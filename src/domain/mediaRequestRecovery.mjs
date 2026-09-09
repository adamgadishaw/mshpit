const RETRY_DELAYS_MS = Object.freeze([2_000, 5_000]);

export function mediaRequestWasTemporary(error) {
  if (!error || error.name === "AbortError" || error.stale === true || error.retryable === false) return false;
  const code = String(error.serverCode || error.code || "");
  const status = Number(error.status) || 0;
  if (/^(?:AUTH_|MEDIA_ACCOUNT_|MEDIA_EMAIL_|IDENTITY_|VALIDATION_|FORBIDDEN|CONFLICT|RATE_LIMITED|MEDIA_UPLOAD_QUOTA_)/u.test(code)
    || /^PIT-(?:AUTH|REQ)-/u.test(code)) return false;
  if (status >= 400 && status < 500) return status === 408;
  if ([500, 502, 503, 504].includes(status)) return true;
  return status === 0 && ["PIT-NET-001", "PIT-NET-002", "NETWORK_ERROR", "TIMEOUT"].includes(code);
}

function cancelled(signal) {
  const error = new Error("Media upload was cancelled.", signal?.reason instanceof Error ? { cause: signal.reason } : undefined);
  error.name = "AbortError";
  return error;
}

function timedOut() {
  const error = new Error("The media connection timed out. Your selected media is still available; try again.");
  error.code = "PIT-NET-002";
  error.status = 0;
  error.retryable = true;
  return error;
}

// Abort alone does not settle every native/browser transport. This deadline
// also settles the caller and observes late responses without adopting them.
export function boundedMediaRequest(request, { signal, timeoutMs = 30_000 } = {}) {
  if (typeof request !== "function" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("A bounded media request is required.");
  }
  if (signal?.aborted) return Promise.reject(cancelled(signal));
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let finished = false;
    let timer;
    const finish = (settle, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", cancel);
      settle(value);
    };
    const cancel = () => { const error = cancelled(signal); finish(reject, error); controller.abort(error); };
    signal?.addEventListener?.("abort", cancel, { once: true });
    timer = setTimeout(() => { const error = timedOut(); finish(reject, error); controller.abort(error); }, timeoutMs);
    let pending;
    try { pending = request({ signal: controller.signal }); }
    catch (error) { finish(reject, error); return; }
    Promise.resolve(pending).then(
      (value) => signal?.aborted ? cancel() : finish(resolve, value),
      (error) => signal?.aborted ? cancel() : finish(reject, error),
    );
  });
}

export function waitForMediaRecovery(ms, signal) {
  if (signal?.aborted) return Promise.reject(cancelled(signal));
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener?.("abort", cancel); resolve(); };
    const timer = setTimeout(finish, ms);
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener?.("abort", cancel); reject(cancelled(signal)); };
    signal?.addEventListener?.("abort", cancel, { once: true });
  });
}

// Only explicitly idempotent media control-plane calls use this helper. It is
// not a policy for posts, arbitrary mutations, or replaying original file PUTs.
export async function recoverMediaRequest(request, {
  signal, onRetry, requestTimeoutMs = 10_000, totalTimeoutMs = 30_000,
  now = Date.now, wait = waitForMediaRecovery,
} = {}) {
  const deadline = now() + totalTimeoutMs;
  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    if (signal?.aborted) throw cancelled(signal);
    const remaining = deadline - now();
    if (!Number.isFinite(remaining) || remaining <= 0) throw lastError || timedOut();
    try {
      return await boundedMediaRequest(request, { signal, timeoutMs: Math.min(requestTimeoutMs, remaining) });
    } catch (error) {
      if (signal?.aborted) throw cancelled(signal);
      if (!mediaRequestWasTemporary(error) || attempt === RETRY_DELAYS_MS.length) throw error;
      lastError = error;
      const remainingAfter = deadline - now();
      if (remainingAfter <= RETRY_DELAYS_MS[attempt]) throw error;
      onRetry?.({ attempt: attempt + 2, error });
      await wait(RETRY_DELAYS_MS[attempt], signal);
    }
  }
  throw lastError;
}
