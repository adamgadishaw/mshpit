import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { accountMutationIsCurrent, captureAccountMutation } from "./accountMutation.mjs";
import { publicProfileCacheEntry } from "./dataPolicy.mjs";
import { profileGenreSelection } from "./genrePreferences.mjs";
import { confirmSignupProfile } from "./signupProfileDraft.mjs";
import { clean, cleanHandle, cleanName, isHandle, LIMITS } from "./validation.mjs";

// Run the actual Store closure with deferred transport and React-state seams.
// Pure sanitizers, account ownership, and public-cache projection stay real.
const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
const provider = ast.program.body.find((node) => node.type === "ExportNamedDeclaration"
  && node.declaration?.id?.name === "StoreProvider")?.declaration;
const callback = provider?.body.body.flatMap((node) => node.type === "VariableDeclaration" ? node.declarations : [])
  .find((node) => node.id?.name === "updateProfile")?.init;
assert.ok(callback, "The production updateProfile callback must exist");
const productionCallback = source.slice(callback.start, callback.end);

const owner = {
  id: "account-a", name: "Night Fan", handle: "nightfan", email: "private@example.test",
  emailVerified: true, ageBand: "18_plus", onboardingVersion: 0,
  avatarUri: "https://media.example.test/avatar-old.jpg", banner: "https://media.example.test/banner-old.jpg",
  handleChangeAvailableAt: null, termsAcceptedAt: 100, analyticsOptOut: true,
};
const neighbor = { id: "neighbor", name: "Other Fan", handle: "otherfan" };

function fixture() {
  const initial = structuredClone(owner);
  const state = { session: initial, users: [publicProfileCacheEntry(initial), { ...neighbor }] };
  const sessionRef = { current: initial };
  const accountMutationEpochRef = { current: 1 };
  const calls = [], writes = [], pendingState = [];
  const dependencies = {
    sessionRef, accountMutationEpochRef, captureAccountMutation, accountMutationIsCurrent,
    clean, cleanName, cleanHandle, isHandle, LIMITS, profileGenreSelection, publicProfileCacheEntry,
    ENABLE_DEMO_DATA: false,
    api: (path, options) => new Promise((resolve, reject) => calls.push({ path, options, resolve, reject })),
    setUsers: (update) => { writes.push("users"); state.users = update(state.users); },
    // Do not pretend a React state setter immediately refreshes sessionRef.
    // The production callback itself must publish its confirmed reference.
    setSession: (update) => { writes.push("session"); pendingState.push(update); },
  };
  const updateProfile = new Function(...Object.keys(dependencies), `"use strict"; return (${productionCallback});`)(...Object.values(dependencies));
  const flush = () => {
    for (const update of pendingState.splice(0)) state.session = typeof update === "function" ? update(state.session) : update;
  };
  const adopt = (user, epochChange = 1) => {
    state.session = user;
    sessionRef.current = user;
    accountMutationEpochRef.current += epochChange;
    state.users = user ? [publicProfileCacheEntry(user), { ...neighbor }] : [{ ...neighbor }];
  };
  const save = (patch, options = {}) => updateProfile(patch, { optimistic: false, expectedAccountId: owner.id, ...options });
  return { save, calls, writes, state, sessionRef, accountMutationEpochRef, flush, adopt };
}

test("concert map preference crosses the confirmed profile wire and keeps false in the public cache", async () => {
  for (const visible of [false, true]) {
    const f = fixture(), before = structuredClone(f.state);
    const pending = f.save({ concertMapVisible: visible });
    assert.equal(f.calls.length, 1, "a map-only update must not be mistaken for an unsupported no-op");
    assert.deepEqual(f.calls[0].options.body, { concertMapVisible: visible });
    assert.deepEqual(f.state, before, "privacy settings are not optimistic");
    const user = { ...owner, concertMapVisible: visible };
    f.calls[0].resolve({ user });
    assert.equal((await pending).ok, true);
    f.flush();
    assert.equal(f.state.session.concertMapVisible, visible);
    assert.equal(f.state.users[0].concertMapVisible, visible);
  }
});

test("setup photo saves remain unchanged while pending and publish only confirmed server fields", async () => {
  const f = fixture(), controller = new AbortController();
  const patch = { avatarUri: "https://media.example.test/avatar-new.jpg" };
  const before = structuredClone(f.state);
  const pending = f.save(patch, { signal: controller.signal });
  assert.deepEqual(f.state, before);
  assert.deepEqual(f.sessionRef.current, before.session);
  assert.deepEqual(f.writes, []);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].path, "/api/me");
  assert.equal(f.calls[0].options.method, "PATCH");
  assert.equal(f.calls[0].options.expectedAccountId, owner.id);
  assert.equal(f.calls[0].options.signal, controller.signal);
  assert.deepEqual(f.calls[0].options.body, patch);

  const user = { ...owner, ...patch, profileUpdatedAt: 200, handleChangeAvailableAt: 900 };
  f.calls[0].resolve({ user });
  const result = await pending;
  assert.deepEqual(result, { ok: true, user, patch });
  assert.deepEqual(f.sessionRef.current, user, "confirmed session reference must update before React renders");
  assert.deepEqual(f.state.session, before.session, "the fixture still has an uncommitted React state update");
  f.flush();
  assert.deepEqual(f.state.session, f.sessionRef.current);
  assert.deepEqual(f.state.users, [publicProfileCacheEntry(user), neighbor]);
  for (const key of ["email", "ageBand", "emailVerified", "onboardingVersion", "handleChangeAvailableAt", "termsAcceptedAt", "analyticsOptOut"]) {
    assert.equal(Object.hasOwn(f.state.users[0], key), false, `${key} must not leak into the persisted people cache`);
  }
});

test("missing or cross-account response users cannot confirm or mutate an onboarding save", async () => {
  for (const response of [undefined, null, {}, { user: null }, { user: {} }, { user: { ...owner, id: "account-b" } }]) {
    const f = fixture(), before = structuredClone(f.state);
    const pending = f.save({ banner: "https://media.example.test/banner-new.jpg" });
    f.calls[0].resolve(response);
    const result = await pending;
    assert.equal(result.ok, false);
    assert.ok(result.error instanceof Error);
    f.flush();
    assert.deepEqual(f.state, before);
    assert.deepEqual(f.sessionRef.current, before.session);
    assert.deepEqual(f.writes, []);
  }
});

test("transport rejection or cancellation preserves the server-backed profile and exposes retry failure", async () => {
  for (const error of [new Error("Network unavailable"), Object.assign(new Error("Cancelled"), { name: "AbortError" })]) {
    const f = fixture(), before = structuredClone(f.state), controller = new AbortController();
    const pending = f.save({ avatarUri: null }, { signal: controller.signal });
    if (error.name === "AbortError") controller.abort();
    f.calls[0].reject(error);
    assert.deepEqual(await pending, { ok: false, error });
    f.flush();
    assert.deepEqual(f.state, before);
    assert.deepEqual(f.sessionRef.current, before.session);
    assert.deepEqual(f.writes, []);
  }
});

test("missing, mismatched, and pre-cancelled setup identities make no profile request", async () => {
  const cancelled = new AbortController(); cancelled.abort();
  for (const variation of ["missing", "mismatched", "cancelled"]) {
    const f = fixture();
    if (variation === "missing") f.adopt(null);
    const options = variation === "mismatched" ? { expectedAccountId: "account-b" }
      : variation === "cancelled" ? { signal: cancelled.signal } : {};
    const result = await f.save({ banner: null }, options);
    assert.equal(result.ok, false);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.writes, []);
  }
});

test("late profile success and failure cannot change a replacement, logged-out, or re-entered account", async () => {
  for (const next of [null, { ...owner, id: "account-b", handle: "newaccount" }, { ...owner, banner: "https://media.example.test/reentered.jpg" }]) {
    for (const failed of [false, true]) {
      const f = fixture();
      const pending = f.save({ banner: "https://media.example.test/old-request.jpg" });
      f.adopt(next, next?.id === owner.id ? 2 : 1);
      const before = structuredClone(f.state), beforeRef = f.sessionRef.current;
      if (failed) f.calls[0].reject(new Error("Old request failed"));
      else f.calls[0].resolve({ user: { ...owner, banner: "https://media.example.test/old-request.jpg" } });
      const result = await pending;
      assert.equal(result.ok, false);
      assert.equal(result.stale, true);
      f.flush();
      assert.deepEqual(f.state, before);
      assert.equal(f.sessionRef.current, beforeRef);
      assert.deepEqual(f.writes, []);
    }
  }
});

test("explicit avatar and banner removals cross the wire as null and reconcile confirmed null fields", async () => {
  for (const patch of [{ avatarUri: null }, { banner: null }, { avatarUri: null, banner: null }]) {
    const f = fixture(), pending = f.save(patch);
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].options.body)), patch, "null removals must not become omitted fields");
    const user = { ...owner, ...patch };
    f.calls[0].resolve({ user });
    const result = await pending;
    const confirmed = confirmSignupProfile(result, owner.id, patch);
    f.flush();
    for (const key of Object.keys(patch)) {
      assert.equal(confirmed[key], null);
      assert.equal(f.state.session[key], null);
      assert.equal(f.sessionRef.current[key], null);
      assert.equal(f.state.users[0][key], null);
    }
    assert.equal(f.state.session.handle, owner.handle);
  }
});

test("an unchanged response to photo removal cannot advance the onboarding confirmation boundary", async () => {
  const f = fixture(), pending = f.save({ avatarUri: null, banner: null });
  f.calls[0].resolve({ user: { ...owner } });
  const result = await pending;
  assert.throws(() => confirmSignupProfile(result, owner.id, { avatarUri: null, banner: null }), /could not confirm/);
  assert.equal(f.sessionRef.current.avatarUri, owner.avatarUri);
  assert.equal(f.sessionRef.current.banner, owner.banner);
});

test("the next same-account save reads confirmed session metadata before a React render", async () => {
  const f = fixture();
  const first = f.save({ handle: "newnightfan" });
  const firstUser = { ...owner, handle: "newnightfan", handleChangeAvailableAt: 123456, termsAcceptedAt: 321 };
  f.calls[0].resolve({ user: firstUser });
  assert.equal((await first).ok, true);
  assert.equal(f.state.session.handle, owner.handle, "React state has intentionally not been flushed");
  assert.equal(f.sessionRef.current.handle, firstUser.handle);

  const second = f.save({ nowPlaying: { title: "New song", artist: "Artist" } });
  assert.equal(f.calls[1].options.body.extras.termsAcceptedAt, 321, "follow-up writes must merge the latest confirmed consent metadata");
  assert.equal(f.calls[1].options.expectedAccountId, owner.id);
  f.calls[1].resolve({ user: { ...firstUser, nowPlaying: f.calls[1].options.body.extras.nowPlaying } });
  assert.equal((await second).ok, true);
  f.flush();
  assert.deepEqual(f.state.session, f.sessionRef.current);
  assert.equal(f.sessionRef.current.handleChangeAvailableAt, 123456);
  assert.equal(f.sessionRef.current.analyticsOptOut, true);
});
