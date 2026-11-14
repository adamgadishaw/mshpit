import { isVideoFileName } from "../domain/mediaMime.mjs";
import { VIDEO_POSTER_ERROR_CODES, VideoPosterError } from "../domain/videoPoster.mjs";

export function createOperationGuard(signal, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const assertActive = () => {
    if (signal?.aborted) throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.aborted);
    if (Date.now() >= deadline) throw new VideoPosterError(VIDEO_POSTER_ERROR_CODES.timeout);
  };
  const race = (operation) => {
    assertActive();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener?.("abort", onAbort);
        callback(value);
      };
      const onAbort = () => finish(reject, new VideoPosterError(VIDEO_POSTER_ERROR_CODES.aborted));
      const timer = setTimeout(
        () => finish(reject, new VideoPosterError(VIDEO_POSTER_ERROR_CODES.timeout)),
        Math.max(1, deadline - Date.now()),
      );
      signal?.addEventListener?.("abort", onAbort, { once: true });
      Promise.resolve(operation).then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error),
      );
    });
  };
  return { assertActive, race, remainingMs: () => Math.max(0, deadline - Date.now()) };
}

export function validVideoAsset(asset) {
  if (!asset || typeof asset !== "object") return false;
  const uri = String(asset.uri || "");
  const mime = String(asset.mimeType || asset.file?.type || "").toLowerCase();
  const name = String(asset.fileName || asset.file?.name || uri);
  return !!uri && (asset.type === "video" || mime.startsWith("video/") || isVideoFileName(name));
}
