import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./LogScreen.jsx", import.meta.url), "utf8");
const includes = (text, needle) => assert.ok(text.includes(needle), `Expected source to include: ${needle}`);
const excludes = (text, needle) => assert.ok(!text.includes(needle), `Expected source not to include: ${needle}`);

test("composer queues picker selections synchronously and uploads originals without a native staging copy", () => {
  const stage = source.slice(source.indexOf("async function stageSelectedAssets"), source.indexOf("const addPhoto"));
  const preflight = stage.indexOf("mediaPublishingPreflightSelection(candidateAssets");
  const pending = stage.indexOf("setPendingMediaAssets((current)");
  const upload = stage.indexOf("await uploadOriginalMedia(selected)");
  assert.ok(preflight >= 0);
  assert.ok(pending > preflight);
  assert.ok(upload > pending);
  includes(stage, "allowLivePhotoVideo: true");
  includes(stage, "originalMediaProjectAsset(asset, index)");
  includes(stage, "uploadOperationRef.current");
  excludes(stage, "stageMediaDraftAssets");
  excludes(source, "stageMediaDraftAssets,");
  includes(source, "stageSelectedAssets(result.assets)");
  excludes(source, "components/media-editor");
  excludes(source, "MediaEditorWorkspace");
  excludes(source, "PITStudio");
});

test("original upload leaves admission to the authenticated route and keeps progress, retry, and cancellation", () => {
  const upload = source.slice(source.indexOf("async function uploadOriginalMedia"), source.indexOf("async function stageSelectedAssets"));
  includes(upload, ".map((asset, index) => originalMediaProjectAsset(asset, index))");
  excludes(upload, "refreshMediaPublishingCapabilities");
  excludes(upload, "mediaPublishingSelection");
  includes(upload, "const controller = new AbortController()");
  includes(upload, "if (!selected.length || uploadOperationRef.current");
  includes(upload, "uploadOperationRef.current = operation");
  includes(upload, "const operationIsActive = () => ownsOperation() && !controller.signal.aborted");
  excludes(upload, "renderedAsset");
  includes(upload, "onProgress: (progress) =>");
  includes(upload, "createMediaTransferProgressPublisher({");
  includes(upload, "progressPublisher.publish({");
  includes(upload, "progressPublisher.cancel()");
  excludes(upload, "setUploadProgress({");
  includes(upload, "fraction: progress.fraction");
  includes(upload, 'fraction: stage === "ready" ? 1 : 0');
  excludes(upload, 'stage.startsWith("verifying-") ? 1');
  includes(source, "uploadControllerRef.current?.abort()");
  includes(upload, "onRemoteDraft: ({ assetId, sourceUploaded }) =>");
  includes(upload, "if (sourceUploaded !== true) return");
  includes(upload, "originalMediaProjectAsset({ ...candidate, assetId }, candidateIndex)");
  const retirement = source.slice(source.indexOf("async function retireRemoteDrafts"), source.indexOf("const refreshMediaPublishingCapabilities"));
  includes(retirement, "remoteDraftAssetIdsRef.current.get(localId) === assetId");
  includes(retirement, "normalizeMediaProjectAsset({ ...asset, assetId: null }, index)");
  includes(source, "const retryPendingMedia = async () =>");
  includes(source, "await uploadOriginalMedia(originals)");
  includes(source, 'accessibilityRole="progressbar"');
  includes(source, "mediaUploadProgressCopy(uploadProgress)");
});

test("composer exposes no filter, crop, cover, trim, or media-editor entry point", () => {
  for (const removed of [
    "photo and video editor",
    "media editor",
    "MediaEditor",
    "PITStudio",
    "Resume editing",
    "Edit attached media",
    "Apply media edits",
    "videoEditRequiresExport",
    "mediaImageRequiresRender",
    "filterIntensity",
    "activeTab",
  ]) excludes(source, removed);
  includes(source, "Uploading your originals");
  includes(source, 'items will"} upload without filters or edits');
});

test("picker requests iOS permission before original passthrough selection", () => {
  includes(source, "loadMediaPublishingCapabilities({");
  includes(source, "apiCall: api");
  includes(source, "signal: controller.signal");
  excludes(source, "api(MEDIA_PUBLISHING_HEALTH_PATH");
  includes(source, "allowPhotos: pickerCapabilities.photos");
  includes(source, "allowVideos: pickerCapabilities.videos");
  includes(source, "iosPassthroughPreset: ImagePicker.VideoExportPreset.Passthrough");
  includes(source, "iosCurrentRepresentation: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current");
  includes(source, "allowLivePhotoVideo: true");
  includes(source, "label={mediaAttachmentLabel}");
  includes(source, 'AppState.addEventListener("change"');
  includes(source, 'state === "active") void refreshMediaPublishingCapabilities({ background: true })');
  includes(source, "sameMediaPublishingCapabilities(current, capabilities) ? current : capabilities");
  includes(source, "setMediaPublishingCapabilitiesLoaded(true)");
  includes(source, "mediaPublishingCapabilitiesLoaded");
  includes(source, '? mediaPublishingAvailabilityCopy(mediaPublishingCapabilities)');
  includes(source, "refreshMediaPublishingCapabilities({ force: true, background: false })");
  includes(source, 'accessibilityLabel="Check media upload availability again"');
  excludes(source, "Photo Studio is available now");
  const picker = source.slice(source.indexOf("const addPhoto"), source.indexOf("const cancelUpload"));
  includes(picker, "const pickerCapabilities = { photos: true, videos: true }");
  includes(picker, "void refreshMediaPublishingCapabilities({ background: true })");
  const permission = picker.indexOf("await ImagePicker.requestMediaLibraryPermissionsAsync()");
  const launch = picker.indexOf("await ImagePicker.launchImageLibraryAsync(");
  assert.ok(permission >= 0 && launch > permission);
  includes(picker, "if (!permission?.granted)");
  includes(picker, "await stageSelectedAssets(res.assets)");
  excludes(picker, "await refreshMediaPublishingCapabilities");
  includes(source, 'const mediaAttachmentLabel = "Photo / video"');
  includes(source, 'const mediaAddLabel = "Add media"');
});

test("pending Android picker recovery does not wait for or get consumed by media health", () => {
  const recovery = source.slice(source.indexOf("pendingMediaHandledRef"), source.indexOf("const discardCurrentDraft"));
  includes(recovery, "if (!draftRestoreReady || !pendingMedia?.requestId");
  excludes(recovery, "mediaPublishingCapabilitiesReady");
  includes(recovery, "stageSelectedAssets(result.assets)");
});

test("verified media remains attached without exposing a second transformation workflow", () => {
  excludes(source, "Reopening selected media");
  excludes(source, "Recovering selected media");
  excludes(source, "Edit attached photos and videos again");
  excludes(source, "Make more changes before you publish");
  includes(source, "posterUri={mediaPosterUri(descriptor)}");
});
