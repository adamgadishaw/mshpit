import test from "node:test";
import assert from "node:assert/strict";
import {
  PLAYER_CLOSE_RAIL_MIN_HEIGHT,
  canUsePlayerCloseSwipe,
  isUpwardPlayerSwipeIntent,
  nativeTouchCount,
  shouldClosePlayerFromSwipe,
  shouldStartPlayerCloseResponder,
} from "./player-gesture.mjs";

test("the dedicated rail claims a single touch before PanResponder grant resets movement", () => {
  assert.equal(PLAYER_CLOSE_RAIL_MIN_HEIGHT, 44);
  assert.equal(shouldStartPlayerCloseResponder({ enabled: true, touchCount: 1 }), true);
  assert.equal(shouldStartPlayerCloseResponder({ enabled: true, touchCount: null }), true);
  assert.equal(shouldStartPlayerCloseResponder({ enabled: true, touchCount: 2 }), false);
  assert.equal(shouldStartPlayerCloseResponder({ enabled: false, touchCount: 1 }), false);
  assert.equal(nativeTouchCount({ nativeEvent: { touches: [{}] } }), 1);
  assert.equal(nativeTouchCount({ nativeEvent: { touches: [{}, {}] } }), 2);
  assert.equal(nativeTouchCount({ nativeEvent: {} }), null);
});

test("start-time ownership preserves the full coalesced swipe through grant and release", () => {
  assert.equal(shouldStartPlayerCloseResponder({ enabled: true, touchCount: 1 }), true);
  // RN resets these values on grant. Because grant now happens at touch-down,
  // all subsequent movement belongs to this same gesture instead of being lost.
  assert.equal(shouldClosePlayerFromSwipe({ dx: 0, dy: 0, vy: 0 }), false);
  assert.equal(shouldClosePlayerFromSwipe({ dx: 5, dy: -52, vy: -0.2 }), true);
  assert.equal(shouldClosePlayerFromSwipe({ dx: 3, dy: -40, vy: -1.15 }), true);

  const coalescedRelease = { dx: 5, dy: -52, vy: -1.2 };
  const lateGrantReset = { ...coalescedRelease, dx: 0, dy: 0 };
  assert.equal(
    shouldClosePlayerFromSwipe(lateGrantReset),
    false,
    "the old move-to-claim lifecycle loses a coalesced swipe when RN grants and resets dx/dy",
  );
  assert.equal(
    shouldClosePlayerFromSwipe(coalescedRelease),
    true,
    "touch-down ownership grants before movement, so release retains the complete swipe",
  );
});

test("player swipe is limited to compact native or coarse-pointer layouts", () => {
  assert.equal(canUsePlayerCloseSwipe({ compactMobile: true, native: true, coarsePointer: false }), true);
  assert.equal(canUsePlayerCloseSwipe({ compactMobile: true, native: false, coarsePointer: true }), true);
  assert.equal(canUsePlayerCloseSwipe({ compactMobile: true, native: false, coarsePointer: false }), false);
  assert.equal(canUsePlayerCloseSwipe({ compactMobile: false, native: true, coarsePointer: true }), false);
});

test("player swipe intent starts only for a clear dominant upward move", () => {
  assert.equal(isUpwardPlayerSwipeIntent({ dx: 4, dy: -18 }), true);
  assert.equal(isUpwardPlayerSwipeIntent({ dx: 18, dy: -18 }), false);
  assert.equal(isUpwardPlayerSwipeIntent({ dx: 0, dy: -17 }), false);
  assert.equal(isUpwardPlayerSwipeIntent({ dx: 0, dy: 80 }), false);
  assert.equal(isUpwardPlayerSwipeIntent({ dx: Number.NaN, dy: undefined }), false);
});

test("player swipe closes after deliberate upward distance", () => {
  assert.equal(shouldClosePlayerFromSwipe({ dx: 10, dy: -52, vy: -0.1 }), true);
  assert.equal(shouldClosePlayerFromSwipe({ dx: 12, dy: -60, vy: 0 }), true);
  assert.equal(shouldClosePlayerFromSwipe({ dx: 5, dy: -51, vy: -0.1 }), false);
});

test("player swipe accepts a shorter upward flick only with enough velocity", () => {
  assert.equal(shouldClosePlayerFromSwipe({ dx: 4, dy: -40, vy: -1.15 }), true);
  assert.equal(shouldClosePlayerFromSwipe({ dx: 4, dy: -40, vy: -1.14 }), false);
  assert.equal(shouldClosePlayerFromSwipe({ dx: 4, dy: -39, vy: -1.4 }), false);
});

test("player swipe rejects horizontal, downward, and hesitant movement", () => {
  assert.equal(shouldClosePlayerFromSwipe({ dx: 40, dy: -55, vy: -1.4 }), false);
  assert.equal(shouldClosePlayerFromSwipe({ dx: 2, dy: 100, vy: 1.2 }), false);
  assert.equal(shouldClosePlayerFromSwipe({ dx: 8, dy: -48, vy: -0.4 }), false);
});
