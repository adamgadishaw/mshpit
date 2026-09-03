import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Normalize line endings before matching. Several assertions below embed a
// literal newline escape, and git checks this file out with CRLF on Windows and
// in CI. Without this the suite passes on a working copy that happens to hold LF
// at that spot and fails on any clean checkout, including the deploy build.
const source = (await readFile(new URL("./LogScreen.jsx", import.meta.url), "utf8"))
  .replace(/\r\n/gu, "\n");
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

test("an invalid album item is retired while systemic failures still stop the upload batch", () => {
  const upload = source.slice(source.indexOf("async function uploadOriginalMedia"), source.indexOf("async function stageSelectedAssets"));
  includes(source, 'import { shouldContinueMediaBatch } from "../domain/mediaBatchPolicy.mjs"');
  includes(upload, "const completedSelections = []");
  includes(upload, "const rejectedAssets = []");
  includes(upload, "if (!operationIsActive() || !shouldContinueMediaBatch(error)) throw error");
  includes(upload, "rejectedAssets.push({ asset, error })");
  includes(upload, "void retireRemoteDrafts([asset.id])");
  includes(upload, "await releaseMediaDraftAsset(asset)");
  includes(upload, "continue;");
  includes(upload, "completedSelections.push(asset)");
  includes(upload, "completedSelections,\n          completedAssets");
  excludes(upload, "selected.slice(0, completedAssets.length)");
});

test("pending local videos render a picker still or lightweight tile without starting SmartImage video work", () => {
  const preview = source.slice(source.indexOf("function PendingMediaPreview"), source.indexOf("function Stepper"));
  includes(preview, 'if (kind === "video")');
  includes(preview, "const posterUri = mediaPosterUri(asset)");
  includes(preview, "uri={posterUri}");
  includes(preview, 'mediaKind="image"');
  includes(preview, "styles.pendingVideoPreview");
  excludes(preview, 'mediaKind="video"');
  excludes(preview, "posterUri={");
  const pendingGrid = source.slice(source.indexOf("pendingMediaAssets.map"), source.indexOf("photos.length + pendingMediaAssets.length <"));
  includes(pendingGrid, "<PendingMediaPreview");
  excludes(pendingGrid, "<SmartImage");
});

test("submit claims a synchronous lock and checkpoints its exact id before either post request", () => {
  includes(source, "const submitOperationRef = useRef(false)");
  const submit = source.slice(source.indexOf("const submit = async () =>"), source.indexOf("\n\n  return (", source.indexOf("const submit = async () =>")));
  includes(submit, "if (!canPost || submitBusy || submitOperationRef.current) return");
  const claim = submit.indexOf("submitOperationRef.current = true");
  const posting = submit.indexOf("setPosting(true)");
  const checkpoint = submit.indexOf("persistDraftSnapshot(normalizeComposerDraft({");
  const submissionIdentity = submit.indexOf("submissionId: submissionIdRef.current", checkpoint);
  const request = submit.indexOf("await onPost?.(");
  assert.ok(claim >= 0 && posting > claim, "submit lock must be claimed before posting state is scheduled");
  assert.ok(checkpoint > posting && submissionIdentity > checkpoint && request > submissionIdentity, "the exact draft identity must be saved before onPost");
  includes(submit, "} finally {");
  const release = submit.lastIndexOf("submitOperationRef.current = false");
  const postingDone = submit.lastIndexOf("setPosting(false)");
  assert.ok(release > request && postingDone > release, "the synchronous lock must be released from finally");
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

test("artist-page media reuse is an independent opt-in for reviews and memorial memories", () => {
  includes(source, 'const [photosPublic, setPhotosPublic] = useState(editing?.photosPublic === true)');
  includes(source, "photosPublic: isMemorialMemory && photosPublic");
  includes(source, "(!isStatus || isMemorialMemory) && photos.length > 0");
  includes(source, "Artist-page photo sharing is optional and stays off unless you turn it on above.");
  excludes(source, "photosPublic: true,");
  excludes(source, "Public artist-page photo sharing is on by default");
});
