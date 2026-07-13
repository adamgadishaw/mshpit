const DEFAULT_READ_TIMEOUT_MS = 20_000;
const DEFAULT_WRITE_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

export function resolveRequestTimeout(method = "GET", requested) {
  if (requested !== undefined && requested !== null) {
    const value = Number(requested);
    if (Number.isFinite(value) && value > 0) return Math.min(MAX_TIMEOUT_MS, Math.max(1, Math.round(value)));
  }
  const verb = String(method).toUpperCase();
  return verb === "GET" || verb === "HEAD" ? DEFAULT_READ_TIMEOUT_MS : DEFAULT_WRITE_TIMEOUT_MS;
}
// Combines Pit's deadline with a caller's cancellation signal without relying on
// AbortSignal.any(), which is not consistently available across every native JS
// runtime. Call cleanup() in every completion path.
export function createRequestControl({ method, timeoutMs, callerSignal } = {}) {
  const controller = new AbortController();
  const duration = resolveRequestTimeout(method, timeoutMs);
  let timedOut = false;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);

  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener?.("abort", abortFromCaller, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, duration);

  return {
    signal: controller.signal,
    timeoutMs: duration,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener?.("abort", abortFromCaller);
    },
  };
}
