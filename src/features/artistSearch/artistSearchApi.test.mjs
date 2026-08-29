import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTIST_SEARCH_MAX_LIMIT,
  COMPOSER_ARTIST_SEARCH_LIMIT,
  attachArtistSuggestion,
  fetchArtistSuggestions,
  mergeArtistSearchCacheEntry,
} from "./artistSearchApi.mjs";

test("composer artist lookup uses the catalog first and only falls back remotely on a miss", async () => {
  const calls = [];
  const artist = { key: "earl-sweatshirt", name: "Earl Sweatshirt", mbid: "artist-mbid" };
  const apiClient = async (path, options) => {
    calls.push({ path, options });
    if (path.startsWith("/api/artists?")) return { artists: [] };
    return { artist, transient: true };
  };
  const controller = new AbortController();
  const rows = await fetchArtistSuggestions(" Earl Sweatshirt ", {
    apiClient,
    signal: controller.signal,
    limit: COMPOSER_ARTIST_SEARCH_LIMIT,
    remoteFallback: true,
  });

  assert.deepEqual(rows, [{ ...artist, transient: true }]);
  assert.deepEqual(calls.map((call) => call.path), [
    `/api/artists?q=Earl%20Sweatshirt&limit=${COMPOSER_ARTIST_SEARCH_LIMIT}`,
    "/api/artists/resolve?name=Earl%20Sweatshirt",
  ]);
  assert.ok(calls.every((call) => call.options.signal === controller.signal));
  assert.ok(calls.every((call) => call.options.timeoutMs === 8_000));
});

test("catalog hits, short text, result limits, and duplicate identities stay bounded", async () => {
  const calls = [];
  const apiClient = async (path) => {
    calls.push(path);
    return { artists: [
      { key: "sza", name: "SZA" },
      { key: "sza", name: "Duplicate SZA" },
      ...Array.from({ length: ARTIST_SEARCH_MAX_LIMIT + 5 }, (_, index) => ({ key: `artist-${index}`, name: `Artist ${index}` })),
    ] };
  };

  const rows = await fetchArtistSuggestions("s", { apiClient, limit: 9_999, remoteFallback: true });
  assert.equal(rows.length, ARTIST_SEARCH_MAX_LIMIT);
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
  assert.equal(calls.length, 1, "a catalog hit never starts an upstream provider request");

  const noMatchCalls = [];
  const noMatchApi = async (path) => { noMatchCalls.push(path); return { artists: [] }; };
  assert.deepEqual(await fetchArtistSuggestions("xy", { apiClient: noMatchApi, remoteFallback: true }), []);
  assert.equal(noMatchCalls.length, 1, "two-character partials do not fan out to MusicBrainz");
});

test("settled artist lookups are cached per API client while cancellation and force remain authoritative", async () => {
  let calls = 0;
  const apiClient = async () => {
    calls += 1;
    return { artists: [{ key: "cache-artist", name: "Cache Artist" }] };
  };

  const first = await fetchArtistSuggestions("Cache Artist", { apiClient, limit: 8 });
  const second = await fetchArtistSuggestions("Cache Artist", { apiClient, limit: 8 });
  assert.deepEqual(second, first);
  assert.equal(calls, 1, "repeating a settled type-ahead query does not hit the server again");

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fetchArtistSuggestions("Cache Artist", { apiClient, signal: controller.signal, limit: 8 }),
    (error) => error?.name === "AbortError",
  );
  assert.equal(calls, 1, "an already-cancelled caller never starts or reuses work");

  await fetchArtistSuggestions("Cache Artist", { apiClient, limit: 8, force: true });
  assert.equal(calls, 2, "an explicit refresh bypasses the settled-result cache");
});

test("choosing a transient result performs one verified mutation and returns a durable binding", async () => {
  const calls = [];
  const controller = new AbortController();
  const apiClient = async (path, options) => {
    calls.push({ path, options });
    return { artist: { key: "earl sweatshirt", name: "Earl Sweatshirt", mbid: options.body.mbid } };
  };
  const artist = await attachArtistSuggestion({
    name: "Earl Sweatshirt",
    mbid: "b9f4edcf-7f05-4f37-a565-cc4c1f6cfb78",
    transient: true,
  }, { apiClient, signal: controller.signal });

  assert.equal(artist.key, "earl sweatshirt");
  assert.equal(artist.transient, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/artists/resolve");
  assert.deepEqual(calls[0].options.body, {
    name: "Earl Sweatshirt",
    mbid: "b9f4edcf-7f05-4f37-a565-cc4c1f6cfb78",
  });
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.signal, controller.signal);
});

test("artist search summaries cannot downgrade richer cached artist metadata", () => {
  const full = {
    key: "cache-safe-artist",
    name: "Cache Safe Artist",
    bio: "Original profile",
    albums: [{ title: "First" }, { title: "Second" }],
    topTracks: [{ title: "One" }, { title: "Two" }],
  };
  const summary = {
    key: "cache-safe-artist",
    name: "Cache Safe Artist",
    bio: "Updated profile",
    topTracks: [{ title: "One" }],
    searchSummary: true,
  };
  const preserved = mergeArtistSearchCacheEntry(full, summary);
  assert.equal(preserved.bio, "Updated profile");
  assert.deepEqual(preserved.albums, full.albums);
  assert.deepEqual(preserved.topTracks, full.topTracks);
  assert.equal(preserved.searchSummary, undefined);

  const resolved = mergeArtistSearchCacheEntry(summary, {
    ...full,
    bio: "Resolved profile",
  });
  assert.equal(resolved.bio, "Resolved profile");
  assert.deepEqual(resolved.albums, full.albums);
  assert.deepEqual(resolved.topTracks, full.topTracks);
  assert.equal(resolved.searchSummary, undefined);
});
