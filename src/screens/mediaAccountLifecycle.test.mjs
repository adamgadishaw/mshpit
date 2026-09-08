import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { createAccountTaskScope } from "../domain/accountTaskScope.mjs";
import { shouldContinueMediaBatch } from "../domain/mediaBatchPolicy.mjs";
import { createMediaTransferProgressPublisher } from "../domain/mediaTransferProgress.mjs";
import {
  mediaProjectPublishedMedia, mediaProjectRequiresLegacyUpload,
  originalMediaProjectAsset, reconcileMediaProjectSelection,
} from "../domain/mediaProject.mjs";

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
  const events = [];
  const run = compileComposerPicker({
    accountTasks, user: { id: "a" }, uploadOperationRef: { current: null }, uploadingPhotos: false, posting: false,
    refreshMediaPublishingCapabilities: () => {}, mediaProjectRequiresLegacyUpload: () => false, mediaProject: {},
    photos: [], pendingMediaAssets: [], MEDIA_POST_MAX_ATTACHMENTS: 8, composerId: null, Platform: { OS: platform },
    ImagePicker: { requestMediaLibraryPermissionsAsync: () => permission.promise,
      launchImageLibraryAsync: () => { events.push("picker"); return picker.promise; },
      VideoExportPreset: { Passthrough: 0 }, UIImagePickerPreferredAssetRepresentationMode: { Current: 1 } },
    Alert: { alert: () => events.push("permission-alert") }, postMediaPickerOptions: () => ({}),
    setMediaError: () => events.push("error"), reportMediaPickerError: () => events.push("picker-error"),
    stageSelectedAssets: async () => events.push("stage"),
  });
  return { accountTasks, permission, picker, events, run };
}

test("iOS denied photo permission never launches the picker or uploads", async () => {
  const f = composerPickerFixture(), run = f.run(); f.permission.resolve({ granted: false }); await run;
  assert.deepEqual(f.events, ["permission-alert"]);
});

test("account changes during the iOS permission prompt cannot launch Photos afterward", async () => {
  const f = composerPickerFixture(), run = f.run(); f.accountTasks.setAccount("b");
  f.permission.resolve({ granted: true }); await run; assert.deepEqual(f.events, []);
});

test("a picker returning to a dismissed composer cannot stage private device media", async () => {
  const f = composerPickerFixture("web"), run = f.run(); f.accountTasks.dispose();
  f.picker.resolve(pickerResult); await run; assert.deepEqual(f.events, ["picker"]);
});

const compileComposerUpload = callback("LogScreen.jsx", "LogScreen", "uploadOriginalMedia");
function composerUploadFixture() {
  const accountTasks = scope(), upload = deferred(), started = deferred(), events = [];
  const uploadControllerRef = { current: null }, uploadOperationRef = { current: null };
  const bindings = {
    accountTasks, user: { id: "a" }, originalMediaProjectAsset, MEDIA_POST_MAX_ATTACHMENTS: 8,
    uploadControllerRef, uploadOperationRef, uploadingPhotos: false, posting: false,
    createMediaTransferProgressPublisher, mediaProjectRequiresLegacyUpload,
    mediaProject: { version: 1, assets: [] }, photos: [], reconcileMediaProjectSelection, mediaProjectPublishedMedia,
    shouldContinueMediaBatch, remoteDraftAssetIdsRef: { current: new Map() },
    releaseMediaDraftAsset: async () => {}, retireRemoteDrafts: async () => {},
    uploadOriginalMediaAsset: (options) => { started.resolve(options); return upload.promise; },
    ...Object.fromEntries(["setUploadProgress", "setUploadingPhotos", "setMediaError", "setPendingMediaAssets", "setMediaProject", "setPhotos"]
      .map((name) => [name, (value) => events.push({ name, value })])),
  };
  const run = compileComposerUpload(bindings);
  return { accountTasks, upload, started, events, uploadControllerRef, run: () => run(pickerResult.assets) };
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
function submitFixture() {
  const accountTasks = scope(), response = deferred(), events = [];
  const bindings = {
    accountTasks, user: { id: "a", name: "A", handle: "a", initials: "A" },
    canPost: true, submitBusy: false, submitOperationRef: { current: false },
    persistDraftSnapshot: () => events.push("checkpoint"), normalizeComposerDraft: (value) => value,
    currentDraft: { id: "draft-a" }, submissionIdRef: { current: "post-a" }, photos: [],
    isDurableMediaUrl: () => true, mediaAssetIdsMatchingPhotos: () => [], mediaProject: { assets: [] },
    mediaProjectPublishedMedia, isStatus: true, isMemorialMemory: false, protectedLegacyMemory: false,
    editing: null, review: "A private draft", memoryTextOnly: false, song: null, isCampaign: false,
    onPost: () => { events.push("post"); return response.promise; },
    postErrorMessage: (error) => error?.message || "Failed", draftIdRef: { current: "draft-a" }, composerId: "composer-a",
    ...Object.fromEntries(["setPosting", "setPostError", "deleteDraft", "setDraftId", "setSavedDraftFingerprint", "onDraftIdentity"]
      .map((name) => [name, () => events.push(name)])),
  };
  return { accountTasks, response, events, run: compileSubmit(bindings) };
}

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
