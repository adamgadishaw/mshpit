import { normalizeComposerDraft } from "./composerDraft.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { moveComposerMedia } from "./composerMediaOrder.mjs";
import { normalizeMediaProject, serializableMediaProject, mediaProjectFromPost, mediaAssetIdsMatchingPhotos, mediaProjectSubmissionAssetIds, patchMediaProjectAsset } from "./mediaProject.mjs";

const fixture = () => normalizeMediaProject({ assets: [
  { id: "photo", assetId: "p", kind: "image", sourceUrl: "https://test/photo.jpg", altText: "Stage lights", status: "ready" },
  { id: "clip", assetId: "v", kind: "video", status: "processing", posterUrl: "https://test/poster.jpg", durationMs: 5000 },
  { id: "video", assetId: "w", kind: "video", sourceUrl: "https://test/video.mp4", status: "ready" },
] });

test("mixed media moves synchronize ready URLs and retain stable IDs and metadata", () => {
  const initial = fixture();
  const result = moveComposerMedia(initial, "video", -1);
  assert.deepEqual(result.project.assets.map(a => a.id), ["photo", "video", "clip"]);
  assert.deepEqual(mediaAssetIdsMatchingPhotos(result.project, result.photos), ["p", "w"]);
  assert.deepEqual(mediaProjectSubmissionAssetIds(result.project, result.photos), ["p", "w", "v"]);
  assert.deepEqual(result.project.assets[0], initial.assets[0]);
  assert.deepEqual(result.project.assets[2], initial.assets[1]);
});

test("bounds, busy operations, unknown identities and invalid moves are no-ops", () => {
  const project = fixture();
  for (const args of [["photo", -1], ["video", 1], ["missing", 1], ["clip", 2], ["clip", 1, true]]) {
    assert.equal(moveComposerMedia(project, ...args), null);
  }
  assert.deepEqual(project, fixture());
});

test("rapid moves use latest identity order, survive draft serialization, and keep conversion final order", () => {
  let result = moveComposerMedia(fixture(), "clip", -1);
  for (let i = 0; i < 20; i++) {
    result = moveComposerMedia(result.project, "clip", 1);
    result = moveComposerMedia(result.project, "clip", -1);
  }
  const reopened = normalizeMediaProject(serializableMediaProject(result.project));
  assert.deepEqual(reopened.assets.map(a => a.id), ["clip", "photo", "video"]);
  assert.equal(reopened.assets[0].status, "processing");
  assert.deepEqual(mediaProjectSubmissionAssetIds(reopened, result.photos), ["v", "p", "w"]);
  const completed = patchMediaProjectAsset(reopened, "clip", { status: "ready", sourceUrl: "https://test/clip.mp4" });
  assert.deepEqual(completed.assets.map(a => a.assetId), ["v", "p", "w"]);
});

test("legacy mixed URL-only posts retain every attachment and stay on compatibility path", () => {
  const project = mediaProjectFromPost({ photos: ["https://test/old.jpg", "https://test/old.mp4"] });
  const result = moveComposerMedia(project, project.assets[1].id, -1);
  assert.deepEqual(result.photos, ["https://test/old.mp4", "https://test/old.jpg"]);
  assert.equal(mediaProjectSubmissionAssetIds(result.project, result.photos), null);
});

test("composer draft save/reopen retains the ordered projection and accessibility metadata", () => {
  const moved = moveComposerMedia(fixture(), "clip", -1);
  const saved = normalizeComposerDraft({ id: "order_draft", postType: "status", photos: moved.photos,
    mediaProject: moved.project, review: "A concert memory" });
  const reopened = normalizeComposerDraft(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(reopened.photos, moved.photos);
  assert.deepEqual(reopened.mediaProject.assets.map(a => a.id), ["clip", "photo", "video"]);
  assert.equal(reopened.mediaProject.assets[1].altText, "Stage lights");
  assert.deepEqual(mediaProjectSubmissionAssetIds(reopened.mediaProject, reopened.photos), ["v", "p", "w"]);
});
