import { swipeAxis } from "./nativeGesturePolicy.mjs";
export function releasedPageSwipe({ dx, dy, width, startX, screenWidth, canceled = false, touches = 1, velocityX = 0, canPrevious = true, canNext = true }) {
  'worklet';
  if (canceled || touches !== 1 || !Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (startX < 24 || startX > screenWidth - 24 || swipeAxis(dx, dy) !== 'horizontal') return null;
  if ((dx > 0 && !canPrevious) || (dx < 0 && !canNext)) return null;
  // A fast flick still needs intentional travel; a reversed release cancels.
  if (Math.sign(velocityX) !== Math.sign(dx) && Math.abs(velocityX) > 350) return null;
  if (Math.abs(dx) < Math.max(72, width * 0.24)
    && !(Math.abs(dx) >= 48 && Math.abs(velocityX) >= 650 && Math.sign(velocityX) === Math.sign(dx))) return null;
  return dx > 0 ? 'positive' : 'negative';
}
