import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mediaEditorNarrowStageHeight, mediaEditorWideStageHeight } from "./mediaEditorLayout.mjs";

test("narrow Studio reserves a visible preview without consuming the inspector", () => {
  assert.equal(mediaEditorNarrowStageHeight(568), 199);
  assert.equal(mediaEditorNarrowStageHeight(844), 295);
  assert.equal(mediaEditorNarrowStageHeight(1_200), 300);
  assert.equal(mediaEditorNarrowStageHeight(320), 176);
});

test("wide Studio reserves room for desktop chrome and the media rail", () => {
  assert.equal(mediaEditorWideStageHeight(500), 180);
  assert.equal(mediaEditorWideStageHeight(768), 448);
  assert.equal(mediaEditorWideStageHeight(900), 580);
  assert.equal(mediaEditorWideStageHeight(1_200), 720);
});

test("the narrow stage uses an auto flex basis instead of RN Web's collapsing flex zero", async () => {
  const source = await readFile(new URL("../components/media-editor/MediaEditorWorkspace.jsx", import.meta.url), "utf8");
  assert.match(source, /flexBasis:\s*"auto"/);
  assert.doesNotMatch(source, /!wide\s*&&\s*\{\s*flex:\s*0/);
});

test("video cover preview is allowed to shrink with its measured Studio stage", async () => {
  const source = await readFile(new URL("../components/media-editor/MediaEditorVideoPreview.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /minHeight:\s*220/);
});

test("the dormant legacy Studio keeps focus hygiene while posting no longer mounts it", async () => {
  const workspace = await readFile(new URL("../components/media-editor/MediaEditorWorkspace.jsx", import.meta.url), "utf8");
  const composer = await readFile(new URL("../screens/LogScreen.jsx", import.meta.url), "utf8");
  assert.match(workspace, /modalRootRef/);
  assert.match(workspace, /root\.addEventListener\("keydown", trapFocus\)/);
  assert.match(workspace, /element\.getAttribute\?\.\("aria-hidden"\) !== "true"/);
  assert.match(workspace, /!element\.closest\?\.\('\[aria-hidden="true"\]'\)/);
  assert.match(workspace, /if \(!returnFocusRef && previous\?\.isConnected\)/);
  assert.doesNotMatch(composer, /studioReturnFocusRef|MediaEditorWorkspace|returnFocusRef=\{/);
});
