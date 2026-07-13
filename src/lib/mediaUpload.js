import { api } from "./api";
import { AppError, captureAppError } from "./diagnostics";

const UPLOAD_TIMEOUT_MS = 45_000;
const MIME_BY_EXTENSION = Object.freeze({
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
});
const EXTENSION_BY_MIME = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
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
  const declared = String(asset?.mimeType || body?.type || "").split(";", 1)[0].trim().toLowerCase();
  if (EXTENSION_BY_MIME[declared]) return declared;
  return MIME_BY_EXTENSION[extensionOf(asset?.fileName || asset?.uri)] || "";
}

function safeFileName(asset, contentType) {
  const extension = EXTENSION_BY_MIME[contentType] || "jpg";
  const provided = String(asset?.fileName || "").split(/[\\/]/).pop()
    .replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  const withExtension = extensionOf(provided) ? provided : `${provided || "pit-photo"}.${extension}`;
  return withExtension.slice(0, 180);
}

async function bodyFor(asset) {
  // SDK 56 exposes the original File on web. Native supplies a local file URI,
  // which React Native fetch can turn into a Blob without base64 expansion.
  if (asset?.file && typeof asset.file.size === "number") return asset.file;
  if (!asset?.uri) throw new Error("The selected photo did not include a readable file.");
  const localResponse = await fetch(asset.uri);
  if (!localResponse.ok && localResponse.status) throw new Error("The selected photo could not be read from this device.");
  return localResponse.blob();
}

function capturedUploadError(error, { timedOut = false, context } = {}) {
  if (error instanceof AppError && error.diagnosticId) return error;
  return captureAppError(error, {
    ...(timedOut ? { kind: "timeout" } : { code: "PIT-UPLOAD-004" }),
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
export async function uploadMediaAsset(asset, purpose, { signal, timeoutMs = UPLOAD_TIMEOUT_MS } = {}) {
  const context = `Uploading a ${purpose} photo`;
  let body;
  try {
    body = await bodyFor(asset);
  } catch (error) {
    throw capturedUploadError(error, { context });
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
    throw capturedUploadError(new Error("The selected photo had no readable file size."), { context });
  }

  // The authenticated Pit API validates size/type and returns a short-lived URL;
  // storage credentials never enter the client bundle.
  const ticket = await api("/api/media/presign", {
    method: "POST",
    context: "Preparing your photo upload",
    signal,
    body: {
      purpose,
      contentType,
      fileSize,
      name: safeFileName(asset, contentType),
    },
  });

  if (!ticket?.uploadUrl || !isDurableMediaUrl(ticket?.publicUrl) || !ticket?.requiredHeaders) {
    throw captureAppError(new AppError(undefined, { code: "PIT-UPLOAD-004", context, source: "media" }), {
      context,
      source: "media",
      toast: true,
      meta: { method: "POST", route: "/api/media/presign" },
    });
  }

  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener?.("abort", cancel, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1_000, Number(timeoutMs) || UPLOAD_TIMEOUT_MS));

  try {
    const response = await fetch(ticket.uploadUrl, {
      method: ticket.method || "PUT",
      headers: ticket.requiredHeaders,
      body,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Media storage rejected the upload (${response.status}).`);
    return ticket.publicUrl;
  } catch (error) {
    throw capturedUploadError(error, { timedOut, context });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener?.("abort", cancel);
  }
}
