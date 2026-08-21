import assert from "node:assert/strict";
import test from "node:test";
import { releaseVideoPosterAssetLease, replaceVideoPosterAssetLease } from "./videoPosterAssetLease.mjs";

test("a stale A image error cannot release the current B poster asset", () => {
  const ref = { current: null };
  const assetA = { uri: "blob:a" };
  const assetB = { uri: "blob:b" };
  let releasesA = 0;
  let releasesB = 0;
  replaceVideoPosterAssetLease(ref, { uri: "video-a", asset: assetA, release: () => { releasesA += 1; } });
  replaceVideoPosterAssetLease(ref, { uri: "video-b", asset: assetB, release: () => { releasesB += 1; } });
  assert.equal(releasesA, 1, "replacing A with B releases A exactly once");

  assert.equal(releaseVideoPosterAssetLease(ref, { uri: "video-a", asset: assetA }), false);
  assert.equal(releasesB, 0);
  assert.equal(ref.current.asset, assetB);

  assert.equal(releaseVideoPosterAssetLease(ref, { uri: "video-b", asset: assetB }), true);
  assert.equal(releasesB, 1);
  assert.equal(releaseVideoPosterAssetLease(ref, { uri: "video-b", asset: assetB }), false);
  assert.equal(releasesB, 1, "the matching event remains idempotent");
});
