import test from "node:test";
import assert from "node:assert/strict";
import { attachMediaEditArtifacts } from "./mediaEditApplyResult.mjs";

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
  const source = {
    id: "local:clip",
    kind: "video",
    uri: "file:///original.mov",
    posterUri: null,
    posterTimeMs: 0,
    durationMs: 0,
    edit: { coverMode: "auto", coverMs: 1_000 },
  };
  const posterAsset = { uri: "file:///cover.jpg", actualTimeMs: 1_234, durationMs: 12_000 };
  const result = attachMediaEditArtifacts(source, { posterAsset });
  assert.equal(result.uri, source.uri);
  assert.equal(result.posterUri, posterAsset.uri);
  assert.equal(result.posterTimeMs, 1_234);
  assert.equal(result.edit.coverMode, "auto");
  assert.equal(result.edit.coverMs, 1_234,
    "the authoritative recipe uses the exact auto-scored frame shown in Studio");
  assert.equal(result.durationMs, 12_000);
  assert.equal(result.posterAsset, posterAsset);
});

test("a video without a local cover artifact keeps the authoritative cover timestamp", () => {
  const source = {
    id: "local:server-cover",
    kind: "video",
    uri: "file:///original.mp4",
    edit: { coverMode: "manual", coverMs: 4_250 },
  };
  const result = attachMediaEditArtifacts(source);
  assert.deepEqual(result, source);
  assert.equal(result.edit.coverMs, 4_250);
  assert.equal(Object.hasOwn(result, "posterAsset"), false);
});
