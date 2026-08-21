import assert from "node:assert/strict";
import test from "node:test";

import {
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
  controller.abort();
  assert.equal(peopleOptions.signal.aborted, true, "the people request is cancelled with the rest");
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
