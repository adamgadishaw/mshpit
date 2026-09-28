import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { Readable, PassThrough } from "node:stream";
import { gzipSync, deflateSync, brotliCompressSync } from "node:zlib";
import { fetchNewsText, publicAddress } from "./newsPublicFetch.js";

const PUBLIC = [{ address: "151.101.1.1", family: 4 }, { address: "2a04:4e42::1", family: 6 }];
function transport(responses = [{ body: Buffer.from("<title>News</title>") }]) {
  const calls = [];
  const requestImpl = (url, options, respond) => {
    const entry = { url: url.href, options, destroyed: false };
    calls.push(entry);
    const req = new EventEmitter();
    req.destroy = () => { entry.destroyed = true; entry.response?.destroy(); };
    req.end = () => {
      options.lookup(url.hostname, { all: true }, (error, addresses) => {
        if (error) { req.emit("error", error); return; }
        entry.addresses = addresses;
        const item = responses[calls.indexOf(entry)] || responses.at(-1);
        if (item.error) { req.emit("error", new Error("private TLS detail")); return; }
        if (item.headersNeverArrive) return;
        const response = item.stall ? new PassThrough() : Readable.from(item.chunks || [item.body || Buffer.alloc(0)]);
        response.statusCode = item.status || 200; response.headers = item.headers || {};
        entry.response = response;
        respond(response);
      });
    };
    return req;
  };
  return { calls, requestImpl };
}
const safeDns = async () => PUBLIC;
const errorCode = code => error => error.code === code && !/private TLS detail|secret/u.test(error.message);

test("the HTTPS socket lookup uses only the vetted DNS answer, preserving TLS host verification", async () => {
  let resolutions = 0;
  const wire = transport();
  const text = await fetchNewsText("https://www.nme.com/news/item", {
    resolve: async () => ++resolutions === 1 ? PUBLIC : [{ address: "127.0.0.1" }], requestImpl: wire.requestImpl });
  assert.match(text, /News/); assert.equal(resolutions, 1);
  const [{ options, addresses }] = wire.calls;
  assert.deepEqual(addresses, PUBLIC);
  assert.equal(options.servername, "www.nme.com");
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.agent, false, "no pooled socket can bypass the pinned lookup");
  assert.equal(options.method, "GET");
  assert.equal(options.maxHeaderSize, 16384);
  await new Promise((resolve, reject) => options.lookup("www.nme.com", { family: 4 }, (error, address, family) => {
    if (error) { reject(error); return; }
    assert.equal(address, PUBLIC[0].address); assert.equal(family, 4); resolve();
  }));
  await new Promise(resolve => options.lookup("other.nme.com", {}, error => { assert.equal(error.code, "publisher_address"); resolve(); }));
});

test("invalid starting destinations and private/mixed DNS never create a connection", async () => {
  for (const url of ["http://www.nme.com/a", "https://user:secret@www.nme.com/a", "https://www.nme.com:444/a",
    "https://127.0.0.1/a", "https://[::1]/a", "https://www.nme.com./a", "https://www.nme.com/a#secret"]) {
    await assert.rejects(fetchNewsText(url, { resolve: () => assert.fail("no DNS"), requestImpl: () => assert.fail("no socket") }), errorCode("publisher_url"));
  }
  for (const addresses of [[], [{ address: "127.0.0.1" }], [...PUBLIC, { address: "10.0.0.1" }], [{ address: "::ffff:127.0.0.1" }],
    [{ address: "2002:0a00:1::" }], [{ address: "64:ff9b:1::a00:1" }], [{ address: "::127.0.0.1" }],
    [{ address: "2001:2::1" }], [{ address: "2606:4700::1111%eth0" }], [{ address: "invalid" }]]) {
    await assert.rejects(fetchNewsText("https://www.nme.com/a", {
      resolve: async () => addresses, requestImpl: () => assert.fail("no private connection") }), errorCode("publisher_address"));
  }
  assert.equal(publicAddress("2001::a00:1"), false, "Teredo cannot tunnel a private destination");
});

test("redirects remain same-site HTTPS and each redirect gets a freshly pinned public address", async () => {
  const wire = transport([{ status: 302, headers: { location: "https://amp.nme.com/news/item" } }, { body: Buffer.from("news") }]);
  const hosts = [];
  assert.equal(await fetchNewsText("https://www.nme.com/a", { requestImpl: wire.requestImpl,
    resolve: async host => { hosts.push(host); return PUBLIC; } }), "news");
  assert.deepEqual(hosts, ["www.nme.com", "amp.nme.com"]);
  assert.equal(wire.calls[0].destroyed, true);
  assert.equal(wire.calls[1].options.servername, "amp.nme.com");
  for (const target of ["http://www.nme.com/a", "https://attacker.test/a", "https://127.0.0.1/", "https://user:secret@amp.nme.com/a"]) {
    const denied = transport([{ status: 302, headers: { location: target } }]);
    await assert.rejects(fetchNewsText("https://www.nme.com/a", { requestImpl: denied.requestImpl, resolve: safeDns }), errorCode("publisher_redirect"));
    assert.equal(denied.calls.length, 1);
  }
  const privateHop = transport([{ status: 302, headers: { location: "https://amp.nme.com/a" } }]);
  await assert.rejects(fetchNewsText("https://www.nme.com/a", { requestImpl: privateHop.requestImpl,
    resolve: async host => host === "www.nme.com" ? PUBLIC : [{ address: "169.254.169.254" }] }), errorCode("publisher_address"));
  assert.equal(privateHop.calls.length, 1);
  const loop = transport([{ status: 302, headers: { location: "/again" } }]);
  await assert.rejects(fetchNewsText("https://www.nme.com/a", { requestImpl: loop.requestImpl, resolve: safeDns }), errorCode("publisher_redirect"));
  assert.equal(loop.calls.length, 4, "three redirects and at most four requests");
});

test("DNS cancellation and deadline finish without opening a socket, including late DNS completion", async () => {
  const controller = new AbortController(); let complete, calls = 0;
  const run = fetchNewsText("https://www.nme.com/a", { signal: controller.signal,
    resolve: () => new Promise(resolve => { complete = resolve; }), requestImpl: () => { calls++; } });
  await Promise.resolve(); controller.abort();
  await assert.rejects(run, errorCode("publisher_aborted"));
  complete(PUBLIC); await new Promise(setImmediate); assert.equal(calls, 0);
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(fetchNewsText("https://www.nme.com/a", { timeoutMs: 10,
      resolve: () => new Promise(() => {}), requestImpl: () => assert.fail("no socket") }), errorCode("publisher_timeout"));
  } finally { clearTimeout(keepAlive); }
});

test("caller abort and deadline destroy active requests and streams; TLS failures are sanitized", async () => {
  for (const item of [{ headersNeverArrive: true }, { stall: true }, { stall: true, headers: { "content-encoding": "gzip" } }]) {
    const wire = transport([item]); const controller = new AbortController();
    const run = fetchNewsText("https://www.nme.com/a", { resolve: safeDns, requestImpl: wire.requestImpl, signal: controller.signal });
    await new Promise(setImmediate); controller.abort();
    await assert.rejects(run, errorCode("publisher_aborted")); assert.equal(wire.calls[0].destroyed, true);
  }
  const wire = transport([{ headersNeverArrive: true }]); const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(fetchNewsText("https://www.nme.com/a", { timeoutMs: 10, resolve: safeDns, requestImpl: wire.requestImpl }), errorCode("publisher_timeout"));
    assert.equal(wire.calls[0].destroyed, true);
  } finally { clearTimeout(keepAlive); }
  const failed = transport([{ error: true }]);
  await assert.rejects(fetchNewsText("https://www.nme.com/a", { resolve: safeDns, requestImpl: failed.requestImpl }), errorCode("publisher_transport"));
});

test("gzip, deflate and Brotli decode with independent compressed and decoded byte caps", async () => {
  const text = "<title>Music news</title>";
  for (const [encoding, encode] of [["gzip", gzipSync], ["deflate", deflateSync], ["br", brotliCompressSync]]) {
    const body = encode(Buffer.from(text));
    const wire = transport([{ body, headers: { "content-encoding": encoding, "content-length": String(body.length) } }]);
    assert.equal(await fetchNewsText("https://www.nme.com/a", { maxBytes: 1024, resolve: safeDns, requestImpl: wire.requestImpl }), text);
    const bomb = transport([{ body: encode(Buffer.alloc(50_000, 65)), headers: { "content-encoding": encoding } }]);
    await assert.rejects(fetchNewsText("https://www.nme.com/a", { maxBytes: 1024, resolve: safeDns, requestImpl: bomb.requestImpl }), errorCode("publisher_size"));
    assert.equal(bomb.calls[0].destroyed, true);
  }
});

test("oversize, truncated, malformed encoding and HTTP failures never return partial text", async () => {
  for (const [item, code] of [
    [{ chunks: [Buffer.alloc(32), Buffer.alloc(33)] }, "publisher_size"],
    [{ headers: { "content-length": "65" } }, "publisher_size"],
    [{ body: Buffer.from("short"), headers: { "content-length": "12" } }, "publisher_body"],
    [{ body: Buffer.from("bad"), headers: { "content-encoding": "gzip" } }, "publisher_body"],
    [{ body: Buffer.from("bad"), headers: { "content-encoding": "gzip, br" } }, "publisher_encoding"],
    [{ status: 503, body: Buffer.from("secret provider body") }, "publisher_http"],
  ]) {
    const wire = transport([item]);
    await assert.rejects(fetchNewsText("https://www.nme.com/a", { maxBytes: 64, resolve: safeDns, requestImpl: wire.requestImpl }), errorCode(code));
    assert.equal(wire.calls[0].destroyed, true);
  }
});
