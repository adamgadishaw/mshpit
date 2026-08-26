import { Platform } from "react-native";
import { File as ExpoFile, UploadType } from "expo-file-system";
import { api } from "./api";
import { AppError, captureAppError } from "./diagnostics";
import { webImageOptimizationPlan } from "./mediaImagePolicy.mjs";
import { mediaPutStatusAccepted } from "../domain/mediaUploadPolicy.mjs";
import { normalizeMediaTransferProgress } from "../domain/mediaTransferProgress.mjs";
import { resolveMediaMimeType } from "../domain/mediaMime.mjs";
import { normalizeProfileImageAsset } from "./profileImageNormalizer";
import { createMediaUploadDeadline, mediaUploadTimeoutMs } from "../domain/mediaUploadDeadline.mjs";
import { uploadBinaryWithProgress } from "./webBinaryUpload.mjs";
import { validMediaUploadTicket } from "../domain/mediaUploadTicket.mjs";

const MIME_BY_EXTENSION = Object.freeze({
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
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
  "image/avif": "avif",
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

async function firstMediaBytes(body) {
  if (typeof body?.slice === "function") {
    const prefix = body.slice(0, 96);
    if (typeof prefix?.arrayBuffer === "function") return new Uint8Array(await prefix.arrayBuffer());
  }
  if (typeof body?.open === "function") {
    const handle = body.open();
    try { return handle.readBytes(Math.min(96, Number(handle.size) || 96)); }
    finally { handle.close(); }
  }
  return null;
}

async function contentTypeFor(asset, body) {
  const bytes = await firstMediaBytes(body);
  return resolveMediaMimeType({ bytes, declaredType: body?.type || asset?.mimeType, fileName: asset?.fileName || asset?.uri });
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
  const contentType = await contentTypeFor(asset, body);
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
  if (!validMediaUploadTicket(ticket)) {
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
    // Private source capabilities deliberately have no browser-readable URL.
    // Stable-media callers finalize them by opaque asset id after the PUT.
    return ticket.storageScope === "public" ? ticket.publicUrl : null;
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
  let uploadAsset = asset;
  try {
    if (purpose === "avatar" || purpose === "banner") {
      try {
        uploadAsset = await normalizeProfileImageAsset(asset, purpose, { signal });
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") throw error;
        uploadAsset = asset;
      }
    }
  const context = `Uploading ${purpose} media`;
  const prepared = await prepareMediaUploadAsset(uploadAsset, { optimizeWeb: true, context });

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
  // Legacy surfaces no longer receive a browser-authored public object. Camera
  // bytes are staged privately, then the server performs the full decode and a
  // metadata-free re-encode before returning the only URL callers may persist.
  if (ticket?.storageScope !== "private"
      || typeof ticket?.finalizeToken !== "string"
      || typeof ticket?.descriptorId !== "string") {
    throw captureAppError(new AppError(undefined, {
      code: "PIT-UPLOAD-004",
      context: "Preparing your private photo upload",
      source: "media",
    }), {
      context: "Preparing your private photo upload",
      source: "media",
      toast: true,
      meta: { method: "POST", route: "/api/media/presign" },
    });
  }
  await uploadPreparedMediaAsset(prepared, ticket, { signal, timeoutMs, context });
  const finalized = await api("/api/media/finalize", {
    method: "POST",
    context: `Securing ${purpose} media`,
    signal,
    body: { finalizeToken: ticket.finalizeToken },
  });
  if (finalized?.descriptorId !== ticket.descriptorId || !isDurableMediaUrl(finalized?.publicUrl)) {
    throw captureAppError(new AppError(undefined, {
      code: "PIT-UPLOAD-004",
      context: `Securing ${purpose} media`,
      source: "media",
    }), {
      context: `Securing ${purpose} media`,
      source: "media",
      toast: true,
      meta: { method: "POST", route: "/api/media/finalize" },
    });
  }
  return finalized.publicUrl;
  } finally {
    if (uploadAsset !== asset) uploadAsset?.release?.();
  }
}
