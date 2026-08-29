const STAGE_LABELS = Object.freeze({
  preparing: "Preparing media",
  "checking-source": "Checking original",
  "preparing-source": "Preparing original",
  "uploading-source": "Uploading original",
  "starting-source": "Starting media check",
  "verifying-source": "Verifying original",
  "processing-source": "Processing original",
  "reconnecting-source": "Reconnecting to media check",
  "uploading-poster": "Uploading video cover",
  "verifying-poster": "Verifying video cover",
  "uploading-render": "Uploading edited photo",
  "verifying-render": "Verifying edited photo",
  ready: "Finishing media",
});

export const MEDIA_TRANSFER_PROGRESS_INTERVAL_MS = 125;

const finiteNonNegative = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
};

export function normalizeMediaTransferProgress(value = {}, expectedBytes = 0) {
  const expected = finiteNonNegative(expectedBytes);
  const reportedTotal = finiteNonNegative(value?.totalBytes);
  const totalBytes = reportedTotal > 0 ? reportedTotal : expected;
  const bytesSent = Math.min(totalBytes || Number.MAX_SAFE_INTEGER, finiteNonNegative(value?.bytesSent));
  return {
    bytesSent,
    totalBytes,
    fraction: totalBytes > 0 ? Math.min(1, bytesSent / totalBytes) : 0,
  };
}

export function mediaUploadProgressCopy(value = {}) {
  const current = Math.max(1, Math.floor(Number(value.current) || 1));
  const total = Math.max(current, Math.floor(Number(value.total) || current));
  const label = STAGE_LABELS[value.stage] || STAGE_LABELS.preparing;
  const fraction = Number(value.fraction);
  const percent = Number.isFinite(fraction) && fraction > 0 && String(value.stage || "").startsWith("uploading-")
    ? ` · ${Math.min(100, Math.max(1, Math.round(fraction * 100)))}%`
    : "";
  return `${label}${percent} · ${current} of ${total}`;
}

function transferProgressSignature(value = {}) {
  const fraction = Number(value.fraction);
  return [
    Math.floor(Number(value.current) || 0),
    Math.floor(Number(value.total) || 0),
    Math.floor(Number(value.completed) || 0),
    String(value.stage || ""),
    Math.floor(Number(value.bytesSent) || 0),
    Math.floor(Number(value.totalBytes) || 0),
    Number.isFinite(fraction) ? Math.round(fraction * 10_000) : 0,
  ].join(":");
}

export function createMediaTransferProgressPublisher({
  publish,
  intervalMs = MEDIA_TRANSFER_PROGRESS_INTERVAL_MS,
  now = () => Date.now(),
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancelSchedule = (handle) => clearTimeout(handle),
} = {}) {
  if (typeof publish !== "function") throw new TypeError("A media progress publisher is required.");
  const interval = Math.max(1, Math.floor(Number(intervalMs) || MEDIA_TRANSFER_PROGRESS_INTERVAL_MS));
  let disposed = false;
  let timer = null;
  let queued = null;
  let queuedSignature = null;
  let lastPublished = null;
  let lastSignature = null;
  let lastPublishedAt = Number.NEGATIVE_INFINITY;

  const clearQueuedTimer = () => {
    if (timer !== null) cancelSchedule(timer);
    timer = null;
  };

  const commit = (value) => {
    if (disposed || !value) return false;
    const signature = transferProgressSignature(value);
    if (signature === lastSignature) return false;
    lastPublished = value;
    lastSignature = signature;
    lastPublishedAt = Number(now()) || 0;
    publish(value);
    return true;
  };

  const flush = (value) => {
    if (disposed) return false;
    if (value) {
      queued = { ...value };
      queuedSignature = transferProgressSignature(queued);
    }
    clearQueuedTimer();
    const next = queued;
    queued = null;
    queuedSignature = null;
    return commit(next);
  };

  const publishProgress = (value, { immediate = false } = {}) => {
    if (disposed || !value) return false;
    const next = { ...value };
    const signature = transferProgressSignature(next);
    const stageChanged = String(next.stage || "") !== String(lastPublished?.stage || "");
    const finalTransfer = String(next.stage || "").startsWith("uploading-")
      && Number(next.fraction) >= 1;
    if (immediate || !lastPublished || stageChanged || next.stage === "ready" || finalTransfer) {
      queued = next;
      queuedSignature = signature;
      return flush();
    }
    if (signature === lastSignature || signature === queuedSignature) return false;
    queued = next;
    queuedSignature = signature;
    if (timer === null) {
      const elapsed = Math.max(0, (Number(now()) || 0) - lastPublishedAt);
      timer = schedule(() => {
        timer = null;
        const pending = queued;
        queued = null;
        queuedSignature = null;
        commit(pending);
      }, Math.max(0, interval - elapsed));
    }
    return false;
  };

  const cancel = () => {
    if (disposed) return;
    clearQueuedTimer();
    queued = null;
    queuedSignature = null;
    disposed = true;
  };

  return { publish: publishProgress, flush, cancel };
}
