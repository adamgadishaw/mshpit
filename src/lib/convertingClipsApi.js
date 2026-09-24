import { api } from "./api";

// Reads how one of the author's own clips is doing on the server. Returns
// "ready", "failed" or "processing"; a failed read counts as still processing.
export async function checkConvertingClip(assetId, { signal } = {}) {
  try {
    const result = await api(`/api/media/assets/${encodeURIComponent(assetId)}`, {
      context: "Checking your clip",
      silent: true,
      signal,
    });
    if (result?.asset?.status === "ready" || result?.finalize?.state === "completed") return "ready";
    if (result?.finalize?.state === "failed") return "failed";
  } catch {
    // A missed check is fine; the next one or the feed refresh catches up.
  }
  return "processing";
}

// Asks the server to convert a stopped clip again from the saved original.
// Throws the API's own error when the server does not take it.
export async function retryConvertingClip(assetId) {
  const result = await api(`/api/media/assets/${encodeURIComponent(assetId)}/processing/retry`, {
    method: "POST",
    context: "Trying your clip again",
    silent: true,
  });
  return result?.finalize?.state === "completed" ? "ready" : "processing";
}
