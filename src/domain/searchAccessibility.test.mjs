import assert from "node:assert/strict";
import test from "node:test";
import { searchLiveAnnouncement, searchResultSummary } from "./searchAccessibility.mjs";

test("search announcements report real result and category counts", () => {
  const groups = { people: [{ id: 1 }], artists: [{ id: 2 }, { id: 3 }], songs: [], venues: [] };
  assert.deepEqual(searchResultSummary(groups), { total: 3, categories: 2 });
  assert.equal(searchLiveAnnouncement({ query: "sza", state: "results", groups }), "3 results across 2 categories for sza.");
});

test("search announcements distinguish loading, no results, and errors", () => {
  assert.equal(searchLiveAnnouncement({ query: "mitski", state: "loading" }), "Searching Pit for mitski.");
  assert.equal(searchLiveAnnouncement({ query: "mitski", state: "no-results", groups: {} }), "No matches for mitski.");
  assert.equal(searchLiveAnnouncement({ query: "mitski", error: "Search could not update." }), "Search could not update.");
  assert.equal(searchLiveAnnouncement({ query: "  " }), "");
});
