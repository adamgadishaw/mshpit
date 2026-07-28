import test from "node:test";
import assert from "node:assert/strict";

import { resizedImageDimensions, webImageOptimizationPlan } from "./mediaImagePolicy.mjs";

test("phone camera images are bounded without changing their aspect ratio", () => {
  assert.deepEqual(resizedImageDimensions(4032, 3024), {
    width: 2048,
    height: 1536,
    resized: true,
  });
  assert.deepEqual(resizedImageDimensions(1200, 900), {
    width: 1200,
    height: 900,
    resized: false,
  });
});

test("web upload policy compresses camera photos but preserves unsupported motion formats", () => {
  const camera = webImageOptimizationPlan({
    type: "image/jpeg",
    size: 6 * 1024 * 1024,
    width: 4032,
    height: 3024,
  });
  assert.equal(camera.optimize, true);
  assert.equal(camera.outputType, "image/webp");
  assert.equal(camera.width, 2048);

  const gif = webImageOptimizationPlan({
    type: "image/gif",
    size: 8 * 1024 * 1024,
    width: 2400,
    height: 1800,
  });
  assert.equal(gif.optimize, false, "animated GIFs must not be flattened by canvas");
});
