export const MEDIA_UPLOAD_TIMEOUT_MIN_MS = 45_000;
export const MEDIA_UPLOAD_VIDEO_TIMEOUT_MIN_MS = 300_000;
export const MEDIA_UPLOAD_TIMEOUT_MAX_MS = 45 * 60_000;

const MEDIA_UPLOAD_STARTUP_ALLOWANCE_MS = 30_000;
const MEDIA_UPLOAD_MIN_BYTES_PER_SECOND = 192 * 1024;

export function normalizeMediaUploadTimeoutMs(value) {
  const numeric = Number(value);
  if (numeric === Number.POSITIVE_INFINITY) return MEDIA_UPLOAD_TIMEOUT_MAX_MS;
  if (!Number.isFinite(numeric)) return MEDIA_UPLOAD_TIMEOUT_MIN_MS;
  return Math.min(MEDIA_UPLOAD_TIMEOUT_MAX_MS, Math.max(1_000, Math.round(numeric)));
}

// Size the default deadline for a conservative mobile uplink instead of using
// a single photo-era timeout. The cap keeps a stalled transfer finite; explicit
// user cancellation remains independent and immediate.
export function mediaUploadTimeoutMs(prepared = {}) {
  const fileSize = Number(prepared?.fileSize);
  const bytes = Number.isSafeInteger(fileSize) && fileSize > 0 ? fileSize : 0;
  const transferAllowance = MEDIA_UPLOAD_STARTUP_ALLOWANCE_MS
    + Math.ceil((bytes / MEDIA_UPLOAD_MIN_BYTES_PER_SECOND) * 1_000);
  const floor = prepared?.kind === "video"
    ? MEDIA_UPLOAD_VIDEO_TIMEOUT_MIN_MS
    : MEDIA_UPLOAD_TIMEOUT_MIN_MS;
  return Math.min(MEDIA_UPLOAD_TIMEOUT_MAX_MS, Math.max(floor, transferAllowance));
}

export function createMediaUploadDeadline(timeoutMs, {
  signal,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  const controller = new AbortController();
  const boundedTimeoutMs = normalizeMediaUploadTimeoutMs(timeoutMs);
  let timedOut = false;
  let disposed = false;
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener?.("abort", cancel, { once: true });
  const timer = setTimeoutFn(() => {
    if (signal?.aborted) {
      controller.abort();
      return;
    }
    timedOut = true;
    controller.abort();
  }, boundedTimeoutMs);
  return {
    signal: controller.signal,
    timeoutMs: boundedTimeoutMs,
    get timedOut() { return timedOut; },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeoutFn(timer);
      signal?.removeEventListener?.("abort", cancel);
    },
  };
}
