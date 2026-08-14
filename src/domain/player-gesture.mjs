export const PLAYER_CLOSE_SWIPE = Object.freeze({
  activationDistance: 18,
  dominanceRatio: 1.8,
  closeDistance: 52,
  fastCloseDistance: 40,
  closeVelocity: 1.15,
});

// A gesture-only surface still needs the same reliable physical target as a
// control. More importantly, the dedicated rail owns its touch from the start:
// React Native resets PanResponder dx/dy when responder grant occurs, so waiting
// for movement before claiming would discard the first part of every swipe.
export const PLAYER_CLOSE_RAIL_MIN_HEIGHT = 44;

export function nativeTouchCount(event) {
  const count = Number(event?.nativeEvent?.touches?.length);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

export function shouldStartPlayerCloseResponder({ enabled, touchCount } = {}) {
  if (!enabled) return false;
  // Some RN/web event adapters omit `touches`; the rail is a dedicated gesture
  // target, so an unknown count is safe to claim. A known multi-touch start is
  // rejected and can never become a destructive close later in the gesture.
  return touchCount == null || touchCount === 1;
}

const finite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

export function canUsePlayerCloseSwipe({ compactMobile, native, coarsePointer }) {
  return Boolean(compactMobile && (native || coarsePointer));
}

export function isUpwardPlayerSwipeIntent(gesture, policy = PLAYER_CLOSE_SWIPE) {
  const dx = Math.abs(finite(gesture?.dx));
  const dy = finite(gesture?.dy);
  const upwardDistance = -dy;

  return upwardDistance >= policy.activationDistance
    && upwardDistance >= dx * policy.dominanceRatio;
}

export function shouldClosePlayerFromSwipe(gesture, policy = PLAYER_CLOSE_SWIPE) {
  if (!isUpwardPlayerSwipeIntent(gesture, policy)) return false;

  const upwardDistance = -finite(gesture?.dy);
  const upwardVelocity = -finite(gesture?.vy);
  return upwardDistance >= policy.closeDistance
    || (upwardDistance >= policy.fastCloseDistance && upwardVelocity >= policy.closeVelocity);
}
