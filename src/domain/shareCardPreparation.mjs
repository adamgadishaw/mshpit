export const SHARE_CARD_PREPARATION_TIMEOUT_MS = 15_000;

const aborted = (signal) => {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error("Share card preparation was cancelled.");
  error.name = "AbortError";
  return error;
};

// A transport abort is best-effort on some platforms. Settle the UI deadline
// independently, and release any private asset delivered after cancellation.
export function prepareShareCardAsset(prepare, {
  signal,
  release,
  timeoutMs = SHARE_CARD_PREPARATION_TIMEOUT_MS,
  timeoutError = () => new Error("Share card preparation timed out."),
} = {}) {
  if (typeof prepare !== "function" || typeof release !== "function"
    || typeof timeoutError !== "function" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Share card preparation requires bounded lifecycle dependencies.");
  }
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    let timer;
    const finish = (failed, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", cancel);
      if (failed) reject(value);
      else resolve(value);
    };
    const cancel = () => {
      const error = aborted(signal);
      finish(true, error);
      controller.abort(error);
    };
    if (signal?.aborted) { cancel(); return; }
    signal?.addEventListener?.("abort", cancel, { once: true });
    timer = setTimeout(() => {
      let error;
      try { error = timeoutError(); } catch (cause) { error = cause; }
      finish(true, error);
      controller.abort(error);
    }, timeoutMs);
    let pending;
    try { pending = prepare({ signal: controller.signal }); }
    catch (error) { finish(true, error); return; }
    Promise.resolve(pending).then((asset) => {
      if (settled) {
        if (asset) {
          try { release(asset); } catch {
            // architecture: allow-empty-catch -- best-effort late private asset cleanup must not create an unhandled rejection after the UI has settled.
          }
        }
        return;
      }
      finish(false, asset);
    }, (error) => finish(true, error));
  });
}
