import { Platform } from "react-native";
import { File as ExpoFile, UploadType } from "expo-file-system";
import { api } from "./api";
import { AppError, captureAppError } from "./diagnostics";
import { webImageOptimizationPlan } from "./mediaImagePolicy.mjs";
import { mediaPutStatusAccepted } from "../domain/mediaUploadPolicy.mjs";
import { normalizeMediaTransferProgress } from "../domain/mediaTransferProgress.mjs";
import { createMediaUploadDeadline, mediaUploadTimeoutMs } from "../domain/mediaUploadDeadline.mjs";
import { uploadBinaryWithProgress } from "./webBinaryUpload.mjs";

const MIME_BY_EXTENSION = Object.freeze({
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
});
const EXTENSION_BY_MIME = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
});

export function isDurableMediaUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

export function reportMediaPickerError(error, context = "Opening the photo library") {
  return captureAppError(error, {
    context,
    source: "media-picker",
    toast: true,
  });
}

function extensionOf(value) {
  const clean = String(value || "").split(/[?#]/, 1)[0];
  const match = clean.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
}

function contentTypeFor(asset, body) {
  const declared = String(body?.type || asset?.mimeType || "").split(";", 1)[0].trim().toLowerCase();
  if (EXTENSION_BY_MIME[declared]) return declared;
  return MIME_BY_EXTENSION[extensionOf(asset?.fileName || asset?.uri)] || "";
}

function safeFileName(asset, contentType) {
  const extension = EXTENSION_BY_MIME[contentType] || "jpg";
  const provided = String(asset?.fileName || "").split(/[\\/]/).pop()
    .replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  const stem = provided.replace(/\.[a-z0-9]+$/i, "") || "pit-photo";
  const withExtension = `${stem}.${extension}`;
  return withExtension.slice(0, 180);
}

async function optimizedWebImage(file) {
  const type = String(file?.type || "").toLowerCase();
  if (!file || !type.startsWith("image/") || typeof document === "undefined" || typeof createImageBitmap !== "function") return file;

  let bitmap;
  try {
    try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch { bitmap = await createImageBitmap(file); }
    const plan = webImageOptimizationPlan({ type, size: file.size, width: bitmap.width, height: bitmap.height });
    if (!plan.optimize) return file;

    const canvas = document.createElement("canvas");
    canvas.width = plan.width;
    canvas.height = plan.height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, plan.width, plan.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, plan.outputType, plan.quality));
    if (!blob || !blob.size || blob.size >= file.size) return file;
    const stem = String(file.name || "pit-photo").replace(/\.[a-z0-9]+$/i, "");
    return typeof globalThis.File === "function"
      ? new globalThis.File([blob], `${stem}.webp`, { type: blob.type || plan.outputType, lastModified: file.lastModified || Date.now() })
      : blob;
  } catch {
    // Optimization is an acceleration, never a reason to reject someone's
    // photo. Older Safari versions fall back to the original upload here.
    return file;
  } finally {
    bitmap?.close?.();
  }
}

async function bodyFor(asset, { optimizeWeb = true } = {}) {
  // SDK 56 exposes the browser's original File on web. On native, pass an Expo
  // File directly to expo/fetch: this streams the local URI and avoids expanding
  // a large clip into a JS Blob (the source of intermittent mobile upload stalls).
  if (Platform.OS === "web" && asset?.file && typeof asset.file.size === "number") {
    return optimizeWeb ? optimizedWebImage(asset.file) : asset.file;
  }
  if (!asset?.uri) throw new Error("The selected media did not include a readable file.");
  const file = new ExpoFile(asset.uri);
  if (!Number.isFinite(Number(file.size)) || Number(file.size) < 1) {
    throw new Error("The selected media could not be read from this device.");
  }
  return file;
}

// Prepare once, then use the same measured bytes for the API ticket and the
// object PUT. New media-assets deliberately set optimizeWeb=false for immutable
// originals; their edited display variant is rendered and uploaded separately.
export async function prepareMediaUploadAsset(asset, { optimizeWeb = true, context = "Preparing media" } = {}) {
  let body;
  try {
    body = await bodyFor(asset, { optimizeWeb });
  } catch (error) {
    throw capturedUploadError(error, { context, code: "PIT-UPLOAD-002" });
  }
  const contentType = contentTypeFor(asset, body);
  if (!contentType) {
    throw captureAppError(new AppError(undefined, { code: "PIT-UPLOAD-002", context, source: "media" }), {
      context,
      source: "media",
      toast: true,
      meta: { method: "PUT", route: "/media/object" },
    });
  }
  const measuredSize = Number(body?.size);
  const fileSize = Number.isFinite(measuredSize) ? measuredSize : Number(asset?.fileSize || 0);
  if (!Number.isSafeInteger(fileSize) || fileSize < 1) {
    throw capturedUploadError(new Error("The selected media had no readable file size."), { context });
  }
  return {
    body,
    contentType,
    fileSize,
    name: safeFileName(asset, contentType),
    kind: contentType.startsWith("video/") ? "video" : "image",
  };
}

export async function uploadPreparedMediaAsset(prepared, ticket, {
  signal,
  timeoutMs,
  context = "Uploading media",
  onProgress,
} = {}) {
  if (!prepared?.body || !prepared?.contentType || !Number.isSafeInteger(prepared?.fileSize)) {
    throw capturedUploadError(new Error("The prepared media upload is invalid."), { context, code: "PIT-UPLOAD-002" });
  }
  if (!ticket?.uploadUrl || !isDurableMediaUrl(ticket?.publicUrl) || !ticket?.requiredHeaders) {
    throw captureAppError(new AppError(undefined, { code: "PIT-UPLOAD-004", context, source: "media" }), {
      context,
      source: "media",
      toast: true,
      meta: { method: "POST", route: "/api/media/presign" },
    });
  }
  if (timeoutMs == null) timeoutMs = mediaUploadTimeoutMs(prepared);
  const deadline = createMediaUploadDeadline(timeoutMs, { signal });
  const reportProgress = (value) => {
    if (!deadline.signal.aborted) onProgress?.(normalizeMediaTransferProgress(value, prepared.fileSize));
  };

  try {
    reportProgress({ bytesSent: 0, totalBytes: prepared.fileSize });
    let status;
    if (Platform.OS === "web") {
      const response = await uploadBinaryWithProgress({
        url: ticket.uploadUrl,
        method: ticket.method || "PUT",
        headers: ticket.requiredHeaders,
        body: prepared.body,
        signal: deadline.signal,
        expectedBytes: prepared.fileSize,
        onProgress: reportProgress,
      });
      status = response.status;
    } else {
      // SDK 56's task API reports native bytes and honors AbortSignal. A
      // foreground session prevents a cancelled Studio action from continuing
      // invisibly after the JS UI has returned to an editable state.
      const task = prepared.body.createUploadTask(ticket.uploadUrl, {
        httpMethod: ticket.method || "PUT",
        uploadType: UploadType.BINARY_CONTENT,
        headers: ticket.requiredHeaders,
        mimeType: prepared.contentType,
        signal: deadline.signal,
        sessionType: "foreground",
        onProgress: reportProgress,
      });
      try {
        const response = await task.uploadAsync();
        status = response.status;
      } finally {
        task.release?.();
      }
    }
    if (!mediaPutStatusAccepted(status)) throw new Error(`Media storage rejected the upload (${status}).`);
    reportProgress({ bytesSent: prepared.fileSize, totalBytes: prepared.fileSize });
    return ticket.publicUrl;
  } catch (error) {
    if (signal?.aborted && !deadline.timedOut) throw error;
    throw capturedUploadError(error, { timedOut: deadline.timedOut, context });
  } finally {
    deadline.dispose();
  }
}

function capturedUploadError(error, { timedOut = false, context, code } = {}) {
  if (error instanceof AppError && error.diagnosticId) return error;
  return captureAppError(error, {
    ...(timedOut ? { kind: "timeout" } : { code: code || "PIT-UPLOAD-004" }),
    context,
    source: "media",
    toast: true,
    meta: { method: "PUT", route: "/media/object" },
  });
}

/**
 * Upload one Expo ImagePickerAsset and return its durable public URL.
 * The local URI is deliberately never returned to callers, persisted, or sent
 * to the Pit API.
 */
export async function uploadMediaAsset(asset, purpose, { signal, timeoutMs } = {}) {
  const context = `Uploading ${purpose} media`;
  const prepared = await prepareMediaUploadAsset(asset, { optimizeWeb: true, context });

  // The authenticated Pit API validates size/type and returns a short-lived URL;
  // storage credentials never enter the client bundle.
  const ticket = await api("/api/media/presign", {
    method: "POST",
    context: "Preparing your photo upload",
    signal,
    body: {
      purpose,
      contentType: prepared.contentType,
      fileSize: prepared.fileSize,
      name: prepared.name,
    },
  });
  return uploadPreparedMediaAsset(prepared, ticket, { signal, timeoutMs, context });
}
