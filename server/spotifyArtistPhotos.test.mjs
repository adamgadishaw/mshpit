import assert from "node:assert/strict";
import test from "node:test";
import {
  createSpotifyArtistPhotoClient,
  safeSpotifyArtistImageUrl,
  safeSpotifyArtistPageUrl,
  spotifyArtistPhotoRecord,
} from "./spotifyArtistPhotos.js";
import {
  isArtistPhotoSeedEnabled,
  startArtistPhotoSeedScheduler,
  stopArtistPhotoSeedScheduler,
} from "./artistPhotoSeedScheduler.js";

const ARTIST_ID = "1234567890ABCDEFGHIJKL";
const IMAGE = "https://i.scdn.co/image/abC123";
const ARTIST_URL = `https://open.spotify.com/artist/${ARTIST_ID}`;
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json" },
});

test("Spotify photo provenance accepts only fixed uncredentialed provider hosts", () => {
  assert.equal(safeSpotifyArtistImageUrl(IMAGE), IMAGE);
  assert.equal(safeSpotifyArtistPageUrl(ARTIST_URL, ARTIST_ID), ARTIST_URL);
  for (const value of [
    "https://evil.example/image/abC123",
    "https://i.scdn.co.evil.example/image/abC123",
    "https://user@i.scdn.co/image/abC123",
    "https://i.scdn.co:444/image/abC123",
    "https://i.scdn.co/image/abC123?resize=1",
  ]) assert.equal(safeSpotifyArtistImageUrl(value), "");
  assert.equal(safeSpotifyArtistPageUrl("https://open.spotify.com.evil.example/artist/" + ARTIST_ID), "");
});

test("Spotify artist record selects the largest trusted remote image and keeps attribution", () => {
  const record = spotifyArtistPhotoRecord({
    id: ARTIST_ID,
    external_urls: { spotify: ARTIST_URL },
    images: [
      { url: "https://evil.example/image/nope", width: 2000, height: 2000 },
      { url: IMAGE, width: 640, height: 640 },
      { url: "https://i.scdn.co/image/smaller", width: 64, height: 64 },
    ],
  }, { checkedAt: 1234 });
  assert.equal(record.spotifyPhoto, IMAGE);
  assert.equal(record.photoSourceUrl, ARTIST_URL);
  assert.equal(record.photoDisplayPolicy, "original");
  assert.equal(record.photoCredit, "Spotify");
  assert.equal(record.spotifyPhotoCheckedAt, 1234);
  assert.equal(Object.hasOwn(record, "photo"), false, "Spotify imagery never enters generic crop/proxy fields");
});

test("Spotify client keeps credentials on the token host and accepts one exact artist identity", async () => {
  const calls = [];
  const client = createSpotifyArtistPhotoClient({
    env: { SPOTIFY_CLIENT_ID: "server-id", SPOTIFY_CLIENT_SECRET: "server-secret" },
    clock: () => 1000,
    wait: async () => {},
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url) === "https://accounts.spotify.com/api/token") {
        return json({ access_token: "server-token", expires_in: 3600 });
      }
      return json({
        id: ARTIST_ID,
        name: "The Artist",
        external_urls: { spotify: ARTIST_URL },
        images: [{ url: IMAGE, width: 640, height: 640 }],
      });
    },
  });
  const record = await client.findArtistPhoto("  The   Artist ", { existingSpotifyId: ARTIST_ID });
  assert.equal(record.spotifyId, ARTIST_ID);
  assert.equal(calls.length, 2);
  assert.match(calls[0].options.headers.Authorization, /^Basic /);
  assert.equal(calls[0].options.headers.Authorization.includes("server-secret"), false);
  assert.equal(calls[1].options.headers.Authorization, "Bearer server-token");
  assert.equal(JSON.stringify(calls[1].options).includes("server-secret"), false);
  assert.equal(calls[1].url, `https://api.spotify.com/v1/artists/${ARTIST_ID}`);
});

test("Spotify client never searches by display name without a pre-bound exact ID", async () => {
  let calls = 0;
  const client = createSpotifyArtistPhotoClient({
    env: { SPOTIFY_CLIENT_ID: "id", SPOTIFY_CLIENT_SECRET: "secret" },
    wait: async () => {},
    fetchImpl: async () => { calls += 1; throw new Error("must not search"); },
  });
  assert.equal(await client.findArtistPhoto("Shared Name"), null);
  assert.equal(calls, 0);
});

test("Spotify quota responses never shorten Retry-After and open an in-process circuit", async () => {
  let now = 10_000;
  let calls = 0;
  const client = createSpotifyArtistPhotoClient({
    env: { SPOTIFY_CLIENT_ID: "id", SPOTIFY_CLIENT_SECRET: "secret" },
    clock: () => now,
    wait: async () => {},
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(options.redirect, "error");
      if (String(url).includes("/api/token")) return json({ access_token: "token", expires_in: 3600 });
      return new Response(JSON.stringify({
        error: { status: 429, message: "API rate limit exceeded", reason: "QUOTA_EXCEEDED" },
      }), { status: 429, headers: { "content-type": "application/json", "retry-after": "7200" } });
    },
  });
  await assert.rejects(client.findArtistPhoto("Quota Artist", { existingSpotifyId: ARTIST_ID }), (error) => {
    assert.equal(error.code, "quota_exceeded");
    assert.equal(error.retryAfterMs, 7_200_000);
    assert.equal(error.blockedUntil, 7_210_000);
    return true;
  });
  assert.equal(calls, 2);
  await assert.rejects(client.findArtistPhoto("Another Artist", { existingSpotifyId: ARTIST_ID }), (error) => {
    assert.equal(error.code, "quota_exceeded");
    assert.equal(error.retryAfterMs, 7_200_000);
    return true;
  });
  assert.equal(calls, 2, "the open circuit rejects without another token or API request");
  now = 7_210_000;
});

test("Spotify quota exhaustion without Retry-After blocks the next scheduler-era call for 24 hours", async () => {
  let now = 1_000;
  let calls = 0;
  const client = createSpotifyArtistPhotoClient({
    env: { SPOTIFY_CLIENT_ID: "id", SPOTIFY_CLIENT_SECRET: "secret" },
    clock: () => now,
    wait: async () => {},
    fetchImpl: async (url) => {
      calls += 1;
      if (String(url).includes("/api/token")) return json({ access_token: "token", expires_in: 3600 });
      return json({ error: { status: 429, reason: "QUOTA_EXCEEDED" } }, 429);
    },
  });
  await assert.rejects(client.findArtistPhoto("Quota Artist", { existingSpotifyId: ARTIST_ID }), (error) => {
    assert.equal(error.code, "quota_exceeded");
    assert.equal(error.retryAfterMs, 24 * 60 * 60 * 1000);
    return true;
  });
  assert.equal(calls, 2);
  now += 15 * 60 * 1000;
  await assert.rejects(client.findArtistPhoto("Scheduler Artist", { existingSpotifyId: ARTIST_ID }), (error) => {
    assert.equal(error.code, "quota_exceeded");
    assert.ok(error.retryAfterMs > 23 * 60 * 60 * 1000);
    return true;
  });
  assert.equal(calls, 2, "the 15-minute scheduler cannot hit Spotify during the quota block");
});

test("Spotify token rejection is classified as an authentication failure, not revocation", async () => {
  const client = createSpotifyArtistPhotoClient({
    env: { SPOTIFY_CLIENT_ID: "bad-id", SPOTIFY_CLIENT_SECRET: "bad-secret" },
    wait: async () => {},
    fetchImpl: async () => json({ error: "invalid_client" }, 400),
  });
  await assert.rejects(
    client.findArtistPhoto("The Artist", { existingSpotifyId: ARTIST_ID }),
    (error) => error.code === "authentication_failed" && error.status === 400,
  );

  const forbiddenToken = createSpotifyArtistPhotoClient({
    env: { SPOTIFY_CLIENT_ID: "restricted-id", SPOTIFY_CLIENT_SECRET: "restricted-secret" },
    wait: async () => {},
    fetchImpl: async () => json({ error: "forbidden" }, 403),
  });
  await assert.rejects(
    forbiddenToken.findArtistPhoto("The Artist", { existingSpotifyId: ARTIST_ID }),
    (error) => error.code === "authentication_failed" && error.status === 403,
  );
});

test("a generic Spotify API 403 is non-destructive and never claims access was revoked", async () => {
  const client = createSpotifyArtistPhotoClient({
    env: { SPOTIFY_CLIENT_ID: "id", SPOTIFY_CLIENT_SECRET: "secret" },
    wait: async () => {},
    fetchImpl: async (url) => String(url).includes("/api/token")
      ? json({ access_token: "token", expires_in: 3600 })
      : json({ error: { status: 403, message: "Forbidden" } }, 403),
  });
  await assert.rejects(
    client.findArtistPhoto("The Artist", { existingSpotifyId: ARTIST_ID }),
    (error) => error.code === "access_forbidden" && error.status === 403,
  );
});

test("disabled, unconfigured, or misconfigured photo work retains data while explicit purge and revocation remove it", async () => {
  let purges = 0;
  let expired = 0;
  assert.equal(startArtistPhotoSeedScheduler({
    env: { ARTIST_PHOTO_SEED_ENABLED: "false" },
    purgeAll: () => { purges += 1; return 1; },
    logger: { log() {} },
  }), null);
  assert.equal(startArtistPhotoSeedScheduler({
    env: { ARTIST_PHOTO_SEED_ENABLED: "true" },
    purgeAll: () => { purges += 1; return 1; },
    logger: { warn() {} },
  }), null);
  assert.equal(purges, 0);
  assert.equal(startArtistPhotoSeedScheduler({
    env: {
      ARTIST_PHOTO_SEED_ENABLED: "false",
      ARTIST_PHOTO_PURGE_REQUESTED: "true",
    },
    purgeAll: () => { purges += 1; return 1; },
    logger: { log() {} },
  }), null);
  assert.equal(purges, 1);

  const misconfigured = startArtistPhotoSeedScheduler({
    env: {
      ARTIST_PHOTO_SEED_ENABLED: "true",
      SPOTIFY_CLIENT_ID: "id",
      SPOTIFY_CLIENT_SECRET: "wrong-secret",
    },
    initialDelayMs: 60_000,
    intervalMs: 60_000,
    catalogStatus: () => ({ running: false }),
    migrateLegacy: () => 0,
    purgeExpired: () => { expired += 1; return 1; },
    purgeAll: () => { purges += 1; return 1; },
    runBatch: async () => ({
      failed: 1,
      providerFailure: { provider: "Spotify", code: "CATALOG_PHOTOS_AUTHENTICATION_FAILED" },
    }),
    logger: { log() {}, error() {}, warn() {} },
  });
  await misconfigured.trigger();
  assert.equal(purges, 1, "a credential mistake pauses work without deleting cached photos");
  assert.equal(expired, 0, "aging waits until a provider request succeeds");
  await stopArtistPhotoSeedScheduler();

  const state = startArtistPhotoSeedScheduler({
    env: {
      ARTIST_PHOTO_SEED_ENABLED: "true",
      SPOTIFY_CLIENT_ID: "id",
      SPOTIFY_CLIENT_SECRET: "secret",
    },
    initialDelayMs: 60_000,
    intervalMs: 60_000,
    catalogStatus: () => ({ running: false }),
    migrateLegacy: () => 0,
    purgeExpired: () => { expired += 1; return 1; },
    purgeAll: () => { purges += 1; return 1; },
    runBatch: async () => ({
      failed: 1,
      providerFailure: { provider: "Spotify", code: "CATALOG_PHOTOS_AUTH_REVOKED" },
    }),
    logger: { log() {}, error() {}, warn() {} },
  });
  await state.trigger();
  assert.equal(purges, 2);
  assert.equal(expired, 0, "confirmed revocation uses the provider purge without running aging first");
  await stopArtistPhotoSeedScheduler();
});

test("an explicit purge failure is contained and logged without private details", () => {
  const errors = [];
  const logs = [];
  let runs = 0;
  const result = startArtistPhotoSeedScheduler({
    env: {
      ARTIST_PHOTO_SEED_ENABLED: "false",
      ARTIST_PHOTO_PURGE_REQUESTED: "true",
    },
    purgeAll: () => {
      const error = new Error("database at C:\\private\\pit.db contains secret-token");
      error.code = "SQLITE_BUSY";
      throw error;
    },
    runBatch: async () => { runs += 1; },
    logger: {
      error: (message) => errors.push(message),
      log: (message) => logs.push(message),
    },
  });
  assert.equal(result, null);
  assert.equal(runs, 0);
  assert.deepEqual(errors, ["[pit] artist photo data purge failed safely cause=Error/SQLITE_BUSY"]);
  assert.equal(errors.join(" ").includes("secret-token"), false);
  assert.ok(logs.includes(
    "[pit] Spotify artist photo seeding disabled; stored photos were retained unless an explicit purge was requested.",
  ));
});

test("scheduled photo seeding is opt-in, credential-gated, bounded, and avoids a manual catalog run", async () => {
  assert.equal(isArtistPhotoSeedEnabled({
    SPOTIFY_CLIENT_ID: "id",
    SPOTIFY_CLIENT_SECRET: "secret",
  }), false, "local development never auto-enables provider work");
  assert.equal(isArtistPhotoSeedEnabled({
    ARTIST_PHOTO_SEED_ENABLED: "tru",
    SPOTIFY_CLIENT_ID: "id",
    SPOTIFY_CLIENT_SECRET: "secret",
  }), false, "a mistyped opt-in fails closed");
  assert.equal(isArtistPhotoSeedEnabled({ RENDER: "true", ARTIST_PHOTO_SEED_ENABLED: "true" }), false);
  assert.equal(isArtistPhotoSeedEnabled({
    RENDER: "true",
    ARTIST_PHOTO_SEED_ENABLED: "true",
    SPOTIFY_CLIENT_ID: "id",
    SPOTIFY_CLIENT_SECRET: "secret",
  }), true);

  let runs = 0;
  let expired = 0;
  const state = startArtistPhotoSeedScheduler({
    env: {
      RENDER: "true",
      ARTIST_PHOTO_SEED_ENABLED: "true",
      ARTIST_PHOTO_SEED_BATCH: "999",
      SPOTIFY_CLIENT_ID: "id",
      SPOTIFY_CLIENT_SECRET: "secret",
    },
    initialDelayMs: 60_000,
    intervalMs: 60_000,
    catalogStatus: () => ({ running: false }),
    migrateLegacy: () => 0,
    purgeExpired: () => { expired += 1; return 1; },
    purgeAll: () => 0,
    runBatch: async ({ limit }) => {
      runs += 1;
      assert.equal(limit, 40);
      return { attempted: 1, filled: 1, noMatch: 0, failed: 0 };
    },
    logger: { log() {}, error() {} },
  });
  await state.trigger();
  assert.equal(runs, 1);
  assert.equal(expired, 1, "aging runs only after a successful provider-backed batch");
  await stopArtistPhotoSeedScheduler();

  const skipped = startArtistPhotoSeedScheduler({
    env: {
      RENDER: "true",
      ARTIST_PHOTO_SEED_ENABLED: "true",
      SPOTIFY_CLIENT_ID: "id",
      SPOTIFY_CLIENT_SECRET: "secret",
    },
    initialDelayMs: 60_000,
    intervalMs: 60_000,
    catalogStatus: () => ({ running: true }),
    migrateLegacy: () => 0,
    purgeExpired: () => 0,
    purgeAll: () => 0,
    runBatch: async () => { throw new Error("must not run"); },
    logger: { log() {}, error() {} },
  });
  assert.deepEqual(await skipped.trigger(), { skipped: "catalog_job_running" });
  await stopArtistPhotoSeedScheduler();
});

test("scheduled photo seeding reports a sanitized provider failure even before an artist completes", async () => {
  const warnings = [];
  const state = startArtistPhotoSeedScheduler({
    env: {
      ARTIST_PHOTO_SEED_ENABLED: "true",
      SPOTIFY_CLIENT_ID: "id",
      SPOTIFY_CLIENT_SECRET: "secret",
    },
    initialDelayMs: 60_000,
    intervalMs: 60_000,
    catalogStatus: () => ({ running: false }),
    migrateLegacy: () => 0,
    purgeExpired: () => 0,
    purgeAll: () => 0,
    runBatch: async () => ({
      attempted: 0,
      filled: 0,
      noMatch: 0,
      failed: 1,
      providerFailure: { provider: "Spotify", code: "CATALOG_PHOTOS_RATE_LIMITED" },
    }),
    logger: { log() {}, error() {}, warn: (message) => warnings.push(message) },
  });
  await state.trigger();
  assert.deepEqual(warnings, [
    "[pit] artist photo provider unavailable provider=spotify code=catalog_photos_rate_limited",
  ]);
  await stopArtistPhotoSeedScheduler();
});
