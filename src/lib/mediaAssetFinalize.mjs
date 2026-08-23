export const MEDIA_SOURCE_FINALIZE_V1_TIMEOUT_MS = 120_000;

export function finalizeMediaSourceV1({ apiCall, assetId, body, signal } = {}) {
  if (typeof apiCall !== "function" || typeof assetId !== "string" || !assetId) {
    throw new Error("PIT could not verify that media source.");
  }
  return apiCall(`/api/media/assets/${encodeURIComponent(assetId)}/finalize`, {
    method: "POST",
    context: "Verifying your PIT media",
    signal,
    // `private-derivative-v1` includes the server's bounded authoritative decode/transcode. Keep
    // this deadline route-scoped; ordinary writes retain api()'s 30s default.
    timeoutMs: MEDIA_SOURCE_FINALIZE_V1_TIMEOUT_MS,
    body,
  });
}
