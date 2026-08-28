import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./LogScreen.jsx", import.meta.url), "utf8");
const studioSource = await readFile(new URL("../components/media-editor/MediaEditorWorkspace.jsx", import.meta.url), "utf8");

test("composer preserves picker and recovered selections before Studio staging", () => {
  const stage = source.slice(source.indexOf("async function stageSelectedAssets"), source.indexOf("async function applyStudioMedia"));
  const preflight = stage.indexOf("mediaPublishingPreflightSelection(candidateAssets");
  const persist = stage.indexOf("stageMediaDraftAssets(selected");
  assert.ok(preflight >= 0);
  assert.ok(persist > preflight);
  assert.match(stage, /allowLivePhotoVideo: true/);
  assert.doesNotMatch(stage, /mediaPublishingSelection/);
  assert.match(source, /stageSelectedAssets\(result\.assets\)/);
});

test("apply leaves admission to the authenticated upload route and connects byte progress plus cancellation", () => {
  const apply = source.slice(source.indexOf("async function applyStudioMedia"), source.indexOf("const addPhoto"));
  assert.match(apply, /void refreshMediaPublishingCapabilities\(\{ force: true, background: true \}\)/);
  assert.doesNotMatch(apply, /mediaPublishingSelection/);
  assert.doesNotMatch(apply, /blockedVideos|blockedPhotos/);
  assert.match(apply, /const controller = new AbortController\(\)/);
  assert.match(apply, /onProgress: \(progress\) =>/);
  assert.match(apply, /fraction: progress\.fraction/);
  assert.match(source, /uploadProgress=\{uploadProgress\}/);
  assert.match(source, /uploadControllerRef\.current\?\.abort\(\)/);
  assert.match(apply, /onRemoteDraft: \(\{ assetId, sourceUploaded \}\) =>/);
  assert.match(apply, /if \(sourceUploaded !== true\) return/);
  assert.match(apply, /normalizeMediaProjectAsset\(\{ \.\.\.candidate, assetId \}, candidateIndex\)/,
    "the recoverable Studio draft retains the remote asset id so retries skip the source PUT");
  const retirement = source.slice(source.indexOf("async function retireRemoteDrafts"), source.indexOf("const refreshMediaPublishingCapabilities"));
  assert.match(retirement, /remoteDraftAssetIdsRef\.current\.get\(localId\) === assetId/,
    "a late retirement response cannot clear a newer retry mapping");
  assert.match(retirement, /normalizeMediaProjectAsset\(\{ \.\.\.asset, assetId: null \}, index\)/,
    "explicitly retired remote identities are cleared from the local retry draft");
  assert.match(source, /await retireRemoteDrafts\(\)/);
  assert.match(source, /void retireRemoteDrafts\(\[id\]\)/);
  assert.match(source, /accessibilityRole="progressbar"/);
  assert.match(source, /mediaUploadProgressCopy\(uploadProgress\)/);
  assert.match(studioSource, /uploadProgress \? \(/);
  assert.match(studioSource, /accessibilityRole="progressbar"/);
  assert.match(studioSource, /mediaUploadProgressCopy\(uploadProgress\)/);
  assert.match(studioSource, /onPress=\{saving \? cancelProcessing : applyEdits\}/);
});

test("Studio treats local video covers as optional previews and leaves durable poster generation to the verifier", () => {
  const blocked = studioSource.slice(studioSource.indexOf("const applyBlocked"), studioSource.indexOf("const anyDirty"));
  assert.doesNotMatch(blocked, /autoCoversReady|needsCoverRenderer|mediaEditVideoCapabilities/);
  const apply = studioSource.slice(studioSource.indexOf("async function applyEdits"), studioSource.indexOf("async function cancelProcessing"));
  assert.doesNotMatch(apply, /await generateVideoCover/);
  assert.match(apply, /const cover = cached\?\.key === autoCoverCacheKey\(asset\) \? cached\.cover : null/);
  assert.match(apply, /attachMediaEditArtifacts\(asset, \{ posterAsset: cover \}\)/);
  assert.match(studioSource, /coverAvailable\s+resolvedCoverTimeMs=/);
});

test("picker preserves local media while refreshing the exact server contract for status", () => {
  assert.match(source, /loadMediaPublishingCapabilities\(\{\s*apiCall: api,\s*signal: controller\.signal,\s*force,/);
  assert.doesNotMatch(source, /api\(MEDIA_PUBLISHING_HEALTH_PATH/);
  assert.match(source, /allowPhotos: pickerCapabilities\.photos/);
  assert.match(source, /allowVideos: pickerCapabilities\.videos/);
  assert.match(source, /iosCompatibleRepresentation: ImagePicker\.UIImagePickerPreferredAssetRepresentationMode\.Compatible/);
  assert.match(source, /allowLivePhotoVideo: true/);
  assert.match(source, /label=\{mediaAttachmentLabel\}/);
  assert.match(source, /AppState\.addEventListener\("change"/);
  assert.match(source, /state === "active"\) void refreshMediaPublishingCapabilities\(\{ background: true \}\)/);
  assert.match(source, /sameMediaPublishingCapabilities\(current, capabilities\) \? current : capabilities/);
  assert.match(source, /refreshMediaPublishingCapabilities\(\{ force: true, background: false \}\)/);
  assert.match(source, /accessibilityLabel="Check media upload availability again"/);
  assert.doesNotMatch(source, /Photo Studio is available now/);
  const picker = source.slice(source.indexOf("const addPhoto"), source.indexOf("const cancelUpload"));
  assert.match(picker, /const pickerCapabilities = \{ photos: true, videos: true \}/);
  assert.match(picker, /void refreshMediaPublishingCapabilities\(\{ background: true \}\)/);
  assert.match(picker, /await stageSelectedAssets\(res\.assets\)/);
  assert.doesNotMatch(picker, /await refreshMediaPublishingCapabilities/);
  assert.match(source, /const mediaAttachmentLabel = "Photo \/ video"/);
  assert.match(source, /const mediaAddLabel = "Add media"/);
});

test("pending Android picker recovery does not wait for or get consumed by media health", () => {
  const recovery = source.slice(source.indexOf("pendingMediaHandledRef"), source.indexOf("const closeReason"));
  assert.match(recovery, /if \(!draftRestoreReady \|\| !pendingMedia\?\.requestId/);
  assert.doesNotMatch(recovery, /mediaPublishingCapabilitiesReady/);
  assert.match(recovery, /stageSelectedAssets\(result\.assets\)/);
});

test("verified mixed media reopens together for ordering while preserving authoritative video posters", () => {
  const reopen = source.slice(source.indexOf("const reopenReadyMedia"), source.indexOf("const openPendingStudio"));
  assert.match(reopen, /asset\.assetId && asset\.status === "ready"/);
  assert.doesNotMatch(reopen, /asset\.kind !== "video"/);
  assert.match(reopen, /posterUri: ownerAsset\.posterUrl \|\| asset\.posterUri/);
  assert.match(reopen, /posterTimeMs: ownerAsset\.posterTimeMs \?\? asset\.posterTimeMs/);
  assert.match(source, /mediaProject\.assets\.some\(\(asset\) => asset\.assetId && asset\.status === "ready"\)/);
});
