import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  accountScopeMatches,
  accountScopedRows,
  favoriteGenreFromHistory,
} from "./accountPrivateProjection.mjs";

test("an A to B adoption hides A history and private playlists before effects run", () => {
  const aHistory = [{ title: "A private title", artist: "A Rock Artist" }];
  const aPlaylists = [{ id: "private-a", name: "A private playlist", visibility: "private" }];
  const bHistory = accountScopedRows(aHistory, "account-a", "account-b");
  const bPlaylists = accountScopedRows(aPlaylists, "account-a", "account-b");

  assert.deepEqual(bHistory, []);
  assert.deepEqual(bPlaylists, []);
  assert.equal(bHistory.some((track) => track.title === "A private title"), false);
  assert.equal(bPlaylists.some((playlist) => playlist.id === "private-a"), false);
  assert.equal(accountScopeMatches("account-a", "account-b"), false);
});

test("B recommendation taste falls back to B instead of consuming A history", () => {
  const rawAHistory = [
    { artist: "A Rock Artist" },
    { artist: "A Rock Artist" },
    { artist: "A Rock Artist" },
  ];
  const projectedForB = accountScopedRows(rawAHistory, "account-a", "account-b");
  const genre = favoriteGenreFromHistory(
    projectedForB,
    (artist) => artist === "A Rock Artist" ? "Rock" : "Jazz",
    "Jazz",
  );
  assert.equal(genre, "Jazz");
});

test("the Store exports projections and recommendation algorithms never read raw A history", () => {
  const source = readFileSync(new URL("../store.js", import.meta.url), "utf8");
  assert.match(source, /const scopedPlayHistory = accountScopedRows\(playHistory, playHistoryAccountId, activeAccountId\)/);
  assert.match(source, /favoriteGenreFromHistory\(scopedPlayHistory/);
  assert.match(source, /history: scopedPlayHistory/);
  assert.match(source, /playHistory: scopedPlayHistory/);
  assert.match(source, /myPlaylists: scopedMyPlaylists/);
});
