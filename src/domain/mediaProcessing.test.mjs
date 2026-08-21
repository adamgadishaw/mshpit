import test from "node:test";
import assert from "node:assert/strict";
import { defaultMediaEdit } from "./mediaEdit.mjs";
import {
  MEDIA_PROCESSING_ERROR,
  mediaAssetProcessingPlan,
  mediaProcessingMessage,
  mediaProjectPublishReadiness,
  nextMediaProcessingAsset,
} from "./mediaProcessing.mjs";

test("unchanged photos upload and finalize without a renderer", () => {
  const plan = mediaAssetProcessingPlan({ kind: "image", edit: defaultMediaEdit("image") }, {});
  assert.deepEqual(plan, { supported: true, errorCode: null, operations: ["upload-source", "finalize-asset"] });
});

test("real photo edits fail closed when output cannot be rendered", () => {
  const edit = { ...defaultMediaEdit("image"), rotation: 90 };
  assert.deepEqual(mediaAssetProcessingPlan({ kind: "image", edit }, {}), {
    supported: false,
    errorCode: MEDIA_PROCESSING_ERROR.PHOTO_RENDERER_UNAVAILABLE,
    operations: [],
  });
  assert.deepEqual(mediaAssetProcessingPlan({ kind: "image", edit }, { photoRender: true }).operations, ["render-photo", "upload-source", "finalize-asset"]);
});

test("cover-only video work does not pretend to require destructive rendering", () => {
  const edit = { ...defaultMediaEdit("video", { durationMs: 20_000 }), coverMs: 8_000 };
  const plan = mediaAssetProcessingPlan({ kind: "video", edit }, { posterGenerate: true });
  assert.equal(plan.supported, true);
  assert.deepEqual(plan.operations, ["generate-poster", "upload-poster", "upload-source", "finalize-asset"]);
});

test("destructive video edits are blocked without the authoritative renderer", () => {
  const edit = { ...defaultMediaEdit("video", { durationMs: 20_000 }), trimEndMs: 12_000 };
  const plan = mediaAssetProcessingPlan({ kind: "video", edit }, { posterGenerate: true });
  assert.equal(plan.supported, false);
  assert.equal(plan.errorCode, MEDIA_PROCESSING_ERROR.VIDEO_RENDERER_UNAVAILABLE);
  assert.match(mediaProcessingMessage(plan.errorCode), /video renderer/i);
});

test("publish readiness requires finalized identity and a durable video poster", () => {
  const project = { assets: [{
    id: "local:1", assetId: "ma_1", kind: "video", uri: "https://media.mshpit.com/users/u/post/v.mp4",
    sourceUrl: "https://media.mshpit.com/users/u/post/v.mp4", status: "ready", durationMs: 5_000,
  }] };
  const blocked = mediaProjectPublishReadiness(project);
  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.errorCodes, [MEDIA_PROCESSING_ERROR.VIDEO_POSTER_REQUIRED]);
  assert.equal(nextMediaProcessingAsset(project)?.id, "local:1");
  const ready = mediaProjectPublishReadiness({ assets: [{ ...project.assets[0], posterUrl: "https://media.mshpit.com/users/u/post/v-poster.jpg" }] });
  assert.equal(ready.ready, true);
});
