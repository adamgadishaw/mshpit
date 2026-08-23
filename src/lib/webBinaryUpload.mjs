import { normalizeMediaTransferProgress } from "../domain/mediaTransferProgress.mjs";

export function mediaUploadAbortError() {
  const error = new Error("Media upload was cancelled.");
  error.name = "AbortError";
  return error;
}

// Browser fetch still has no interoperable upload-progress events. XHR is used
// only for the already-presigned object PUT; authentication and JSON API calls
// continue through the normal fetch client. The AbortSignal owns cancellation
// so closing Studio cannot leave a hidden browser transfer running.
export function uploadBinaryWithProgress({
  url,
  method = "PUT",
  headers = {},
  body,
  signal,
  expectedBytes = 0,
  onProgress,
  xhrFactory = () => new XMLHttpRequest(),
} = {}) {
  return new Promise((resolve, reject) => {
    let xhr = null;
    let settled = false;

    const cleanup = () => signal?.removeEventListener?.("abort", abort);
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const abort = () => {
      try { xhr?.abort?.(); } catch {
        // architecture: allow-empty-catch -- XMLHttpRequest abort is optional cleanup after cancellation.
      }
      finish(reject, mediaUploadAbortError());
    };

    if (signal?.aborted) {
      finish(reject, mediaUploadAbortError());
      return;
    }

    try {
      xhr = xhrFactory();
      if (!xhr || typeof xhr.open !== "function" || typeof xhr.send !== "function") {
        throw new Error("Browser upload transport is unavailable.");
      }
      xhr.open(method, url, true);
      for (const [name, value] of Object.entries(headers || {})) {
        xhr.setRequestHeader(name, String(value));
      }
      xhr.onload = () => finish(resolve, { status: Number(xhr.status) || 0 });
      xhr.onerror = () => finish(reject, new Error("The browser could not reach media storage."));
      xhr.onabort = () => finish(reject, mediaUploadAbortError());
      if (xhr.upload) {
        xhr.upload.onprogress = (event) => onProgress?.(normalizeMediaTransferProgress({
          bytesSent: event?.loaded,
          totalBytes: event?.lengthComputable ? event.total : expectedBytes,
        }, expectedBytes));
      }
      signal?.addEventListener?.("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      xhr.send(body);
    } catch (error) {
      finish(reject, error);
    }
  });
}
