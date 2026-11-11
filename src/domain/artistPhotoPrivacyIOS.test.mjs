import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { captureAccountMutation, accountMutationIsCurrent } from "./accountMutation.mjs";
import { artistGalleryIdentityKey, mergeArtistGalleryMedia, postMatchesArtistGallery } from "./artistGalleryMedia.mjs";
import { mediaDisplayItems } from "./postMediaDisplay.mjs";
import { artistPageAccessDenied } from "./artistPageRead.mjs";
import { commandFailure } from "./commandResult.mjs";
import { isLoadCancellation } from "./loadState.mjs";
import { createIOSArtistPhotoLoader, projectIOSArtistPhotos } from "../features/artistReviews/services/artistPhotoPrivacyService.ios.js";
import { getIOSDetailPrivacySnapshot, invalidateIOSDetailPrivacy } from "../lib/iosDetailPrivacy.ios.js";

// Execute the real Store callbacks with their actual domain dependencies. API
// completions deliberately ignore AbortSignal so adoption guards must work.
const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
const provider = ast.program.body.find(node => node.declaration?.id?.name === "StoreProvider").declaration;
const names = ["isPhotoRemoved", "artistPhotoCacheKey", "loadArtistPhotos", "artistFanPhotos"];
const declarations = provider.body.body.flatMap(node => node.type === "VariableDeclaration" ? node.declarations : []);
const callbacks = names.map(name => { const node = declarations.find(entry => entry.id?.name === name); assert.ok(node, name); return `const ${source.slice(node.start, node.end)};`; }).join("\n");
const photo = { uri: "https://images.example/concert.jpg", posterUrl: "https://images.example/poster.jpg", userId: "fan", postId: "post", by: "Fan" };

class AppError extends Error {
  constructor(message, options = {}) { super(message || "Request unavailable"); this.name = "AppError"; this.code = "PIT-REQ-003"; this.retryable = true; Object.assign(this, options); }
}

function fixture(platform = "ios") {
  const calls = [], writes = [], queued = [];
  const sessionRef = { current: { id: "account-A" } }, accountMutationEpochRef = { current: 1 };
  const baseline = getIOSDetailPrivacySnapshot();
  const state = { photos: {}, removedIds: [], blockedIds: [], removedPhotos: [], feed: [], defer: false };
  Object.defineProperty(state, "privacy", { get: () => getIOSDetailPrivacySnapshot() - baseline,
    set: value => { while (getIOSDetailPrivacySnapshot() - baseline < value) invalidateIOSDetailPrivacy(); } });
  const setArtistPhotosSrv = update => { const apply = () => { const next = update(state.photos); if (next !== state.photos) writes.push(next); state.photos = next; }; if (state.defer) queued.push(apply); else apply(); };
  const render = () => {
    const dependencies = { Platform: { OS: platform }, sessionRef, accountMutationEpochRef, captureAccountMutation, accountMutationIsCurrent,
      artistGalleryIdentityKey, mergeArtistGalleryMedia, postMatchesArtistGallery, mediaDisplayItems, artistPageAccessDenied, isLoadCancellation,
      createIOSArtistPhotoLoader, projectIOSArtistPhotos, AppError, commandError: error => commandFailure(error instanceof AppError ? error : new AppError(error.message, { cause: error })), artistPhotosSrv: state.photos, setArtistPhotosSrv, feed: state.feed,
      removedIds: state.removedIds, blockedIds: state.blockedIds, removedPhotos: state.removedPhotos,
      api: (path, options) => new Promise((resolve, reject) => calls.push({ path, options, resolve, reject })),
    };
    return new Function(...Object.keys(dependencies), `${callbacks}\nreturn {loadArtistPhotos,artistFanPhotos};`)(...Object.values(dependencies));
  };
  return { state, calls, writes, render, sessionRef, accountMutationEpochRef, flush: () => queued.splice(0).forEach(fn => fn()) };
}

test("iOS Artist photo reads reject aborted, replaced, privacy-revoked and account-roundtrip success", async () => {
  for (const mode of ["abort", "privacy", "roundtrip", "replaced"]) {
    const f = fixture(), controller = new AbortController();
    const pending = f.render().loadArtistPhotos("Artist", "artist", { signal: controller.signal });
    assert.equal(f.calls[0].options.signal, controller.signal);
    if (mode === "abort") controller.abort();
    if (mode === "privacy") f.state.privacy++;
    if (mode === "roundtrip") f.accountMutationEpochRef.current += 2;
    if (mode === "replaced") void f.render().loadArtistPhotos("Artist", "artist");
    f.calls[0].resolve({ photos: [photo] });
    assert.equal((await pending).ok, false, mode); assert.deepEqual(f.writes, [], mode);
    assert.deepEqual(f.render().artistFanPhotos("Artist", "artist"), []);
  }
  const f = fixture(), controller = new AbortController(); controller.abort();
  assert.equal((await f.render().loadArtistPhotos("Artist", "artist", { signal: controller.signal })).aborted, true);
  assert.equal(f.calls.length, 0);
});

test("iOS Artist photo setter rechecks ownership when a queued React update commits", async () => {
  const f = fixture(); f.state.defer = true;
  const pending = f.render().loadArtistPhotos("Artist", "artist");
  f.calls[0].resolve({ photos: [photo] }); assert.equal((await pending).ok, true);
  f.state.privacy++; f.flush(); assert.deepEqual(f.writes, []);
});

test("iOS Artist server photos project live removed posts, blocked owners, URI and poster moderation", async () => {
  const f = fixture(), pending = f.render().loadArtistPhotos("Artist", "artist");
  f.calls[0].resolve({ photos: [photo] }); assert.equal((await pending).ok, true);
  assert.equal(f.render().artistFanPhotos("Artist", "artist")[0].ownerId, "fan");
  for (const [field, value] of [["removedIds", "post"], ["blockedIds", "fan"], ["removedPhotos", photo.uri], ["removedPhotos", photo.posterUrl]]) {
    f.state[field] = [value]; assert.deepEqual(f.render().artistFanPhotos("Artist", "artist"), [], `${field}:${value}`); f.state[field] = [];
  }
  f.state.privacy++;
  assert.deepEqual(f.render().artistFanPhotos("Artist", "artist"), [], "settled remote snapshot cannot cross a viewer privacy revision");
});

test("iOS Artist latest denial clears private photos across privacy change but old denial cannot erase newer receipt", async () => {
  const denied = new AppError("Forbidden", { status: 403 });
  const f = fixture();
  const first = f.render().loadArtistPhotos("Artist", "artist");
  const second = f.render().loadArtistPhotos("Artist", "artist");
  f.calls[1].resolve({ photos: [photo] }); await second;
  f.calls[0].reject(denied); await first;
  assert.equal(f.state.privacy, 0); assert.equal(f.render().artistFanPhotos("Artist", "artist").length, 1);
  const latest = f.render().loadArtistPhotos("Artist", "artist");
  f.state.privacy++; f.calls[2].reject(denied); assert.equal((await latest).error, denied);
  assert.equal(f.state.privacy, 2); assert.deepEqual(f.state.photos.artist, []);
  assert.deepEqual(f.render().artistFanPhotos("Artist", "artist"), []);
});

for (const platform of ["android", "web"]) {
  test(`${platform} Artist photo callback retains the original dispatch and cache behavior`, async () => {
    const f = fixture(platform), controller = new AbortController();
    const pending = f.render().loadArtistPhotos("Artist", "artist", { signal: controller.signal });
    controller.abort(); f.state.privacy++;
    f.calls[0].resolve({ photos: [photo] }); assert.equal((await pending).ok, true);
    assert.equal(f.render().artistFanPhotos("Artist", "artist").length, 1);
    assert.equal(f.state.privacy, 1, "default path does not change iOS privacy state");
  });
}


test("iOS Artist authentication401 settles locally without publishing a private-resource denial", async () => {
  const f = fixture(), pending = f.render().loadArtistPhotos("Artist", "artist");
  const error = new AppError("Sign in", { status: 401 });
  f.calls[0].reject(error); assert.equal((await pending).error, error);
  assert.equal(f.state.privacy, 0, "ordinary authentication failure must not rotate retained privacy");
});


test("iOS Artist photo identity/transport/aborted errors do not publish authoritative denial", async () => {
  for (const mode of ["identity", "transport", "aborted"]) {
    const f = fixture(), controller = new AbortController();
    const pending = f.render().loadArtistPhotos("Artist", "artist", { signal: controller.signal });
    if (mode === "aborted") controller.abort();
    f.calls[0].reject(new AppError("Unavailable", mode === "identity" ? { status: 409, serverCode: "IDENTITY_CHANGED", code: "PIT-AUTH-004" } : { status: mode === "aborted" ? 403 : 500 }));
    await pending; assert.equal(f.state.privacy, 0, mode);
  }
});

test("iOS Artist photo metadata is bounded and an evicted read cannot refill the cache", async () => {
  const f = fixture(), first = f.render().loadArtistPhotos("Artist0", "artist0");
  for (let i = 1; i <= 64; i++) void f.render().loadArtistPhotos(`Artist${i}`, `artist${i}`);
  f.calls[0].resolve({ photos: [photo] }); assert.equal((await first).stale, true); assert.deepEqual(f.writes, []);
});
