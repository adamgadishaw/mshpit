const ARTWORK_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DEFAULT_MAX_BYTES = 6 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 3_000;
const RETRY_DELAY_MS = 200;
const MAX_ATTEMPTS = 2;
const FAILURE_REASONS = new Set([
  "network_unavailable", "network_timeout", "connection_reset", "dns_unavailable", "upstream_http",
]);

export function shareArtworkFailureReason(error) {
  if (FAILURE_REASONS.has(error?.code)) return error.code;
  const code = error?.cause?.code || error?.code;
  if (["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(code)
    || error?.name === "TimeoutError") return "network_timeout";
  if (["ECONNRESET", "EPIPE", "UND_ERR_SOCKET"].includes(code)) return "connection_reset";
  if (["EAI_AGAIN", "ENOTFOUND"].includes(code)) return "dns_unavailable";
  return "network_unavailable";
}

export class ShareArtworkTransientError extends Error {
  constructor(reason = "network_unavailable") {
    super("Social share artwork is temporarily unavailable");
    this.name = "ShareArtworkTransientError";
    this.code = FAILURE_REASONS.has(reason) ? reason : "network_unavailable";
  }
}

function discardBody(body) {
  // Cleanup must not extend a failed request's deadline or retain remote data.
  // architecture: allow-empty-catch -- best-effort cancellation cannot extend the request deadline; transport failures are reported by the read operation.
  try { void Promise.resolve(body?.cancel?.()).catch(() => {}); }
  catch { /* best-effort cleanup of an already closed response */ }
}

function abortReason(signal) {
  return signal?.reason || new DOMException("Aborted", "AbortError");
}

function withArtworkSignal(operation, signal, onLateValue = null) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return false;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback(value);
      return true;
    };
    const onAbort = () => finish(reject, abortReason(signal));
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(operation).then((value) => {
      if (!finish(resolve, value)) onLateValue?.(value);
    }, (error) => finish(reject, error));
  });
}

function retryDelay(response) {
  const raw = response?.headers?.get?.("retry-after");
  if (!raw) return RETRY_DELAY_MS;
  const seconds = /^\d+(?:\.\d+)?$/u.test(raw.trim()) ? Number(raw) : NaN;
  const delay = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(raw) - Date.now();
  return Number.isFinite(delay) ? Math.max(RETRY_DELAY_MS, delay) : RETRY_DELAY_MS;
}

function pauseBeforeRetry(delay, signal) {
  let timer;
  return withArtworkSignal(new Promise((resolve) => { timer = setTimeout(resolve, delay); }), signal)
    .finally(() => clearTimeout(timer));
}

function cleanUrl(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2_048) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.hash) return null;
    return parsed;
  } catch {
    return null;
  }
}

function ownedMediaBase(env) {
  const parsed = cleanUrl(env?.MEDIA_PUBLIC_BASE_URL);
  if (!parsed) return null;
  parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
  parsed.search = "";
  return parsed;
}

function pathIsWithinBase(pathname, basePathname) {
  if (!basePathname || basePathname === "/") return pathname.startsWith("/");
  return pathname === basePathname || pathname.startsWith(`${basePathname}/`);
}

/**
 * Share-card models carry only public projection URLs plus their proven source.
 * Rechecking the first-party public-media origin here prevents the renderer
 * from becoming a general-purpose URL fetcher if a future caller bypasses that
 * projection boundary. A provider hostname proves transport identity, not a
 * right to crop and redistribute the provider's image, so provider-hosted
 * artwork is deliberately ineligible for exported cards.
 */
export function trustedShareArtworkUrl(candidate, { env = process.env } = {}) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const parsed = cleanUrl(candidate.url);
  if (!parsed) return null;
  if (!["owned-media", "licensed-media"].includes(candidate.source)) return null;

  const base = ownedMediaBase(env);
  if (!base || parsed.origin !== base.origin || !pathIsWithinBase(parsed.pathname, base.pathname)) return null;
  return parsed.toString();
}

function responseContentType(response) {
  return String(response?.headers?.get?.("content-type") || "")
    .split(";", 1)[0].trim().toLowerCase();
}

function declaredLength(response, maxBytes) {
  const raw = response?.headers?.get?.("content-length");
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 && value <= maxBytes ? value : false;
}

function detectedArtworkType(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

async function readBoundedBytes(response, { maxBytes, signal }) {
  const declared = declaredLength(response, maxBytes);
  const declaredType = responseContentType(response);
  if (declared === false || !ARTWORK_TYPES.has(declaredType)) {
    discardBody(response?.body);
    return null;
  }
  const reader = response?.body?.getReader?.();
  if (!reader) return null;
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
      const { done, value } = await withArtworkSignal(reader.read(), signal);
      if (done) break;
      const chunk = Buffer.from(value || []);
      total += chunk.length;
      if (total > maxBytes) {
        discardBody(reader);
        return null;
      }
      chunks.push(chunk);
    }
  } catch (error) {
    discardBody(reader);
    throw error;
  } finally {
    reader.releaseLock?.();
  }
  if (total < 12 || (declared != null && total !== declared)) return null;
  const bytes = Buffer.concat(chunks, total);
  return detectedArtworkType(bytes) === declaredType ? bytes : null;
}

export async function loadShareArtwork(candidates, {
  acceptBytes = null,
  acceptErrorIsTerminal = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  maxBytes = DEFAULT_MAX_BYTES,
  signal = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!Array.isArray(candidates) || typeof fetchImpl !== "function") return null;
  const boundedMax = Math.max(1_024, Math.min(DEFAULT_MAX_BYTES, Number(maxBytes) || DEFAULT_MAX_BYTES));
  const boundedTimeout = Math.max(100, Math.min(DEFAULT_TIMEOUT_MS, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  let transientReason = null;

  for (const candidate of candidates.slice(0, 3)) {
    if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
    const url = trustedShareArtworkUrl(candidate, { env });
    if (!url) continue;
    // Give every trusted fallback its own short deadline. A stalled provider
    // image must not consume the artist-profile candidate's opportunity.
    const timeoutSignal = AbortSignal.timeout(boundedTimeout);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const deadline = Date.now() + boundedTimeout;
    let bytes = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      let response = null;
      let retryable = false;
      try {
        if (requestSignal.aborted) throw abortReason(requestSignal);
        response = await withArtworkSignal(fetchImpl(url, {
          method: "GET",
          headers: { Accept: "image/webp,image/png,image/jpeg" },
          redirect: "error",
          signal: requestSignal,
        }), requestSignal, (lateResponse) => discardBody(lateResponse?.body));
        if (!response?.ok) {
          const status = Number(response?.status);
          retryable = !Number.isInteger(status) || status === 408 || status === 429 || status >= 500;
          if (retryable) transientReason = "upstream_http";
          discardBody(response?.body);
        } else {
          bytes = await readBoundedBytes(response, { maxBytes: boundedMax, signal: requestSignal });
        }
      } catch (error) {
        if (signal?.aborted) throw abortReason(signal);
        transientReason = shareArtworkFailureReason(error);
        retryable = true;
      }
      if (signal?.aborted) throw abortReason(signal);
      if (bytes || !retryable || requestSignal.aborted || attempt + 1 >= MAX_ATTEMPTS) break;
      const delay = retryDelay(response);
      // Retry only the same approved image, without resetting its deadline.
      // Honour an upstream cooldown longer than our budget by not retrying.
      if (Date.now() + delay >= deadline) break;
      try { await pauseBeforeRetry(delay, requestSignal); }
      catch (error) {
        if (signal?.aborted) throw abortReason(signal);
        transientReason = shareArtworkFailureReason(error);
        break;
      }
    }
    if (!bytes) continue;
    if (typeof acceptBytes !== "function") return bytes;
    let accepted = null;
    try {
      accepted = await acceptBytes(bytes, candidate);
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw error;
      const terminal = typeof acceptErrorIsTerminal !== "function"
        || acceptErrorIsTerminal(error, candidate) !== false;
      if (!terminal) throw error;
      continue;
    }
    if (accepted) return accepted;
  }
  if (transientReason) throw new ShareArtworkTransientError(transientReason);
  return null;
}

export const socialShareArtworkConstants = Object.freeze({
  maxBytes: DEFAULT_MAX_BYTES,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxAttempts: MAX_ATTEMPTS,
  retryDelayMs: RETRY_DELAY_MS,
});
