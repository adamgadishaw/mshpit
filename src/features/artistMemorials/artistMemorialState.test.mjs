import assert from "node:assert/strict";
import test from "node:test";

import { beginLoadState, createLoadState, rejectLoadState, resolveLoadState } from "../../domain/loadState.mjs";
import {
  artistMemorialAdminScope,
  artistMemorialAvailability,
  artistMemorialScope,
  EMPTY_ARTIST_MEMORIALS,
  mergeArtistMemorial,
  projectArtistMemorial,
  projectArtistMemorialAdmin,
} from "./artistMemorialState.mjs";

function appError() {
  const error = new Error("Try again");
  error.name = "AppError";
  error.code = "PIT-NET-001";
  error.retryable = true;
  return error;
}

test("memorial resources are isolated by account and artist", () => {
  const scope = artistMemorialScope({ accountId: "account-a", artistKey: " Artist A " });
  const resource = resolveLoadState({ scope, data: { deceased: true }, updatedAt: 10 });
  assert.equal(projectArtistMemorial(resource, { accountId: "account-a", artistKey: "artist a" }).data.deceased, true);
  assert.equal(projectArtistMemorial(resource, { accountId: "account-b", artistKey: "artist a" }).data, null);
  assert.notEqual(artistMemorialAdminScope({ accountId: "account-a", sessionScope: "account-a\0admin" }), artistMemorialAdminScope({ accountId: "account-b", sessionScope: "account-b\0admin" }));
  assert.notEqual(artistMemorialAdminScope({ accountId: "account-a", sessionScope: "account-a\0admin" }), artistMemorialAdminScope({ accountId: "account-a", sessionScope: "account-a\0moderator" }));
});

test("admin projection closes stale account data and merges one keyed record", () => {
  const scope = artistMemorialAdminScope({ accountId: "account-a", sessionScope: "account-a\0admin" });
  const first = { artistKey: "artist-a", status: "draft" };
  const resource = resolveLoadState({ scope, data: [first], updatedAt: 10 });
  assert.deepEqual(projectArtistMemorialAdmin(resource, { accountId: "account-a", sessionScope: "account-a\0admin" }).data, [first]);
  assert.equal(projectArtistMemorialAdmin(resource, { accountId: "account-a", sessionScope: "account-a\0moderator" }).data, EMPTY_ARTIST_MEMORIALS);
  const published = { artistKey: "artist-a", status: "published" };
  assert.deepEqual(mergeArtistMemorial([first, { artistKey: "artist-b" }], published), [published, { artistKey: "artist-b" }]);
});

test("public memorial availability never mistakes loading or failure for a living artist", () => {
  const artistKey = "artist-a";
  const scope = artistMemorialScope({ accountId: "account-a", artistKey });
  const options = { artistKey, enabled: true };
  assert.equal(artistMemorialAvailability(createLoadState({ scope, status: "loading", data: null }), options), "checking");
  assert.equal(artistMemorialAvailability(rejectLoadState(null, {
    scope,
    error: appError(),
    emptyData: null,
  }), options), "unavailable");
  assert.equal(artistMemorialAvailability(resolveLoadState({ scope, data: null, updatedAt: 10 }), options), "living");
  assert.equal(artistMemorialAvailability(createLoadState({ scope, status: "loading", data: null }), {
    enabled: false,
    artistKey,
  }), "unavailable");
  assert.equal(artistMemorialAvailability(createLoadState({ scope, status: "loading", data: null }), {
    enabled: true,
    artistKey: null,
  }), "unavailable");
});

test("a known memorial survives refresh and refresh failure without restoring live actions", () => {
  const artistKey = "artist-a";
  const scope = artistMemorialScope({ accountId: "account-a", artistKey });
  const memorial = { deceased: true, deathDate: "2026-08-01" };
  const ready = resolveLoadState({ scope, data: memorial, updatedAt: 10 });
  const refreshing = beginLoadState(ready, { scope, emptyData: null });
  const failed = rejectLoadState(refreshing, { scope, error: appError(), emptyData: null });
  assert.equal(artistMemorialAvailability(refreshing, { artistKey }), "deceased");
  assert.equal(artistMemorialAvailability(failed, { artistKey }), "deceased");
  assert.equal(failed.data, memorial);
});

test("a stale living read fails closed while its refresh is unresolved or fails", () => {
  const artistKey = "artist-a";
  const scope = artistMemorialScope({ accountId: "account-a", artistKey });
  const ready = resolveLoadState({ scope, data: null, updatedAt: 10 });
  const refreshing = beginLoadState(ready, { scope, emptyData: null });
  const failed = rejectLoadState(refreshing, { scope, error: appError(), emptyData: null });
  assert.equal(artistMemorialAvailability(refreshing, { artistKey }), "checking");
  assert.equal(artistMemorialAvailability(failed, { artistKey }), "unavailable");
});
