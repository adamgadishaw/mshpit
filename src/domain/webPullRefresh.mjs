export const WEB_PULL_REFRESH_CONFIG = Object.freeze({
  phoneMaxShortSide: 600,
  topTolerancePx: 1,
  intentSlopPx: 8,
  verticalDominance: 1.25,
  pullResistance: 0.62,
  maxPullPx: 104,
  armPullPx: 64,
});

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

export function isTouchPhoneRefreshCapable({
  maxTouchPoints = 0,
  coarsePointer = false,
  noHover = false,
  screenWidth = 0,
  screenHeight = 0,
} = {}) {
  const shortSide = Math.min(
    finiteNumber(screenWidth, Number.POSITIVE_INFINITY),
    finiteNumber(screenHeight, Number.POSITIVE_INFINITY),
  );
  return maxTouchPoints > 0
    && coarsePointer === true
    && noHover === true
    && shortSide > 0
    && shortSide <= WEB_PULL_REFRESH_CONFIG.phoneMaxShortSide;
}

export function resistedWebPullDistance(rawDistance) {
  const distance = Math.max(0, finiteNumber(rawDistance));
  return Math.min(
    WEB_PULL_REFRESH_CONFIG.maxPullPx,
    distance * WEB_PULL_REFRESH_CONFIG.pullResistance,
  );
}

function cancelledGesture(state = {}) {
  return {
    ...state,
    status: "cancelled",
    pullDistance: 0,
    armed: false,
  };
}

export function beginWebPullGesture({ touchCount, x, y, scrollTop } = {}) {
  const state = {
    status: "pending",
    startX: finiteNumber(x),
    startY: finiteNumber(y),
    pullDistance: 0,
    armed: false,
  };
  if (touchCount !== 1 || finiteNumber(scrollTop) > WEB_PULL_REFRESH_CONFIG.topTolerancePx) {
    return cancelledGesture(state);
  }
  return state;
}

export function moveWebPullGesture(state, { touchCount, x, y, scrollTop } = {}) {
  if (!state || state.status === "cancelled") return cancelledGesture(state);
  if (state.status === "claimed") {
    // Once the custom gesture owns this touch sequence it must keep ownership
    // until release. Reclassifying a claimed pull from later diagonal/upward
    // movement hands it back to Safari mid-gesture and can start native reload.
    // A second finger is the one explicit cancellation escape.
    if (touchCount > 1) return cancelledGesture(state);
    const pullDistance = resistedWebPullDistance(finiteNumber(y) - state.startY);
    return {
      ...state,
      pullDistance,
      armed: pullDistance >= WEB_PULL_REFRESH_CONFIG.armPullPx,
    };
  }
  if (touchCount !== 1 || finiteNumber(scrollTop) > WEB_PULL_REFRESH_CONFIG.topTolerancePx) {
    return cancelledGesture(state);
  }

  const deltaX = finiteNumber(x) - state.startX;
  const deltaY = finiteNumber(y) - state.startY;
  if (deltaY < 0) return cancelledGesture(state);

  const horizontalDistance = Math.abs(deltaX);
  const movement = Math.max(horizontalDistance, deltaY);
  if (state.status === "pending" && movement <= WEB_PULL_REFRESH_CONFIG.intentSlopPx) {
    return state;
  }
  if (deltaY < horizontalDistance * WEB_PULL_REFRESH_CONFIG.verticalDominance) {
    return cancelledGesture(state);
  }

  const pullDistance = resistedWebPullDistance(deltaY);
  return {
    ...state,
    status: "claimed",
    pullDistance,
    armed: pullDistance >= WEB_PULL_REFRESH_CONFIG.armPullPx,
  };
}

export function shouldRefreshWebPullGesture(state) {
  return state?.status === "claimed" && state.armed === true;
}

export function canReleaseWebRefreshLatch({ promiseSettled, refreshing } = {}) {
  return promiseSettled === true && refreshing !== true;
}
