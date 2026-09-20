import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { createAccountTaskScope } from "../domain/accountTaskScope.mjs";
import { shouldContinueMediaBatch } from "../domain/mediaBatchPolicy.mjs";
import { createMediaTransferProgressPublisher } from "../domain/mediaTransferProgress.mjs";
import { retireMediaAssetDrafts } from "../lib/mediaAssetDraftCleanup.mjs";
import {
  mediaProjectPublishedMedia, mediaProjectRequiresLegacyUpload,
  originalMediaProjectAsset, reconcileMediaProjectSelection, normalizeMediaProjectAsset,
} from "../domain/mediaProject.mjs";
import { artistCampaignLimitCooldownMs, postRateLimitCooldownMs } from "../domain/postRetryCooldown.mjs";

function find(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) { for (const item of value) { const result = find(item, predicate); if (result) return result; } }
    else if (value && typeof value === "object") { const result = find(value, predicate); if (result) return result; }
  }
  return null;
}

// Compile the actual screen callback, with explicit device/store boundaries.
// Unexpected dependencies fail normally instead of receiving magical stubs.
function callback(file, component, name) {
  const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
  const owner = find(ast, (node) => node.type === "FunctionDeclaration" && node.id?.name === component);
  assert.ok(owner, component);
  const node = find(owner.body, (candidate) => (candidate.type === "VariableDeclarator" || candidate.type === "FunctionDeclaration") && candidate.id?.name === name);
  assert.ok(node, name);
  const body = node.type === "VariableDeclarator" ? node.init : node;
  return (bindings) => new Function(...Object.keys(bindings), `return (${source.slice(body.start, body.end)});`)(...Object.values(bindings));
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function scope() {
  const tasks = createAccountTaskScope(); tasks.setAccount("a"); tasks.mount(); return tasks;
}

function crossBoundary(tasks, boundary) {
  if (boundary === "unmount") tasks.dispose();
  else {
    tasks.setAccount(boundary === "logout" ? null : "b");
    if (boundary === "round-trip") tasks.setAccount("a");
  }
}

const pickerResult = { canceled: false, assets: [{ id: "local-a", uri: "file:///camera.jpg", kind: "image" }] };
const photoCases = [
  ["EditProfileScreen.jsx", "EditProfileScreen", "pickPhoto", "setAvatarUri"],
  ["EditProfileScreen.jsx", "EditProfileScreen", "pickBanner", "setBanner"],
  ["EditArtistProfileScreen.jsx", "ConfirmedArtistProfileEditor", "pickPhoto", "setAvatarUri"],
  ["EditArtistProfileScreen.jsx", "ConfirmedArtistProfileEditor", "pickBanner", "setBanner"],
  ["VenueReviewScreen.jsx", "VenueReviewScreen", "addPhoto", "setPhotos"],
];

function photoFixture(compile) {
  const accountTasks = scope(), picker = deferred(), upload = deferred(), uploadStarted = deferred();
  const events = [], uploads = [];
  const setters = Object.fromEntries(["setAvatarUri", "setAvatarChanged", "setBanner", "setBannerChanged", "setPhotos", "setUploadingAvatar", "setUploadingBanner", "setUploadingPhotos", "setSaveError"]
    .map((name) => [name, (value) => events.push({ name, value })]));
  const run = compile({
    accountTasks, session: { id: "a" }, accountId: "a", uploadingAvatar: false, uploadingBanner: false,
    uploadingPhotos: false, posting: false, saving: false, photos: [], MEDIA_POST_MAX_ATTACHMENTS: 8,
    ImagePicker: { launchImageLibraryAsync: () => picker.promise }, Platform: { OS: "web" },
    profileImagePickerOptions: () => ({}), postMediaPickerOptions: () => ({}),
    reportMediaPickerError: (error) => events.push({ name: "picker-error", error }),
    isDurableMediaUrl: (value) => /^https:\/\//u.test(value || ""),
    uploadMediaAsset: (_asset, _purpose, options) => { uploads.push(options); uploadStarted.resolve(); return upload.promise; },
    ...setters,
  });
  return { accountTasks, picker, upload, uploadStarted, events, uploads, run };
}

for (const [file, component, name, resultSetter] of photoCases) {
  const compile = callback(file, component, name);
  const label = `${component}.${name}`;
  test(`${label} rejects picker results after logout, switch, round trip or unmount`, async () => {
    for (const boundary of ["logout", "switch", "round-trip", "unmount"]) {
      const f = photoFixture(compile), run = f.run();
      crossBoundary(f.accountTasks, boundary);
      const before = f.events.length;
      f.picker.resolve(pickerResult); await run;
      assert.equal(f.uploads.length, 0, boundary);
      assert.equal(f.events.length, before, boundary);
    }
  });

  test(`${label} aborts pending upload and rejects late media completion`, async () => {
    for (const boundary of ["logout", "switch", "round-trip", "unmount"]) {
      const f = photoFixture(compile), run = f.run(); f.picker.resolve(pickerResult);
      await f.uploadStarted.promise;
      assert.equal(f.uploads[0].expectedAccountId, "a");
      crossBoundary(f.accountTasks, boundary);
      assert.equal(f.uploads[0].signal.aborted, true);
      const before = f.events.length;
      f.upload.resolve("https://media.example.org/a.jpg"); await run;
      assert.equal(f.events.length, before, boundary);
    }
  });

  test(`${label} still attaches a successful current-owner upload`, async () => {
    const f = photoFixture(compile), run = f.run(); f.picker.resolve(pickerResult);
    await f.uploadStarted.promise; f.upload.resolve("https://media.example.org/a.jpg"); await run;
    assert.equal(f.uploads[0].expectedAccountId, "a");
    assert.equal(f.uploads[0].signal.aborted, false);
    assert.equal(f.events.filter((event) => event.name === resultSetter).length, 1);
  });
}

const compileComposerPicker = callback("LogScreen.jsx", "LogScreen", "addPhoto");
function composerPickerFixture(platform = "ios") {
  const accountTasks = scope(), permission = deferred(), picker = deferred();
  const events = [], picking = [], released = [], pickerSignals = [];
  const pickerOperationRef = { current: null };
  const run = compileComposerPicker({
    accountTasks, user: { id: "a" }, pickerOperationRef, uploadOperationRef: { current: null }, uploadingPhotos: false, posting: false,
    refreshMediaPublishingCapabilities: () => {}, mediaProjectRequiresLegacyUpload: () => false, mediaProject: {},
    photos: [], pendingMediaAssets: [], MEDIA_POST_MAX_ATTACHMENTS: 8, composerId: null, Platform: { OS: platform },
    ImagePicker: { requestMediaLibraryPermissionsAsync: () => permission.promise,
      VideoExportPreset: { Passthrough: 0 }, UIImagePickerPreferredAssetRepresentationMode: { Current: 1 } },
    launchComposerMediaLibrary: (_options, { signal }) => { events.push("picker"); pickerSignals.push(signal); return picker.promise; },
    setPickingMedia: (value) => picking.push(value),
    releaseMediaDraftAssets: async (assets) => released.push(assets),
    Alert: { alert: () => events.push("permission-alert") }, postMediaPickerOptions: () => ({}),
    setMediaError: () => events.push("error"), reportMediaPickerError: () => events.push("picker-error"),
    stageSelectedAssets: async () => events.push("stage"),
  });
  return { accountTasks, permission, picker, events, picking, released, pickerSignals, pickerOperationRef, run };
}

test("iOS denied photo permission never launches the picker or uploads", async () => {
  const f = composerPickerFixture(), run = f.run(); f.permission.resolve({ granted: false }); await run;
  assert.deepEqual(f.events, ["permission-alert"]);
  assert.deepEqual(f.picking, [true, false]);
  assert.equal(f.pickerOperationRef.current, null);
});

test("account changes during the iOS permission prompt cannot launch Photos afterward", async () => {
  const f = composerPickerFixture(), run = f.run(); f.accountTasks.setAccount("b");
  f.permission.resolve({ granted: true }); await run; assert.deepEqual(f.events, []);
  assert.deepEqual(f.picking, [true], "a stale permission callback cannot alter another account's UI");
  assert.equal(f.pickerOperationRef.current, null);
});

test("a late composer picker cannot stage private media after logout, switch, round trip, or unmount", async () => {
  for (const boundary of ["logout", "switch", "round-trip", "unmount"]) {
    const f = composerPickerFixture("web"), run = f.run();
    crossBoundary(f.accountTasks, boundary);
    assert.equal(f.pickerSignals[0].aborted, true, boundary);
    f.picker.resolve(pickerResult); await run;
    assert.deepEqual(f.events, ["picker"], boundary);
    assert.deepEqual(f.released, [pickerResult.assets], "late browser handles must be released instead of transferred to the next account");
    assert.deepEqual(f.picking, [true], boundary);
    assert.equal(f.pickerOperationRef.current, null, boundary);
  }
});

test("a manual picker cancellation clears current busy state and releases a noncooperative late selection", async () => {
  const f = composerPickerFixture("web"), run = f.run();
  f.pickerOperationRef.current.abort();
  f.picker.resolve(pickerResult); await run;
  assert.deepEqual(f.events, ["picker"]);
  assert.deepEqual(f.picking, [true, false]);
  assert.deepEqual(f.released, [pickerResult.assets]);
  assert.equal(f.pickerOperationRef.current, null);
});

test("double-open is fenced synchronously while a successful owner selection stages exactly once", async () => {
  const f = composerPickerFixture("web"), first = f.run(), second = f.run();
  assert.deepEqual(f.events, ["picker"]);
  f.picker.resolve(pickerResult); await Promise.all([first, second]);
  assert.deepEqual(f.events, ["picker", "stage"]);
  assert.deepEqual(f.picking, [true, false]);
  assert.deepEqual(f.released, [], "the upload pipeline owns a successfully staged File until completion or discard");
  assert.equal(f.pickerOperationRef.current, null);
});

const compileComposerUpload = callback("LogScreen.jsx", "LogScreen", "uploadOriginalMedia");
const compileProjectSetter = callback("LogScreen.jsx", "LogScreen", "setMediaProject");
const compilePhotosSetter = callback("LogScreen.jsx", "LogScreen", "setPhotos");
function composerUploadFixture() {
  const accountTasks = scope(), upload = deferred(), started = deferred(), events = [];
  const uploadControllerRef = { current: null }, uploadOperationRef = { current: null };
  const mediaProjectRef = { current: { version: 1, assets: [] } };
  const photosRef = { current: [] };
  const bindings = {
    accountTasks, user: { id: "a" }, originalMediaProjectAsset, MEDIA_POST_MAX_ATTACHMENTS: 8,
    uploadControllerRef, uploadOperationRef, uploadingPhotos: false, posting: false,
    createMediaTransferProgressPublisher, mediaProjectRequiresLegacyUpload,
    mediaProject: mediaProjectRef.current, mediaProjectRef, photos: [], photosRef, reconcileMediaProjectSelection, mediaProjectPublishedMedia,
    shouldContinueMediaBatch, remoteDraftAssetIdsRef: { current: new Map() },
    releaseMediaDraftAsset: async () => {}, retireRemoteDrafts: async () => {},
    uploadOriginalMediaAsset: (options) => { started.resolve(options); return upload.promise; },
    ...Object.fromEntries(["setUploadProgress", "setUploadingPhotos", "setMediaError", "setPendingMediaAssets"]
      .map((name) => [name, (value) => events.push({ name, value })])),
    setMediaProject: compileProjectSetter({ mediaProjectRef, renderMediaProject: (value) => events.push({ name: "setMediaProject", value }) }),
    setPhotos: compilePhotosSetter({ photosRef, renderPhotos: (value) => events.push({ name: "setPhotos", value }) }),
  };
  const run = compileComposerUpload(bindings);
  return { accountTasks, upload, started, events, uploadControllerRef, bindings, run: () => run(pickerResult.assets) };
}

test("composer rejects an old-account upload completion and its late progress", async () => {
  const f = composerUploadFixture(), run = f.run(), options = await f.started.promise;
  assert.equal(options.expectedAccountId, "a"); f.accountTasks.setAccount("b");
  assert.equal(options.signal.aborted, true);
  const before = f.events.length;
  options.onProgress({ stage: "uploading-source", fraction: 1 });
  options.onRemoteDraft({ assetId: "a-private", sourceUploaded: true });
  f.upload.resolve({ ...pickerResult.assets[0], sourceUrl: "https://media.example.org/a.jpg", assetId: "a-private", status: "ready" });
  assert.equal((await run).stale, true); assert.equal(f.events.length, before);
});

test("expired-session upload stops without attaching media or promising durable draft recovery", async () => {
  const f = composerUploadFixture(), run = f.run(); await f.started.promise;
  f.upload.reject(Object.assign(new Error("Sign in again"), { status: 401 }));
  assert.equal((await run).ok, false);
  assert.equal(f.events.some(({ name }) => name === "setPhotos" || name === "setMediaProject"), false);
  assert.equal(f.events.some(({ name, value }) => name === "setMediaError" && /Sign in to the same account/u.test(value)), true);
  assert.equal(f.events.some(({ name, value }) => name === "setMediaError" && /may need to re-create this draft/u.test(value)), true);
  assert.equal(f.events.some(({ name, value }) => name === "setUploadingPhotos" && value === false), true);
});

test("manual upload cancellation still clears the current composer's busy state", async () => {
  const f = composerUploadFixture(), run = f.run(); await f.started.promise;
  f.uploadControllerRef.current.abort(); f.upload.reject(Object.assign(new Error("Cancelled"), { name: "AbortError" }));
  assert.equal((await run).ok, false);
  assert.equal(f.events.some(({ name, value }) => name === "setUploadingPhotos" && value === false), true);
});

const compileSubmit = callback("LogScreen.jsx", "LogScreen", "submit");
const compileShowPostFailure = callback("LogScreen.jsx", "LogScreen", "showPostFailure");
function submitFixture({ photosPublic = false } = {}) {
  const accountTasks = scope(), response = deferred(), events = [], posts = [];
  const setPostError = () => events.push("setPostError");
  const showPostFailure = compileShowPostFailure({
    artistCampaignLimitCooldownMs,
    setFeaturedRetryAt: (value) => events.push(`featuredRetryAt:${value > 0 ? "future" : "clear"}`),
    postRateLimitCooldownMs,
    setPostRetryClock: () => events.push("setPostRetryClock"),
    setPostRetryAt: (value) => events.push(`setPostRetryAt:${value > 0 ? "future" : "clear"}`),
    setPostError,
    postErrorMessage: (error) => error?.message || "Failed",
  });
  const bindings = {
    accountTasks, user: { id: "a", name: "A", handle: "a", initials: "A" },
    canPost: true, submitBusy: false, postCoolingDown: false, featuredPostingBlocked: false,
    submitOperationRef: { current: false },
    persistDraftSnapshot: () => events.push("checkpoint"), normalizeComposerDraft: (value) => value,
    currentDraft: { id: "draft-a" }, submissionIdRef: { current: "post-a" }, photos: [],
    isDurableMediaUrl: () => true, mediaAssetIdsMatchingPhotos: () => [], mediaProject: { assets: [] },
    mediaProjectPublishedMedia, isStatus: true, isMemorialMemory: false, protectedLegacyMemory: false,
    editing: null, review: "A private draft", memoryTextOnly: false, song: null, isCampaign: false,
    artistMediaConsent: { photosPublic },
    onPost: (post) => { events.push("post"); posts.push(post); return response.promise; },
    showPostFailure, setPostError, draftIdRef: { current: "draft-a" }, composerId: "composer-a",
    ...Object.fromEntries(["setPosting", "deleteDraft", "setDraftId", "setSavedDraftFingerprint", "onDraftIdentity"]
      .map((name) => [name, () => events.push(name)])),
  };
  return { accountTasks, response, events, posts, run: compileSubmit(bindings) };
}

test("status publication transmits the explicit normalized artist gallery choice", async () => {
  for (const photosPublic of [false, true]) {
    const f = submitFixture({ photosPublic }), run = f.run();
    assert.equal(f.posts.length, 1);
    assert.equal(f.posts[0].photosPublic, photosPublic);
    assert.equal(f.posts[0].campaign, null);
    assert.equal(f.posts[0].artist, undefined, "the server owns artist attribution for ordinary posts");
    f.response.resolve({ ok: true }); await run;
  }
});

test("late publish success cannot delete another account's draft or update its composer", async () => {
  for (const boundary of ["logout", "switch", "round-trip", "unmount"]) {
    const f = submitFixture(), run = f.run(); assert.equal(f.events.includes("post"), true);
    crossBoundary(f.accountTasks, boundary); const before = f.events.length;
    f.response.resolve({ ok: true }); await run;
    assert.equal(f.events.length, before, boundary); assert.equal(f.events.includes("deleteDraft"), false);
  }
});

test("a current-owner publish success clears only its own draft", async () => {
  const f = submitFixture(), run = f.run(); f.response.resolve({ ok: true }); await run;
  assert.equal(f.events.filter((event) => event === "deleteDraft").length, 1);
});

test("rejected publication retains the draft for the current owner", async () => {
  const f = submitFixture(), run = f.run(); f.response.resolve({ ok: false, error: new Error("Sign in again") }); await run;
  assert.equal(f.events.includes("deleteDraft"), false);
  assert.equal(f.events.filter((event) => event === "setPostError").length, 2);
});

test("a Featured quota failure retains the draft and blocks only Featured mode", async () => {
  const f = submitFixture(), run = f.run();
  f.response.resolve({
    ok: false,
    error: { status: 429, serverCode: "ARTIST_CAMPAIGN_LIMIT", retryAfterMs: 3_600_000 },
  });
  await run;
  assert.equal(f.events.includes("deleteDraft"), false);
  assert.equal(f.events.includes("featuredRetryAt:future"), true);
  assert.equal(f.events.includes("setPostRetryAt:clear"), true);
  assert.equal(f.events.includes("setPostRetryAt:future"), false, "ordinary posting must not inherit the Featured quota");
});

const compileComposerRetry = callback("LogScreen.jsx", "LogScreen", "retryPendingMedia");
const compilePendingSetter = callback("LogScreen.jsx", "LogScreen", "setPendingMediaAssets");
function composerRetryFixture(initial = [originalMediaProjectAsset({
  id: "local:clip", assetId: "ma_source", kind: "video", uri: "blob:original", durationMs: 2_000,
})]) {
  const accountTasks = scope(), recovery = deferred(), events = [], uploads = [];
  const pendingMediaAssetsRef = { current: initial }, mediaRetryOperationRef = { current: null };
  const uploadOperationRef = { current: null };
  const setPendingMediaAssets = compilePendingSetter({
    pendingMediaAssetsRef,
    renderPendingMediaAssets: (value) => events.push({ name: "pending", value }),
  });
  let recoveryCalls = 0;
  const bindings = {
    accountTasks, user: { id: "a" }, pendingMediaAssets: initial, pendingMediaAssetsRef,
    mediaRetryOperationRef, uploadOperationRef, submitBusy: false,
    setMediaError: (value) => events.push({ name: "error", value }),
    recoverMediaDraftAssets: () => { recoveryCalls += 1; return recovery.promise; },
    originalMediaProjectAsset, setPendingMediaAssets,
    uploadOriginalMedia: async (assets) => { uploads.push(assets); },
  };
  return { ...bindings, recovery, events, uploads, run: compileComposerRetry(bindings),
    recoveryCalls: () => recoveryCalls };
}

test("Stop pauses upload without deleting the source needed by Retry", async () => {
  const controller = new AbortController(), errors = [], retired = [];
  const cancel = callback("LogScreen.jsx", "LogScreen", "cancelUpload")({
    uploadControllerRef: { current: controller },
    setMediaError: (value) => errors.push(value),
    retireRemoteDrafts: async () => retired.push("deleted"),
  });
  await cancel();
  assert.equal(controller.signal.aborted, true);
  assert.deepEqual(retired, [], "a pause must not destroy the resumable server source");
  assert.match(errors.at(-1), /still here.*try again/u);
});

test("Retry cannot resurrect a source identity retired during recovery", async () => {
  const f = composerRetryFixture(), deletion = deferred();
  const original = f.pendingMediaAssetsRef.current[0];
  const remoteDraftAssetIdsRef = { current: new Map([[original.id, original.assetId]]) };
  const retire = callback("LogScreen.jsx", "LogScreen", "retireRemoteDrafts")({
    remoteDraftAssetIdsRef, accountTasks: f.accountTasks, user: { id: "a" }, retireMediaAssetDrafts,
    api: () => deletion.promise, setPendingMediaAssets: f.setPendingMediaAssets, normalizeMediaProjectAsset,
  });
  const cleaning = retire(), retrying = f.run();
  deletion.resolve({ removed: true }); await cleaning;
  assert.equal(f.pendingMediaAssetsRef.current[0].assetId, null);
  f.recovery.resolve([]); await retrying;
  assert.equal(f.uploads.length, 1);
  assert.equal(f.uploads[0][0].assetId, null, "retry may upload the retained original, never the deleted source");
  assert.equal(f.uploads[0][0].uri, "blob:original");
  assert.equal(f.pendingMediaAssetsRef.current[0].assetId, null);
});

test("removing the failed pending item clears its error and cannot be undone by Retry", async () => {
  const f = composerRetryFixture(), retired = [], released = [];
  const removePending = callback("LogScreen.jsx", "LogScreen", "removePendingMedia")({
    pendingMediaAssets: f.pendingMediaAssetsRef.current, pendingMediaAssetsRef: f.pendingMediaAssetsRef,
    setPendingMediaAssets: f.setPendingMediaAssets, setMediaError: f.setMediaError,
    retireRemoteDrafts: async (ids) => retired.push(ids), releaseMediaDraftAsset: async (asset) => released.push(asset.id),
  });
  const retrying = f.run();
  f.setMediaError("That PIT media source is no longer available.");
  removePending("local:clip");
  assert.equal(f.events.at(-1).value, "");
  f.recovery.resolve([]); await retrying;
  assert.deepEqual(f.pendingMediaAssetsRef.current, []);
  assert.deepEqual(f.uploads, []);
  assert.deepEqual(retired, [["local:clip"]]);
  assert.deepEqual(released, ["local:clip"]);
});

test("Retry uses the latest identity and preserves selections added while recovery waits", async () => {
  const f = composerRetryFixture(), retrying = f.run();
  const added = originalMediaProjectAsset({ id: "local:new", kind: "image", uri: "blob:new" });
  f.setPendingMediaAssets((current) => [{ ...current[0], assetId: "ma_replacement" }, added]);
  f.recovery.resolve([]); await retrying;
  assert.deepEqual(f.uploads[0].map((asset) => asset.assetId), ["ma_replacement"]);
  assert.deepEqual(f.pendingMediaAssetsRef.current.map((asset) => asset.id), ["local:clip", "local:new"]);
});

test("Retry never calls an unchecked replacement local source missing", async () => {
  for (const initiallyRemote of [true, false]) {
    const asset = originalMediaProjectAsset({ id: "local:clip", kind: "video", durationMs: 2_000,
      uri: "file:///cache/pit-studio/a/draft/original.mov", durableLocalUri: "file:///cache/pit-studio/a/draft/original.mov",
      ...(initiallyRemote ? { assetId: "ma_retired" } : {}),
    });
    const f = composerRetryFixture([asset]), running = f.run();
    const latest = { ...asset, assetId: null,
      ...(initiallyRemote ? {} : { durableLocalUri: "file:///cache/pit-studio/a/draft/replacement.mov" }),
    };
    f.setPendingMediaAssets([latest]); f.recovery.resolve([]); await running;
    assert.equal(f.uploads.length, 1);
    assert.equal(f.uploads[0][0].durableLocalUri, latest.durableLocalUri);
    assert.equal(f.pendingMediaAssetsRef.current.length, 1);
  }
});

test("double Retry shares one recovery and releases its lock after completion", async () => {
  const f = composerRetryFixture(), first = f.run(), second = f.run();
  assert.equal(f.recoveryCalls(), 1);
  f.recovery.resolve([]); await Promise.all([first, second]);
  assert.equal(f.uploads.length, 1);
  assert.equal(f.mediaRetryOperationRef.current, null);
});

test("failed recovery releases the Retry lock without losing selections", async () => {
  const f = composerRetryFixture(), first = f.run();
  f.recovery.reject(new Error("Device source temporarily unavailable")); await first;
  assert.equal(f.mediaRetryOperationRef.current, null);
  assert.equal(f.pendingMediaAssetsRef.current.length, 1);
  await f.run();
  assert.equal(f.recoveryCalls(), 2);
  assert.equal(f.mediaRetryOperationRef.current, null);
  assert.deepEqual(f.uploads, []);
});

test("late Retry recovery cannot touch another account or a dismissed composer", async () => {
  for (const boundary of ["logout", "switch", "round-trip", "unmount"]) {
    const f = composerRetryFixture(), retrying = f.run();
    crossBoundary(f.accountTasks, boundary);
    const before = f.events.length;
    f.recovery.resolve([]); await retrying;
    assert.equal(f.events.length, before, boundary);
    assert.deepEqual(f.uploads, [], boundary);
    assert.equal(f.mediaRetryOperationRef.current, null, boundary);
  }
});

test("Retry does not race a newer upload that started during recovery", async () => {
  const f = composerRetryFixture(), retrying = f.run();
  f.uploadOperationRef.current = { token: Symbol("newer-upload") };
  f.recovery.resolve([]); await retrying;
  assert.deepEqual(f.uploads, []);
  assert.equal(f.mediaRetryOperationRef.current, null);
});

const compileRestoredRecovery = callback("LogScreen.jsx", "LogScreen", "recoverRestoredMedia");
function restoredRecoveryFixture() {
  const local = originalMediaProjectAsset({ id: "local:restored", kind: "video", durationMs: 2_000,
    uri: "file:///cache/pit-studio/a/draft/clip.mov", durableLocalUri: "file:///cache/pit-studio/a/draft/clip.mov" });
  const remote = originalMediaProjectAsset({ id: "remote:restored", kind: "video", assetId: "ma_remote", uri: "", durationMs: 2_000 });
  const f = composerRetryFixture([local, remote]), calls = [];
  const draftIdRef = { current: "draft-a" }, mediaRestoreOperationRef = { current: null };
  const recover = compileRestoredRecovery({ accountTasks: f.accountTasks, user: { id: "a" }, draftIdRef,
    mediaRestoreOperationRef, setPendingMediaAssets: f.setPendingMediaAssets, setMediaError: f.setMediaError,
    recoverMediaDraftAssets: (assets) => { calls.push(assets); return f.recovery.promise; } });
  return { ...f, local, remote, calls, draftIdRef, mediaRestoreOperationRef, recover };
}

test("restored remote-only uploads remain recoverable without the original device file", async () => {
  const f = restoredRecoveryFixture();
  f.setPendingMediaAssets([f.remote]);
  await f.recover([f.remote], "draft-a");
  assert.deepEqual(f.calls, [], "remote sources must not pass through local file existence checks");
  assert.deepEqual(f.pendingMediaAssetsRef.current, [f.remote]);
  const unpersistable = callback("LogScreen.jsx", "LogScreen", "hasUnpersistablePendingMedia");
  assert.equal(unpersistable({ pendingMediaAssets: [f.remote] }), false);
  assert.equal(unpersistable({ pendingMediaAssets: [{ uri: "blob:unsent" }] }), true);
});

test("restored media checks only local files and preserves remote sources when a local file is missing", async () => {
  const f = restoredRecoveryFixture(), checking = f.recover([f.local, f.remote], "draft-a");
  assert.deepEqual(f.calls[0].map((asset) => asset.id), [f.local.id]);
  f.recovery.resolve([]); await checking;
  assert.deepEqual(f.pendingMediaAssetsRef.current, [f.remote]);
  assert.match(f.events.at(-1).value, /no longer available on this device/u);
  assert.equal(f.mediaRestoreOperationRef.current, null);
});

test("late saved-draft recovery preserves removed, added, replaced and newly uploaded selections", async () => {
  for (const change of ["removed", "replaced", "uploaded"]) {
    const f = restoredRecoveryFixture(), checking = f.recover([f.local, f.remote], "draft-a");
    const added = originalMediaProjectAsset({ id: "local:added", kind: "image", uri: "blob:new" });
    const replacement = change === "replaced"
      ? { ...f.local, durableLocalUri: "file:///cache/pit-studio/a/draft/other.mov" }
      : { ...f.local, assetId: "ma_newly_uploaded" };
    const expected = [...(change === "removed" ? [] : [replacement]), f.remote, added];
    f.setPendingMediaAssets(expected);
    f.recovery.resolve([]); await checking;
    assert.deepEqual(f.pendingMediaAssetsRef.current, expected, change);
    assert.equal(f.events.some((event) => event.name === "error"), false, change);
  }
});

test("saved-draft recovery is fenced by account, draft id and restore generation", async () => {
  for (const boundary of ["logout", "switch", "round-trip", "unmount", "draft", "new-restore"]) {
    const f = restoredRecoveryFixture(), checking = f.recover([f.local, f.remote], "draft-a");
    if (boundary === "draft") f.draftIdRef.current = "draft-b";
    else if (boundary === "new-restore") await f.recover([f.remote], "draft-a");
    else crossBoundary(f.accountTasks, boundary);
    const before = f.events.length;
    f.recovery.resolve([]); await checking;
    assert.equal(f.events.length, before, boundary);
    assert.deepEqual(f.pendingMediaAssetsRef.current, [f.local, f.remote], boundary);
  }
});

test("failed saved-draft checks retain selections and report a retryable local check", async () => {
  const f = restoredRecoveryFixture(), checking = f.recover([f.local, f.remote], "draft-a");
  f.recovery.reject(new Error("Temporary device failure")); await checking;
  assert.deepEqual(f.pendingMediaAssetsRef.current, [f.local, f.remote]);
  assert.match(f.events.at(-1).value, /draft is unchanged/u);
  assert.equal(f.mediaRestoreOperationRef.current, null);
});

test("a terminal rejected clip does not block later files or detach successful uploads", async () => {
  const f = composerUploadFixture(), attempted = [], retired = [];
  const selected = ["first", "rejected", "last"].map((id) => originalMediaProjectAsset({
    id, kind: "video", uri: `blob:${id}`, durationMs: 2_000,
  }));
  const state = { pending: selected, project: { assets: [] }, photos: [] };
  const bindings = { ...f.bindings,
    setPendingMediaAssets: (update) => { state.pending = typeof update === "function" ? update(state.pending) : update; },
    setMediaProject: (value) => { state.project = value; f.bindings.mediaProjectRef.current = value; },
    setPhotos: (value) => { state.photos = value; },
    retireRemoteDrafts: async (ids) => retired.push(ids),
    uploadOriginalMediaAsset: async ({ asset, expectedAccountId }) => {
      assert.equal(expectedAccountId, "a");
      attempted.push(asset.id);
      if (asset.id === "rejected") throw Object.assign(new Error("That clip format is unsupported"), {
        status: 415, code: "MEDIA_TYPE_UNSUPPORTED",
      });
      return { ...asset, assetId: `ma_${asset.id}`, sourceUrl: `https://media.example.org/${asset.id}.mp4`,
        posterUrl: `https://media.example.org/${asset.id}.jpg`, status: "ready" };
    },
  };
  const result = await compileComposerUpload(bindings)(selected);
  assert.equal(result.ok, true);
  assert.equal(result.partial, true);
  assert.deepEqual(attempted, ["first", "rejected", "last"]);
  assert.deepEqual(state.project.assets.map((asset) => asset.assetId), ["ma_first", "ma_last"]);
  assert.deepEqual(state.photos, ["https://media.example.org/first.mp4", "https://media.example.org/last.mp4"]);
  assert.deepEqual(state.pending, []);
  assert.deepEqual(retired, [["rejected"]]);
});

test("a delayed Retry does not restore removed ready media or discard newly attached media", async () => {
  const f = composerUploadFixture();
  const ready = (id) => originalMediaProjectAsset({ id, assetId: `ma_${id}`, kind: "image", status: "ready",
    sourceUrl: `https://media.example.org/${id}.jpg` });
  const removed = ready("removed"), retained = ready("retained"), added = ready("added");
  f.bindings.mediaProject = { assets: [removed, retained] };
  f.bindings.photos = [removed.sourceUrl, retained.sourceUrl];
  const pending = originalMediaProjectAsset({ id: "pending", kind: "image", uri: "blob:pending" });
  const uploadFromBeforeRecovery = compileComposerUpload({ ...f.bindings,
    uploadOriginalMediaAsset: async () => ({ ...pending, ...ready("pending") }),
  });
  // The callback has already captured the old render, as Retry does across its
  // filesystem await. Later composer edits must still win at reconciliation.
  f.bindings.setMediaProject({ assets: [retained, added] });
  f.bindings.setPhotos([retained.sourceUrl, added.sourceUrl]);
  await uploadFromBeforeRecovery([pending]);
  assert.deepEqual(f.bindings.mediaProjectRef.current.assets.map((asset) => asset.id), ["retained", "added", "pending"]);
});

test("two finished attachments survive Retry with six pending files including a lost local and expired remote source", async () => {
  const finished = ["ready-one", "ready-two"].map((id) => originalMediaProjectAsset({
    id, assetId: `ma_${id}`, kind: "video", status: "ready", sourceUrl: `https://media.example.org/${id}.mp4`,
  }));
  const pending = ["lost-local", "expired-remote", "photo-one", "photo-two", "photo-three", "photo-four"].map((id) => originalMediaProjectAsset({
    id, kind: id.startsWith("photo") ? "image" : "video", uri: id === "expired-remote" ? "" : `blob:${id}`,
    ...(id === "expired-remote" ? { assetId: "ma_expired" } : {}),
    ...(id === "lost-local" ? { uri: "file:///cache/pit-studio/a/draft/lost.mov", durableLocalUri: "file:///cache/pit-studio/a/draft/lost.mov" } : {}),
  }));
  const retry = composerRetryFixture(pending), upload = composerUploadFixture(), attempted = [];
  upload.bindings.mediaProjectRef.current = { assets: finished };
  let message = "";
  const setMediaError = (value) => { message = typeof value === "function" ? value(message) : value; };
  const uploadBatch = compileComposerUpload({ ...upload.bindings, accountTasks: retry.accountTasks,
    setPendingMediaAssets: retry.setPendingMediaAssets, setMediaError,
    uploadOriginalMediaAsset: async ({ asset }) => {
      attempted.push(asset.id);
      if (asset.id === "expired-remote") throw Object.assign(new Error("Missing original"), { code: "MEDIA_SOURCE_MISSING" });
      assert.equal(asset.edit.filter, "original", "fresh photos remain original-only");
      return { ...asset, assetId: `ma_${asset.id}`, status: "ready", sourceUrl: `https://media.example.org/${asset.id}.jpg` };
    },
  });
  const retryBatch = compileComposerRetry({ ...retry, setMediaError, uploadOriginalMedia: uploadBatch });
  const running = retryBatch(); retry.recovery.resolve([]); await running;
  assert.deepEqual(attempted, ["expired-remote", "photo-one", "photo-two", "photo-three", "photo-four"]);
  assert.equal(upload.bindings.mediaProjectRef.current.assets.length, 6, "two finished plus four recoverable photos stay attached");
  assert.deepEqual(retry.pendingMediaAssetsRef.current, []);
  assert.match(message, /could not be recovered/u);
  assert.match(message, /1 original file is no longer available/u);
});
