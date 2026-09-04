const VALID_PRIORITIES = new Set(["low", "normal", "high"]);
const VALID_LOADING = new Set(["lazy", "eager"]);

const clean = (value) => String(value ?? "").trim();

// Keep the shared image defaults conservative. Visible/high-priority artwork
// may start immediately, while ordinary web images let the browser defer work
// until they approach the viewport. An explicit caller choice still wins.
export function imageLoadPolicy({ priority = "normal", loading = null, viewable = null } = {}) {
  const requestedPriority = VALID_PRIORITIES.has(priority) ? priority : "normal";
  const requestedLoading = VALID_LOADING.has(loading) ? loading : null;
  return {
    priority: viewable === false && requestedPriority === "normal" ? "low" : requestedPriority,
    loading: requestedLoading || (requestedPriority === "high" || viewable === true ? "eager" : "lazy"),
    autoplay: viewable !== false,
    transition: viewable === false ? 0 : 80,
  };
}

// Profile projections include a monotonic profileUpdatedAt value. Use it to
// keep one cache identity when a delivery URL is refreshed, while guaranteeing
// that an actual profile-photo update invalidates the old pixels. Without a
// trustworthy version, the exact URL remains the safest cache boundary.
export function versionedImageCacheKey({ namespace = "image", id, version, variant = "default", uri } = {}) {
  const source = clean(uri);
  const stableId = clean(id);
  const revision = Number(version);
  if (!source) return "";
  if (!stableId || !Number.isFinite(revision) || revision <= 0) return source;
  return [clean(namespace) || "image", stableId, Math.trunc(revision), clean(variant) || "default"]
    .map(encodeURIComponent)
    .join(":");
}
