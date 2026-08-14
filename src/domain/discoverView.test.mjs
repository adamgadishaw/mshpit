import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelDiscoverRequest,
  compactDiscoverNumber,
  discoverSectionState,
  filterDiscoverRows,
  hasDiscoverOverviewContent,
  isCurrentDiscoverAccountRequest,
  normalizeDiscoverArtistRows,
  normalizeDiscoverOverview,
  normalizeFriendsListening,
  orderDiscoverCountries,
  selectDiscoverPhotos,
} from "./discoverView.mjs";

test("overview normalization accepts the combined payload and rejects malformed rows", () => {
  const normalized = normalizeDiscoverOverview({
    chart: { source: "plays", rows: [{ name: "J. Cole" }, null, {}] },
    genres: [{ genre: "Hip-Hop", count: "12", pct: 1.6 }, { genre: "" }],
    total: 20,
    distinctGenres: 4,
    catalogTotal: 200,
    memberTotal: 42,
    countries: [{ country: "Canada", count: 8 }, { country: "Worldwide", count: 200 }],
  });
  assert.deepEqual(normalized.chart.rows.map((row) => row.name), ["J. Cole"]);
  assert.equal(normalized.chart.source, "plays");
  assert.deepEqual(normalized.genres, [{ genre: "Hip-Hop", count: 12, pct: 1 }]);
  assert.deepEqual(normalized.countries, [{ country: "Canada", count: 8 }]);
  assert.equal(normalized.memberTotal, 42);
});

test("overview metrics preserve authoritative zeroes but distinguish missing values", () => {
  const zeroes = normalizeDiscoverOverview({ memberTotal: 0, catalogTotal: 0, distinctGenres: 0 });
  assert.equal(zeroes.memberTotal, 0);
  assert.equal(zeroes.catalogTotal, 0);
  assert.equal(zeroes.distinctGenres, 0);
  const missing = normalizeDiscoverOverview({});
  assert.equal(missing.memberTotal, null);
  assert.equal(missing.catalogTotal, null);
  assert.equal(missing.distinctGenres, null);
});

test("overview normalization bounds and deduplicates untrusted chart and genre rows", () => {
  const normalized = normalizeDiscoverOverview({
    chart: { source: "popularity", rows: [{ name: " SZA " }, { name: "sza" }, ...Array.from({ length: 80 }, (_, index) => ({ name: `Artist ${index}` }))] },
    genres: [{ genre: " R&B ", count: 2, pct: 0.2 }, { genre: "r&b", count: 3, pct: 0.3 }],
  }, "plays");
  assert.equal(normalized.chart.source, "popularity", "an explicit response source wins over the request fallback");
  assert.equal(normalized.chart.rows.length, 60);
  assert.equal(normalized.chart.rows[0].name, "SZA");
  assert.deepEqual(normalized.genres.map(({ genre, count, pct }) => ({ genre, count, pct })), [{ genre: "R&B", count: 5, pct: 0.5 }]);
});

test("artist and friend normalizers reject malformed duplicates and cap render work", () => {
  assert.deepEqual(normalizeDiscoverArtistRows([{ name: " J. Cole ", topTrack: { title: " MIDDLE CHILD " } }, { name: "j. cole" }, {}], 10), [
    { name: "J. Cole", genre: null, country: null, topTrack: { title: "MIDDLE CHILD" } },
  ]);
  const friends = normalizeFriendsListening([
    { user: { id: "fan-1", name: " Ada " }, track: { title: " Song ", artist: " Artist " } },
    { user: { id: "fan-1", name: "Duplicate" }, track: { title: "Other" } },
    { user: { id: "fan-2", handle: "grace" }, track: { title: "Track" } },
    { user: {}, track: { title: "Missing id" } },
  ]);
  assert.equal(friends.length, 2);
  assert.equal(friends[0].user.name, "Ada");
  assert.equal(friends[1].user.name, "grace");
  assert.equal(friends[1].track.artist, "Unknown artist");
});

test("photo selection excludes removed and blocked posts while keeping bounded top results", () => {
  const photos = selectDiscoverPhotos([
    { id: "removed", photos: ["removed.jpg"], likes: 100 },
    { id: "blocked", userId: "fan-2", photos: ["blocked.jpg"], likes: 90 },
    { id: "visible-a", artist: "SZA", photos: ["a.jpg", "b.jpg"], likes: 5 },
    { id: "visible-b", venue: "History", photos: ["c.jpg"], likes: 8 },
  ], { removedIds: ["removed"], blockedIds: ["fan-2"], limit: 2 });
  assert.deepEqual(photos, [
    { uri: "c.jpg", artist: null, venue: "History", by: "", likes: 8, logId: "visible-b", ownerId: null },
    { uri: "a.jpg", artist: "SZA", venue: null, by: "", likes: 5, logId: "visible-a", ownerId: null },
  ]);
});

test("regions put Worldwide first and the member home country second without duplicates", () => {
  const rows = orderDiscoverCountries([
    { country: "United States", count: 50 },
    { country: "Canada", count: 30 },
    { country: "Canada", count: 20 },
  ], "Canada");
  assert.deepEqual(rows.map((row) => row.country), ["Worldwide", "Canada", "United States"]);
});

test("a small home scene remains selectable when it is absent from the API list", () => {
  const rows = orderDiscoverCountries([{ country: "United States", count: 50 }], "Iceland");
  assert.deepEqual(rows, [
    { country: "Worldwide", count: null },
    { country: "Iceland", count: null },
    { country: "United States", count: 50 },
  ]);
  assert.deepEqual(orderDiscoverCountries([{ country: "canada", count: 10 }, { country: "Canada", count: 9 }], "Canada").map((row) => row.country), ["Worldwide", "canada"]);
});

test("chart search spans artist, genre, country, and lead track", () => {
  const rows = [
    { name: "J. Cole", genre: "Hip-Hop", country: "United States", topTrack: { title: "No Role Modelz" } },
    { name: "SZA", genre: "R&B", country: "United States", topTrack: { title: "Saturn" } },
  ];
  assert.deepEqual(filterDiscoverRows(rows, "role").map((row) => row.name), ["J. Cole"]);
  assert.deepEqual(filterDiscoverRows(rows, "r&b").map((row) => row.name), ["SZA"]);
  assert.equal(filterDiscoverRows(rows, "metal").length, 0);
});

test("section state distinguishes loading, offline failure, true empty, and filtered empty", () => {
  assert.equal(discoverSectionState({ status: "loading", rows: [] }), "loading");
  assert.equal(discoverSectionState({ status: "error", rows: [] }), "error");
  assert.equal(discoverSectionState({ status: "ready", rows: [] }), "empty");
  assert.equal(discoverSectionState({ status: "ready", rows: [], query: "cole" }), "no-results");
  assert.equal(discoverSectionState({ status: "refreshing", rows: [{ name: "J. Cole" }] }), "ready");
  assert.equal(discoverSectionState({ status: "refreshing", rows: [] }), "loading");
});

test("an empty plays chart does not hide a valid genre overview", () => {
  const overview = normalizeDiscoverOverview({
    chart: { source: "plays", rows: [] },
    genres: [{ genre: "Hip-Hop", count: 12, pct: 0.5 }],
    genreTotal: 12,
  }, "plays");
  assert.equal(discoverSectionState({ status: "ready", rows: overview.chart.rows }), "empty");
  assert.equal(hasDiscoverOverviewContent(overview), true);
  assert.equal(hasDiscoverOverviewContent(normalizeDiscoverOverview({})), false);
});

test("teardown cancels the latest request and invalidates its sequence", () => {
  const controller = new AbortController();
  const next = cancelDiscoverRequest({ sequence: 4, controller });
  assert.equal(controller.signal.aborted, true);
  assert.deepEqual(next, { sequence: 5, controller: null });
});

test("friend responses must match both the latest request and account", () => {
  const active = { sequence: 7, accountId: "fan-b" };
  assert.equal(isCurrentDiscoverAccountRequest(active, 7, "fan-b"), true);
  assert.equal(isCurrentDiscoverAccountRequest(active, 6, "fan-b"), false);
  assert.equal(isCurrentDiscoverAccountRequest(active, 7, "fan-a"), false);
});

test("large Discover metrics stay readable on narrow screens", () => {
  assert.equal(compactDiscoverNumber(999), "999");
  assert.equal(compactDiscoverNumber(1_250), "1.3K");
  assert.equal(compactDiscoverNumber(1_250_000), "1.3M");
});
