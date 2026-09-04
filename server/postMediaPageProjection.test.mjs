import assert from "node:assert/strict";
import test from "node:test";

import {
  attachPostMediaPageProjection,
  preloadedPostMedia,
} from "./postMediaPageProjection.js";

test("a 50-card page resolves stable and legacy media once without mutating or serializing context", () => {
  const rows = Array.from({ length: 50 }, (_, index) => ({ id: `p_${index}`, marker: index }));
  const stableCalls = [];
  const legacyCalls = [];
  const projected = attachPostMediaPageProjection({ marker: "database" }, rows, {
    ownerId: "viewer",
    projectStable(database, ids, options) {
      stableCalls.push({ database, ids, options });
      return {
        assetsByPost: new Map(ids.map((id) => [id, [{ id: `asset_${id}`, url: `https://media.test/${id}.jpg` }]])),
      };
    },
    projectLegacy(database, ids) {
      legacyCalls.push({ database, ids });
      return new Map([["p_1", [{ id: "legacy_1", url: "https://media.test/legacy.mp4" }]]]);
    },
  });

  assert.equal(stableCalls.length, 1, "one page-level stable-media lookup replaces 50 per-card lookups");
  assert.equal(legacyCalls.length, 1, "legacy release mappings are also resolved at the page boundary");
  assert.deepEqual(stableCalls[0].ids, rows.map((row) => row.id));
  assert.deepEqual(stableCalls[0].options, { ownerId: "viewer" });
  assert.equal(preloadedPostMedia(projected[0]).stable.assets[0].id, "asset_p_0");
  assert.equal(preloadedPostMedia(projected[1]).legacy[0].id, "legacy_1");
  assert.equal(preloadedPostMedia(projected[2]).legacy.length, 0);
  assert.deepEqual(rows[0], { id: "p_0", marker: 0 }, "shared recommendation rows remain untouched");
  assert.equal(JSON.stringify(projected[0]).includes("asset_p_0"), false, "private projection context never enters API JSON");
});

test("large pages are chunked to the media projectors' bounded 100-post contract", () => {
  const rows = Array.from({ length: 205 }, (_, index) => ({ id: `p_${index}` }));
  const batchSizes = [];
  const projected = attachPostMediaPageProjection({}, rows, {
    projectStable(_database, ids) {
      batchSizes.push(["stable", ids.length]);
      return { assetsByPost: new Map() };
    },
    projectLegacy(_database, ids) {
      batchSizes.push(["legacy", ids.length]);
      return new Map();
    },
  });

  assert.deepEqual(batchSizes, [
    ["stable", 100], ["legacy", 100],
    ["stable", 100], ["legacy", 100],
    ["stable", 5], ["legacy", 5],
  ]);
  assert.equal(projected.length, rows.length);
  assert.deepEqual(preloadedPostMedia(projected.at(-1)), {
    stable: { assets: [], linkedAssetIds: [] },
    legacy: [],
  });
});

test("empty or id-less pages perform no media work", () => {
  let calls = 0;
  const options = {
    projectStable() { calls += 1; },
    projectLegacy() { calls += 1; },
  };
  assert.deepEqual(attachPostMediaPageProjection({}, [], options), []);
  assert.deepEqual(attachPostMediaPageProjection({}, [{ marker: 1 }], options), [{ marker: 1 }]);
  assert.equal(calls, 0);
  assert.equal(preloadedPostMedia({ id: "plain" }), null);
});
