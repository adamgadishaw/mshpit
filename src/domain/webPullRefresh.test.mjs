import assert from "node:assert/strict";
import test from "node:test";
import {
  beginWebPullGesture,
  canReleaseWebRefreshLatch,
  isTouchPhoneRefreshCapable,
  moveWebPullGesture,
  resistedWebPullDistance,
  shouldRefreshWebPullGesture,
  WEB_PULL_REFRESH_CONFIG,
} from "./webPullRefresh.mjs";

const phone = {
  maxTouchPoints: 5,
  coarsePointer: true,
  noHover: true,
  screenWidth: 393,
  screenHeight: 852,
};

test("web pull refresh is limited to coarse, no-hover touch phones", () => {
  assert.equal(isTouchPhoneRefreshCapable(phone), true);
  assert.equal(isTouchPhoneRefreshCapable({ ...phone, screenWidth: 852, screenHeight: 393 }), true);
  assert.equal(isTouchPhoneRefreshCapable({ ...phone, maxTouchPoints: 0 }), false);
  assert.equal(isTouchPhoneRefreshCapable({ ...phone, coarsePointer: false }), false);
  assert.equal(isTouchPhoneRefreshCapable({ ...phone, noHover: false }), false);
  assert.equal(isTouchPhoneRefreshCapable({ ...phone, screenWidth: 744, screenHeight: 1133 }), false);
  assert.equal(isTouchPhoneRefreshCapable({ ...phone, screenWidth: 0 }), false);
});

test("gesture waits through slop, then claims only a downward vertical pull at the top", () => {
  const started = beginWebPullGesture({ touchCount: 1, x: 20, y: 40, scrollTop: -3 });
  assert.equal(started.status, "pending", "negative Safari bounce still counts as the top");

  const withinSlop = moveWebPullGesture(started, {
    touchCount: 1,
    x: 28,
    y: 48,
    scrollTop: 0,
  });
  assert.equal(withinSlop.status, "pending");

  const claimed = moveWebPullGesture(started, {
    touchCount: 1,
    x: 27,
    y: 49,
    scrollTop: 1,
  });
  assert.equal(claimed.status, "claimed");
  assert.ok(claimed.pullDistance > 0);
});

test("upward, horizontal, scrolled, and multi-touch intent cancels permanently", () => {
  const start = () => beginWebPullGesture({ touchCount: 1, x: 10, y: 10, scrollTop: 0 });
  assert.equal(moveWebPullGesture(start(), {
    touchCount: 1, x: 10, y: 9, scrollTop: 0,
  }).status, "cancelled");
  assert.equal(moveWebPullGesture(start(), {
    touchCount: 1, x: 20, y: 17, scrollTop: 0,
  }).status, "cancelled");
  assert.equal(moveWebPullGesture(start(), {
    touchCount: 1, x: 10, y: 22, scrollTop: 2,
  }).status, "cancelled");
  assert.equal(moveWebPullGesture(start(), {
    touchCount: 2, x: 10, y: 22, scrollTop: 0,
  }).status, "cancelled");
  assert.equal(beginWebPullGesture({ touchCount: 2, x: 0, y: 0, scrollTop: 0 }).status, "cancelled");

  const cancelled = moveWebPullGesture(start(), {
    touchCount: 1, x: 30, y: 12, scrollTop: 0,
  });
  const retry = moveWebPullGesture(cancelled, {
    touchCount: 1, x: 10, y: 80, scrollTop: 0,
  });
  assert.equal(retry.status, "cancelled");
  assert.equal(shouldRefreshWebPullGesture(retry), false);
});

test("a claimed pull keeps ownership until release unless another finger joins", () => {
  const start = beginWebPullGesture({ touchCount: 1, x: 20, y: 20, scrollTop: 0 });
  const claimed = moveWebPullGesture(start, {
    touchCount: 1, x: 20, y: 60, scrollTop: 0,
  });
  assert.equal(claimed.status, "claimed");

  const diagonalRetreat = moveWebPullGesture(claimed, {
    touchCount: 1, x: 180, y: 18, scrollTop: 30,
  });
  assert.equal(diagonalRetreat.status, "claimed");
  assert.equal(diagonalRetreat.pullDistance, 0);
  assert.equal(diagonalRetreat.armed, false);

  const armedAgain = moveWebPullGesture(diagonalRetreat, {
    touchCount: 1, x: -100, y: 140, scrollTop: 50,
  });
  assert.equal(armedAgain.status, "claimed");
  assert.equal(armedAgain.armed, true);

  const multiTouch = moveWebPullGesture(armedAgain, {
    touchCount: 2, x: 20, y: 140, scrollTop: 0,
  });
  assert.equal(multiTouch.status, "cancelled");
});

test("resisted pull is capped and arms at the configured visual distance", () => {
  assert.equal(resistedWebPullDistance(-10), 0);
  assert.equal(resistedWebPullDistance(0), 0);
  assert.ok(resistedWebPullDistance(50) > 0);
  assert.ok(resistedWebPullDistance(50) < 50);
  assert.ok(resistedWebPullDistance(100) < resistedWebPullDistance(150));
  assert.equal(resistedWebPullDistance(10_000), WEB_PULL_REFRESH_CONFIG.maxPullPx);

  const start = beginWebPullGesture({ touchCount: 1, x: 0, y: 0, scrollTop: 0 });
  const belowArm = moveWebPullGesture(start, {
    touchCount: 1, x: 0, y: 103, scrollTop: 0,
  });
  const armed = moveWebPullGesture(start, {
    touchCount: 1, x: 0, y: 104, scrollTop: 0,
  });
  assert.equal(belowArm.armed, false);
  assert.equal(armed.armed, true);
  assert.ok(armed.pullDistance >= WEB_PULL_REFRESH_CONFIG.armPullPx);
  assert.equal(shouldRefreshWebPullGesture(armed), true);
});

test("refresh latch releases only after the promise settles and controlled refresh ends", () => {
  assert.equal(canReleaseWebRefreshLatch({ promiseSettled: false, refreshing: false }), false);
  assert.equal(canReleaseWebRefreshLatch({ promiseSettled: true, refreshing: true }), false);
  assert.equal(canReleaseWebRefreshLatch({ promiseSettled: false, refreshing: true }), false);
  assert.equal(canReleaseWebRefreshLatch({ promiseSettled: true, refreshing: false }), true);
});
