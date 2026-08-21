// One display adapter for old URL-only posts and the stable media descriptors
// returned by the new asset contract. The post's legacy `photos` list remains
// the canonical visible order during rollout; matching descriptors enrich it
// with durable posters, dimensions, and alt text without duplicating media.
export function mediaDisplayUri(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  return String(value.uri || value.url || value.sourceUrl || "").trim();
}

export function mediaDisplayItems({ photos = [], media = [] } = {}) {
  const legacy = Array.isArray(photos) ? photos : [];
  const stable = (Array.isArray(media) ? media : [])
    .map((item) => ({ ...item, uri: mediaDisplayUri(item) }))
    .filter((item) => item.uri);
  const stableByUri = new Map(stable.map((item) => [item.uri, item]));
  const ordered = legacy.length ? legacy : stable;

  return ordered.map((item) => {
    const uri = mediaDisplayUri(item);
    if (!uri) return null;
    const enriched = stableByUri.get(uri);
    if (enriched) return enriched;
    return typeof item === "object" && item ? { ...item, uri } : { uri };
  }).filter(Boolean);
}

export function mediaPosterForUri(post, uri) {
  return mediaDescriptorForUri(post, uri)?.posterUrl || null;
}

export function mediaDescriptorForUri(post, uri) {
  const target = String(uri || "");
  return mediaDisplayItems(post).find((item) => item.uri === target) || null;
}
