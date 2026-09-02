import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  catalogSeedRequestOptions, crawlerGenreFields, fillMissingArtistPhotos, growOutcome, refreshSongsAndGenres,
  deezerEnrich, enrichCatalogArtistPhoto, mergeGenreBackfillData, mergePhotoFillData,
  normalizeLegacySpotifyArtistPhotoData, photoFillRefreshBefore, rotateRowsAfterCursor,
  shouldEnrichAfterCrawl, stripSpotifyArtistPhotoData,
  SPOTIFY_PHOTO_NO_MATCH_GRACE_MS,
  SPOTIFY_PHOTO_RECHECK_MS,
} from "./catalogSeed.js";
import { displayGenre, resolveGenre, storedClaims } from "../src/domain/genre.mjs";
import { artistRow, artistStmts, mergeBundledArtist, publicArtist } from "./db.js";
import { ProviderError } from "./musicProviders.js";

const catalogSeedSource = readFileSync(new URL("./catalogSeed.js", import.meta.url), "utf8");

// Regression cover for the 2026-07-14 incident. "Grow by 10k" added zero artists
// (every genre cursor had reached the end of its results) yet reported success and
// still ran a full Deezer re-enrichment over 5,599 existing profiles. That pass
// rewrote ~46k short-lived preview URLs, which then expired and broke playback.

test("a grow that adds nothing reports exhausted, never done", () => {
  const outcome = growOutcome({ added: 0, reachedTarget: false, stopRequested: false });
  assert.equal(outcome.phase, "exhausted");
  assert.equal(outcome.errorCode, "CATALOG_CRAWL_EXHAUSTED");
  assert.match(outcome.note, /left untouched/i);
});

test("a grow that adds artists reports done without an error code", () => {
  const outcome = growOutcome({ added: 120, reachedTarget: false, stopRequested: false });
  assert.equal(outcome.phase, "done");
  assert.equal(outcome.errorCode, undefined);
});

test("reaching the requested target is done even though the crawl stopped early", () => {
  const outcome = growOutcome({ added: 2000, reachedTarget: true, stopRequested: false });
  assert.equal(outcome.phase, "done");
});

test("a target already satisfied is not misreported as exhausted", () => {
  // reachedTarget short-circuits the crawl before it can add anything.
  const outcome = growOutcome({ added: 0, reachedTarget: true, stopRequested: false });
  assert.equal(outcome.phase, "done");
  assert.equal(outcome.errorCode, undefined);
});

test("an operator stop outranks both outcomes and keeps what was added", () => {
  assert.equal(growOutcome({ added: 0, reachedTarget: false, stopRequested: true }).phase, "stopped");
  assert.equal(growOutcome({ added: 50, reachedTarget: false, stopRequested: true }).phase, "stopped");
});

test("enrichment never runs when the crawl added nothing", () => {
  // The exact fall-through that rewrote ~46k expiring preview URLs.
  assert.equal(shouldEnrichAfterCrawl({ enrich: true, added: 0, stopRequested: false }), false);
});

test("enrichment runs only for artists this crawl actually added", () => {
  assert.equal(shouldEnrichAfterCrawl({ enrich: true, added: 12, stopRequested: false }), true);
  assert.equal(shouldEnrichAfterCrawl({ enrich: false, added: 12, stopRequested: false }), false);
  assert.equal(shouldEnrichAfterCrawl({ enrich: true, added: 12, stopRequested: true }), false);
});

test("catalog seed requests keep missing-photo repair distinct from grow and refresh", () => {
  assert.deepEqual(catalogSeedRequestOptions({ mode: "photos" }), { mode: "photos" });
  assert.deepEqual(catalogSeedRequestOptions({ mode: "refresh" }), { mode: "refresh" });
  assert.deepEqual(catalogSeedRequestOptions({ add: 5000 }), { add: 5000 });
  assert.deepEqual(catalogSeedRequestOptions({ mode: "unknown", add: 10 }), { add: 100 });
});

test("missing-photo repair resumes from its durable cursor and records each completed artist", async () => {
  const cursorWrites = [];
  const persisted = [];
  const result = await fillMissingArtistPhotos({
    readCursor: () => "artist-a",
    writeCursor: (value) => cursorWrites.push(value),
    loadBatch: (cursor, limit) => {
      assert.equal(cursor, "artist-a");
      assert.equal(limit, 40);
      return {
        rows: [{ norm: "artist-b", name: "Artist B" }, { norm: "artist-c", name: "Artist C" }],
        total: 12,
        wrapped: false,
      };
    },
    enrichArtist: async (name) => name === "Artist B" ? { deezerId: 2, photo: "https://example.com/b.jpg" } : null,
    persistArtist: (row) => { persisted.push(row.norm); return true; },
    pause: async () => {},
  });
  assert.deepEqual(cursorWrites, ["artist-b", "artist-c"]);
  assert.deepEqual(persisted, ["artist-b"]);
  assert.equal(result.attempted, 2);
  assert.equal(result.filled, 1);
  assert.equal(result.noMatch, 1);
  assert.equal(result.pendingAtStart, 12);
  assert.equal(result.cursor, "artist-c");
});

test("missing-photo repair preserves partial success and does not advance past a provider failure", async () => {
  const cursorWrites = [];
  const result = await fillMissingArtistPhotos({
    readCursor: () => "",
    writeCursor: (value) => cursorWrites.push(value),
    loadBatch: () => ({
      rows: [{ norm: "artist-a", name: "Artist A" }, { norm: "artist-b", name: "Artist B" }, { norm: "artist-c", name: "Artist C" }],
      total: 3,
      wrapped: false,
    }),
    enrichArtist: async (name) => {
      if (name === "Artist B") throw new ProviderError("Deezer", 429, "rate limited", { code: "rate_limited" });
      return { deezerId: 1, photo: "https://example.com/a.jpg" };
    },
    persistArtist: () => true,
    pause: async () => {},
  });
  assert.deepEqual(cursorWrites, ["artist-a"]);
  assert.equal(result.attempted, 1);
  assert.equal(result.filled, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.providerFailure.code, "CATALOG_PHOTOS_RATE_LIMITED");
  assert.equal(result.cursor, "artist-a", "the failed artist remains next after restart");
});

test("missing-photo repair stays bounded and stops only at an artist boundary", async () => {
  let stop = false;
  const cursorWrites = [];
  const result = await fillMissingArtistPhotos({
    shouldStop: () => stop,
    writeCursor: (value) => cursorWrites.push(value),
    loadBatch: (_cursor, limit) => ({
      rows: Array.from({ length: limit + 20 }, (_, index) => ({ norm: `artist-${index}`, name: `Artist ${index}` })),
      total: 1000,
      wrapped: false,
    }),
    enrichArtist: async () => ({ deezerId: 1, photo: "https://example.com/photo.jpg" }),
    persistArtist: () => { stop = true; return true; },
    pause: async () => {},
  });
  assert.equal(result.batchSize, 40, "one run cannot exceed the fixed provider-work budget");
  assert.equal(result.attempted, 1);
  assert.equal(result.stopped, true);
  assert.deepEqual(cursorWrites, ["artist-0"]);
});

test("photo enrichment preserves existing provider data while filling the missing image", () => {
  const merged = mergePhotoFillData(
    { name: "Photo Fixture", genre: "Rock", mbid: "mbid-1", country: "Canada", formed: "2001", popularity: 55, photo: null },
    { bio: "Keep this biography", topTracks: [{ title: "Keep This" }] },
    { deezerId: 42, photo: "https://example.com/photo.jpg", popularity: 70, followers: 1000, topTracks: [{ title: "Replacement" }] },
  );
  assert.equal(merged.photo, "https://example.com/photo.jpg");
  assert.equal(merged.photoCredit, "Deezer");
  assert.equal(merged.popularity, 55);
  assert.equal(merged.bio, "Keep this biography");
  assert.deepEqual(merged.topTracks, [{ title: "Keep This" }]);
  assert.equal(merged.mbid, "mbid-1");
});

test("Spotify photo enrichment stays outside generic photo fields and keeps fixed provenance", () => {
  const spotifyId = "1234567890ABCDEFGHIJKL";
  const merged = mergePhotoFillData(
    { name: "Spotify Fixture", genre: null, mbid: "mbid-spotify", photo: null },
    { bio: "Keep this biography" },
    {
      provider: "spotify",
      spotifyId,
      spotifyPhoto: "https://i.scdn.co/image/trusted123",
      spotifyPhotoWidth: 640,
      spotifyPhotoHeight: 640,
      photoSourceUrl: `https://open.spotify.com/artist/${spotifyId}`,
      spotifyPhotoCheckedAt: 1234,
    },
  );
  assert.equal(merged.photo, undefined);
  assert.equal(merged.spotifyPhoto, "https://i.scdn.co/image/trusted123");
  assert.equal(merged.photoSource, "spotify");
  assert.equal(merged.photoCredit, "Spotify");
  assert.equal(merged.photoDisplayPolicy, "original");
  assert.equal(merged.bio, "Keep this biography");
  assert.equal(mergePhotoFillData(
    { name: "Bad", photo: null },
    {},
    { provider: "spotify", spotifyId, spotifyPhoto: "https://attacker.example/a.jpg", photoSourceUrl: `https://open.spotify.com/artist/${spotifyId}` },
  ), null);
});

test("public artists expose Spotify attribution separately from generic photos", () => {
  const spotifyId = "1234567890ABCDEFGHIJKL";
  const artist = publicArtist({
    norm: "spotify-public",
    name: "Spotify Public",
    public_slug: "spotify-public",
    photo: null,
    bio: null,
    mbid: null,
    spotify_id: spotifyId,
    formed: null,
    country: null,
    popularity: 12,
    genre: null,
    data: JSON.stringify({
      name: "Spotify Public",
      spotifyId,
      spotifyPhoto: "https://i.scdn.co/image/public123",
      photoSource: "spotify",
      photoCredit: "Spotify",
      photoSourceUrl: `https://open.spotify.com/artist/${spotifyId}`,
      photoDisplayPolicy: "original",
      spotifyPhotoCheckedAt: 100,
      spotifyPhotoNoMatchSince: 90,
      spotifyPhotoLastResult: "no_match",
      photos: [
        "https://i.scdn.co/image/legacyarray",
        { uri: "https://i.scdn.co/image/legacyobject" },
        "https://i.scdn.co/not-an-approved-image-path",
        "https://example.com/fan.jpg",
      ],
      galleryPool: [
        { uri: "https://i.scdn.co/image/legacygallery", source: "spotify" },
        { uri: "https://example.com/licensed.jpg", source: "openverse" },
      ],
    }),
  });
  assert.equal(artist.photo, null);
  assert.equal(artist.spotifyPhoto, "https://i.scdn.co/image/public123");
  assert.equal(artist.spotifyArtistUrl, `https://open.spotify.com/artist/${spotifyId}`);
  assert.equal(artist.photoSource, "spotify");
  assert.equal(Object.hasOwn(artist, "spotifyPhotoCheckedAt"), false);
  assert.equal(Object.hasOwn(artist, "spotifyPhotoNoMatchSince"), false);
  assert.equal(Object.hasOwn(artist, "spotifyPhotoLastResult"), false);
  assert.deepEqual(artist.photos, ["https://example.com/fan.jpg"]);
  assert.deepEqual(artist.galleryPool, [{ uri: "https://example.com/licensed.jpg", source: "openverse" }]);
});

test("legacy Spotify photos become attributed provider art once and never remain in generic galleries", () => {
  const spotifyId = "1234567890ABCDEFGHIJKL";
  const legacy = {
    name: "Legacy Artist",
    spotifyId,
    photo: "https://i.scdn.co/image/legacyprimary",
    photoCredit: "Spotify",
    photos: ["https://i.scdn.co/image/legacyprimary", "https://example.com/fan.jpg"],
    galleryPool: [
      { uri: "https://i.scdn.co/image/legacyprimary", credit: "Spotify" },
      { uri: "https://example.com/licensed.jpg", credit: "Creator" },
    ],
  };
  const first = normalizeLegacySpotifyArtistPhotoData(legacy, legacy.photo, spotifyId, 1_000);
  assert.equal(first.photo, null);
  assert.equal(first.data.photo, undefined);
  assert.equal(first.data.spotifyPhoto, legacy.photo);
  assert.equal(first.data.photoSourceUrl, `https://open.spotify.com/artist/${spotifyId}`);
  assert.deepEqual(first.data.photos, ["https://example.com/fan.jpg"]);
  assert.deepEqual(first.data.galleryPool, [{ uri: "https://example.com/licensed.jpg", credit: "Creator" }]);
  const second = normalizeLegacySpotifyArtistPhotoData(first.data, first.photo, first.spotifyId, 2_000);
  assert.equal(second.data.spotifyPhoto, legacy.photo);
  assert.equal(second.data.spotifyPhotoCheckedAt, 1_000,
    "a second migration pass does not reset retention or discard normalized art");

  const malformed = normalizeLegacySpotifyArtistPhotoData({
    spotifyId,
    photo: "https://i.scdn.co/image/not-approved-path",
    photoCredit: "Spotify",
  }, "https://i.scdn.co/image/not-approved-path", spotifyId, 3_000);
  assert.equal(malformed.photo, null);
  assert.equal(malformed.data.photo, undefined);
  assert.equal(malformed.data.spotifyPhoto, undefined,
    "an unapproved Spotify path is removed from generic fields but never promoted");
});

test("bundle merge cannot resurrect stale Spotify CDN art but retains the exact refresh identity", () => {
  const spotifyId = "1234567890ABCDEFGHIJKL";
  const merged = mergeBundledArtist(null, {
    name: "Bundled Artist",
    spotifyId,
    photo: "https://i.scdn.co/image/bundledprimary",
    photoCredit: "Spotify",
    photos: ["https://i.scdn.co/image/bundledprimary", "https://example.com/fan.jpg"],
    galleryPool: [
      { uri: "https://i.scdn.co/image/bundledprimary", credit: "Spotify" },
      { uri: "https://example.com/licensed.jpg", credit: "Creator" },
    ],
  });
  assert.equal(merged.spotifyId, spotifyId);
  assert.equal(merged.photo, undefined);
  assert.equal(merged.photoCredit, undefined);
  assert.deepEqual(merged.photos, ["https://example.com/fan.jpg"]);
  assert.deepEqual(merged.galleryPool, [{ uri: "https://example.com/licensed.jpg", credit: "Creator" }]);
});

test("Spotify purge removes provider data and CDN entries while preserving user-provided photos", () => {
  const clean = stripSpotifyArtistPhotoData({
    photo: "https://example.com/user.jpg",
    spotifyId: "1234567890ABCDEFGHIJKL",
    spotifyPhoto: "https://i.scdn.co/image/provider",
    spotifyPhotoCheckedAt: 10,
    spotifyPhotoNoMatchSince: 9,
    spotifyPhotoLastResult: "no_match",
    photoSource: "spotify",
    photoCredit: "Spotify",
    photoSourceUrl: "https://open.spotify.com/artist/1234567890ABCDEFGHIJKL",
    photoDisplayPolicy: "original",
    photos: ["https://example.com/fan.jpg", "https://i.scdn.co/image/provider"],
  }, "https://example.com/user.jpg");
  assert.equal(clean.photo, "https://example.com/user.jpg");
  assert.equal(clean.data.photo, "https://example.com/user.jpg");
  assert.deepEqual(clean.data.photos, ["https://example.com/fan.jpg"]);
  for (const key of ["spotifyId", "spotifyPhoto", "spotifyPhotoCheckedAt", "spotifyPhotoNoMatchSince", "spotifyPhotoLastResult", "photoSource", "photoCredit", "photoSourceUrl", "photoDisplayPolicy"]) {
    assert.equal(Object.hasOwn(clean.data, key), false, key);
  }

  const expired = stripSpotifyArtistPhotoData({
    spotifyId: "1234567890ABCDEFGHIJKL",
    spotifyPhotoCheckedAt: 10,
    spotifyPhotoNoMatchSince: 9,
    spotifyPhotoLastResult: "no_match",
  }, null, { preserveIdentity: true });
  assert.equal(expired.spotifyId, "1234567890ABCDEFGHIJKL");
  assert.equal(expired.data.spotifyId, "1234567890ABCDEFGHIJKL");
  assert.equal(expired.data.spotifyPhotoCheckedAt, undefined);
  assert.equal(expired.data.spotifyPhotoNoMatchSince, undefined);
  assert.equal(expired.data.spotifyPhotoLastResult, undefined);

  const unattributedLegacy = stripSpotifyArtistPhotoData({
    photo: "https://i.scdn.co/image/unattributedlegacy",
    photos: ["https://i.scdn.co/image/unattributedlegacy", "https://example.com/user.jpg"],
    galleryPool: [
      { uri: "https://i.scdn.co/image/unattributedlegacy" },
      { uri: "https://example.com/user-gallery.jpg" },
    ],
  }, "https://i.scdn.co/image/unattributedlegacy");
  assert.equal(unattributedLegacy.photo, null);
  assert.equal(unattributedLegacy.data.photo, undefined);
  assert.deepEqual(unattributedLegacy.data.photos, ["https://example.com/user.jpg"]);
  assert.deepEqual(unattributedLegacy.data.galleryPool, [{ uri: "https://example.com/user-gallery.jpg" }]);
});

test("missing-photo repair passes stored provider identity to its bounded enricher", async () => {
  let received = null;
  await fillMissingArtistPhotos({
    loadBatch: () => ({
      rows: [{ norm: "artist-a", name: "Artist A", spotify_id: "stored-id", data: "{}" }],
      total: 1,
    }),
    enrichArtist: async (name, options) => {
      received = { name, row: options.row };
      return null;
    },
    writeCursor: () => {},
    pause: async () => {},
  });
  assert.equal(received.name, "Artist A");
  assert.equal(received.row.spotify_id, "stored-id");
});

test("a verified Spotify miss is cached without starting Deezer work", async () => {
  let deezerCalls = 0;
  const result = await enrichCatalogArtistPhoto("No Match", {
    spotifyConfigured: true,
    findSpotify: async () => null,
    enrichDeezer: async () => { deezerCalls += 1; return null; },
    clock: () => 5678,
  });
  assert.deepEqual(result, {
    provider: "spotify",
    noMatch: true,
    spotifyPhotoCheckedAt: 5678,
  });
  assert.equal(deezerCalls, 0);
});

test("Spotify enrichment never starts provider work without a verified exact ID", async () => {
  let spotifyCalls = 0;
  const result = await enrichCatalogArtistPhoto("Same Name", {
    row: { spotify_id: null, data: "{}" },
    spotifyConfigured: true,
    findSpotify: async () => { spotifyCalls += 1; return null; },
    clock: () => 1234,
  });
  assert.equal(spotifyCalls, 0);
  assert.deepEqual(result, { provider: "spotify", noMatch: true, spotifyPhotoCheckedAt: 1234 });
});

test("Spotify Retry-After state survives worker recreation through durable backoff hooks", async () => {
  const spotifyId = "1234567890ABCDEFGHIJKL";
  let stored = null;
  const limited = new ProviderError("Spotify", 429, "limited", { code: "rate_limited" });
  limited.blockedUntil = 9_000;
  await assert.rejects(enrichCatalogArtistPhoto("Rate Artist", {
    row: { spotify_id: spotifyId, data: "{}" },
    spotifyConfigured: true,
    findSpotify: async () => { throw limited; },
    readProviderBackoff: () => null,
    writeProviderBackoff: (record) => { stored = record; return true; },
    clearProviderBackoff: () => {},
    clock: () => 1_000,
  }), (error) => error === limited);
  assert.deepEqual(stored, { until: 9_000, code: "rate_limited" });

  let providerCalls = 0;
  await assert.rejects(enrichCatalogArtistPhoto("Rate Artist", {
    row: { spotify_id: spotifyId, data: "{}" },
    spotifyConfigured: true,
    findSpotify: async () => { providerCalls += 1; return null; },
    readProviderBackoff: () => stored,
    clearProviderBackoff: () => {},
    clock: () => 2_000,
  }), (error) => error.code === "rate_limited" && error.retryAfterMs === 7_000);
  assert.equal(providerCalls, 0);
});

test("photo repair distinguishes bad credentials from confirmed provider revocation", async () => {
  const runFailure = async (code) => {
    const failure = new ProviderError(
      "Spotify",
      code === "access_revoked" ? 403 : 401,
      "provider failure",
      { code },
    );
    return fillMissingArtistPhotos({
      loadBatch: () => ({
        rows: [{
          norm: "artist",
          name: "Artist",
          spotify_id: "1234567890ABCDEFGHIJKL",
          data: "{}",
        }],
        total: 1,
      }),
      enrichArtist: async () => { throw failure; },
      writeCursor: () => { throw new Error("failed artists must not advance the cursor"); },
      pause: async () => {},
    });
  };

  const authentication = await runFailure("authentication_failed");
  assert.equal(authentication.providerFailure?.code, "CATALOG_PHOTOS_AUTHENTICATION_FAILED");
  const revocation = await runFailure("access_revoked");
  assert.equal(revocation.providerFailure?.code, "CATALOG_PHOTOS_AUTH_REVOKED");
});

test("missing Spotify credentials retain the existing Deezer fallback", async () => {
  const expected = { deezerId: 42, photo: "https://example.com/deezer.jpg" };
  const result = await enrichCatalogArtistPhoto("Fallback Artist", {
    spotifyConfigured: false,
    findSpotify: async () => { throw new Error("Spotify must remain off"); },
    enrichDeezer: async (name) => {
      assert.equal(name, "Fallback Artist");
      return expected;
    },
  });
  assert.equal(result, expected);
});

test("Spotify negative cache preserves prior provider fields and counts as unmatched", async () => {
  const prior = {
    spotifyId: "1234567890ABCDEFGHIJKL",
    spotifyPhoto: "https://i.scdn.co/image/prior123",
    photoSourceUrl: "https://open.spotify.com/artist/1234567890ABCDEFGHIJKL",
    photoSource: "spotify",
    photoCredit: "Spotify",
    photoDisplayPolicy: "original",
  };
  const sentinel = { provider: "spotify", noMatch: true, spotifyPhotoCheckedAt: 9876 };
  const merged = mergePhotoFillData({ name: "Prior Artist", photo: null }, prior, sentinel);
  assert.equal(merged.spotifyPhoto, prior.spotifyPhoto);
  assert.equal(merged.photoSourceUrl, prior.photoSourceUrl);
  assert.equal(merged.spotifyPhotoCheckedAt, 9876);
  assert.equal(merged.spotifyPhotoNoMatchSince, 9876);
  assert.equal(merged.spotifyPhotoLastResult, "no_match");

  let persisted = 0;
  const result = await fillMissingArtistPhotos({
    loadBatch: () => ({ rows: [{ norm: "prior", name: "Prior Artist" }], total: 1 }),
    enrichArtist: async () => sentinel,
    persistArtist: () => { persisted += 1; return true; },
    writeCursor: () => {},
    pause: async () => {},
  });
  assert.equal(persisted, 1, "the checked timestamp is persisted");
  assert.equal(result.filled, 0);
  assert.equal(result.noMatch, 1);
});

test("Spotify confirmed misses retain stale art only for the bounded grace period", () => {
  const spotifyId = "1234567890ABCDEFGHIJKL";
  const firstCheckedAt = 10_000;
  const prior = {
    spotifyId,
    spotifyPhoto: "https://i.scdn.co/image/priorGrace123",
    spotifyPhotoWidth: 640,
    spotifyPhotoHeight: 640,
    photoSource: "spotify",
    photoCredit: "Spotify",
    photoSourceUrl: `https://open.spotify.com/artist/${spotifyId}`,
    photoDisplayPolicy: "original",
  };
  const row = { name: "Grace Artist", photo: null };
  const missAt = (spotifyPhotoCheckedAt) => ({
    provider: "spotify",
    noMatch: true,
    spotifyPhotoCheckedAt,
  });

  const firstMiss = mergePhotoFillData(row, prior, missAt(firstCheckedAt));
  assert.equal(firstMiss.spotifyPhoto, prior.spotifyPhoto);
  assert.equal(firstMiss.spotifyPhotoNoMatchSince, firstCheckedAt);

  const beforeExpiry = mergePhotoFillData(
    row,
    firstMiss,
    missAt(firstCheckedAt + SPOTIFY_PHOTO_NO_MATCH_GRACE_MS - 1),
  );
  assert.equal(beforeExpiry.spotifyPhoto, prior.spotifyPhoto);
  assert.equal(beforeExpiry.spotifyPhotoNoMatchSince, firstCheckedAt);

  const expired = mergePhotoFillData(
    row,
    beforeExpiry,
    missAt(firstCheckedAt + SPOTIFY_PHOTO_NO_MATCH_GRACE_MS),
  );
  assert.equal(expired.spotifyPhoto, undefined);
  assert.equal(expired.spotifyPhotoWidth, undefined);
  assert.equal(expired.spotifyPhotoHeight, undefined);
  assert.equal(expired.photoSource, undefined);
  assert.equal(expired.photoCredit, undefined);
  assert.equal(expired.photoSourceUrl, undefined);
  assert.equal(expired.photoDisplayPolicy, undefined);
  assert.equal(expired.spotifyPhotoNoMatchSince, firstCheckedAt);
});

test("a later Spotify success clears prior no-match aging markers", () => {
  const spotifyId = "1234567890ABCDEFGHIJKL";
  const merged = mergePhotoFillData(
    { name: "Recovered Artist", photo: null },
    {
      spotifyPhotoNoMatchSince: 100,
      spotifyPhotoLastResult: "no_match",
    },
    {
      provider: "spotify",
      spotifyId,
      spotifyPhoto: "https://i.scdn.co/image/recovered123",
      spotifyPhotoWidth: 640,
      spotifyPhotoHeight: 640,
      photoSourceUrl: `https://open.spotify.com/artist/${spotifyId}`,
      spotifyPhotoCheckedAt: 200,
    },
  );
  assert.equal(merged.spotifyPhoto, "https://i.scdn.co/image/recovered123");
  assert.equal(merged.spotifyPhotoNoMatchSince, undefined);
  assert.equal(merged.spotifyPhotoLastResult, undefined);
});

test("photo pending totals always bind the refresh cutoff and manual work shares the coordinator", () => {
  assert.equal(photoFillRefreshBefore(SPOTIFY_PHOTO_RECHECK_MS), 0);
  assert.equal(SPOTIFY_PHOTO_RECHECK_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(SPOTIFY_PHOTO_NO_MATCH_GRACE_MS, 30 * 24 * 60 * 60 * 1000);
  assert.doesNotMatch(catalogSeedSource, /photoFillPendingCount\.get\(\)/,
    "every prepared pending query receives its refresh cutoff");
  const photoMode = catalogSeedSource.slice(
    catalogSeedSource.indexOf('if (mode === "photos")'),
    catalogSeedSource.indexOf('// "refresh" mode:'),
  );
  assert.equal((photoMode.match(/photoFillPendingTotal\(\)/g) || []).length, 2,
    "manual start and completion use the same cutoff-aware pending helper");
  assert.match(photoMode, /void runBackgroundJob\(async \(\) =>[\s\S]*?fillMissingArtistPhotos\(/,
    "the full manual photo body is serialized with scheduled provider jobs");
  const refreshMode = catalogSeedSource.slice(
    catalogSeedSource.indexOf('if (mode === "refresh")'),
    catalogSeedSource.indexOf("const target = startTotal + add"),
  );
  const growMode = catalogSeedSource.slice(catalogSeedSource.indexOf("const target = startTotal + add"));
  assert.match(refreshMode, /void runBackgroundJob\(async \(\) =>/,
    "the full manual refresh body shares the provider coordinator");
  assert.match(growMode, /void runBackgroundJob\(async \(\) =>/,
    "the full manual grow and enrichment body shares the provider coordinator");
});

test("crawler buckets persist as review hints, never as factual genres", () => {
  const fields = crawlerGenreFields("Hardcore");
  assert.equal(fields.genre, null);
  assert.equal(fields.genreHint, "Hardcore");
  const claims = storedClaims(fields, fields.genre);
  assert.equal(claims[0]?.source, "tag_hint");
  assert.equal(displayGenre(resolveGenre(claims)), null);
});

test("refresh processes genre-missing artists even when their songs are already complete", async () => {
  const phases = [];
  const result = await refreshSongsAndGenres({
    enrichSongsImpl: async ({ tick }) => {
      phases.push("songs");
      tick({ ranked: 0, done: 0, of: 0 });
      return 0;
    },
    beforeGenres: () => phases.push("before-genres"),
    backfillGenresImpl: async ({ tick }) => {
      phases.push("genres");
      tick({ fixed: 1, done: 1, of: 1 });
      return { fixed: 1, scanned: 1, pending: 1 };
    },
  });
  assert.deepEqual(phases, ["songs", "before-genres", "genres"]);
  assert.deepEqual(result, {
    songs: 0,
    genres: { fixed: 1, scanned: 1, pending: 1 },
    stopped: false,
  });
});

test("refresh honors a stop between songs and genres", async () => {
  let stopped = false;
  let genreRuns = 0;
  const result = await refreshSongsAndGenres({
    shouldStop: () => stopped,
    enrichSongsImpl: async () => { stopped = true; return 2; },
    backfillGenresImpl: async () => { genreRuns += 1; return { fixed: 1 }; },
  });
  assert.equal(genreRuns, 0);
  assert.equal(result.stopped, true);
  assert.equal(result.songs, 2);
});

test("genre backfill resumes after its last attempted artist and wraps fairly", () => {
  const rows = [{ norm: "a" }, { norm: "b" }, { norm: "c" }, { norm: "d" }];
  assert.deepEqual(rotateRowsAfterCursor(rows, "b").map((row) => row.norm), ["c", "d", "a", "b"]);
  assert.deepEqual(rotateRowsAfterCursor(rows, "missing").map((row) => row.norm), ["a", "b", "c", "d"]);
});

test("background Deezer enrichment treats an auto-saved identity as a self-healing hint", async () => {
  artistStmts.upsert.run(artistRow("background identity hint", {
    name: "Background Identity Hint",
    deezerId: 7001,
  }, "deezer"));
  let lookupOptions = null;
  const enriched = await deezerEnrich("Background Identity Hint", {
    findArtist: async (_name, options) => {
      lookupOptions = options;
      return null;
    },
  });
  assert.equal(enriched, null);
  assert.deepEqual(lookupOptions, { hintId: 7001 });
  assert.equal(Object.hasOwn(lookupOptions, "preferredId"), false);
});

test("genre backfill saves a corrected Deezer identity while clearing the former proof", () => {
  const evidence = {
    genre: "Pop", provider: "deezer", basis: "release-consensus-v1",
    sampleCount: 3, supportingCount: 2, share: 0.6667,
    counts: [{ genre: "Pop", count: 2 }, { genre: "Rock", count: 1 }],
  };
  assert.equal(mergeGenreBackfillData({ name: "Offline", genre: "Pop" }, { deezerId: 11 }, null), null);

  const merged = mergeGenreBackfillData(
    { name: "Corrected Background Artist", genre: "Pop" },
    {
      deezerId: 11,
      genreClaims: [{ value: "Pop", source: "release_consensus", at: 1 }],
      genreEvidence: evidence,
    },
    { deezerId: 22, genreEvidence: null },
  );
  assert.equal(merged.deezerId, 22);
  assert.deepEqual(merged.genreClaims, []);
  assert.equal(merged.genreEvidence, undefined);
});
