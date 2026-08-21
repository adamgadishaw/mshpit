import test from "node:test";
import assert from "node:assert/strict";
import { attachMediaEditArtifacts, mediaEditAssetNeedsPosterArtifact } from "./mediaEditApplyResult.mjs";

test("an edited photo keeps its immutable source descriptor and attaches a rendition", () => {
  const source = {
    id: "local:one",
    kind: "image",
    uri: "file:///original.heic",
    width: 4032,
    height: 3024,
    fileSize: 8_000_000,
    mimeType: "image/heic",
  };
  const renderedAsset = {
    uri: "file:///pit-studio.jpg",
    file: { size: 900_000, type: "image/jpeg" },
    width: 1638,
    height: 2048,
    fileSize: 900_000,
    mimeType: "image/jpeg",
  };
  const result = attachMediaEditArtifacts(source, { renderedAsset });
  assert.equal(result.uri, source.uri);
  assert.equal(result.width, source.width);
  assert.equal(result.height, source.height);
  assert.equal(result.fileSize, source.fileSize);
  assert.equal(result.mimeType, source.mimeType);
  assert.equal(result.renderedAsset, renderedAsset);
  assert.equal(result.renderedAsset.file, renderedAsset.file);
});

test("a video cover is attached without replacing the source video", () => {
  const source = { id: "local:clip", kind: "video", uri: "file:///original.mov", posterUri: null, posterTimeMs: 0, durationMs: 0 };
  const posterAsset = { uri: "file:///cover.jpg", actualTimeMs: 1_234, durationMs: 12_000 };
  const result = attachMediaEditArtifacts(source, { posterAsset });
  assert.equal(result.uri, source.uri);
  assert.equal(result.posterUri, posterAsset.uri);
  assert.equal(result.posterTimeMs, 1_234);
  assert.equal(result.durationMs, 12_000);
  assert.equal(result.posterAsset, posterAsset);
});

test("a video preview URI never substitutes for an uploadable poster artifact", () => {
  assert.equal(mediaEditAssetNeedsPosterArtifact({ kind: "video", posterUri: "blob:preview-only" }), true);
  assert.equal(mediaEditAssetNeedsPosterArtifact({ kind: "image", posterUri: "blob:not-relevant" }), false);
});
