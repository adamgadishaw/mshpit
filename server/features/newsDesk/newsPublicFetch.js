import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";

const MAX_REDIRECTS = 3;
const USER_AGENT = "MshpitNewsDesk/1.0 (+https://www.mshpit.com/news)";
const fault = code => Object.assign(new Error("The publisher response could not be safely read."), { code });
const cancelled = signal => fault(signal?.reason?.name === "TimeoutError" ? "publisher_timeout" : "publisher_aborted");
const siteOf = hostname => {
  const labels = hostname.toLowerCase().split(".");
  const secondLevel = labels.length > 2 && labels.at(-1).length === 2 && labels.at(-2).length <= 3;
  return labels.slice(secondLevel ? -3 : -2).join(".");
};
function safeUrl(url) {
  return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash
    && url.hostname.length <= 253 && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/u.test(url.hostname)
    && !isIP(url.hostname) && !url.hostname.split(".").some(label => !label || label.length > 63);
}
export function allowedRedirect(from, to) {
  return safeUrl(to) && (to.hostname === siteOf(from.hostname) || to.hostname.endsWith("." + siteOf(from.hostname)));
}

const NON_PUBLIC = new BlockList();
const GLOBAL_V6 = new BlockList();
GLOBAL_V6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]]) NON_PUBLIC.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64],
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]]) NON_PUBLIC.addSubnet(address, prefix, "ipv6");

export function publicAddress(address) {
  const value = String(address || "").toLowerCase();
  if (value.includes("%")) return false;
  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u)?.[1];
  if (mapped) return publicAddress(mapped);
  const family = isIP(value);
  if (family === 6 && (value.startsWith("::ffff:") || !GLOBAL_V6.check(value, "ipv6"))) return false;
  return family !== 0 && !NON_PUBLIC.check(value, family === 6 ? "ipv6" : "ipv4");
}

// Abort stops waiting for OS DNS; a late resolution can never open a socket.
export async function assertPublicHost(hostname, { resolve = lookup, signal } = {}) {
  const answers = await new Promise((done, reject) => {
    const abort = () => reject(cancelled(signal));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => resolve(hostname, { all: true, verbatim: true }))
      .then(done, () => reject(fault("publisher_dns")))
      .finally(() => signal?.removeEventListener("abort", abort));
  });
  if (signal?.aborted) throw cancelled(signal);
  if (!Array.isArray(answers) || !answers.length || answers.length > 32 || !answers.every(answer => publicAddress(answer?.address))) {
    throw Object.assign(new Error("publisher host does not resolve to a public address"), { code: "publisher_address" });
  }
  return answers.map(({ address }) => ({ address, family: isIP(address) }));
}

// Native HTTPS gets only this checked answer set. It never resolves the host a
// second time. Keep the URL hostname for TLS SNI/certificate verification/Host.
function pinnedLookup(hostname, addresses, signal) {
  return (requested, options, callback) => {
    if (typeof options === "function") { callback = options; options = {}; }
    queueMicrotask(() => {
      if (signal.aborted) { callback(cancelled(signal)); return; }
      if (requested.toLowerCase() !== hostname) { callback(fault("publisher_address")); return; }
      const family = typeof options === "number" ? options : options?.family;
      const selected = addresses.filter(answer => !family || answer.family === family);
      if (!selected.length) { callback(fault("publisher_address")); return; }
      if (options?.all) callback(null, selected.map(answer => ({ ...answer })));
      else callback(null, selected[0].address, selected[0].family);
    });
  };
}

function readHop(url, { addresses, signal, requestImpl, accept, maxBytes }) {
  return new Promise((resolve, reject) => {
    let req, response, decoder, finished = false;
    const cleanup = () => signal.removeEventListener("abort", abort);
    const fail = error => {
      if (finished) return;
      finished = true;
      cleanup();
      response?.destroy();
      decoder?.destroy();
      req?.destroy();
      reject(error);
    };
    const succeed = value => {
      if (finished) return;
      finished = true; cleanup(); resolve(value);
    };
    const abort = () => fail(cancelled(signal));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    try {
      req = requestImpl(url, { method: "GET", agent: false, servername: url.hostname, rejectUnauthorized: true,
        lookup: pinnedLookup(url.hostname, addresses, signal), signal, maxHeaderSize: 16 * 1024,
        headers: { "user-agent": USER_AGENT, accept, "accept-encoding": "gzip, deflate, br" } }, incoming => {
        response = incoming;
        response.on("error", () => fail(fault("publisher_body")));
        response.on("aborted", () => fail(fault("publisher_body")));
        if (finished || signal.aborted) { response.destroy(); abort(); return; }
        const status = response.statusCode;
        const location = response.headers.location;
        if (status >= 300 && status < 400 && typeof location === "string" && location.length <= 2048) {
          succeed({ location }); response.destroy(); req?.destroy(); return;
        }
        if (!(status >= 200 && status < 300)) { fail(fault("publisher_http")); return; }
        const length = response.headers["content-length"];
        if (length !== undefined && (typeof length !== "string" || !/^\d{1,10}$/u.test(length) || Number(length) > maxBytes)) {
          fail(fault("publisher_size")); return;
        }
        const encoding = String(response.headers["content-encoding"] || "identity").trim().toLowerCase();
        if (!["identity", "gzip", "deflate", "br"].includes(encoding)) { fail(fault("publisher_encoding")); return; }
        decoder = encoding === "gzip" ? createGunzip({ chunkSize: 16 * 1024 })
          : encoding === "deflate" ? createInflate({ chunkSize: 16 * 1024 })
            : encoding === "br" ? createBrotliDecompress({ chunkSize: 16 * 1024 }) : null;
        let wireBytes = 0, decodedBytes = 0, ended = false;
        const chunks = [];
        response.on("data", chunk => {
          wireBytes += chunk.byteLength;
          if (wireBytes > maxBytes) fail(fault("publisher_size"));
        });
        response.on("end", () => {
          ended = true;
          if (length !== undefined && wireBytes !== Number(length)) fail(fault("publisher_body"));
        });
        response.on("close", () => { if (!ended) fail(fault("publisher_body")); });
        const body = decoder || response;
        body.on("error", () => fail(fault("publisher_body")));
        body.on("data", chunk => {
          if (finished) return;
          decodedBytes += chunk.byteLength;
          if (decodedBytes > maxBytes) { fail(fault("publisher_size")); return; }
          chunks.push(chunk);
        });
        body.on("end", () => {
          if (signal.aborted) { abort(); return; }
          succeed({ text: Buffer.concat(chunks, decodedBytes).toString("utf8") });
        });
        if (decoder) response.pipe(decoder);
      });
      req.on("error", () => fail(signal.aborted ? cancelled(signal) : fault("publisher_transport")));
      req.end();
    } catch { fail(fault("publisher_transport")); }
  });
}

// All dependencies are injected only by server tests. No caller-supplied
// dispatcher/proxy/TLS override, cookie, credential or header reaches HTTPS.
export async function fetchNewsText(value, { signal, timeoutMs = 15_000, maxBytes = 3 * 1024 * 1024,
  accept = "text/html", resolve = lookup, requestImpl = request } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 3 * 1024 * 1024) throw new TypeError("Invalid news request limits.");
  let first;
  try { first = new URL(value); } catch { throw fault("publisher_url"); }
  if (!safeUrl(first)) throw fault("publisher_url");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Publisher deadline exceeded.", "TimeoutError")), timeoutMs);
  timer.unref?.();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let current = first;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const addresses = await assertPublicHost(current.hostname, { resolve, signal: combined });
      const result = await readHop(current, { addresses, signal: combined, requestImpl, accept, maxBytes });
      if (result.text !== undefined) return result.text;
      let next;
      try { next = new URL(result.location, current); } catch { throw fault("publisher_redirect"); }
      if (!allowedRedirect(first, next) || hop === MAX_REDIRECTS) throw fault("publisher_redirect");
      current = next;
    }
    throw fault("publisher_redirect");
  } finally { clearTimeout(timer); }
}
