import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { commandFailure, commandSuccess } from "./commandResult.mjs";
import { beginLoadState, createLoadState, projectLoadState } from "./loadState.mjs";
import { settleArtistPageRead } from "./artistPageRead.mjs";

const scope = "viewer:artist";
const loading = () => beginLoadState(createLoadState(), { scope });
const page = { legacyProfile: true, profile: { bio: "Staff-confirmed biography" }, posts: [{ id: "p1" }], loadedAt: 123 };
const failure = Object.assign(new Error("The network is unavailable."), {
  name: "AppError", code: "PIT-NET-001", retryable: true,
});

test("artist page proof unwraps the actual command envelope, including legacy policy", () => {
  const state = settleArtistPageRead(loading(), { scope, result: commandSuccess(page) });
  assert.equal(state.status, "ready");
  assert.equal(state.updatedAt, 123);
  assert.equal(state.data.legacyProfile, true);
  assert.deepEqual(state.data.profile, page.profile);
  assert.deepEqual(state.data.posts, page.posts);
});

test("a transport failure preserves same-viewer profile content and exposes the original error", () => {
  const ready = settleArtistPageRead(loading(), { scope, result: commandSuccess(page) });
  const failed = settleArtistPageRead(beginLoadState(ready, { scope }), { scope, result: commandFailure(failure) });
  assert.equal(failed.status, "error");
  assert.equal(failed.error, failure);
  assert.equal(failed.data, ready.data);
  const recovered = settleArtistPageRead(beginLoadState(failed, { scope }), { scope, result: commandSuccess({ ...page, legacyProfile: false }) });
  assert.equal(recovered.status, "ready");
  assert.equal(recovered.error, null);
  assert.equal(recovered.data.legacyProfile, false);
});

test("permission and account failures discard stale owner content and legacy policy proof", () => {
  const ready = settleArtistPageRead(loading(), { scope, result: commandSuccess(page) });
  for (const details of [{ code: "PIT-AUTH-001" }, { code: "PIT-AUTH-002" }, { code: "PIT-AUTH-004" }, { status: 401 }, { status: 403 }]) {
    const error = Object.assign(new Error("Access denied"), { name: "AppError", code: "PIT-API-001", retryable: false }, details);
    const failed = settleArtistPageRead(ready, { scope, result: commandFailure(error) });
    assert.equal(failed.status, "error");
    assert.equal(failed.error, error);
    assert.equal(failed.data, null);
    assert.equal(failed.updatedAt, null);
  }
});

test("another account or artist cannot adopt a late profile response or cached policy proof", () => {
  const ready = settleArtistPageRead(loading(), { scope, result: commandSuccess(page) });
  const next = beginLoadState(ready, { scope: "other-viewer:artist" });
  assert.equal(next.data, null);
  assert.equal(projectLoadState(ready, "other-viewer:artist").data, null);
  assert.equal(settleArtistPageRead(next, { scope, result: commandSuccess(page) }), next);
  const initialFailure = settleArtistPageRead(loading(), { scope, result: commandFailure(failure) });
  assert.equal(initialFailure.data, null);
  assert.equal(initialFailure.status, "error");
});

test("a malformed success or error becomes a retryable load error, not a rendering exception", () => {
  const invalidResponseError = Object.assign(new Error("Try again"), { name: "AppError", code: "PIT-API-001", retryable: true });
  for (const result of [commandSuccess(null), commandSuccess({}), { ok: true }, null, { ok: false, error: new Error("raw transport failure") }]) {
    const failed = settleArtistPageRead(loading(), { scope, result, invalidResponseError });
    assert.equal(failed.status, "error");
    assert.equal(failed.error, invalidResponseError);
    assert.equal(failed.data, null);
  }
});

test("profile metadata commits only behind the account, cancellation, and latest-read fences", () => {
  const store = readFileSync(new URL("../store.js", import.meta.url), "utf8");
  const read = store.slice(store.indexOf("const loadArtistPage ="), store.indexOf("const updateArtistProfile ="));
  assert.match(read, /expectedAccountId: accountId/);
  assert.match(read, /signal\?\.aborted[\s\S]*artistPageCache\.isCurrent\(claim, accountId\)/);
  assert.ok(read.indexOf("if (!committed)") < read.indexOf("if (artist) cacheArtists"));
  assert.match(read, /cacheArtists\(\[\{ \.\.\.artist, transient: false \}\]\)/);
  assert.match(read, /artistPageAccessDenied\(error\)[\s\S]*profile: \{\}, posts: \[\]/);
  const screen = readFileSync(new URL("../screens/ArtistScreen.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(screen, /resolveArtist\(a\.name/);
  assert.match(screen, /settleArtistPageRead\(current, \{ scope: artistPageProofScope, result/);
  assert.match(screen, /artistPageResource\.error\.message/);
  assert.match(screen, /ticket !== artistPageReadSequence\.current/);
  assert.match(screen, /ticket === artistPageReadSequence\.current/);
  assert.match(screen, /const artistPageProofScope = [^\n]*artistPageCacheEpoch/);
});
