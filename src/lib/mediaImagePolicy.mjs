export const WEB_IMAGE_MAX_EDGE = 2048;
export const WEB_IMAGE_QUALITY = 0.82;

const OPTIMIZABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function resizedImageDimensions(width, height, maxEdge = WEB_IMAGE_MAX_EDGE) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const edge = Math.max(1, Math.round(Number(maxEdge) || WEB_IMAGE_MAX_EDGE));
  if (Math.max(w, h) <= edge) return { width: w, height: h, resized: false };
  const scale = edge / Math.max(w, h);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    resized: true,
  };
}

export function webImageOptimizationPlan({ type, size, width, height } = {}) {
  const contentType = String(type || "").split(";", 1)[0].trim().toLowerCase();
  const dimensions = resizedImageDimensions(width, height);
  const supported = OPTIMIZABLE_TYPES.has(contentType);
  return {
    ...dimensions,
    supported,
    // Re-encoding tiny, already-right-sized images wastes battery and can make
    // them larger. Large camera dimensions or a 1 MiB+ payload are worthwhile.
    optimize: supported && (dimensions.resized || Number(size) > 1024 * 1024),
    outputType: "image/webp",
    quality: WEB_IMAGE_QUALITY,
  };
}
