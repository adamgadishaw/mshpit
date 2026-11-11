// Deliberate direction changes, measured in points rather than event counts.
// Extrema absorb small reversals; clamping excludes UIKit rubber-band travel.
export function scrollChromeState(offset = 0, shown = true) {
  'worklet';
  const y = Number.isFinite(offset) ? Math.max(0, offset) : 0;
  return { y, anchor: y, shown };
}
export function advanceScrollChrome(state, offset, maxOffset, interactive) {
  'worklet';
  const limit = Number.isFinite(maxOffset) ? Math.max(0, maxOffset) : 0;
  const y = Number.isFinite(offset) ? Math.min(limit, Math.max(0, offset)) : state.y;
  if (y <= 8) return scrollChromeState(y, true);
  // Restores, layout changes and imperative seeks establish a new baseline;
  // they are not evidence of a user's scrolling direction.
  if (!interactive) return scrollChromeState(y, state.shown);
  const anchor = state.shown ? Math.min(state.anchor, y) : Math.max(state.anchor, y);
  const change = state.shown ? y >= 80 && y - anchor >= 64 : anchor - y >= 36;
  return change ? scrollChromeState(y, !state.shown) : { y, anchor, shown: state.shown };
}
