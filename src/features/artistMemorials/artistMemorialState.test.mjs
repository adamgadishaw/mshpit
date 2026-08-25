import assert from "node:assert/strict";
import test from "node:test";

import { resolveLoadState } from "../../domain/loadState.mjs";
import {
  artistMemorialAdminScope,
  artistMemorialScope,
  EMPTY_ARTIST_MEMORIALS,
  mergeArtistMemorial,
  projectArtistMemorial,
  projectArtistMemorialAdmin,
} from "./artistMemorialState.mjs";

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
