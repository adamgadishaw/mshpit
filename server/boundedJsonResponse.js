const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const ABSOLUTE_MAX_BYTES = 16 * 1024 * 1024;

function byteLimit(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > ABSOLUTE_MAX_BYTES) {
    throw new RangeError(`JSON response limit must be between 1 and ${ABSOLUTE_MAX_BYTES} bytes.`);
  }
  return parsed;
}

function abortReason(signal, fallback) {
  if (!signal?.aborted) return null;
  return signal.reason || fallback || new DOMException("Aborted", "AbortError");
}

function declaredLength(response) {
  const raw = response?.headers?.get?.("content-length");
  if (raw == null || String(raw).trim() === "") return null;
  const text = String(raw).trim();
  const parsed = /^\d+$/u.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new BoundedJsonResponseError("Provider response declared an invalid body length.", {
      code: "invalid_content_length",
    });
  }
  return parsed;
}

function jsonBytes(value) {
  const encoded = JSON.stringify(value);
  return encoded == null ? null : Buffer.byteLength(encoded, "utf8");
}

export class BoundedJsonResponseError extends Error {
  constructor(message, { code = "invalid_json", maxBytes = null, receivedBytes = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "BoundedJsonResponseError";
    this.code = code;
    this.maxBytes = maxBytes;
    this.receivedBytes = receivedBytes;
  }
}

/**
 * Parse a provider JSON response without allowing an unbounded body allocation.
 *
 * Real fetch Responses are streamed and stopped as soon as the byte ceiling is
 * crossed. The json()-only branch exists for injected test/provider adapters;
 * it still rejects an oversized decoded value, but production fetch never uses
 * that compatibility path.
 */
export async function readBoundedJsonResponse(response, {
  maxBytes = DEFAULT_MAX_BYTES,
  signal,
} = {}) {
  const limit = byteLimit(maxBytes);
  const initiallyAborted = abortReason(signal);
  if (initiallyAborted) throw initiallyAborted;

  let announced;
  try {
    announced = declaredLength(response);
  } catch (error) {
    try { await response?.body?.cancel?.(); }
    catch { /* architecture: allow-empty-catch -- best-effort stream disposal must not replace the invalid-header error */ }
    throw error;
  }
  if (announced != null && announced > limit) {
    try { await response?.body?.cancel?.(); }
    catch { /* architecture: allow-empty-catch -- best-effort stream disposal must not replace the bounded-size error */ }
    throw new BoundedJsonResponseError("Provider response exceeded its allowed size.", {
      code: "response_too_large",
      maxBytes: limit,
      receivedBytes: announced,
    });
  }

  if (response?.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parts = [];
    let received = 0;
    const abort = () => {
      try { void reader.cancel(abortReason(signal)); }
      catch { /* architecture: allow-empty-catch -- the caller's abort remains the authoritative cancellation result */ }
    };
    signal?.addEventListener?.("abort", abort, { once: true });
    try {
      while (true) {
        const chunk = await reader.read();
        const aborted = abortReason(signal);
        if (aborted) throw aborted;
        if (chunk.done) break;
        const bytes = chunk.value instanceof Uint8Array ? chunk.value : new Uint8Array(chunk.value || []);
        received += bytes.byteLength;
        if (received > limit) {
          try { await reader.cancel(); }
          catch { /* architecture: allow-empty-catch -- stream cleanup must not hide the response-too-large result */ }
          throw new BoundedJsonResponseError("Provider response exceeded its allowed size.", {
            code: "response_too_large",
            maxBytes: limit,
            receivedBytes: received,
          });
        }
        parts.push(decoder.decode(bytes, { stream: true }));
      }
      parts.push(decoder.decode());
      try {
        return JSON.parse(parts.join(""));
      } catch (error) {
        throw new BoundedJsonResponseError("Provider returned invalid JSON.", {
          code: "invalid_json",
          maxBytes: limit,
          receivedBytes: received,
          cause: error,
        });
      }
    } catch (error) {
      const aborted = abortReason(signal, error);
      if (aborted) throw aborted;
      throw error;
    } finally {
      signal?.removeEventListener?.("abort", abort);
      try { reader.releaseLock?.(); }
      catch { /* architecture: allow-empty-catch -- lock release is best-effort after the body has already settled */ }
    }
  }

  // A real fetch Response with JSON has a web stream. This bounded-after-decode
  // compatibility path keeps existing injected adapters usable in unit tests
  // and in provider SDK shims that expose only json().
  if (typeof response?.json === "function") {
    let value;
    try {
      value = await response.json();
    } catch (error) {
      const aborted = abortReason(signal, error);
      if (aborted) throw aborted;
      throw new BoundedJsonResponseError("Provider returned invalid JSON.", {
        code: "invalid_json",
        maxBytes: limit,
        cause: error,
      });
    }
    let received;
    try {
      received = jsonBytes(value);
    } catch (error) {
      throw new BoundedJsonResponseError("Provider returned invalid JSON.", {
        code: "invalid_json",
        maxBytes: limit,
        cause: error,
      });
    }
    if (received == null) {
      throw new BoundedJsonResponseError("Provider returned invalid JSON.", {
        code: "invalid_json",
        maxBytes: limit,
      });
    }
    if (received > limit) {
      throw new BoundedJsonResponseError("Provider response exceeded its allowed size.", {
        code: "response_too_large",
        maxBytes: limit,
        receivedBytes: received,
      });
    }
    return value;
  }

  throw new BoundedJsonResponseError("Provider response body is unavailable.", {
    code: "body_unavailable",
    maxBytes: limit,
  });
}

export const PROVIDER_JSON_LIMITS = Object.freeze({
  standard: DEFAULT_MAX_BYTES,
  musicBrainz: 1024 * 1024,
  wikidata: 4 * 1024 * 1024,
  tourDates: 8 * 1024 * 1024,
});
