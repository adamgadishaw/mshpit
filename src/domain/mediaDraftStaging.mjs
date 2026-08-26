const MAX_URI = 3_000;
const EXTENSION_BY_MIME = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
});

function extensionFromPath(value) {
  const clean = String(value || "").split(/[?#]/)[0];
  const match = clean.match(/\.([A-Za-z0-9]{1,8})$/);
  return match?.[1]?.toLowerCase() || "";
}

export function safeMediaDraftSegment(value, fallback = "item") {
  const cleaned = String(value || "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

export function mediaDraftFileName(asset = {}, index = 0, { detectedMimeType } = {}) {
  // Byte-sniffed identity wins. When it is unavailable, the picker URI is a
  // better representation hint than fileName: iOS can return JPEG bytes/URI
  // while retaining the original IMG.HEIC library name.
  const extension = EXTENSION_BY_MIME[String(detectedMimeType || "").toLowerCase()]
    || extensionFromPath(asset.uri)
    || EXTENSION_BY_MIME[String(asset.mimeType || "").split(";", 1)[0].trim().toLowerCase()]
    || extensionFromPath(asset.fileName || asset.name)
    || (asset.kind === "video" ? "mp4" : "jpg");
  const id = safeMediaDraftSegment(asset.id || `asset-${index + 1}`, `asset-${index + 1}`);
  return `${String(index + 1).padStart(2, "0")}-${id}.${extension}`;
}

// Only app-owned native draft files are eligible for persistence. This is a
// serialization boundary, not an authorization check: the native deletion
// helper independently proves the URI is below the actual Paths.document root
// before touching a file.
export function isPersistableMediaDraftUri(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > MAX_URI) return false;
  if (!/^file:\/\//i.test(value) || /[?#\0]/.test(value)) return false;
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { return false; }
  const normalized = decoded.replace(/\\/g, "/");
  if (!/(?:^|\/)pit-studio(?:\/|$)/i.test(normalized)) return false;
  if (normalized.split("/").some((segment) => segment === "..")) return false;
  return true;
}
