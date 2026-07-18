import { Platform } from "react-native";
import { fetch as expoFetch } from "expo/fetch";
import { File } from "expo-file-system";
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
  // SDK 56 exposes the browser's original File on web. On native, pass an Expo
  // File directly to expo/fetch: this streams the local URI and avoids expanding
  // a large clip into a JS Blob (the source of intermittent mobile upload stalls).
  if (Platform.OS === "web" && asset?.file && typeof asset.file.size === "number") return asset.file;
  if (!asset?.uri) throw new Error("The selected media did not include a readable file.");
  const file = new File(asset.uri);
  if (!Number.isFinite(Number(file.size)) || Number(file.size) < 1) {
    throw new Error("The selected media could not be read from this device.");
  }
  return file;
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
export async function uploadMediaAsset(asset, purpose, { signal, timeoutMs } = {}) {
  const context = `Uploading ${purpose} media`;
  let body;
  try {
    body = await bodyFor(asset);
  } catch (error) {
    throw capturedUploadError(error, { context });
  }

  const contentType = contentTypeFor(asset, body);
  // Clips are an order of magnitude bigger than photos; give the PUT room
  // before declaring it dead on a normal uplink.
  if (timeoutMs == null) timeoutMs = contentType.startsWith("video/") ? 300_000 : UPLOAD_TIMEOUT_MS;
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
    const response = await expoFetch(ticket.uploadUrl, {
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
