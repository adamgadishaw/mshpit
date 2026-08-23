const STAGE_LABELS = Object.freeze({
  preparing: "Preparing media",
  "checking-source": "Checking original",
  "preparing-source": "Preparing original",
  "uploading-source": "Uploading original",
  "verifying-source": "Verifying original",
  "uploading-poster": "Uploading video cover",
  "verifying-poster": "Verifying video cover",
  "uploading-render": "Uploading edited photo",
  "verifying-render": "Verifying edited photo",
  ready: "Finishing media",
});

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
