import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./LogScreen.jsx", import.meta.url), "utf8");
const studioSource = await readFile(new URL("../components/media-editor/MediaEditorWorkspace.jsx", import.meta.url), "utf8");

test("composer filters picker and recovered selections before Studio staging", () => {
  const stage = source.slice(source.indexOf("async function stageSelectedAssets"), source.indexOf("async function applyStudioMedia"));
  const capability = stage.indexOf("mediaPublishingSelection(candidateAssets, capabilities)");
  const preflight = stage.indexOf("mediaPublishingPreflightSelection(selection.accepted");
  const persist = stage.indexOf("stageMediaDraftAssets(selected");
  assert.ok(capability >= 0);
  assert.ok(preflight > capability);
  assert.ok(persist > preflight);
  assert.match(source, /draftRestoreReady \|\| !mediaPublishingCapabilitiesReady/);
  assert.match(source, /stageSelectedAssets\(result\.assets\)/);
});

test("apply rechecks the live capability and connects byte progress plus cancellation", () => {
  const apply = source.slice(source.indexOf("async function applyStudioMedia"), source.indexOf("const addPhoto"));
  assert.match(apply, /await refreshMediaPublishingCapabilities\(\)/);
  assert.match(apply, /mediaPublishingSelection\(selected, activeCapabilities\)/);
  assert.match(apply, /selection\.blockedPhotos/);
  assert.match(apply, /const controller = new AbortController\(\)/);
  assert.match(apply, /onProgress: \(progress\) =>/);
  assert.match(apply, /fraction: progress\.fraction/);
  assert.match(source, /uploadProgress=\{uploadProgress\}/);
  assert.match(source, /uploadControllerRef\.current\?\.abort\(\)/);
  assert.match(apply, /onRemoteDraft: \(\{ assetId \}\) =>/);
  assert.match(source, /await retireRemoteDrafts\(\)/);
  assert.match(source, /void retireRemoteDrafts\(\[id\]\)/);
  assert.match(source, /accessibilityRole="progressbar"/);
  assert.match(source, /mediaUploadProgressCopy\(uploadProgress\)/);
  assert.match(studioSource, /uploadProgress \? \(/);
  assert.match(studioSource, /accessibilityRole="progressbar"/);
  assert.match(studioSource, /mediaUploadProgressCopy\(uploadProgress\)/);
  assert.match(studioSource, /onPress=\{saving \? cancelProcessing : applyEdits\}/);
});

test("picker refreshes and honors both media capabilities from the exact server contract", () => {
  assert.match(source, /loadMediaPublishingCapabilities\(\{ apiCall: api, signal: controller\.signal \}\)/);
  assert.doesNotMatch(source, /api\(MEDIA_PUBLISHING_HEALTH_PATH/);
  assert.match(source, /allowPhotos: pickerCapabilities\.photos/);
  assert.match(source, /allowVideos: pickerCapabilities\.videos/);
  assert.match(source, /label=\{mediaAttachmentLabel\}/);
  assert.match(source, /AppState\.addEventListener\("change"/);
  assert.match(source, /accessibilityLabel="Check media upload availability again"/);
  assert.doesNotMatch(source, /Photo Studio is available now/);
  const picker = source.slice(source.indexOf("const addPhoto"), source.indexOf("const cancelUpload"));
  assert.match(picker, /if \(Platform\.OS === "web"\) \{\s*void refreshMediaPublishingCapabilities\(\)/);
  assert.match(picker, /const latestCapabilities = await refreshMediaPublishingCapabilities\(\)/);
});

test("verified clips never reopen into the unsupported client cover replacement path", () => {
  const reopen = source.slice(source.indexOf("const reopenReadyMedia"), source.indexOf("const openPendingStudio"));
  assert.match(reopen, /asset\.status === "ready" && asset\.kind !== "video"/);
  assert.match(source, /mediaProject\.assets\.some\(\(asset\) => asset\.assetId && asset\.status === "ready" && asset\.kind !== "video"\)/);
});
