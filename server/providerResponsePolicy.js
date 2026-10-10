export const PROVIDER_RETRY_AFTER_MAX_MS = 24 * 60 * 60_000;
const HTTP_DATE = /^(?:[a-z]{3}, \d{2} [a-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT|[a-z]+, \d{2}-[a-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT|[a-z]{3} [a-z]{3} (?: \d|\d{2}) \d{2}:\d{2}:\d{2} \d{4})$/iu;

export function providerRetryAfterMs(response, at = Date.now()) {
  const value = response?.headers?.get?.("retry-after")?.trim();
  if (!value) return null;
  // Delta-seconds is an unsigned integer. Do not let Date.parse interpret a
  // malformed numeric hint (such as -1 or 1.5) as a calendar date.
  if (/^\d+$/u.test(value)) {
    return Math.min(PROVIDER_RETRY_AFTER_MAX_MS, Number(value) * 1_000);
  }
  if (!HTTP_DATE.test(value)) return null;
  const delay = Date.parse(value) - Number(at);
  return Number.isFinite(delay) ? Math.max(0, Math.min(PROVIDER_RETRY_AFTER_MAX_MS, Math.ceil(delay))) : null;
}

export function withProviderRetryDeadline(error, retryAt, at = Date.now()) {
  if (error == null || !["object", "function"].includes(typeof error)
    || !Number.isSafeInteger(retryAt) || retryAt < 0 || !Number.isSafeInteger(at) || at < 0) return error;
  const deadline = Math.min(retryAt, at + PROVIDER_RETRY_AFTER_MAX_MS);
  const timing = {
    retryAt: { value: deadline, writable: true, enumerable: true, configurable: true },
    retryAfterMs: { value: Math.max(0, deadline - at), writable: true, enumerable: true, configurable: true },
  };
  try {
    // Define data properties directly: a custom setter must not replace the
    // provider failure while we attach its effective recovery deadline.
    Object.defineProperties(error, timing);
    return error;
  } catch { /* architecture: allow-empty-catch -- immutable provider errors retain their semantics in the bounded copy below */ }

  const wrapped = new Error("Provider request failed.", { cause: error });
  try {
    const descriptors = Object.getOwnPropertyDescriptors(error);
    if (descriptors.stack && !("value" in descriptors.stack)) {
      // Native Error stack accessors use their receiver's internal stack. Read
      // the original once so the copied error retains the provider call site.
      try {
        descriptors.stack = { value: error.stack, writable: true, enumerable: descriptors.stack.enumerable, configurable: descriptors.stack.configurable };
      } catch {
        // An unusual stack getter must not prevent copying the provider fields.
        delete descriptors.stack;
      }
    }
    delete descriptors.retryAt;
    delete descriptors.retryAfterMs;
    Object.setPrototypeOf(wrapped, Object.getPrototypeOf(error));
    Object.defineProperties(wrapped, descriptors);
  } catch { /* architecture: allow-empty-catch -- an unusual thrown object remains available as the fallback cause */ }
  Object.defineProperties(wrapped, timing);
  return wrapped;
}

// Failed bodies must not hold sockets open or replace the real provider error.
export function discardProviderResponse(response) {
  try { Promise.resolve(response?.body?.cancel?.()).catch(() => undefined); }
  catch { /* architecture: allow-empty-catch -- disposal of an already closed response must not mask the actual provider failure */ }
}
