import test from "node:test";
import assert from "node:assert/strict";
import { discoverTabPosition, discoverTabFrame, discoverTabScroll } from "./iosDiscoverTabGeometry.mjs";

test("tab progress is the visible page coordinate, clamped at both boundaries", () => {
  assert.equal(discoverTabPosition(-100, 400, 2, 6), 2.25);
  assert.equal(discoverTabPosition(100, 400, 2, 6), 1.75);
  assert.equal(discoverTabPosition(40, 400, 0, 6), 0);
  assert.equal(discoverTabPosition(-40, 400, 5, 6), 5);
  for (const width of [0, NaN, Infinity, -10]) assert.equal(discoverTabPosition(-100, width, 2, 6), 2);
});

test("interpolation uses unequal measured labels, not guessed text or selection", () => {
  const frames = [{ x: 3, width: 76 }, { x: 79, width: 110 }, { x: 189, width: 400 }];
  assert.deepEqual(discoverTabFrame(frames, .5), { x: 41, width: 93 });
  assert.deepEqual(discoverTabFrame(frames, 1.75), { x: 161.5, width: 327.5 });
  assert.equal(discoverTabFrame([frames[0]], .5), null);
  assert.equal(discoverTabFrame([{ x: 0, width: 0 }], 0), null);
});

test("actual positions work in either physical label order", () => {
  assert.deepEqual(discoverTabFrame([{ x: 180, width: 80 }, { x: 70, width: 110 }], .25), { x: 152.5, width: 87.5 });
});

test("visibility clamps at both ends and handles labels wider than the viewport", () => {
  assert.equal(discoverTabScroll({ x: 3, width: 76 }, 300, 600), 0);
  assert.equal(discoverTabScroll({ x: 200, width: 100 }, 300, 600), 100);
  assert.equal(discoverTabScroll({ x: 500, width: 97 }, 300, 600), 300);
  assert.equal(discoverTabScroll({ x: 100, width: 500 }, 300, 800), 200);
  assert.equal(discoverTabScroll({ x: 100, width: 50 }, 1000, 600), 0);
});

test("atomic page promotion never changes the indicator frame", () => {
  const frames = [{ x: 3, width: 76 }, { x: 79, width: 110 }, { x: 189, width: 400 }];
  for (const [origin, x, destination] of [[0, -393, 1], [2, 393, 1]]) {
    assert.deepEqual(discoverTabFrame(frames, discoverTabPosition(x, 393, origin, 3)),
      discoverTabFrame(frames, discoverTabPosition(0, 393, destination, 3)));
  }
});
