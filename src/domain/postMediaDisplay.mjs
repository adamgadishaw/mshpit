// One display adapter for old URL-only posts and the stable media descriptors
// returned by the new asset contract. The post's legacy `photos` list remains
// the canonical visible order during rollout; matching descriptors enrich it
// with durable posters, dimensions, and alt text without duplicating media.
export function mediaDisplayUri(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  return String(value.uri || value.url || value.sourceUrl || "").trim();
}

const VIDEO_EXTENSION = /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i;

// Stable descriptors are authoritative for media type. URL extensions remain a
// compatibility fallback for historical URL-only posts, but must not decide
// whether an extensionless CDN URL is mounted as an image or a video.
export function mediaDisplayKind(value) {
  if (value && typeof value === "object") {
    const declared = String(value.kind || value.type || value.mediaType || "").trim().toLowerCase();
    if (declared === "video") return "video";
    if (declared === "image") return "image";
    const mimeType = String(value.mimeType || value.contentType || "").trim().toLowerCase();
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("image/")) return "image";
  }
  return VIDEO_EXTENSION.test(mediaDisplayUri(value)) ? "video" : "image";
}

export function mediaPosterUri(value) {
  if (!value || typeof value !== "object") return null;
  for (const candidate of [value.posterUrl, value.posterUri]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function descriptorUris(item) {
  if (!item || typeof item !== "object") return [];
  return [...new Set([item.uri, item.url, item.sourceUrl]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim()))];
}

export function mediaDisplayItems({ photos = [], media = [] } = {}) {
  const legacy = Array.isArray(photos) ? photos : [];
  const stable = (Array.isArray(media) ? media : [])
    .map((item) => ({ ...item, uri: mediaDisplayUri(item) }))
    .filter((item) => item.uri);
  const stableByUri = new Map();
  const stableById = new Map();
  for (const item of stable) {
    for (const uri of descriptorUris(item)) {
      if (!stableByUri.has(uri)) stableByUri.set(uri, item);
    }
    if (item.id != null && !stableById.has(String(item.id))) stableById.set(String(item.id), item);
  }
  const ordered = legacy.length ? legacy : stable;

  return ordered.map((item) => {
    const uri = mediaDisplayUri(item);
    if (!uri) return null;
    const enriched = stableByUri.get(uri)
      || (item && typeof item === "object" && item.id != null ? stableById.get(String(item.id)) : null);
    if (enriched) return enriched;
    return typeof item === "object" && item ? { ...item, uri } : { uri };
  }).filter(Boolean);
}

export function mediaPosterForUri(post, uri) {
  return mediaPosterUri(mediaDescriptorForUri(post, uri));
}

export function mediaDescriptorForUri(post, uri) {
  const target = String(uri || "").trim();
  if (!target) return null;
  return mediaDisplayItems(post).find((item) => descriptorUris(item).includes(target)) || null;
}

// Feed polling may preserve the previous object only when its visible media
// contract is unchanged. This deliberately compares enriched descriptors, not
// just the legacy URL list, so a fresh durable poster can replace an older
// persisted URL-only card even when the post's content version is unchanged.
export function sameMediaDisplayItems(left, right) {
  return JSON.stringify(mediaDisplayItems(left)) === JSON.stringify(mediaDisplayItems(right));
}
