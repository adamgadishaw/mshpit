const normalizedId = (value) => value === null || value === undefined ? "" : String(value);

// FlatList reports deltas, not a complete visible snapshot. Keep this update
// pure so feed viewability remains deterministic across native and web.
export function nextVisibleMediaPostIds(current, changed = []) {
  const next = new Set(current instanceof Set ? current : []);
  for (const token of Array.isArray(changed) ? changed : []) {
    const id = normalizedId(token?.item?.id);
    if (!id) continue;
    if (token.isViewable) next.add(id);
    else next.delete(id);
  }
  return next;
}

export function posterGenerationEnabled({ enabled = true, explicitViewable = null, autoViewable = false } = {}) {
  if (!enabled) return false;
  // A caller may veto work (false), but even a coarse parent-level true never
  // bypasses the tile's own intersection measurement.
  if (explicitViewable === false) return false;
  return !!autoViewable;
}

// Native's measureInWindow fallback needs the same boundary semantics as the
// web IntersectionObserver path. Any genuinely painted intersection counts;
// FlatList surfaces apply their stricter 60%/750 ms policy before this helper.
export function posterBoundsAreViewable({ x = 0, y = 0, width = 0, height = 0, viewportWidth = 0, viewportHeight = 0 } = {}) {
  const left = Number(x);
  const top = Number(y);
  const measuredWidth = Math.max(0, Number(width) || 0);
  const measuredHeight = Math.max(0, Number(height) || 0);
  const right = left + measuredWidth;
  const bottom = top + measuredHeight;
  const screenWidth = Math.max(0, Number(viewportWidth) || 0);
  const screenHeight = Math.max(0, Number(viewportHeight) || 0);
  return measuredWidth > 0 && measuredHeight > 0 && right > 0 && bottom > 0 && left < screenWidth && top < screenHeight;
}
