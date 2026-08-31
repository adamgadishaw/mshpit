const COMPATIBLE_IMAGE_PATH = /\.(?:jpe?g|png|webp)$/i;

function safeHttpsImage(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2000) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password && COMPATIBLE_IMAGE_PATH.test(url.pathname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export const isLandingCompatibleImage = (value) => !!safeHttpsImage(value);
export const hasLandingCompatibleImage = (value) => Array.isArray(value) && value.some(isLandingCompatibleImage);

function safeText(value, max) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function safeLandingPath(value) {
  const path = typeof value === "string" ? value.trim() : "";
  return /^\/media\/landing\/[A-Za-z0-9_-]{1,180}$/.test(path) ? path : null;
}

// The server is the publication authority; this client projection is a second
// defensive boundary before a remote image reaches the full-screen landing
// surface. It keeps the reel bounded, HTTPS-only, browser-compatible and free
// of duplicate URLs or unbounded labels.
export function normalizeLandingCommunityMedia(value, max = 6, { resolvePath = (path) => path } = {}) {
  const limit = Math.max(0, Math.min(8, Math.trunc(Number(max) || 0)));
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(value) ? value : []) {
    const path = safeLandingPath(item?.path);
    const uri = path ? resolvePath(path) : null;
    const id = safeText(item?.id, 180);
    if (typeof uri !== "string" || !uri || !id || seen.has(path)) continue;
    seen.add(path);
    out.push({
      id: `community:${id}`,
      uri,
      path,
      credit: safeText(item?.credit, 120) || "Shared by the Mshpit community",
      artist: safeText(item?.artist, 120) || null,
      venue: safeText(item?.venue, 160) || null,
      source: "community",
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function landingPhotoAfterFailure(media, failedIds) {
  const failed = failedIds instanceof Set
    ? failedIds
    : new Set(Array.isArray(failedIds) ? failedIds : []);
  return (Array.isArray(media) ? media : []).filter((item) => item?.id && !failed.has(item.id));
}
