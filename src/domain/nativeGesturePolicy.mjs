export function swipeThreshold(width) {
  'worklet';
  return Math.max(72, Math.min(112, Number(width || 0) * 0.25));
}

export function swipeAxis(dx, dy) {
  'worklet';
  const x = Math.abs(dx), y = Math.abs(dy);
  if (y > 8 && y * 1.5 >= x) return 'vertical';
  if (x > 12 && x > y * 1.5) return 'horizontal';
  return 'undecided';
}

export function releasedSwipe({ dx, dy, width, startX, screenWidth, canceled = false, touches = 1 }) {
  'worklet';
  if (canceled || touches !== 1 || !Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (startX < 24 || startX > screenWidth - 24) return null;
  if (swipeAxis(dx, dy) !== 'horizontal' || Math.abs(dx) < swipeThreshold(width)) return null;
  return dx > 0 ? 'positive' : 'negative';
}

export function adjacentSwipeTab(current, direction, tabs) {
  const index = tabs.indexOf(current);
  if (index < 0 || !['positive', 'negative'].includes(direction)) return null;
  return tabs[index + (direction === 'negative' ? 1 : -1)] || null;
}
