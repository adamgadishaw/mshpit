// Anonymous, read-only privacy proof. A deadline settles independently of the
// transport so a stuck socket cannot occupy the only recovery check forever.
function responseStatus(response) {
  const value = Number(response?.status);
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

// A temporary provider failure does not prove either privacy or public access.
// Keep uploads closed, but let the monitor retry it promptly rather than wait
// the five-minute interval reserved for configuration/exposure failures.
function transientResponse(status) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function retryAfterMs(response, at) {
  const raw = response?.headers?.get?.("retry-after");
  if (typeof raw !== "string" || raw.length > 128) return 0;
  const value = raw.trim();
  const duration = /^\d+$/.test(value) ? Number(value) * 1_000 : Date.parse(value) - at;
  // Keep the timer in Node's supported range; overflow otherwise retries in 1ms.
  return Number.isFinite(duration) && duration > 0 ? Math.min(2_147_483_647, Math.ceil(duration)) : 0;
}

function releaseBody(body) {
  if (!body || body.locked || typeof body.cancel !== "function") return;
  try { Promise.resolve(body.cancel()).catch(() => {}); } // architecture: allow-empty-catch -- response cleanup is best-effort
  catch { /* architecture: allow-empty-catch -- response cleanup cannot prevent recovery */ }
}

async function boundedBody(response, signal) {
  const maxBytes = 512;
  const declared = Number(response?.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const reader = response?.body?.getReader?.();
  if (!reader) {
    if (typeof response?.text !== "function") return null;
    const value = String(await response.text());
    return Buffer.byteLength(value, "utf8") <= maxBytes ? value : null;
  }
  const cancel = () => {
    try { Promise.resolve(reader.cancel()).catch(() => {}); } // architecture: allow-empty-catch -- bounded read cleanup
    catch { /* architecture: allow-empty-catch -- preserve the probe result */ }
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks = [];
  let total = 0;
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value?.byteLength || 0;
      if (total > maxBytes) { cancel(); return null; }
      chunks.push(value);
    }
    if (signal.aborted) return null;
    return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock?.();
  }
}

async function denied(response, endpoint, signal) {
  const status = responseStatus(response);
  if (status === 401 || status === 403) return true;
  // R2's S3 API uses this exact unsigned-authorization response. A generic
  // 400, a 404, an exposed bucket, or a lookalike host never proves privacy.
  const hostname = String(endpoint?.hostname || "").toLowerCase();
  if (status !== 400 || !/^[a-f0-9]{32}\.(?:(?:eu|fedramp)\.)?r2\.cloudflarestorage\.com$/.test(hostname)) return false;
  const body = await boundedBody(response, signal);
  if (!body) return false;
  const compact = body.trim().replace(/>\s+</g, "><");
  return compact === '<?xml version="1.0" encoding="UTF-8"?><Error><Code>InvalidArgument</Code><Message>Authorization</Message></Error>'
    || compact === "<Error><Code>InvalidArgument</Code><Message>Authorization</Message></Error>";
}

export async function probePrivateMediaIsolation({ listUrl, objectUrl, endpoint, fetchImpl, timeoutMs = 5_000, signal, clock = Date.now } = {}) {
  if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason || new DOMException("Aborted", "AbortError"));
  signal?.addEventListener("abort", abort, { once: true });
  const responses = new Set();
  let rejectAbort;
  const interrupted = new Promise((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(controller.signal.reason);
  controller.signal.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(new DOMException("Privacy probe timed out", "TimeoutError")),
    Math.max(500, Math.min(15_000, Math.trunc(Number(timeoutMs) || 5_000))));
  timeout.unref?.();
  let listStatus = null;
  let objectStatus = null;
  let retryDelayMs = 0;
  const fetchProbe = async (url, kind) => {
    const response = await fetchImpl(url, { method: "GET", redirect: "error", signal: controller.signal });
    responses.add(response);
    if (controller.signal.aborted) {
      releaseBody(response?.body);
      throw controller.signal.reason;
    }
    const status = responseStatus(response);
    if (kind === "list") listStatus = status;
    else objectStatus = status;
    if (transientResponse(status)) retryDelayMs = Math.max(retryDelayMs, retryAfterMs(response, clock()));
    return response;
  };
  try {
    const work = (async () => {
      const [list, object] = await Promise.all([fetchProbe(listUrl, "list"), fetchProbe(objectUrl, "object")]);
      const results = await Promise.all([denied(list, endpoint, controller.signal), denied(object, endpoint, controller.signal)]);
      if (results.every(Boolean)) return null;
      const statuses = [listStatus, objectStatus];
      // A definite unexpected response takes precedence over a transient peer:
      // a public listing plus a 503 object probe is still a privacy failure.
      if (results.some((isDenied, index) => !isDenied && !transientResponse(statuses[index]))) {
        return "anonymous_access_not_denied";
      }
      return "probe_http_unavailable";
    })();
    const errorCode = await Promise.race([work, interrupted]);
    return { listStatus, objectStatus, errorCode, ...(errorCode && retryDelayMs > 0 ? { retryAfterMs: retryDelayMs } : {}) };
  } catch {
    if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
    return { listStatus, objectStatus, errorCode: controller.signal.aborted ? "probe_timeout" : "probe_failed",
      ...(retryDelayMs > 0 ? { retryAfterMs: retryDelayMs } : {}) };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", onAbort);
    controller.abort();
    for (const response of responses) releaseBody(response?.body);
  }
}
