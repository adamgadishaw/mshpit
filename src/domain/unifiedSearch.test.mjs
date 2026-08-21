import assert from "node:assert/strict";
import test from "node:test";

import {
  recentSongSearchEntry,
  recentSongTrack,
  unifiedPeopleSearchScope,
  unifiedSearchRequestOptions,
  unifiedSearchResultCount,
  unifiedSearchState,
  visibleUnifiedPeople,
  withoutBlockedPersonSearches,
} from "./unifiedSearch.mjs";

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
