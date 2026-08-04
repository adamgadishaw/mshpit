// A bad individual selection may be skipped so later photos still upload. A
// systemic failure (offline, timeout, auth, rate limit, storage outage) must
// stop the batch immediately instead of repeating the same slow request for
// every selected file.
export function shouldContinueMediaBatch(error) {
  const status = Number(error?.status || error?.body?.status) || 0;
  const serverCode = String(error?.serverCode || error?.body?.code || "");
  const code = String(error?.code || "");
  return status === 413
    || status === 415
    || serverCode === "MEDIA_TOO_LARGE"
    || serverCode === "MEDIA_TYPE_UNSUPPORTED"
    || code === "PIT-UPLOAD-002"
    || code === "PIT-UPLOAD-003";
}
