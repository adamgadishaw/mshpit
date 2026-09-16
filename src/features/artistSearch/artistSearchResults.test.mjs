import assert from "node:assert/strict";
import test from "node:test";
import { artistPath } from "../../domain/urls.mjs";
import { artistSearchRowIdentity, mergeArtistSearchResults, settleArtistSearchSnapshot } from "./artistSearchResults.mjs";

test("same-query transport failures retain confirmed rows, never another query or account", () => {
  const saved = { scope: "account-a:artist", rows: [{ key: "artist", name: "Artist" }] };
  const error = Object.assign(new Error("Provider outage"), { status: 502 });
  assert.equal(settleArtistSearchSnapshot(saved, { scope: saved.scope, error }), saved);
  for (const scope of ["account-b:artist", "account-a:other"]) {
    assert.deepEqual(settleArtistSearchSnapshot(saved, { scope, error }), { scope, rows: [] });
  }
  for (const denied of [{ status: 401 }, { status: 403 }, { code: "PIT-AUTH-004" }, { serverCode: "IDENTITY_CHANGED" }]) {
    assert.deepEqual(settleArtistSearchSnapshot(saved, { scope: saved.scope, error: denied }).rows, []);
  }
  assert.deepEqual(settleArtistSearchSnapshot(saved, { scope: saved.scope, rows: [] }).rows, [], "a confirmed empty response replaces stale matches");
});

test("search preserves canonical collision slugs and keeps distinct same-named saved artists", () => {
  const first = { key: "first-band", name: "Shared Name", publicSlug: "shared-name-first", memorial: { deceased: true } };
  const second = { key: "second-band", name: "Shared Name", publicSlug: "shared-name-second" };
  const rows = mergeArtistSearchResults([first, second, first], [{ name: "Shared Name" }, { name: "Local Only" }]);
  assert.deepEqual(rows, [first, second, { name: "Local Only" }]);
  assert.equal(artistPath(rows[0]), "/artist/shared-name-first");
  assert.equal(artistPath(rows[1]), "/artist/shared-name-second");
  assert.notEqual(artistSearchRowIdentity(rows[0]), artistSearchRowIdentity(rows[1]));
  assert.equal(Object.hasOwn(rows[2], "publicSlug"), false, "labels never fabricate a canonical slug");
});

test("a provider preview remains transient after projection, even when it includes a public slug", () => {
  const preview = { key: "preview", name: "Preview", publicSlug: "preview", transient: true };
  assert.equal(mergeArtistSearchResults([preview], [])[0].transient, true);
});
