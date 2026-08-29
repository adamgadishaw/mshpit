import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  recentSongSearchEntry,
  recentSongTrack,
  settleUnifiedSearchRequests,
  unifiedSearchCategories,
  unifiedPeopleSearchScope,
  unifiedSearchPreviewRows,
  unifiedSearchRequestOptions,
  unifiedSearchResultCount,
  unifiedSearchState,
  visibleUnifiedPeople,
  withoutBlockedPersonSearches,
} from "./unifiedSearch.mjs";

test("search categories expose only capabilities that can actually return results", () => {
  assert.deepEqual(
    unifiedSearchCategories().map(({ key }) => key),
    ["all", "artists", "shows", "venues", "clubs"],
  );
  assert.deepEqual(
    unifiedSearchCategories({ canSearchPeople: true, canSearchSongs: true }).map(({ key }) => key),
    ["all", "artists", "shows", "venues", "people", "clubs", "songs"],
  );
});

test("All previews stay bounded while a selected category keeps every result", () => {
  const rows = Array.from({ length: 12 }, (_, id) => ({ id }));
  assert.deepEqual(unifiedSearchPreviewRows(rows, { activeCategory: "all", category: "artists", limit: 5 }), rows.slice(0, 5));
  assert.deepEqual(unifiedSearchPreviewRows(rows, { activeCategory: "artists", category: "artists", limit: 5 }), rows);
  assert.deepEqual(unifiedSearchPreviewRows(rows, { activeCategory: "venues", category: "artists", limit: 5 }), []);
});

test("one failed provider does not discard successful unified search sections", async () => {
  const partial = await settleUnifiedSearchRequests({
    people: Promise.resolve([{ id: "fan" }]),
    artists: Promise.reject(Object.assign(new Error("catalog unavailable"), { name: "ApiError" })),
    songs: Promise.resolve([{ id: "song" }]),
  });
  assert.deepEqual(partial.people, [{ id: "fan" }]);
  assert.deepEqual(partial.artists, []);
  assert.deepEqual(partial.songs, [{ id: "song" }]);
  assert.deepEqual(partial.failures, ["artists"]);
  assert.equal(partial.succeeded, 2);
  assert.equal(partial.aborted, false);

  const aborted = await settleUnifiedSearchRequests({
    artists: Promise.reject(Object.assign(new Error("cancelled"), { name: "AbortError" })),
  });
  assert.equal(aborted.aborted, true);
});

test("song-only searches are real results and never render the empty state", () => {
  const sections = { people: [], artists: [], songs: [{ title: "Nights" }], venues: [], events: [], clubs: [] };
  assert.equal(unifiedSearchResultCount(sections), 1);
  assert.equal(unifiedSearchState({ query: "nights", loading: false, ...sections }), "ready");
});

test("unified search distinguishes browse, loading, ready, and no-results", () => {
  assert.equal(unifiedSearchState({ query: "", loading: false }), "browse");
  assert.equal(unifiedSearchState({ query: "sza", loading: true }), "loading");
  assert.equal(unifiedSearchState({ query: "sza", loading: false, artists: [{ name: "SZA" }] }), "ready");
  assert.equal(unifiedSearchState({ query: "not-a-real-result", loading: false }), "no-results");
});

test("all unified search requests can share an abortable signal", () => {
  const controller = new AbortController();
  const peopleOptions = unifiedSearchRequestOptions(controller);
  const artistOptions = unifiedSearchRequestOptions(controller);
  const songOptions = unifiedSearchRequestOptions(controller);
  assert.equal(peopleOptions.signal, controller.signal);
  assert.equal(artistOptions.signal, controller.signal);
  assert.equal(songOptions.signal, controller.signal);
  assert.equal(songOptions.throwOnError, true, "screen-level search owns truthful error presentation");
  controller.abort();
  assert.equal(peopleOptions.signal.aborted, true, "the people request is cancelled with the rest");
});

test("recent song searches reopen the exact bounded playback descriptor", () => {
  const entry = recentSongSearchEntry({
    id: 42,
    sourceId: "deezer-42",
    provider: "deezer",
    videoId: "video-42",
    title: "  Saturn  ",
    artist: "  SZA  ",
    album: "SOS",
    duration: 999999,
    art: "https://media.test/saturn.jpg",
    url: "https://media.test/saturn.mp3",
    ignored: "must not persist",
  });
  assert.equal(entry.label, "Saturn - SZA");
  assert.equal(entry.track.id, 42);
  assert.equal(entry.track.sourceId, "deezer-42");
  assert.equal(entry.track.videoId, "video-42");
  assert.equal(entry.track.duration, 86400);
  assert.equal("ignored" in entry.track, false);
  assert.deepEqual(recentSongTrack(entry), entry.track);
});

test("legacy label-only song recents remain playable after the storage migration", () => {
  assert.deepEqual(recentSongTrack({ type: "song", label: "Nights - Frank Ocean" }), {
    kind: "track",
    title: "Nights",
    artist: "Frank Ocean",
    id: null,
    sourceId: null,
    provider: null,
    source: null,
    videoId: null,
    url: null,
    preview: null,
    art: null,
    album: null,
    duration: 0,
  });
  assert.equal(recentSongTrack({ type: "song", label: "Malformed" }), null);
});

test("people-search cache is invalidated across accounts and new blocks", () => {
  const beforeBlock = unifiedPeopleSearchScope("account-a", []);
  const cache = {
    scope: beforeBlock,
    query: "mara",
    rows: [{ id: "mara", name: "Mara", handle: "mara" }],
  };

  assert.equal(visibleUnifiedPeople(cache, {
    scope: unifiedPeopleSearchScope("account-b", []), query: "mara", viewerId: "account-b",
  }).length, 0, "account B cannot render account A's cached response");
  assert.equal(visibleUnifiedPeople(cache, {
    scope: unifiedPeopleSearchScope("account-a", ["mara"]), query: "mara", viewerId: "account-a", blockedIds: ["mara"],
  }).length, 0, "a new block invalidates the pre-block cache immediately");
});

test("fresh people results and recent searches still filter blocked members", () => {
  const scope = unifiedPeopleSearchScope("account-a", ["blocked"]);
  const rows = visibleUnifiedPeople({
    scope,
    query: "fan",
    rows: [
      { id: "blocked", name: "Blocked Fan", handle: "blockedfan" },
      { id: "visible", name: "Visible Fan", handle: "visiblefan" },
    ],
  }, { scope, query: "fan", viewerId: "account-a", blockedIds: ["blocked"] });
  assert.deepEqual(rows.map((user) => user.id), ["visible"]);
  assert.deepEqual(withoutBlockedPersonSearches([
    { type: "person", id: "blocked", label: "Blocked Fan" },
    { type: "artist", id: "blocked", label: "Unrelated Artist" },
  ], ["blocked"]), [{ type: "artist", id: "blocked", label: "Unrelated Artist" }]);
});

test("local catalogue hydration does not cancel and restart remote unified search", () => {
  const source = readFileSync(new URL("../screens/SearchScreen.jsx", import.meta.url), "utf8");
  const effectStart = source.indexOf("// Pull the artist catalog on open");
  const effectEnd = source.indexOf("const mine = session?.id", effectStart);
  assert.ok(effectStart >= 0 && effectEnd > effectStart);
  const requestEffect = source.slice(effectStart, effectEnd);

  assert.match(requestEffect, /localResultCountRef\.current/);
  assert.match(requestEffect, /\}, \[peopleScope, remoteSearchScope, searchRevision, session\?\.id, settledQuery\]\);/);
  assert.doesNotMatch(
    requestEffect,
    /\[(?:[^\]]*\b(?:venues|events|clubs)\.length\b[^\]]*)\]/,
    "local result-count changes must not own the remote request lifecycle",
  );
});

test("local catalogue work shares the debounced query and show rows open the show page", () => {
  const source = readFileSync(new URL("../screens/SearchScreen.jsx", import.meta.url), "utf8");
  assert.match(source, /setTimeout\(\(\) => setSettledQuery\(query\), 250\)/);
  assert.match(source, /searchVenues\(settledQuery, 24\)/);
  assert.match(source, /includes\(settledQuery\)/);
  assert.doesNotMatch(source, /searchVenues\(query, 24\)/);
  assert.match(source, /<EventRow[\s\S]*?onOpenShow=\{onOpen\}/);
  assert.match(source, /onPress=\{\(\) => onOpenShow\?\.\(t\)\}/);
});
