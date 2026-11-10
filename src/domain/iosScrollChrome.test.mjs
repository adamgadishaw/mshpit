import assert from "node:assert/strict";
import test from "node:test";
import { advanceScrollChrome, scrollChromeState } from "./iosScrollChrome.mjs";

test("chrome hides after deliberate downscroll and requires meaningful upward travel", () => {
  let state = scrollChromeState();
  for (const y of [2, 8, 10, 30, 29, 45, 44, 68, 79]) {
    state = advanceScrollChrome(state, y, 1000, true); assert.equal(state.shown, true);
  }
  state = advanceScrollChrome(state, 80, 1000, true); assert.equal(state.shown, false);
  for (const y of [120, 118, 123, 110, 100, 88]) {
    state = advanceScrollChrome(state, y, 1000, true); assert.equal(state.shown, false);
  }
  state = advanceScrollChrome(state, 87, 1000, true); assert.equal(state.shown, true);
  for (const y of [90, 88, 100, 140, 150]) { state = advanceScrollChrome(state, y, 1000, true); assert.equal(state.shown, true); }
  state = advanceScrollChrome(state, 151, 1000, true); assert.equal(state.shown, false);
});
test("top and bottom rubber-band travel cannot manufacture direction changes", () => {
  let state = scrollChromeState(200, false);
  for (const y of [230, 270, 250, 220, 201, 200, 199, 180, 165]) {
    state = advanceScrollChrome(state, y, 200, true); assert.equal(state.shown, false);
  }
  state = advanceScrollChrome(state, 164, 200, true); assert.equal(state.shown, true);
  for (const y of [8, -10, -90, -1, 0, 5, 12, 30, 50]) {
    state = advanceScrollChrome(state, y, 200, true); assert.equal(state.shown, true);
  }
  assert.equal(advanceScrollChrome(scrollChromeState(), 100, 0, true).shown, true);
});
test("restoration and imperative seeks establish baselines without hiding or revealing", () => {
  let state = advanceScrollChrome(scrollChromeState(), 800, 1000, false);
  assert.equal(state.shown, true);
  state = advanceScrollChrome(state, 820, 1000, true); assert.equal(state.shown, true);
  state = advanceScrollChrome(state, 864, 1000, true); assert.equal(state.shown, false);
  state = advanceScrollChrome(state, 500, 1000, false); assert.equal(state.shown, false);
  state = advanceScrollChrome(state, 480, 1000, true); assert.equal(state.shown, false);
  state = advanceScrollChrome(state, 464, 1000, true); assert.equal(state.shown, true);
  state = advanceScrollChrome(scrollChromeState(500, false), 0, 1000, false); assert.equal(state.shown, true);
});
