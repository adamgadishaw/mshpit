import assert from "node:assert/strict";
import test from "node:test";
import { defaultMediaEdit } from "./mediaEdit.mjs";
import { mediaEditorGesturePatch, touchCentroid, touchDistance } from "./mediaEditorGesture.mjs";

test("direct manipulation maps screen movement to exact focal coordinates", () => {
  const edit = { ...defaultMediaEdit("image"), aspect: "square", zoom: 2 };
  const patch = mediaEditorGesturePatch({
    edit,
    sourceWidth: 4000,
    sourceHeight: 3000,
    viewportWidth: 300,
    viewportHeight: 300,
    deltaX: 75,
    deltaY: -30,
  });
  assert.equal(patch.zoom, 2);
  assert.ok(Math.abs(patch.focalX - 0.40625) < 0.0001);
  assert.ok(Math.abs(patch.focalY - 0.55) < 0.0001);
});

test("pinch zoom and focal output remain bounded", () => {
  const edit = { ...defaultMediaEdit("image"), zoom: 2.5, focalX: 0.1, focalY: 0.9 };
  assert.deepEqual(mediaEditorGesturePatch({
    edit,
    sourceWidth: 100,
    sourceHeight: 100,
    viewportWidth: 200,
    viewportHeight: 200,
    deltaX: 10_000,
    deltaY: -10_000,
    scale: 4,
  }), { zoom: 3, focalX: 0, focalY: 1 });
});

test("two-touch geometry has stable centroid and distance", () => {
  const touches = [{ pageX: 10, pageY: 20 }, { pageX: 40, pageY: 60 }];
  assert.deepEqual(touchCentroid(touches), { x: 25, y: 40 });
  assert.equal(touchDistance(touches), 50);
  assert.equal(touchDistance(touches.slice(0, 1)), null);
});
