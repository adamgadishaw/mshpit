// Native layout is the authority: no character-count widths or target guesses.
export function discoverTabPosition(x, width, origin, count) {
  'worklet';
  const position = Number.isFinite(origin) ? origin : 0;
  const offset = Number.isFinite(width) && width > 0 && Number.isFinite(x) ? x / width : 0;
  return Math.max(0, Math.min(count - 1, position - offset));
}

export function discoverTabFrame(frames, position) {
  'worklet';
  const from = frames[Math.floor(position)], to = frames[Math.ceil(position)];
  if (!from || !to || from.width <= 0 || to.width <= 0) return null;
  const progress = position - Math.floor(position);
  return { x: from.x + (to.x - from.x) * progress, width: from.width + (to.width - from.width) * progress };
}

export function discoverTabScroll(frame, viewport, contentWidth) {
  'worklet';
  if (!frame || viewport <= 0 || contentWidth <= 0) return 0;
  return Math.max(0, Math.min(contentWidth - viewport, frame.x + frame.width / 2 - viewport / 2));
}
