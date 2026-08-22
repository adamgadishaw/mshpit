import test from "node:test";
import assert from "node:assert/strict";
import {
  MEDIA_PROJECT_MAX_ASSETS,
  mediaProjectFromLegacyUrls,
  mediaProjectFromPost,
  mediaAssetIdsMatchingPhotos,
  mediaProjectRequiresLegacyUpload,
  mediaProjectFromPicker,
  mediaProjectPublishedMedia,
  mediaProjectReady,
  moveMediaProjectAsset,
  normalizeMediaProject,
  patchMediaProjectAsset,
  serializableMediaProject,
  transitionMediaProjectAsset,
} from "./mediaProject.mjs";

test("picker projects are bounded, ordered and strip opaque picker objects", () => {
  const picked = Array.from({ length: 10 }, (_, index) => ({
    uri: `blob:clip-${index}`, type: "video", duration: 8_000, width: 1080, height: 1920, file: { size: 100 + index, secret: index },
  }));
  const project = mediaProjectFromPicker(picked, "test");
  assert.equal(project.assets.length, MEDIA_PROJECT_MAX_ASSETS);
  assert.equal(project.assets[0].id, "local:test:1");
  assert.equal("file" in project.assets[0], false);
  assert.equal(project.assets[0].runtimeFile.size, 100);
});

test("legacy URL posts normalize into ready backward-compatible assets", () => {
  const project = mediaProjectFromLegacyUrls([
    "https://media.mshpit.com/users/u/post/still.jpg",
    "https://media.mshpit.com/users/u/post/clip.mp4",
  ]);
  assert.equal(mediaProjectReady(project), true);
  assert.deepEqual(project.assets.map((asset) => asset.kind), ["image", "video"]);
});

test("post edit projects preserve unenriched photos around a partial video descriptor", () => {
  const still = "https://media.mshpit.com/users/u/post/still.jpg";
  const clip = "https://media.mshpit.com/users/u/post/clip.mp4";
  const encore = "https://media.mshpit.com/users/u/post/encore.jpg";
  const project = mediaProjectFromPost({
    photos: [still, clip, encore],
    media: [{
      id: "legacy_video_cover",
      kind: "video",
      url: clip,
      sourceUrl: clip,
      posterUrl: "https://media.mshpit.com/users/u/post/clip-poster.jpg",
      posterTimeMs: 2_000,
    }],
  });

  assert.deepEqual(project.assets.map((asset) => asset.sourceUrl), [still, clip, encore]);
  assert.deepEqual(project.assets.map((asset) => asset.kind), ["image", "video", "image"]);
  assert.equal(project.assets[1].posterUrl, "https://media.mshpit.com/users/u/post/clip-poster.jpg");
  assert.equal(project.assets[1].assetId, null);
  assert.equal(mediaAssetIdsMatchingPhotos(project, [still, clip, encore]), null);
});

test("post edit projects retain only server-authorized stable asset IDs", () => {
  const url = "https://media.mshpit.com/users/u/post/stable.webp";
  const project = mediaProjectFromPost({
    photos: [url],
    media: [{ id: "ma_abcdefgh12345678", kind: "image", url }],
    mediaAssetIds: ["ma_abcdefgh12345678"],
  });
  assert.equal(project.assets[0].assetId, "ma_abcdefgh12345678");
  assert.deepEqual(mediaAssetIdsMatchingPhotos(project, [url]), ["ma_abcdefgh12345678"]);
});

test("project identity is deduplicated and hostile fields are bounded", () => {
  const project = normalizeMediaProject({ assets: [
    { id: "same", uri: "file:///a.jpg", status: "failed", errorCode: "bad text !@#", progress: 8, altText: "a".repeat(1_500) },
    { id: "same", uri: "file:///b.jpg" },
  ] });
  assert.equal(project.assets[0].errorCode, "BADTEXT");
  assert.equal(project.assets[0].progress, 1);
  assert.equal(project.assets[0].altText.length, 1_000);
  assert.notEqual(project.assets[0].id, project.assets[1].id);
});

test("state transitions fail closed and ready requires a durable source", () => {
  const project = mediaProjectFromPicker([{ uri: "file:///a.jpg", type: "image", width: 100, height: 100 }], "state");
  const illegal = transitionMediaProjectAsset(project, "local:state:1", "ready");
  assert.equal(illegal.assets[0].status, "selected");
  const uploading = transitionMediaProjectAsset(project, "local:state:1", "uploading", { progress: 0.4 });
  const readyWithoutUrl = transitionMediaProjectAsset(uploading, "local:state:1", "ready");
  assert.equal(mediaProjectReady(readyWithoutUrl), false);
  const ready = patchMediaProjectAsset(readyWithoutUrl, "local:state:1", { sourceUrl: "https://media.mshpit.com/users/u/post/a.jpg" });
  assert.equal(mediaProjectReady(ready), true);
});

test("moving assets preserves recipes and published order", () => {
  let project = mediaProjectFromLegacyUrls([
    "https://media.mshpit.com/users/u/post/a.jpg",
    "https://media.mshpit.com/users/u/post/b.jpg",
  ]);
  project = patchMediaProjectAsset(project, "legacy:1", { assetId: "ma_a", altText: "Front row" });
  project = moveMediaProjectAsset(project, "ma_a", 1);
  const published = mediaProjectPublishedMedia(project);
  assert.equal(published[1].assetId, "ma_a");
  assert.equal(published[1].altText, "Front row");
  assert.deepEqual(published.map((item) => item.position), [0, 1]);
});

test("serialized drafts retain only PIT-managed local recovery files", () => {
  const project = normalizeMediaProject({ assets: [
    { id: "local", uri: "file:///private/path.jpg", kind: "image", status: "editing" },
    { id: "staged", uri: "file:///data/user/0/app/files/pit-studio/u/post/staged.jpg", durableLocalUri: "file:///data/user/0/app/files/pit-studio/u/post/staged.jpg", kind: "image", status: "editing", altText: "Draft lights" },
    { id: "remote", uri: "https://media.mshpit.com/users/u/post/a.jpg", kind: "image", status: "ready", altText: "Lights" },
  ] });
  const serialized = serializableMediaProject(project);
  assert.equal(serialized.assets.length, 2);
  assert.equal(serialized.assets[0].altText, "Draft lights");
  assert.equal(serialized.assets[0].status, "editing");
  assert.match(serialized.assets[0].durableLocalUri, /pit-studio/);
  assert.equal(serialized.assets[1].altText, "Lights");
  assert.equal(JSON.stringify(serialized).includes("file:///private"), false);
  assert.equal(JSON.stringify(serialized).includes("runtimeFile"), false);
});

test("a stable asset keeps its explicit editing state across process-death serialization", () => {
  const project = normalizeMediaProject({ assets: [{
    id: "stable-edit",
    assetId: "ma_abcdefgh12345678",
    kind: "image",
    sourceUrl: "https://media.mshpit.com/users/u/post/render.jpg",
    status: "editing",
    edit: { kind: "image", filter: "encore" },
    altText: "Updated description",
  }] });
  const restored = normalizeMediaProject(serializableMediaProject(project));
  assert.equal(restored.assets.length, 1);
  assert.equal(restored.assets[0].status, "editing");
  assert.equal(restored.assets[0].edit.filter, "encore");
  assert.equal(restored.assets[0].altText, "Updated description");
});

test("stable IDs are emitted only when they cover the full photos projection", () => {
  const stable = normalizeMediaProject({ assets: [{
    id: "stable", assetId: "ma_abcdefgh12345678", kind: "image", status: "ready",
    sourceUrl: "https://media.mshpit.com/users/u/post/a.jpg",
  }] });
  assert.deepEqual(mediaAssetIdsMatchingPhotos(stable, ["https://media.mshpit.com/users/u/post/a.jpg"]), ["ma_abcdefgh12345678"]);
  assert.equal(mediaAssetIdsMatchingPhotos(stable, ["https://media.mshpit.com/users/u/post/a.jpg", "https://legacy.example/b.jpg"]), null);
  assert.equal(mediaAssetIdsMatchingPhotos(mediaProjectFromLegacyUrls(["https://legacy.example/b.jpg"]), ["https://legacy.example/b.jpg"]), null);
  assert.equal(mediaProjectRequiresLegacyUpload(stable, ["https://media.mshpit.com/users/u/post/a.jpg"]), false);
  assert.equal(mediaProjectRequiresLegacyUpload(mediaProjectFromLegacyUrls(["https://legacy.example/b.jpg"]), ["https://legacy.example/b.jpg"]), true);
  assert.equal(mediaProjectRequiresLegacyUpload(normalizeMediaProject(), []), false);
});
