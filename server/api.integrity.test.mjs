import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-api-integrity-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q, publicUser, artistStmts, artistRow, publicArtist, pruneMissingArtists } = await import("./db.js");
const { ApiError, reserveVideoPublishingDemand, routes } = await import("./api.js");
const { discoverySidebar } = await import("./discovery.js");
const {
  YOUTUBE_MATCH_CACHE_VERSION,
  invalidateSongIndex,
  legacyTrackOverrideKey,
  normalizeYouTubeCacheText,
  trackOverrideKey,
  trackSourceOverrideKey,
  youtubeCacheKey,
} = await import("./musicProviders.js");
const { renderPublicPage } = await import("./publicPages.js");
const { clearRecommendationSnapshotsForTests } = await import("./recommendationService.js");
const { hashPassword, resetRateLimitsForTests } = await import("./auth.js");
const { verifyPrivateMediaBucketIsolation } = await import("./media.js");
const { portableMediaAsset } = await import("./features/accountPrivacy/accountPrivacyRoutes.js");
const { refreshVideoVerifierHealth, resetVideoVerifierStateForTests } = await import("./videoVerifier.js");
const {
  resetVideoFinalizeJobsForTests,
  startVideoFinalizeJob,
} = await import("./videoFinalizeJobs.js");
const {
  signVideoVerifierResponse,
  verifyVideoVerifierRequest,
  VIDEO_VERIFIER_PROTOCOL_VERSION,
} = await import("./videoVerifierProtocol.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id, email, handle) {
  q.insertUser.run(id, email, handle, handle, "test-hash", "fan", "Toronto", 43.65, -79.38, handle.slice(0, 2).toUpperCase(), "#123456", Date.now());
  return q.userById.get(id);
}

function verifiedUser(id, email, handle) {
  addUser(id, email, handle);
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}

const coldYouTubeResolve = ({ user, query, ip, signal }) => routes["POST /api/youtube/track/resolve"]({
  user,
  body: query,
  ip,
  signal,
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function eventually(read, predicate, { attempts = 100 } = {}) {
  let value;
  for (let index = 0; index < attempts; index += 1) {
    value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`Expected asynchronous state was not reached: ${JSON.stringify(value)}`);
}

test("publicUser treats extras as untrusted and tolerates malformed stored JSON", () => {
  const base = {
    id: "u_projection",
    email: "real@example.com",
    name: "Real Name",
    handle: "realhandle",
    role: "fan",
    verified: 0,
    sponsor: 0,
    home_city: "Toronto",
    home_lat: 43.65,
    home_lng: -79.38,
    genres: "not-json",
    favorite_artists: "null",
    extras: JSON.stringify({
      id: "spoofed", email: "leak@example.com", role: "admin", verified: true, home: { city: "Spoofed" }, theme: "stage",
      searchIndexingOptOut: true,
      nowPlaying: { title: { nested: "crash" }, artist: ["not", "a", "string"] },
    }),
  };

  const publicProjection = publicUser(base);
  assert.equal(publicProjection.id, "u_projection");
  assert.equal(publicProjection.role, "fan");
  assert.equal(publicProjection.verified, false);
  assert.equal(publicProjection.email, undefined);
  assert.deepEqual(publicProjection.home, { city: "Toronto" });
  assert.equal(publicProjection.home.lat, undefined);
  assert.equal(publicProjection.home.lng, undefined);
  assert.equal(publicProjection.theme, "stage");
  assert.equal(publicProjection.searchIndexingOptOut, undefined);
  assert.equal(publicProjection.nowPlaying, undefined);
  assert.deepEqual(publicProjection.genres, []);
  assert.deepEqual(publicProjection.favoriteArtists, []);

  const selfProjection = publicUser(base, { self: true });
  assert.equal(selfProjection.email, "real@example.com");
  assert.deepEqual(selfProjection.home, { city: "Toronto", lat: 43.65, lng: -79.38 });
  assert.equal(selfProjection.searchIndexingOptOut, true);
  assert.doesNotThrow(() => publicUser({ ...base, extras: "{broken" }));
});

test("public profile and people search expose city only while self keeps coordinates", () => {
  const user = addUser("u_location_projection", "location-projection@example.com", "locationprojection");
  const viewer = addUser("u_location_search_viewer", "location-search-viewer@example.com", "locationsearchviewer");
  const self = routes["GET /api/me"]({ user });
  assert.deepEqual(self.user.home, { city: "Toronto", lat: 43.65, lng: -79.38 });

  const profile = routes["GET /api/users/:id"]({ params: { id: user.id } });
  assert.deepEqual(profile.user.home, { city: "Toronto" });
  assert.equal(profile.user.home.lat, undefined);
  assert.equal(profile.user.home.lng, undefined);

  const search = routes["GET /api/people"]({ user: viewer, ip: "location-search", query: { q: "locationprojection" } });
  const result = search.users.find((entry) => entry.id === user.id);
  assert.deepEqual(result.home, { city: "Toronto" });
  assert.equal(result.home.lat, undefined);
  assert.equal(result.home.lng, undefined);
});

test("public health is minimal while detailed readiness requires active staff", () => {
  const previousVideoCapability = process.env.PIT_VIDEO_PUBLISHING_ENABLED;
  delete process.env.PIT_VIDEO_PUBLISHING_ENABLED;
  try {
    const health = routes["GET /api/health"]({});
    assert.equal(health.ok, true);
    assert.deepEqual(Object.keys(health).sort(), ["capabilities", "mediaPublishingContract", "ok", "ts"]);
    assert.equal(health.services, undefined);
    assert.equal(health.commit, undefined);
    assert.deepEqual(health.capabilities.mediaPublishing, { photos: true, videos: false });
    assert.deepEqual(health.mediaPublishingContract, {
      negotiationRequired: true,
      pipeline: "private-derivative-v1",
      state: "unavailable",
    });

    process.env.PIT_VIDEO_PUBLISHING_ENABLED = "true";
    const legacyHealth = routes["GET /api/health"]({ query: {} });
    assert.deepEqual(legacyHealth.capabilities.mediaPublishing,
      { photos: true, videos: false }, "legacy clients never receive the new video contract");
    assert.deepEqual(legacyHealth.mediaPublishingContract, {
      negotiationRequired: true,
      pipeline: "private-derivative-v1",
      state: "unavailable",
    }, "operators can distinguish a legacy response from actual runtime readiness");
    assert.deepEqual(routes["GET /api/health"]({ query: { mediaPipeline: "verified-v0" } }).capabilities.mediaPublishing,
      { photos: true, videos: false }, "misspelled/old pipeline opt-ins fail closed");
    const negotiatedHealth = routes["GET /api/health"]({ query: { mediaPipeline: "private-derivative-v1" } });
    assert.deepEqual(negotiatedHealth.capabilities.mediaPublishing,
      { photos: true, videos: false }, "a flag and client opt-in cannot bypass storage/verifier readiness");
    assert.deepEqual(negotiatedHealth.mediaPublishingContract, {
      negotiationRequired: false,
      pipeline: "private-derivative-v1",
      state: "unavailable",
    });

    addUser("u_health_mod", "health-mod@example.com", "healthmod");
    db.prepare("UPDATE users SET role='moderator' WHERE id=?").run("u_health_mod");
    const staffHealth = routes["GET /api/admin/health"]({ user: q.userById.get("u_health_mod") });
    assert.equal(staffHealth.services.database, true);
    assert.equal(typeof staffHealth.uptimeSeconds, "number");
    assert.equal(typeof staffHealth.services.youtubeConfigured, "boolean");
    assert.equal(typeof staffHealth.services.mail.apiKeyPresent, "boolean");
    assert.equal(typeof staffHealth.services.youtubeLookup?.search?.remaining, "number");
    assert.equal(typeof staffHealth.services.youtubeLookup?.efficiency?.searchCallsReserved, "number");
    assert.deepEqual(Object.keys(staffHealth.services.privateMediaIsolation).sort(),
      ["checkedAt", "configured", "errorCode", "listStatus", "objectStatus", "ready"].sort());
    assert.equal(typeof staffHealth.services.imageProcessor.available, "boolean");
    assert.equal(typeof staffHealth.services.legacyMediaFinalize.pending, "number");
    assert.equal(typeof staffHealth.services.sitemap.available, "boolean");
    assert.equal(typeof staffHealth.services.sitemap.refreshing, "boolean");
    assert.equal(typeof staffHealth.services.sitemap.totalUrls, "number");
    assert.equal(health.services?.sitemap, undefined,
      "sitemap topology and refresh history remain on the authenticated staff surface");
    assert.equal(JSON.stringify(staffHealth.services.sitemap).includes("@"), false);
    assert.equal(JSON.stringify(staffHealth.services.privateMediaIsolation).includes("pit-private"), false,
      "private storage diagnostics never expose bucket identities");
    assert.deepEqual(staffHealth.services.youtubeLookup?.actorAllowance, {
      version: 2,
      day: staffHealth.services.youtubeLookup.actorAllowance.day,
      eligible: false,
      accountVerified: false,
      adminBypass: false,
      used: 0,
      limit: 20,
      remaining: 20,
    });
    assert.match(staffHealth.services.youtubeLookup.actorAllowance.day, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(JSON.stringify(staffHealth.services.youtubeLookup.actorAllowance).includes("u_health_mod"), false,
      "staff diagnostics expose allowance state without account or network identifiers");
    assert.throws(
      () => routes["GET /api/admin/health"]({ user: addUser("u_health_fan", "health-fan@example.com", "healthfan") }),
      (error) => error.status === 403,
    );
  } finally {
    if (previousVideoCapability === undefined) delete process.env.PIT_VIDEO_PUBLISHING_ENABLED;
    else process.env.PIT_VIDEO_PUBLISHING_ENABLED = previousVideoCapability;
  }
});

test("YouTube cold search preserves anonymous cache/pins but requires a verified actor with bounded daily budgets", async () => {
  const previousApiKey = process.env.YOUTUBE_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.YOUTUBE_API_KEY = "test-key";
  let searchCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/search?")) searchCalls += 1;
    return { ok: true, status: 200, json: async () => ({ items: [] }) };
  };
  try {
    const pinnedTitle = "Anonymous Pinned Boundary";
    const pinnedArtist = "Pinned Artist";
    db.prepare(`INSERT OR REPLACE INTO track_overrides
      (key,title,artist,video_id,set_by,updated_at) VALUES (?,?,?,?,NULL,?)`).run(
      trackOverrideKey(pinnedTitle, pinnedArtist),
      pinnedTitle,
      pinnedArtist,
      "pinned00001",
      Date.now(),
    );
    assert.deepEqual(await routes["GET /api/youtube/track"]({
      query: { title: pinnedTitle, artist: pinnedArtist },
      ip: "youtube-anonymous-pinned",
    }), { videoId: "pinned00001", status: "pinned" });

    const cachedTitle = "Anonymous Cached Boundary";
    const cachedArtist = "Cached Artist";
    const cachedAt = Date.now();
    db.prepare(`INSERT OR REPLACE INTO yt_cache
      (key,video_id,updated_at,metadata,score,expires_at,rejected_ids)
      VALUES (?,?,?,?,?,?,?)`).run(
      youtubeCacheKey(cachedTitle, cachedArtist),
      "cached00001",
      cachedAt,
      JSON.stringify({ title: cachedTitle, channel: `${cachedArtist} - Topic`, reasons: ["official"], duration: 180, matchVersion: YOUTUBE_MATCH_CACHE_VERSION }),
      99,
      cachedAt + 24 * 60 * 60 * 1000,
      "[]",
    );
    assert.deepEqual(await routes["GET /api/youtube/track"]({
      query: { title: cachedTitle, artist: cachedArtist },
      ip: "youtube-anonymous-cached",
    }), { videoId: "cached00001", status: "cached", confidence: 99 });
    assert.equal(searchCalls, 0, "anonymous pinned and cached playback never reaches search.list");

    const anonymous = await routes["GET /api/youtube/track"]({
      query: { title: "Anonymous Cold Boundary", artist: "" },
      ip: "youtube-anonymous-cold",
    });
    assert.deepEqual(anonymous, { videoId: null, status: "search_login_required", retryable: false });
    assert.equal(searchCalls, 0);

    const unverified = addUser("u_youtube_unverified", "youtube-unverified@example.com", "ytunverified");
    const verification = await routes["GET /api/youtube/track"]({
      user: unverified,
      query: { title: "Unverified Cold Boundary", artist: "" },
      ip: "youtube-unverified-cold",
    });
    assert.deepEqual(verification, { videoId: null, status: "search_verification_required", retryable: false });
    assert.equal(searchCalls, 0);

    const bounded = verifiedUser("u_youtube_bounded", "youtube-bounded@example.com", "ytbounded");
    const quotaParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const quotaPart = (type) => quotaParts.find((entry) => entry.type === type)?.value;
    const quotaDay = `${quotaPart("year")}-${quotaPart("month")}-${quotaPart("day")}`;
    const boundedV2Key = `youtube_cold_user:v2:${quotaDay}:${bounded.id}`;
    const boundedV1Key = `youtube_cold_user:${quotaDay}:${bounded.id}`;
    db.prepare("INSERT OR REPLACE INTO app_meta (key,value) VALUES (?,'19')").run(boundedV2Key);
    db.prepare("INSERT OR REPLACE INTO app_meta (key,value) VALUES (?,'20')").run(boundedV1Key);
    const budgetRowsBeforeGet = db.prepare(`SELECT key,value FROM app_meta
      WHERE key GLOB 'youtube_search_calls:*' OR key GLOB 'youtube_cold_user:*' ORDER BY key`).all();
    for (let index = 0; index < 3; index += 1) {
      assert.deepEqual(await routes["GET /api/youtube/track"]({
        user: bounded,
        query: { title: "Verified GET Cannot Spend", artist: "" },
        ip: "youtube-bounded-ip",
      }), {
        videoId: null,
        status: "search_deferred",
        retryable: false,
        resolveMethod: "POST",
      });
    }
    assert.deepEqual(db.prepare(`SELECT key,value FROM app_meta
      WHERE key GLOB 'youtube_search_calls:*' OR key GLOB 'youtube_cold_user:*' ORDER BY key`).all(), budgetRowsBeforeGet,
    "repeated GET reads must not reserve listener or global YouTube search budget");
    assert.equal(searchCalls, 0, "repeated GET reads must never call search.list");

    for (let index = 0; index < 1; index += 1) {
      const result = await coldYouTubeResolve({
        user: bounded,
        query: { title: `Bounded Cold Boundary ${index}`, artist: "" },
        ip: "youtube-bounded-ip",
      });
      assert.equal(result.status, "low_confidence");
    }
    assert.equal(searchCalls, 1);
    const boundedDenied = await coldYouTubeResolve({
      user: bounded,
      query: { title: "Bounded Cold Boundary Exhausted", artist: "" },
      ip: "youtube-bounded-ip",
    });
    assert.deepEqual(boundedDenied, {
      videoId: null,
      status: "search_actor_budget_exhausted",
      retryable: false,
    });
    assert.equal(searchCalls, 1, "the account cap stops a provider request before it leaves PIT");
    assert.equal(Number(db.prepare("SELECT value FROM app_meta WHERE key GLOB ?")
      .get(`youtube_cold_user:v2:*:${bounded.id}`)?.value), 20,
    "the per-account cap survives a process restart in SQLite");
    assert.equal(db.prepare("SELECT 1 FROM app_meta WHERE key=?").get(boundedV1Key), undefined,
      "the retired per-provider-call counter cannot strand an actor after the v2 rollout");

    const sharedIp = "youtube-shared-network";
    const networkUsers = Array.from({ length: 3 }, (_, index) => verifiedUser(
      `u_youtube_network_${index}`,
      `youtube-network-${index}@example.com`,
      `ytnetwork${index}`,
    ));
    const beforeNetwork = searchCalls;
    for (let userIndex = 0; userIndex < 2; userIndex += 1) {
      for (let requestIndex = 0; requestIndex < 20; requestIndex += 1) {
        const result = await coldYouTubeResolve({
          user: networkUsers[userIndex],
          query: { title: `Network Cold Boundary ${userIndex}-${requestIndex}`, artist: "" },
          ip: sharedIp,
        });
        assert.equal(result.status, "low_confidence");
      }
    }
    assert.equal(searchCalls - beforeNetwork, 40);
    const networkDenied = await coldYouTubeResolve({
      user: networkUsers[2],
      query: { title: "Network Cold Boundary Exhausted", artist: "" },
      ip: sharedIp,
    });
    assert.deepEqual(networkDenied, {
      videoId: null,
      status: "search_actor_budget_exhausted",
      retryable: false,
    });
    assert.equal(searchCalls - beforeNetwork, 40, "the hashed in-memory network cap remains below global capacity");

    // Denial at the later IP gate must roll back the earlier user reservation.
    // Otherwise this actor reaches a new network with only four searches left.
    const afterSaturatedIp = searchCalls;
    db.prepare("INSERT OR REPLACE INTO app_meta (key,value) VALUES (?,'19')")
      .run(`youtube_cold_user:v2:${quotaDay}:${networkUsers[2].id}`);
    for (let requestIndex = 0; requestIndex < 1; requestIndex += 1) {
      const result = await coldYouTubeResolve({
        user: networkUsers[2],
        query: { title: `Network Rollover Boundary ${requestIndex}`, artist: "" },
        ip: "youtube-network-fresh-ip",
      });
      assert.equal(result.status, "low_confidence");
    }
    assert.equal(searchCalls - afterSaturatedIp, 1,
      "an IP-cap denial consumes none of the user's final allowance on a fresh network");

    // Seed only the restart-safe account cap. Its denial must also roll back the
    // fresh IP reservation so that 20 other legitimate actors retain all 20
    // network slots rather than failing on the final request.
    const boundedKey = db.prepare("SELECT key FROM app_meta WHERE key GLOB ?")
      .get(`youtube_cold_user:*:${bounded.id}`)?.key;
    assert.ok(boundedKey);
    const actorPrefix = boundedKey.slice(0, -bounded.id.length);
    const persistedCapped = verifiedUser(
      "u_youtube_persisted_cap",
      "youtube-persisted-cap@example.com",
      "ytpersistedcap",
    );
    db.prepare("INSERT OR REPLACE INTO app_meta (key,value) VALUES (?,'20')")
      .run(`${actorPrefix}${persistedCapped.id}`);
    const freshIp = "youtube-persisted-cap-fresh-ip";
    const persistedDenied = await coldYouTubeResolve({
      user: persistedCapped,
      query: { title: "Persisted Cap Boundary", artist: "" },
      ip: freshIp,
    });
    assert.deepEqual(persistedDenied, {
      videoId: null,
      status: "search_actor_budget_exhausted",
      retryable: false,
    });

    const freshIpUsers = Array.from({ length: 2 }, (_, index) => verifiedUser(
      `u_youtube_fresh_ip_${index}`,
      `youtube-fresh-ip-${index}@example.com`,
      `ytfreship${index}`,
    ));
    const beforeFreshIp = searchCalls;
    for (let userIndex = 0; userIndex < freshIpUsers.length; userIndex += 1) {
      for (let requestIndex = 0; requestIndex < 20; requestIndex += 1) {
        const result = await coldYouTubeResolve({
          user: freshIpUsers[userIndex],
          query: { title: `Persisted Fresh IP Boundary ${userIndex}-${requestIndex}`, artist: "" },
          ip: freshIp,
        });
        assert.equal(result.status, "low_confidence");
      }
    }
    assert.equal(searchCalls - beforeFreshIp, 40,
      "a persisted-account denial consumes none of a fresh IP's allowance");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = previousApiKey;
  }
});

test("player provider routes propagate disconnects and downgrade ordinary preview outages", async () => {
  const previousApiKey = process.env.YOUTUBE_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.YOUTUBE_API_KEY = "test-key";
  const listener = verifiedUser("u_player_abort", "player-abort@example.com", "playerabort");
  try {
    const youtubeStarted = deferred();
    const youtubeStopped = deferred();
    globalThis.fetch = async (_url, request) => {
      youtubeStarted.resolve();
      return new Promise((_resolve, reject) => {
        const onAbort = () => {
          youtubeStopped.resolve();
          reject(request.signal.reason);
        };
        if (request.signal.aborted) onAbort();
        else request.signal.addEventListener("abort", onAbort, { once: true });
      });
    };
    const youtubeAbort = new AbortController();
    const youtube = coldYouTubeResolve({
      user: listener,
      query: { title: "Route Cancellation Track", artist: "" },
      ip: "player-abort-youtube",
      signal: youtubeAbort.signal,
    });
    await youtubeStarted.promise;
    youtubeAbort.abort(new DOMException("HTTP caller disconnected", "AbortError"));
    await assert.rejects(() => youtube, { name: "AbortError" });
    await youtubeStopped.promise;

    const deezerStarted = deferred();
    const deezerStopped = deferred();
    globalThis.fetch = async (_url, request) => {
      deezerStarted.resolve();
      return new Promise((_resolve, reject) => {
        const onAbort = () => {
          deezerStopped.resolve();
          reject(request.signal.reason);
        };
        if (request.signal.aborted) onAbort();
        else request.signal.addEventListener("abort", onAbort, { once: true });
      });
    };
    const deezerAbort = new AbortController();
    const deezer = routes["GET /api/deezer/track"]({
      query: { title: "Route Preview Cancellation", artist: "Route Preview Artist" },
      ip: "player-abort-deezer",
      signal: deezerAbort.signal,
    });
    await deezerStarted.promise;
    deezerAbort.abort(new DOMException("HTTP caller disconnected", "AbortError"));
    await assert.rejects(() => deezer, { name: "AbortError" });
    await deezerStopped.promise;

    globalThis.fetch = async () => ({ ok: false, status: 503 });
    assert.deepEqual(await routes["GET /api/deezer/track"]({
      query: { title: "Route Preview Provider Miss", artist: "Route Preview Artist" },
      ip: "player-preview-provider-miss",
      signal: new AbortController().signal,
    }), { preview: null, status: "http_error", retryable: true },
    "a normal third-party preview outage is playback state, not a PIT server failure");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = previousApiKey;
  }
});

test("public video capability requires exact private-derivative negotiation plus live storage and verifier", async () => {
  const keys = [
    "NODE_ENV", "PIT_VIDEO_PUBLISHING_ENABLED", "PIT_VIDEO_VERIFIER_HOSTPORT", "PIT_VIDEO_VERIFIER_SECRET",
    "MEDIA_ENDPOINT", "MEDIA_BUCKET", "MEDIA_SOURCE_BUCKET", "MEDIA_REGION", "MEDIA_ACCESS_KEY_ID", "MEDIA_SECRET_ACCESS_KEY",
    "MEDIA_PUBLIC_BASE_URL",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const secret = "api-health-video-verifier-secret-at-least-thirty-two-bytes";
  try {
    Object.assign(process.env, {
      NODE_ENV: "production",
      PIT_VIDEO_PUBLISHING_ENABLED: "true",
      PIT_VIDEO_VERIFIER_HOSTPORT: "pit-video-verifier:10001",
      PIT_VIDEO_VERIFIER_SECRET: secret,
      MEDIA_ENDPOINT: "https://objects.example.com/s3",
      MEDIA_BUCKET: "pit-media",
      MEDIA_SOURCE_BUCKET: "pit-media-private",
      MEDIA_REGION: "auto",
      MEDIA_ACCESS_KEY_ID: "health-access",
      MEDIA_SECRET_ACCESS_KEY: "health-secret",
      MEDIA_PUBLIC_BASE_URL: "https://media.example.com/cdn",
    });
    resetVideoVerifierStateForTests();
    assert.throws(() => routes["GET /api/readiness"]({}),
      (error) => error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE",
      "an enabled release cannot be promoted before its live verifier proof");
    await verifyPrivateMediaBucketIsolation({
      env: process.env,
      fetchImpl: async () => ({ status: 403 }),
    });
    assert.throws(() => routes["GET /api/readiness"]({}),
      (error) => error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE",
      "private storage readiness alone cannot bypass the verifier gate");
    const verifierHealth = (sourceTypes) => async (url, request) => {
      const path = new URL(url).pathname;
      const authenticated = verifyVideoVerifierRequest({
        secret,
        path,
        body: request.body,
        headers: request.headers,
      });
      const signed = signVideoVerifierResponse({
        secret,
        path,
        requestNonce: authenticated.nonce,
        payload: {
          ok: true,
          protocol: VIDEO_VERIFIER_PROTOCOL_VERSION,
          pipeline: "private-derivative-v1",
          decoder: { ffmpeg: true, ffprobe: true, version: "ffmpeg health" },
          poster: { generated: true, decoded: true },
          storage: { privateInput: true, sanitizedOutput: true },
          sourceTypes,
          sourceCodecs: Object.fromEntries(sourceTypes.map((type) => [type, ["h264", "hevc"]])),
          concurrency: 1,
        },
      });
      return new Response(signed.body, { status: 200, headers: signed.headers });
    };
    await refreshVideoVerifierHealth({
      env: process.env,
      fetchImpl: verifierHealth(["video/mp4", "video/quicktime"]),
    });
    assert.deepEqual(Object.keys(routes["GET /api/readiness"]({})).sort(), ["ok", "ts"]);
    assert.deepEqual(routes["GET /api/health"]({ query: {} }).capabilities.mediaPublishing,
      { photos: true, videos: false });
    assert.deepEqual(routes["GET /api/health"]({ query: { mediaPipeline: "private-derivative-v1x" } }).capabilities.mediaPublishing,
      { photos: true, videos: false });
    assert.deepEqual(routes["GET /api/health"]({ query: { mediaPipeline: "private-derivative-v1" } }).capabilities.mediaPublishing,
      {
        photos: true,
        videos: true,
        pipeline: "private-derivative-v1",
        sourceTypes: ["video/mp4", "video/quicktime"],
        sourceCodecs: {
          "video/mp4": ["h264", "hevc"],
          "video/quicktime": ["h264", "hevc"],
        },
      });
    process.env.PIT_VIDEO_PUBLISHING_ENABLED = "false";
    assert.equal(routes["GET /api/readiness"]({}).ok, true,
      "an explicit rollback keeps the core web release deployable without advertising videos");
    assert.deepEqual(routes["GET /api/health"]({ query: { mediaPipeline: "private-derivative-v1" } }).capabilities.mediaPublishing,
      { photos: true, videos: false }, "capability environment flags are evaluated on every health response");
    process.env.PIT_VIDEO_PUBLISHING_ENABLED = "true";
    assert.deepEqual(routes["GET /api/health"]({ query: { mediaPipeline: "private-derivative-v1" } }).capabilities.mediaPublishing,
      {
        photos: true,
        videos: true,
        pipeline: "private-derivative-v1",
        sourceTypes: ["video/mp4", "video/quicktime"],
        sourceCodecs: {
          "video/mp4": ["h264", "hevc"],
          "video/quicktime": ["h264", "hevc"],
        },
      });
    process.env.MEDIA_SOURCE_BUCKET = process.env.MEDIA_BUCKET;
    const degraded = routes["GET /api/health"]({ query: { mediaPipeline: "private-derivative-v1" } });
    assert.equal(degraded.ok, true, "core liveness survives an unavailable optional media provider");
    assert.deepEqual(degraded.capabilities.mediaPublishing, { photos: false, videos: false },
      "a public/shared source bucket keeps every publishing capability fail closed");
    assert.throws(() => routes["GET /api/readiness"]({}),
      (error) => error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE",
      "enabled video plus degraded private storage blocks release promotion without breaking liveness");
    process.env.MEDIA_SOURCE_BUCKET = "pit-media-private";

    const videoBody = (clientAssetId) => ({
      clientAssetId,
      purpose: "post",
      contentType: "video/mp4",
      fileSize: 1_000_000,
      name: `${clientAssetId}.mp4`,
    });
    const unverified = addUser("u_video_route_unverified", "video-route-unverified@example.com", "videorouteunverified");
    assert.throws(() => routes["POST /api/media/assets"]({
      user: unverified,
      ip: "video-route-unverified-ip",
      body: videoBody("video-route-unverified"),
    }), (error) => error.status === 403 && error.code === "FORBIDDEN");
    assert.equal(db.prepare("SELECT COUNT(*) count FROM media_assets WHERE owner_id=?").get(unverified.id).count, 0);

    const legacyAdminSeed = addUser("u_video_route_admin", "video-route-admin@example.com", "videorouteadmin");
    db.prepare("UPDATE users SET role='admin' WHERE id=?").run(legacyAdminSeed.id);
    const legacyAdmin = q.userById.get(legacyAdminSeed.id);
    assert.equal(legacyAdmin.email_verified_at, 0);
    const rollingMov = routes["POST /api/media/assets"]({
      user: legacyAdmin,
      ip: "video-route-admin-mov",
      body: {
        clientAssetId: "video-route-admin-mov",
        purpose: "post",
        contentType: "video/quicktime",
        fileSize: 1_000_000,
        name: "video-route-admin-mov.mov",
      },
    });
    await refreshVideoVerifierHealth({
      env: process.env,
      fetchImpl: verifierHealth(["video/mp4"]),
      at: Date.now() + 1,
    });
    assert.throws(() => routes["POST /api/media/assets"]({
      user: legacyAdmin,
      ip: "video-route-admin-mov-blocked",
      body: {
        clientAssetId: "video-route-admin-mov-blocked",
        purpose: "post",
        contentType: "video/quicktime",
        fileSize: 1_000_000,
        name: "video-route-admin-mov-blocked.mov",
      },
    }), (error) => error.status === 415 && error.code === "MEDIA_TYPE_UNSUPPORTED");
    await assert.rejects(routes["POST /api/media/assets/:id/finalize"]({
      user: legacyAdmin,
      ip: "video-route-admin-mov-finalize-blocked",
      params: { id: rollingMov.asset.id },
      body: {
        width: 720,
        height: 1_280,
        durationMs: 1_000,
        orientation: 0,
        editRecipe: { coverMs: 0 },
      },
    }), (error) => error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE");
    assert.equal(db.prepare("SELECT status FROM media_assets WHERE id=?").get(rollingMov.asset.id).status, "upload_pending",
      "a rolling capability mismatch preserves the resumable source instead of terminally cancelling it");
    assert.equal(routes["POST /api/media/assets"]({
      user: legacyAdmin,
      ip: "video-route-admin-ip",
      body: videoBody("video-route-admin"),
    }).duplicate, false);
    const terminalDraft = db.prepare("SELECT id,source_key FROM media_assets WHERE owner_id=? AND client_asset_id=?")
      .get(legacyAdmin.id, "video-route-admin");
    const terminalLedger = db.prepare("SELECT upload_expires_at FROM media_objects WHERE object_key=?")
      .get(terminalDraft.source_key);
    const previousFetch = globalThis.fetch;
    const cachedFastDraft = routes["POST /api/media/assets"]({
      user: legacyAdmin,
      ip: "video-route-cached-fast-create",
      body: videoBody("video-route-cached-fast"),
    }).asset;
    const cachedFastBody = {
      width: 1_280,
      height: 720,
      durationMs: 1_000,
      orientation: 0,
      editRecipe: { coverMs: 0 },
    };
    const cachedFastFingerprint = createHash("sha256").update(JSON.stringify({
      durationMs: 1_000,
      editRecipe: { coverMs: 0 },
      height: 720,
      orientation: 0,
      width: 1_280,
    })).digest("hex");
    startVideoFinalizeJob({
      ownerId: legacyAdmin.id,
      assetId: cachedFastDraft.id,
      fingerprint: cachedFastFingerprint,
      run: async () => {
        db.prepare("UPDATE media_assets SET status='ready',render_state='ready',updated_at=? WHERE id=? AND owner_id=?")
          .run(Date.now(), cachedFastDraft.id, legacyAdmin.id);
        return { asset: { ...cachedFastDraft, status: "ready", renderState: "ready" }, duplicate: false };
      },
    });
    const cachedFast = await routes["POST /api/media/assets/:id/finalize"]({
      user: legacyAdmin,
      ip: "video-route-cached-fast-finalize",
      params: { id: cachedFastDraft.id },
      body: cachedFastBody,
    });
    assert.equal(cachedFast.asset.status, "ready");
    assert.deepEqual(cachedFast.finalize, { state: "completed" },
      "a cached client keeps its ready response when the shared job finishes inside the compatibility window");

    const cachedCreateBody = videoBody("video-route-cached-client");
    const cachedDraft = routes["POST /api/media/assets"]({
      user: legacyAdmin,
      ip: "video-route-cached-client-create",
      body: cachedCreateBody,
    }).asset;
    const cachedFetchGate = deferred();
    globalThis.fetch = async () => {
      await cachedFetchGate.promise;
      return new Response(null, { status: 503 });
    };
    const cachedBody = {
      width: 1_280,
      height: 720,
      durationMs: 1_000,
      orientation: 0,
      editRecipe: { coverMs: 0 },
    };
    const cachedNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    try {
      await assert.rejects(routes["POST /api/media/assets/:id/finalize"]({
        user: legacyAdmin,
        ip: "video-route-cached-client-start",
        params: { id: cachedDraft.id },
        body: cachedBody,
      }), (error) => error.status === 429 && error.code === "RATE_LIMITED"
        && /upload is saved/u.test(error.message));
      const issuancesBeforeRetry = db.prepare("SELECT COUNT(*) count FROM media_upload_issuances").get().count;
      const cachedDuplicate = routes["POST /api/media/assets"]({
        user: legacyAdmin,
        ip: "video-route-cached-client-duplicate-create",
        body: cachedCreateBody,
      });
      assert.equal(cachedDuplicate.duplicate, true);
      assert.equal(cachedDuplicate.upload, null,
        "a cached create retry cannot mint a second writer while verification reads the source");
      assert.equal(db.prepare("SELECT COUNT(*) count FROM media_upload_issuances").get().count, issuancesBeforeRetry,
        "suppressing the duplicate writer also avoids a hidden unused issuance");
      assert.deepEqual(routes["GET /api/media/assets/:id"]({
        user: legacyAdmin,
        ip: "video-route-cached-client-still-processing",
        params: { id: cachedDraft.id },
      }).finalize, { state: "processing" });
      await assert.rejects(routes["POST /api/media/assets/:id/finalize"]({
        user: legacyAdmin,
        ip: "video-route-cached-client-join",
        params: { id: cachedDraft.id },
        body: cachedBody,
      }), (error) => error.status === 429 && error.code === "RATE_LIMITED"
        && /upload is saved/u.test(error.message));
    } finally {
      process.env.NODE_ENV = cachedNodeEnv;
    }
    assert.equal(db.prepare("SELECT status FROM media_assets WHERE id=?").get(cachedDraft.id).status, "upload_pending",
      "a cached timeout keeps the resumable source owned while background processing continues");
    cachedFetchGate.resolve();
    const cachedFailed = await eventually(
      () => routes["GET /api/media/assets/:id"]({
        user: legacyAdmin,
        ip: "video-route-cached-client-poll",
        params: { id: cachedDraft.id },
      }),
      (value) => value.finalize.state === "failed",
    );
    assert.equal(cachedFailed.finalize.error.retryable, true);
    assert.equal(cachedFailed.asset.status, "upload_pending",
      "a transient worker/storage failure does not cancel cached-client source bytes");
    const observedBackgroundFailure = db.prepare(`SELECT code,status,method,route,cause,count FROM error_events
      WHERE method='POST' AND route='/api/media/assets/:id/finalize' ORDER BY last_seen DESC LIMIT 1`).get();
    assert.equal(observedBackgroundFailure.code, "MEDIA_STORAGE_UNAVAILABLE");
    assert.equal(observedBackgroundFailure.status, 503);
    assert.equal(observedBackgroundFailure.count >= 1, true);
    assert.equal(JSON.stringify(observedBackgroundFailure).includes("objects.example.com"), false,
      "detached-job observability stores only the route pattern and sanitized error identity");

    globalThis.fetch = async (_url, request = {}) => {
      const method = String(request.method || "GET").toUpperCase();
      if (method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "content-length": "1000000",
            "content-type": "video/mp4",
            etag: '"terminal-incompatible-source"',
          },
        });
      }
      const headers = new Headers(request.headers || {});
      const match = /^bytes=([0-9]+)-([0-9]+)$/u.exec(headers.get("range") || "");
      assert.ok(match, "structural inspection uses an exact signed byte range");
      const start = Number(match[1]);
      const end = Number(match[2]);
      return new Response(Buffer.alloc(end - start + 1), {
        status: 206,
        headers: {
          "content-length": String(end - start + 1),
          "content-range": `bytes ${start}-${end}/1000000`,
          "content-type": "video/mp4",
          etag: '"terminal-incompatible-source"',
        },
      });
    };
    let terminalOutcome;
    try {
      resetVideoFinalizeJobsForTests();
      const finalizeBody = {
        width: 1_280,
        height: 720,
        durationMs: 1_000,
        orientation: 0,
        editRecipe: { coverMs: 0 },
      };
      const caller = new AbortController();
      const firstRequest = routes["POST /api/media/assets/:id/finalize"]({
        user: legacyAdmin,
        ip: "video-route-admin-finalize",
        params: { id: terminalDraft.id },
        body: { ...finalizeBody, async: true },
        signal: caller.signal,
      });
      const joinedRequest = routes["POST /api/media/assets/:id/finalize"]({
        user: legacyAdmin,
        ip: "video-route-admin-finalize-joined",
        params: { id: terminalDraft.id },
        // Reordered JSON keys prove the operation identity is canonical.
        body: { ...finalizeBody, editRecipe: { coverMs: 0 }, async: true },
      });
      await assert.rejects(routes["POST /api/media/assets/:id/finalize"]({
        user: legacyAdmin,
        ip: "video-route-admin-finalize-conflict",
        params: { id: terminalDraft.id },
        body: { ...finalizeBody, editRecipe: { coverMs: 1 } },
      }), (error) => error.status === 409 && error.code === "CONFLICT");
      caller.abort(new DOMException("HTTP caller disconnected", "AbortError"));
      const [started, joined] = await Promise.all([firstRequest, joinedRequest]);
      assert.equal(started.asset.status, "upload_pending");
      assert.deepEqual(started.finalize, { state: "processing" });
      assert.deepEqual(joined.finalize, { state: "processing" });
      terminalOutcome = await eventually(
        () => routes["GET /api/media/assets/:id"]({
          user: legacyAdmin,
          ip: "video-route-admin-poll",
          params: { id: terminalDraft.id },
        }),
        (value) => value.finalize.state === "failed",
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
    assert.equal(terminalOutcome.asset, null);
    assert.deepEqual(Object.keys(terminalOutcome.finalize.error).sort(), ["code", "message", "retryable", "status"]);
    assert.equal(terminalOutcome.finalize.error.code, "MEDIA_TYPE_UNSUPPORTED");
    assert.equal(terminalOutcome.finalize.error.status, 415);
    assert.equal(terminalOutcome.finalize.error.retryable, false);
    assert.equal(JSON.stringify(terminalOutcome).includes("terminal-incompatible-source"), false,
      "polling never exposes object generations, causes, stacks, or verifier details");
    assert.equal(db.prepare("SELECT 1 FROM media_assets WHERE id=?").get(terminalDraft.id), undefined,
      "terminally incompatible bytes do not occupy a draft/quota slot for seven days");
    assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(terminalDraft.source_key).status,
      "delete_queued");
    assert.ok(db.prepare("SELECT next_attempt_at FROM media_deletion_queue WHERE object_key=?")
      .get(terminalDraft.source_key).next_attempt_at > terminalLedger.upload_expires_at,
    "terminal cleanup still respects the signed PUT settle barrier");

    const fan = verifiedUser("u_video_route_verified", "video-route-verified@example.com", "videorouteverified");
    const firstBody = videoBody("video-route-idempotent");
    assert.equal(routes["POST /api/media/assets"]({ user: fan, ip: "video-route-fan-0", body: firstBody }).duplicate, false);
    for (let index = 0; index < 12; index += 1) {
      assert.equal(routes["POST /api/media/assets"]({
        user: fan,
        ip: `video-route-duplicate-${index}`,
        body: firstBody,
      }).duplicate, true, "lost-response retries do not consume a new upload permit");
    }
    for (let index = 1; index < 40; index += 1) {
      assert.equal(routes["POST /api/media/assets"]({
        user: fan,
        ip: `video-route-unique-${index}`,
        body: videoBody(`video-route-unique-${index}`),
      }).duplicate, false);
    }
    assert.equal(db.prepare("SELECT COUNT(*) count FROM media_assets WHERE owner_id=?")
      .get(fan.id).count, 40,
    "clip source creation has neither the old ten-per-day cap nor a hidden thirty-per-ten-minute route cap");
  } finally {
    resetVideoVerifierStateForTests();
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("video publishing leaves source counts unmetered while protecting scarce decoder capacity", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  delete process.env.NODE_ENV;
  const reserve = (phase, userId, ip) => reserveVideoPublishingDemand({ ip }, { id: userId }, phase);
  try {
    resetRateLimitsForTests();
    for (let index = 0; index < 5_000; index += 1) {
      assert.equal(reserve("upload", "video-account", `shared-upload-ip-${index % 3}`), null,
        "source admission has no account, carrier-NAT, or site-wide count bucket");
    }
    for (let index = 0; index < 240; index += 1) reserve("verify", "video-account", `verify-ip-${index}`).commit();
    assert.throws(() => reserve("verify", "video-account", "verify-ip-over"),
      (error) => error.status === 429 && error.code === "RATE_LIMITED");

    resetRateLimitsForTests();
    for (let index = 0; index < 480; index += 1) reserve("verify", `shared-verify-${index}`, "shared-verify-ip").commit();
    assert.throws(() => reserve("verify", "shared-verify-over", "shared-verify-ip"),
      (error) => error.status === 429 && error.code === "RATE_LIMITED");

    resetRateLimitsForTests();
    const rolledBack = reserve("verify", "rollback-account", "rollback-ip");
    assert.equal(rolledBack.rollback(), true);
    for (let index = 0; index < 2_000; index += 1) {
      reserve("verify", `global-verify-${index}`, `global-verify-ip-${index}`).commit();
    }
    assert.throws(() => reserve("verify", "global-verify-over", "global-verify-ip-over"),
      (error) => error.status === 429 && error.code === "RATE_LIMITED");

  } finally {
    resetRateLimitsForTests();
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test("YouTube v2 actor allowance admits legacy admins, gates fans, and isolates day and account counters", async () => {
  const previousApiKey = process.env.YOUTUBE_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.YOUTUBE_API_KEY = "test-key";
  let providerSearches = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/search?")) providerSearches += 1;
    return { ok: true, status: 200, json: async () => ({ items: [] }) };
  };
  try {
    const legacyAdminId = "u_youtube_legacy_admin";
    addUser(legacyAdminId, "youtube-legacy-admin@example.com", "youtubelegacyadmin");
    db.prepare("UPDATE users SET role='admin' WHERE id=?").run(legacyAdminId);
    const legacyAdmin = q.userById.get(legacyAdminId);
    assert.equal(legacyAdmin.email_verified_at, 0);
    assert.deepEqual(await routes["GET /api/youtube/track"]({
      user: legacyAdmin,
      query: { title: "Legacy Admin Cold Read", artist: "" },
      ip: "youtube-legacy-admin-read",
    }), {
      videoId: null,
      status: "search_deferred",
      retryable: false,
      resolveMethod: "POST",
    }, "an existing admin is eligible even before verification backfill");

    const beforeHealth = routes["GET /api/admin/health"]({ user: legacyAdmin });
    const day = beforeHealth.services.youtubeLookup.actorAllowance.day;
    assert.deepEqual(beforeHealth.services.youtubeLookup.actorAllowance, {
      version: 2,
      day,
      eligible: true,
      accountVerified: false,
      adminBypass: true,
      used: 0,
      limit: 20,
      remaining: 20,
    });
    db.prepare("INSERT OR REPLACE INTO app_meta (key,value) VALUES (?,'20')")
      .run(`youtube_cold_user:${day}:${legacyAdmin.id}`);
    assert.equal((await coldYouTubeResolve({
      user: legacyAdmin,
      query: { title: "Legacy Admin Cold Resolve", artist: "" },
      ip: "youtube-legacy-admin-resolve",
    })).status, "low_confidence");
    assert.equal(providerSearches, 1);
    const afterHealth = routes["GET /api/admin/health"]({ user: legacyAdmin });
    assert.equal(afterHealth.services.youtubeLookup.actorAllowance.used, 1,
      "one explicit cold track consumes exactly one v2 actor permit");
    assert.equal(afterHealth.services.youtubeLookup.actorAllowance.remaining, 19);
    assert.equal(db.prepare("SELECT 1 FROM app_meta WHERE key=?").get(
      `youtube_cold_user:${day}:${legacyAdmin.id}`,
    ), undefined, "the retired v1 count is ignored and cleaned during the first v2 reservation");

    const unverifiedFan = addUser("u_youtube_v2_unverified_fan", "youtube-v2-fan@example.com", "youtubev2fan");
    assert.deepEqual(await coldYouTubeResolve({
      user: unverifiedFan,
      query: { title: "Unverified Fan Cold Resolve", artist: "" },
      ip: "youtube-v2-unverified-fan",
    }), { videoId: null, status: "search_verification_required", retryable: false });
    assert.equal(providerSearches, 1, "an ordinary unverified account never reaches search.list");

    const rolloverUser = verifiedUser("u_youtube_v2_rollover", "youtube-v2-rollover@example.com", "youtubev2rollover");
    const yesterdayParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(Date.now() - 36 * 60 * 60 * 1000));
    const yesterdayPart = (type) => yesterdayParts.find((entry) => entry.type === type)?.value;
    const yesterday = `${yesterdayPart("year")}-${yesterdayPart("month")}-${yesterdayPart("day")}`;
    assert.notEqual(yesterday, day);
    const yesterdayKey = `youtube_cold_user:v2:${yesterday}:${rolloverUser.id}`;
    db.prepare("INSERT OR REPLACE INTO app_meta (key,value) VALUES (?,'20')").run(yesterdayKey);
    assert.equal((await coldYouTubeResolve({
      user: rolloverUser,
      query: { title: "Rollover Cold Resolve", artist: "" },
      ip: "youtube-v2-rollover",
    })).status, "low_confidence");
    assert.equal(Number(db.prepare("SELECT value FROM app_meta WHERE key=?").get(
      `youtube_cold_user:v2:${day}:${rolloverUser.id}`,
    )?.value), 1, "a prior Pacific-day counter cannot consume today's allowance");
    assert.equal(db.prepare("SELECT 1 FROM app_meta WHERE key=?").get(yesterdayKey), undefined,
      "stale actor counters are pruned on reservation");

    const capped = verifiedUser("u_youtube_v2_capped", "youtube-v2-capped@example.com", "youtubev2capped");
    const isolated = verifiedUser("u_youtube_v2_isolated", "youtube-v2-isolated@example.com", "youtubev2isolated");
    db.prepare("INSERT OR REPLACE INTO app_meta (key,value) VALUES (?,'20')")
      .run(`youtube_cold_user:v2:${day}:${capped.id}`);
    assert.deepEqual(await coldYouTubeResolve({
      user: capped,
      query: { title: "Capped Actor Cold Resolve", artist: "" },
      ip: "youtube-v2-capped",
    }), { videoId: null, status: "search_actor_budget_exhausted", retryable: false });
    assert.equal((await coldYouTubeResolve({
      user: isolated,
      query: { title: "Isolated Actor Cold Resolve", artist: "" },
      ip: "youtube-v2-isolated",
    })).status, "low_confidence");
    assert.equal(Number(db.prepare("SELECT value FROM app_meta WHERE key=?").get(
      `youtube_cold_user:v2:${day}:${isolated.id}`,
    )?.value), 1, "one account's cap never bleeds into another account");

    const cappedLeader = verifiedUser("u_youtube_v2_capped_leader", "youtube-v2-capped-leader@example.com", "youtubev2cappedlead");
    const freshFollower = verifiedUser("u_youtube_v2_fresh_follower", "youtube-v2-fresh-follower@example.com", "youtubev2freshfollow");
    db.prepare("INSERT OR REPLACE INTO app_meta (key,value) VALUES (?,'20')")
      .run(`youtube_cold_user:v2:${day}:${cappedLeader.id}`);
    const sharedTrack = { title: "Concurrent Actor Isolation Track", artist: "" };
    const globalBeforeConcurrent = routes["GET /api/admin/health"]({ user: legacyAdmin })
      .services.youtubeLookup.search.used;
    const [leaderResult, followerResult] = await Promise.all([
      coldYouTubeResolve({ user: cappedLeader, query: sharedTrack, ip: "youtube-v2-capped-leader" }),
      coldYouTubeResolve({ user: freshFollower, query: sharedTrack, ip: "youtube-v2-fresh-follower" }),
    ]);
    assert.deepEqual(leaderResult, { videoId: null, status: "search_actor_budget_exhausted", retryable: false });
    assert.equal(followerResult.status, "low_confidence",
      "an actor-local denial cannot poison a concurrent eligible same-track listener");
    assert.equal(Number(db.prepare("SELECT value FROM app_meta WHERE key=?").get(
      `youtube_cold_user:v2:${day}:${freshFollower.id}`,
    )?.value), 1, "the eligible follower independently reserves its own actor permit");
    assert.equal(routes["GET /api/admin/health"]({ user: legacyAdmin })
      .services.youtubeLookup.search.used, globalBeforeConcurrent + 1,
    "the capped leader's rolled-back reservation does not consume shared provider capacity");
    assert.equal(providerSearches, 4);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = previousApiKey;
  }
});

test("YouTube GET is database-and-network read-only while POST can data-promote a source recording for free", async () => {
  const previousApiKey = process.env.YOUTUBE_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.YOUTUBE_API_KEY = "test-key";
  const title = "Read Only Source Promotion";
  const artist = "Read Only Promotion Artist";
  const videoId = "getpromote1";
  const sourceId = "7333333333";
  const at = Date.now();
  const listener = verifiedUser("u_youtube_read_only", "youtube-read-only@example.com", "youtubereadonly");
  db.prepare(`INSERT OR REPLACE INTO yt_cache
    (key,video_id,updated_at,metadata,score,expires_at,rejected_ids) VALUES (?,?,?,?,?,?,?)`).run(
    youtubeCacheKey(title, artist),
    videoId,
    at,
    JSON.stringify({
      title,
      channel: `${artist} - Topic`,
      reasons: ["artist-channel", "licensed"],
      duration: 204,
      matchVersion: YOUTUBE_MATCH_CACHE_VERSION,
    }),
    100,
    at + 24 * 60 * 60 * 1000,
    "[]",
  );
  let fetches = 0;
  let searches = 0;
  globalThis.fetch = async (url) => {
    fetches += 1;
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith("/search")) searches += 1;
    if (parsed.hostname === "api.deezer.com") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: Number(sourceId),
          title,
          duration: 204,
          artist: { name: artist },
          contributors: [{ name: artist, role: "Main" }],
        }),
      };
    }
    if (parsed.pathname.endsWith("/videos")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [{
          id: videoId,
          snippet: { title, channelTitle: `${artist} - Topic` },
          contentDetails: { duration: "PT3M24S", licensedContent: true },
          status: { embeddable: true, madeForKids: false, privacyStatus: "public" },
          statistics: { viewCount: "1000000" },
        }] }),
      };
    }
    throw new Error(`unexpected read-only fixture endpoint: ${parsed}`);
  };
  const providerTables = ["yt_cache", "provider_cache", "artists", "wikidata_channel_checks", "app_meta"];
  const snapshot = () => Object.fromEntries(providerTables.map((table) => [
    table,
    db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(),
  ]));
  try {
    const before = snapshot();
    const changesBefore = db.prepare("SELECT total_changes() changes").get().changes;
    const read = await routes["GET /api/youtube/track"]({
      user: listener,
      query: { title, artist, provider: "deezer", sourceId, duration: "204" },
      ip: "youtube-read-only",
    });
    assert.deepEqual(read, {
      videoId: null,
      status: "search_deferred",
      retryable: false,
      resolveMethod: "POST",
    });
    assert.equal(fetches, 0, "GET performs no YouTube, Deezer, or Wikidata request");
    assert.equal(db.prepare("SELECT total_changes() changes").get().changes, changesBefore,
      "GET executes no SQLite write even when a tuple row could be source-promoted");
    assert.deepEqual(snapshot(), before, "GET leaves every provider/cache table byte-for-byte equivalent");

    const resolved = await coldYouTubeResolve({
      user: listener,
      query: { title, artist, provider: "deezer", sourceId, duration: 204 },
      ip: "youtube-read-only",
    });
    assert.equal(resolved.videoId, videoId);
    assert.equal(fetches, 2, "POST validates YouTube metadata and exact Deezer credit proof");
    assert.equal(searches, 0, "safe tuple promotion is data-only");
    assert.equal(db.prepare("SELECT value FROM app_meta WHERE key GLOB ?").get(
      `youtube_cold_user:v2:*:${listener.id}`,
    ), undefined, "data-only POST promotion consumes no actor search allowance");
    assert.equal(db.prepare("SELECT video_id FROM yt_cache WHERE key=?").get(
      youtubeCacheKey(title, artist, `deezer:${sourceId}`),
    )?.video_id, videoId);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = previousApiKey;
  }
});

test("Spotify HTTP playback isolates solo and feature tuples while preserving exact staff overrides", async () => {
  const previousApiKey = process.env.YOUTUBE_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.YOUTUBE_API_KEY = "test-key";
  const artist = "Spotify Route Boundary";
  const norm = artist.toLowerCase();
  const title = "Route Parallel Signal";
  const featureTitle = `${title} (feat. Guest Rapper)`;
  const channelId = "UC_spotify_route_boundary";
  const soloSourceId = "RouteSpotifySolo001";
  const featureSourceId = "RouteSpotifyFeature001";
  const unknownSourceId = "RouteSpotifyUnknown001";
  const soloVideoId = "rtspsolo001";
  const featureVideoId = "rtspfeat001";
  const pinVideoId = "rtspin00001";
  const listener = verifiedUser("u_spotify_route_boundary", "spotify-route-boundary@example.com", "spotifyroutebound");
  addUser("u_spotify_route_moderator", "spotify-route-moderator@example.com", "spotifyroutemod");
  db.prepare("UPDATE users SET role='moderator' WHERE id=?").run("u_spotify_route_moderator");
  const moderator = q.userById.get("u_spotify_route_moderator");
  artistStmts.upsert.run(artistRow(norm, {
    name: artist,
    topTracks: [
      { title, url: `https://open.spotify.com/track/${soloSourceId}` },
      { title: featureTitle, url: `https://open.spotify.com/track/${featureSourceId}` },
    ],
  }, "test"));
  artistStmts.setChannel.run(channelId, Date.now(), "youtube_v4", norm);
  invalidateSongIndex();

  const seedTuple = (tupleTitle, videoId, videoTitle) => {
    const at = Date.now();
    db.prepare(`INSERT OR REPLACE INTO yt_cache
      (key,video_id,updated_at,metadata,score,expires_at,rejected_ids) VALUES (?,?,?,?,?,?,?)`).run(
      youtubeCacheKey(tupleTitle, artist),
      videoId,
      at,
      JSON.stringify({
        title: videoTitle,
        channel: `${artist} - Topic`,
        reasons: ["artist-channel", "licensed"],
        matchVersion: YOUTUBE_MATCH_CACHE_VERSION,
      }),
      100,
      at + 24 * 60 * 60 * 1000,
      "[]",
    );
  };
  let fetches = 0;
  let searches = 0;
  const candidates = new Map([
    [soloVideoId, {
      id: soloVideoId,
      snippet: { title, channelTitle: `${artist} - Topic` },
      contentDetails: { duration: "PT3M23S", licensedContent: true },
      status: { embeddable: true, madeForKids: false, privacyStatus: "public" },
      statistics: { viewCount: "900000000" },
    }],
    [featureVideoId, {
      id: featureVideoId,
      snippet: { title: featureTitle, channelTitle: `${artist} - Topic` },
      contentDetails: { duration: "PT3M23S", licensedContent: true },
      status: { embeddable: true, madeForKids: false, privacyStatus: "public" },
      statistics: { viewCount: "1000" },
    }],
  ]);
  globalThis.fetch = async (url) => {
    fetches += 1;
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith("/channels")) {
      return { ok: true, status: 200, json: async () => ({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UU_spotify_route_boundary" } } }] }) };
    }
    if (parsed.pathname.endsWith("/playlistItems")) {
      return { ok: true, status: 200, json: async () => ({ items: [
        { snippet: { title, resourceId: { videoId: soloVideoId } } },
        { snippet: { title: featureTitle, resourceId: { videoId: featureVideoId } } },
      ] }) };
    }
    if (parsed.pathname.endsWith("/videos")) {
      const ids = (parsed.searchParams.get("id") || "").split(",");
      return { ok: true, status: 200, json: async () => ({ items: ids.map((id) => candidates.get(id)).filter(Boolean) }) };
    }
    if (parsed.pathname.endsWith("/search")) {
      searches += 1;
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    }
    throw new Error(`unexpected Spotify route fixture endpoint: ${parsed}`);
  };

  try {
    const sharedBefore = routes["GET /api/admin/health"]({ user: moderator })
      .services.youtubeLookup.search.used;
    const actorRowsBefore = db.prepare("SELECT key,value FROM app_meta WHERE key GLOB ? ORDER BY key")
      .all(`youtube_cold_user:v2:*:${listener.id}`);

    seedTuple(title, featureVideoId, featureTitle);
    assert.deepEqual(await routes["GET /api/youtube/track"]({
      user: listener,
      query: { title, artist, provider: "spotify", sourceId: soloSourceId },
      ip: "spotify-route-feature-to-solo",
    }), {
      videoId: null,
      status: "search_deferred",
      retryable: false,
      resolveMethod: "POST",
    }, "a tuple feature positive is never returned for the Spotify solo source");
    const solo = await coldYouTubeResolve({
      user: listener,
      query: { title, artist, provider: "spotify", sourceId: soloSourceId },
      ip: "spotify-route-feature-to-solo-post",
    });
    assert.equal(solo.videoId, soloVideoId);
    assert.notEqual(solo.videoId, featureVideoId,
      "POST validates the cross-recording tuple then chooses only the exact Spotify solo from local catalogue data");

    seedTuple(featureTitle, soloVideoId, title);
    assert.deepEqual(await routes["GET /api/youtube/track"]({
      user: listener,
      query: { title: featureTitle, artist, provider: "spotify", sourceId: featureSourceId },
      ip: "spotify-route-solo-to-feature",
    }), {
      videoId: null,
      status: "search_deferred",
      retryable: false,
      resolveMethod: "POST",
    }, "a tuple solo positive is never returned for the Spotify feature source");
    const feature = await coldYouTubeResolve({
      user: listener,
      query: { title: featureTitle, artist, provider: "spotify", sourceId: featureSourceId },
      ip: "spotify-route-solo-to-feature-post",
    });
    assert.equal(feature.videoId, featureVideoId);
    assert.notEqual(feature.videoId, soloVideoId,
      "POST validates the cross-recording tuple then chooses only the exact credited Spotify feature");
    assert.equal(searches, 0, "both wrong-cross POST resolutions remain data-only");
    assert.deepEqual(db.prepare("SELECT key,value FROM app_meta WHERE key GLOB ? ORDER BY key")
      .all(`youtube_cold_user:v2:*:${listener.id}`), actorRowsBefore,
    "data-only source correction consumes no listener allowance");
    assert.equal(routes["GET /api/admin/health"]({ user: moderator })
      .services.youtubeLookup.search.used, sharedBefore, "it consumes no shared search allowance");

    const fetchesBeforeUnknown = fetches;
    assert.deepEqual(await coldYouTubeResolve({
      user: listener,
      query: { title, artist, provider: "spotify", sourceId: unknownSourceId },
      ip: "spotify-route-unknown-source",
    }), { videoId: null, status: "search_deferred" });
    assert.equal(fetches, fetchesBeforeUnknown, "an unknown Spotify ID fails before tuple validation or search");
    assert.deepEqual(db.prepare("SELECT key,value FROM app_meta WHERE key GLOB ? ORDER BY key")
      .all(`youtube_cold_user:v2:*:${listener.id}`), actorRowsBefore,
    "a deferred unsupported identity consumes no listener allowance");
    assert.equal(routes["GET /api/admin/health"]({ user: moderator })
      .services.youtubeLookup.search.used, sharedBefore, "it consumes no shared search allowance");
    assert.equal(db.prepare("SELECT 1 FROM yt_cache WHERE key=?").get(
      youtubeCacheKey(title, artist, `spotify:${unknownSourceId}`),
    ), undefined, "unsupported proof cannot create a source cache row");

    const pinned = routes["POST /api/admin/tracks/override"]({
      user: moderator,
      requestId: "spotify-route-unknown-pin",
      body: {
        title,
        artist,
        provider: "spotify",
        sourceId: unknownSourceId,
        url: `https://youtu.be/${pinVideoId}`,
      },
    });
    assert.deepEqual({ videoId: pinned.videoId, provider: pinned.provider, sourceId: pinned.sourceId }, {
      videoId: pinVideoId,
      provider: "spotify",
      sourceId: unknownSourceId,
    });
    assert.deepEqual(await routes["GET /api/youtube/track"]({
      user: listener,
      query: { title, artist, provider: "spotify", sourceId: unknownSourceId },
      ip: "spotify-route-unknown-pinned",
    }), { videoId: pinVideoId, status: "pinned" },
    "an exact staff decision remains authority even when automated Spotify proof is unavailable");
    assert.equal(fetches, fetchesBeforeUnknown);
  } finally {
    globalThis.fetch = previousFetch;
    db.prepare("DELETE FROM track_source_overrides WHERE provider='spotify' AND source_id IN (?,?,?)")
      .run(soloSourceId, featureSourceId, unknownSourceId);
    db.prepare("DELETE FROM yt_cache WHERE key IN (?,?,?,?,?)").run(
      youtubeCacheKey(title, artist),
      youtubeCacheKey(featureTitle, artist),
      youtubeCacheKey(title, artist, `spotify:${soloSourceId}`),
      youtubeCacheKey(featureTitle, artist, `spotify:${featureSourceId}`),
      youtubeCacheKey(title, artist, `spotify:${unknownSourceId}`),
    );
    db.prepare("DELETE FROM provider_cache WHERE key LIKE ?").run(`%${channelId}%`);
    db.prepare("DELETE FROM artists WHERE norm=?").run(norm);
    invalidateSongIndex();
    if (previousApiKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = previousApiKey;
  }
});

test("Unicode staff pins remain isolated at the playback route", async () => {
  const pins = [
    { title: "初恋", artist: "宇多田ヒカル", videoId: "JPpin000001" },
    { title: "群青", artist: "ヨルシカ", videoId: "JPpin000002" },
    { title: "봄날", artist: "방탄소년단", videoId: "KRpin000001" },
  ];
  const insert = db.prepare(`INSERT OR REPLACE INTO track_overrides
    (key,title,artist,video_id,set_by,updated_at) VALUES (?,?,?,?,NULL,?)`);
  try {
    for (const pin of pins) {
      insert.run(trackOverrideKey(pin.title, pin.artist), pin.title, pin.artist, pin.videoId, Date.now());
    }
    for (const [index, pin] of pins.entries()) {
      assert.deepEqual(await routes["GET /api/youtube/track"]({
        query: { title: pin.title, artist: pin.artist },
        ip: `youtube-unicode-pin-${index}`,
      }), { videoId: pin.videoId, status: "pinned" });
    }
  } finally {
    for (const pin of pins) db.prepare("DELETE FROM track_overrides WHERE key=?").run(trackOverrideKey(pin.title, pin.artist));
  }
});

test("track override shadow keys remain safe across rolling deploys and code rollback", async () => {
  const legacy = { title: "Late Legacy Pin", artist: "Rolling Artist", videoId: "legacy00001" };
  const legacyKey = legacyTrackOverrideKey(legacy.title, legacy.artist);
  const currentKey = trackOverrideKey(legacy.title, legacy.artist);
  const moderatorId = "u_track_override_rolling_mod";
  addUser(moderatorId, "track-override-rolling@example.com", "trackoverriderolling");
  db.prepare("UPDATE users SET role='moderator' WHERE id=?").run(moderatorId);
  const moderator = q.userById.get(moderatorId);
  const fresh = { title: "New Rolling Pin", artist: "New Rolling Artist", videoId: "newroll0001" };
  const freshLegacyKey = legacyTrackOverrideKey(fresh.title, fresh.artist);
  const freshCurrentKey = trackOverrideKey(fresh.title, fresh.artist);
  const update = { title: "Rolling Update", artist: "Exact Artist" };
  const updateLegacyKey = legacyTrackOverrideKey(update.title, update.artist);
  const updateCurrentKey = trackOverrideKey(update.title, update.artist);
  const currentWins = { title: "Current Wins", artist: "Exact Artist" };
  const currentWinsLegacyKey = legacyTrackOverrideKey(currentWins.title, currentWins.artist);
  const currentWinsKey = trackOverrideKey(currentWins.title, currentWins.artist);
  const removed = { title: "Rolling Delete", artist: "Exact Artist", videoId: "remove00001" };
  const removedLegacyKey = legacyTrackOverrideKey(removed.title, removed.artist);
  const removedCurrentKey = trackOverrideKey(removed.title, removed.artist);
  const collisionA = { title: "初恋", artist: "宇多田ヒカル", videoId: "collide0001" };
  const collisionB = { title: "群青", artist: "ヨルシカ", videoId: "collide0002" };
  const collisionLegacyKey = legacyTrackOverrideKey(collisionA.title, collisionA.artist);
  const collisionAKey = trackOverrideKey(collisionA.title, collisionA.artist);
  const collisionBKey = trackOverrideKey(collisionB.title, collisionB.artist);
  try {
    db.prepare(`INSERT OR REPLACE INTO track_overrides
      (key,title,artist,video_id,set_by,updated_at) VALUES (?,?,?,?,NULL,?)`)
      .run(legacyKey, legacy.title, legacy.artist, legacy.videoId, Date.now());
    db.prepare("DELETE FROM track_overrides WHERE key=?").run(currentKey);
    const linksBeforeLegacyRead = db.prepare("SELECT COUNT(*) c FROM track_override_compat_links WHERE legacy_key=?")
      .get(legacyKey).c;
    assert.deepEqual(await routes["GET /api/youtube/track"]({
      query: { title: legacy.title, artist: legacy.artist },
      ip: "youtube-rolling-legacy",
    }), { videoId: legacy.videoId, status: "pinned" });
    assert.equal(db.prepare("SELECT video_id FROM track_overrides WHERE key=?").get(currentKey), undefined,
      "GET serves a late exact legacy pin without promoting it into current state");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM track_override_compat_links WHERE legacy_key=?").get(legacyKey).c,
      linksBeforeLegacyRead, "GET never registers compatibility provenance");

    const created = routes["POST /api/admin/tracks/override"]({
      user: moderator,
      body: { title: fresh.title, artist: fresh.artist, url: `https://youtu.be/${fresh.videoId}` },
    });
    assert.equal(created.ok, true);
    assert.equal(created.videoId, fresh.videoId);
    assert.equal(created.confirmedUnavailable, undefined);
    assert.equal(db.prepare("SELECT video_id FROM track_overrides WHERE key=?").get(freshCurrentKey).video_id, fresh.videoId);
    assert.equal(db.prepare("SELECT video_id FROM track_overrides WHERE key=?").get(freshLegacyKey).video_id, fresh.videoId,
      "a new current pin leaves a collision-safe shadow for a rolled-back instance");

    db.prepare(`INSERT OR REPLACE INTO track_overrides
      (key,title,artist,video_id,set_by,updated_at) VALUES (?,?,?,?,NULL,?)`)
      .run(updateCurrentKey, update.title, update.artist, "oldpin00001", 1_000);
    db.prepare(`INSERT OR REPLACE INTO track_overrides
      (key,title,artist,video_id,set_by,updated_at) VALUES (?,?,?,?,NULL,?)`)
      .run(updateLegacyKey, update.title, update.artist, "newpin00001", 2_000);
    assert.deepEqual(await routes["GET /api/youtube/track"]({
      query: { title: update.title, artist: update.artist },
      ip: "youtube-rolling-newer-legacy",
    }), { videoId: "oldpin00001", status: "pinned" });
    assert.equal(db.prepare("SELECT video_id FROM track_overrides WHERE key=?").get(updateCurrentKey).video_id, "oldpin00001",
      "a later legacy write never overwrites an existing exact v2 identity");
    db.prepare("UPDATE track_overrides SET video_id=?,updated_at=? WHERE key=?")
      .run("newpin00002", 3_000, updateLegacyKey);
    assert.equal(db.prepare("SELECT video_id FROM track_overrides WHERE key=?").get(updateCurrentKey).video_id, "oldpin00001",
      "old-process updates fail closed because their intended Unicode identity is unknowable");

    db.prepare(`INSERT OR REPLACE INTO track_overrides
      (key,title,artist,video_id,set_by,updated_at) VALUES (?,?,?,?,NULL,?)`)
      .run(currentWinsKey, currentWins.title, currentWins.artist, "current00001", 5_000);
    db.prepare(`INSERT OR REPLACE INTO track_overrides
      (key,title,artist,video_id,set_by,updated_at) VALUES (?,?,?,?,NULL,?)`)
      .run(currentWinsLegacyKey, currentWins.title, currentWins.artist, "legacy00002", 4_000);
    assert.deepEqual(await routes["GET /api/youtube/track"]({
      query: { title: currentWins.title, artist: currentWins.artist },
      ip: "youtube-rolling-newer-current",
    }), { videoId: "current00001", status: "pinned" });

    routes["POST /api/admin/tracks/override"]({
      user: moderator,
      body: { title: removed.title, artist: removed.artist, url: `https://youtu.be/${removed.videoId}` },
    });
    db.prepare("DELETE FROM track_overrides WHERE key=?").run(removedLegacyKey);
    assert.equal(db.prepare("SELECT video_id FROM track_overrides WHERE key=?").get(removedCurrentKey).video_id, removed.videoId,
      "an old-process unpin cannot delete a v2 identity it cannot prove");
    routes["DELETE /api/admin/tracks/override"]({
      user: moderator,
      body: { title: removed.title, artist: removed.artist },
    });
    assert.equal(db.prepare("SELECT video_id FROM track_overrides WHERE key=?").get(removedCurrentKey), undefined,
      "the current identity-aware unpin removes the exact v2 pin");

    routes["POST /api/admin/tracks/override"]({
      user: moderator,
      body: { title: collisionA.title, artist: collisionA.artist, url: `https://youtu.be/${collisionA.videoId}` },
    });
    routes["POST /api/admin/tracks/override"]({
      user: moderator,
      body: { title: collisionB.title, artist: collisionB.artist, url: `https://youtu.be/${collisionB.videoId}` },
    });
    assert.ok(db.prepare("SELECT COUNT(*) c FROM track_override_compat_links WHERE legacy_key=?").get(collisionLegacyKey).c >= 2,
      "every current identity marks the old ASCII slot as ambiguous");
    // This is the exact UPSERT used by the rolled-back binary: on a collision it
    // changes only the video/timestamp and leaves A's title/artist in the row.
    // The compatibility trigger must therefore refuse to guess that B belongs
    // to A, otherwise one moderator pin corrupts a different Unicode song.
    db.prepare(`INSERT INTO track_overrides (key,title,artist,video_id,set_by,updated_at)
      VALUES (?,?,?,?,NULL,?) ON CONFLICT(key) DO UPDATE SET
        video_id=excluded.video_id,set_by=excluded.set_by,updated_at=excluded.updated_at`)
      .run(collisionLegacyKey, collisionB.title, collisionB.artist, "collide0003", 9_000);
    assert.equal(db.prepare("SELECT video_id FROM track_overrides WHERE key=?").get(collisionAKey).video_id, collisionA.videoId);
    assert.equal(db.prepare("SELECT video_id FROM track_overrides WHERE key=?").get(collisionBKey).video_id, collisionB.videoId,
      "an ambiguous old write fails closed without corrupting either v2 pin");
    assert.deepEqual(await routes["GET /api/youtube/track"]({
      query: { title: collisionA.title, artist: collisionA.artist },
      ip: "youtube-rolling-collision-read",
    }), { videoId: collisionA.videoId, status: "pinned" },
    "playback must ignore an ambiguous legacy row even when its stale labels match");
    db.prepare("DELETE FROM track_overrides WHERE key=?").run(collisionLegacyKey);
    assert.equal(db.prepare("SELECT video_id FROM track_overrides WHERE key=?").get(collisionAKey).video_id, collisionA.videoId);
    assert.equal(db.prepare("SELECT video_id FROM track_overrides WHERE key=?").get(collisionBKey).video_id, collisionB.videoId,
      "an ambiguous old unpin cannot delete either exact Unicode identity");
  } finally {
    for (const key of [legacyKey, currentKey, freshLegacyKey, freshCurrentKey, updateLegacyKey, updateCurrentKey,
      currentWinsLegacyKey, currentWinsKey, removedLegacyKey, removedCurrentKey, collisionLegacyKey, collisionAKey, collisionBKey]) {
      db.prepare("DELETE FROM track_overrides WHERE key=?").run(key);
    }
    for (const key of [legacyKey, freshLegacyKey, updateLegacyKey, currentWinsLegacyKey, removedLegacyKey, collisionLegacyKey]) {
      db.prepare("DELETE FROM track_override_compat_links WHERE legacy_key=?").run(key);
    }
  }
});

test("terminal iframe failures quarantine only the reporting listener and never let forged IDs poison shared playback", async () => {
  const previousApiKey = process.env.YOUTUBE_API_KEY;
  delete process.env.YOUTUBE_API_KEY;
  const reporter = verifiedUser("u_youtube_terminal_reporter", "youtube-terminal-reporter@example.com", "ytterminalreporter");
  const other = verifiedUser("u_youtube_terminal_other", "youtube-terminal-other@example.com", "ytterminalother");
  const pinned = { title: "Pinned Failure Boundary", artist: "Pinned Failure Artist", videoId: "deadpin0001" };
  const cached = { title: "Cached Forgery Boundary", artist: "Cached Forgery Artist", videoId: "cachegood01" };
  const pinnedKey = trackOverrideKey(pinned.title, pinned.artist);
  const cachedKey = youtubeCacheKey(cached.title, cached.artist);
  try {
    db.prepare(`INSERT OR REPLACE INTO track_overrides
      (key,title,artist,video_id,set_by,updated_at) VALUES (?,?,?,?,NULL,?)`)
      .run(pinnedKey, pinned.title, pinned.artist, pinned.videoId, Date.now());
    const cachedAt = Date.now();
    db.prepare(`INSERT OR REPLACE INTO yt_cache
      (key,video_id,updated_at,metadata,score,expires_at,rejected_ids) VALUES (?,?,?,?,?,?,?)`)
      .run(cachedKey, cached.videoId, cachedAt, JSON.stringify({
        title: `${cached.artist} - ${cached.title}`,
        channel: `${cached.artist} - Topic`,
        reasons: ["official"],
        duration: 180,
        matchVersion: YOUTUBE_MATCH_CACHE_VERSION,
      }), 99, cachedAt + 24 * 60 * 60 * 1000, "[]");

    assert.deepEqual(await routes["GET /api/youtube/track"]({
      user: reporter,
      query: { title: pinned.title, artist: pinned.artist },
      ip: "youtube-terminal-before",
    }), { videoId: pinned.videoId, status: "pinned" });
    assert.deepEqual(routes["POST /api/youtube/invalidate"]({
      user: reporter,
      body: pinned,
      ip: "youtube-terminal-invalidate",
    }), { ok: true, quarantined: true, globallyInvalidated: false });

    const reporterRetry = await routes["GET /api/youtube/track"]({
      user: reporter,
      query: { title: pinned.title, artist: pinned.artist },
      ip: "youtube-terminal-after",
    });
    assert.notEqual(reporterRetry.videoId, pinned.videoId, "the same listener never receives the failed pin again");
    assert.deepEqual(await routes["GET /api/youtube/track"]({
      user: other,
      query: { title: pinned.title, artist: pinned.artist },
      ip: "youtube-terminal-other",
    }), { videoId: pinned.videoId, status: "pinned" }, "one client cannot destroy a staff pin for everyone");
    const guestRetry = await routes["GET /api/youtube/track"]({
      query: { title: pinned.title, artist: pinned.artist, exclude: pinned.videoId },
      ip: "youtube-terminal-guest",
    });
    assert.notEqual(guestRetry.videoId, pinned.videoId, "an anonymous device can response-locally skip its failed pin");

    routes["POST /api/youtube/invalidate"]({
      user: reporter,
      body: { title: cached.title, artist: cached.artist, videoId: "forgedid001" },
      ip: "youtube-terminal-forged",
    });
    assert.deepEqual(await routes["GET /api/youtube/track"]({
      user: reporter,
      query: { title: cached.title, artist: cached.artist },
      ip: "youtube-terminal-cache",
    }), { videoId: cached.videoId, status: "cached", confidence: 99 }, "forged B cannot alter healthy cached A");
    assert.equal(db.prepare("SELECT video_id FROM yt_cache WHERE key=?").get(cachedKey).video_id, cached.videoId);

    routes["POST /api/youtube/invalidate"]({
      user: reporter,
      body: { title: cached.title, artist: cached.artist, videoId: cached.videoId },
      ip: "youtube-terminal-cached-a",
    });
    const actorScopedRetry = await routes["GET /api/youtube/track"]({
      user: reporter,
      query: { title: cached.title, artist: cached.artist },
      ip: "youtube-terminal-cached-retry",
    });
    assert.notEqual(actorScopedRetry.videoId, cached.videoId);
    assert.deepEqual(await routes["GET /api/youtube/track"]({
      user: other,
      query: { title: cached.title, artist: cached.artist },
      ip: "youtube-terminal-cache-other",
    }), { videoId: cached.videoId, status: "cached", confidence: 99 });
    assert.deepEqual({ ...db.prepare("SELECT video_id,rejected_ids FROM yt_cache WHERE key=?").get(cachedKey) }, {
      video_id: cached.videoId,
      rejected_ids: "[]",
    }, "an actor-local failure never mutates the shared cache row");
  } finally {
    db.prepare("DELETE FROM track_overrides WHERE key=?").run(pinnedKey);
    db.prepare("DELETE FROM yt_cache WHERE key=?").run(cachedKey);
    if (previousApiKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = previousApiKey;
  }
});

test("YouTube track API replaces a retired wrong-uploader cache row with the official J. Cole recording", async () => {
  const previousApiKey = process.env.YOUTUBE_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.YOUTUBE_API_KEY = "test-key";
  const title = "MIDDLE CHILD";
  const artist = "J. Cole";
  const wrongId = "Bu5DMJ8LJnk";
  const officialId = "e8CLsYzE5wk";
  const at = Date.now();
  const oldKey = `yt:v3:${JSON.stringify([
    normalizeYouTubeCacheText(artist),
    normalizeYouTubeCacheText(title),
  ])}`;
  db.prepare(`INSERT OR REPLACE INTO yt_cache
    (key,video_id,updated_at,metadata,score,expires_at,rejected_ids)
    VALUES (?,?,?,?,?,?,?)`).run(
    oldKey,
    wrongId,
    at,
    JSON.stringify({ title: "J. Cole - MIDDLE CHILD", channel: "HNM Magazine", reasons: ["title-match"] }),
    97,
    at + 7 * 24 * 60 * 60 * 1000,
    "[]",
  );
  if (!artistStmts.byNorm.get("j. cole")) {
    artistStmts.upsert.run(artistRow("J. Cole", { name: "J. Cole" }, "test"));
  }
  artistStmts.setChannel.run(null, at, "youtube_v4", "j. cole");

  let oldValidations = 0;
  let searches = 0;
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith("/search")) {
      searches += 1;
      assert.equal(parsed.searchParams.get("type"), "video");
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [
          { id: { videoId: wrongId } },
          { id: { videoId: officialId } },
        ] }),
      };
    }
    if (parsed.pathname.endsWith("/videos")) {
      const ids = (parsed.searchParams.get("id") || "").split(",").filter(Boolean);
      if (ids.includes(wrongId)) oldValidations += 1;
      const candidates = [
        {
          id: wrongId,
          snippet: { title: "J. Cole - MIDDLE CHILD", channelTitle: "HNM Magazine" },
          contentDetails: { duration: "PT3M33S", licensedContent: true },
          status: { embeddable: true, madeForKids: false, privacyStatus: "public" },
          statistics: { viewCount: "9000000" },
        },
        {
          id: officialId,
          snippet: { title: "J. Cole - MIDDLE CHILD (Official Audio)", channelTitle: "J. Cole - Topic" },
          contentDetails: { duration: "PT3M34S", licensedContent: true },
          status: { embeddable: true, madeForKids: false, privacyStatus: "public" },
          statistics: { viewCount: "200000000" },
        },
      ];
      return { ok: true, status: 200, json: async () => ({ items: candidates.filter((item) => ids.includes(item.id)) }) };
    }
    throw new Error(`unexpected YouTube endpoint: ${parsed.pathname}`);
  };

  try {
    const user = verifiedUser("u_youtube_recording_regression", "youtube-recording-regression@example.com", "ytrecordingfix");
    const readPhase = await routes["GET /api/youtube/track"]({
      user,
      query: { title, artist, duration: "214" },
      ip: "youtube-recording-regression",
    });
    assert.deepEqual(readPhase, {
      videoId: null,
      status: "search_deferred",
      retryable: false,
      resolveMethod: "POST",
    });
    assert.equal(searches, 0, "GET validates cache state but never reaches search.list");
    const result = await coldYouTubeResolve({
      user,
      query: { title, artist, duration: "214" },
      ip: "youtube-recording-regression",
    });
    assert.equal(result.videoId, officialId);
    assert.equal(result.status, "resolved");
    assert.equal(oldValidations, 1, "the two-phase API route validates the retired ID only once");
    assert.equal(searches, 1);
    assert.equal(db.prepare("SELECT 1 FROM yt_cache WHERE key=?").get(oldKey), undefined);
    const cached = db.prepare("SELECT video_id,metadata,rejected_ids FROM yt_cache WHERE key=?")
      .get(youtubeCacheKey(title, artist));
    assert.equal(cached.video_id, officialId);
    assert.equal(JSON.parse(cached.metadata).matchVersion, YOUTUBE_MATCH_CACHE_VERSION);
    assert.ok(JSON.parse(cached.rejected_ids).includes(wrongId));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = previousApiKey;
  }
});

test("source-scoped moderation repairs one exact recording without affecting its sibling", async () => {
  const previousApiKey = process.env.YOUTUBE_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.YOUTUBE_API_KEY = "test-key";
  const title = "Source Scoped Shared Recording";
  const artist = "Source Scoped Pop Artist";
  const norm = artist.toLowerCase();
  const channelId = "UC_source_override_route";
  const uploadsId = "UU_source_override_route";
  const tuplePinId = "tuplepin001";
  const exactPinId = "exactpin001";
  const soloId = "rtesolo0001";
  const featureId = "rtefeat0001";
  const soloSourceId = "8124841682";
  const featureSourceId = "8234638792";
  const candidate = (id, candidateTitle, views) => ({
    id,
    snippet: { title: candidateTitle, channelTitle: `${artist} - Topic` },
    contentDetails: { duration: "PT3M48S", licensedContent: true },
    status: { embeddable: true, madeForKids: false, privacyStatus: "public" },
    statistics: { viewCount: String(views) },
  });
  const candidates = [
    candidate(soloId, title, 900_000_000),
    candidate(featureId, `${title} (feat. Guest Rapper)`, 1_000),
  ];
  artistStmts.upsert.run(artistRow(norm, { name: artist }, "test"));
  artistStmts.setChannel.run(channelId, Date.now(), "youtube_v4", norm);
  const moderatorId = "u_source_override_mod";
  addUser(moderatorId, "source-override-mod@example.com", "sourceoverridemod");
  db.prepare("UPDATE users SET role='moderator' WHERE id=?").run(moderatorId);
  const moderator = q.userById.get(moderatorId);
  const listener = verifiedUser("u_source_override_listener", "source-override-listener@example.com", "sourceoverridelistener");
  db.prepare(`INSERT OR REPLACE INTO track_overrides
    (key,title,artist,video_id,set_by,updated_at) VALUES (?,?,?,?,NULL,?)`)
    .run(trackOverrideKey(title, artist), title, artist, tuplePinId, Date.now());
  let deezerCalls = 0;
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === "api.deezer.com") {
      const sourceId = parsed.pathname.split("/").pop();
      deezerCalls += 1;
      const featured = sourceId === featureSourceId;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: sourceId,
          title,
          duration: 228,
          artist: { name: artist },
          contributors: featured
            ? [{ name: artist, role: "Main" }, { name: "Guest Rapper", role: "Featured" }]
            : [{ name: artist, role: "Main" }],
        }),
      };
    }
    if (parsed.pathname.endsWith("/channels")) {
      return { ok: true, status: 200, json: async () => ({ items: [{ contentDetails: { relatedPlaylists: { uploads: uploadsId } } }] }) };
    }
    if (parsed.pathname.endsWith("/playlistItems")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: candidates.map((item) => ({
          snippet: { title: item.snippet.title, resourceId: { videoId: item.id } },
        })) }),
      };
    }
    if (parsed.pathname.endsWith("/videos")) {
      const ids = new Set((parsed.searchParams.get("id") || "").split(","));
      return { ok: true, status: 200, json: async () => ({ items: candidates.filter((item) => ids.has(item.id)) }) };
    }
    throw new Error(`unexpected provider request: ${parsed}`);
  };

  try {
    assert.deepEqual(await routes["GET /api/youtube/track"]({
      query: { title, artist },
      ip: "youtube-source-pin-legacy",
    }), { videoId: tuplePinId, status: "pinned" }, "a title/artist-only request keeps legacy moderation behavior");

    assert.deepEqual(await routes["GET /api/youtube/track"]({
      user: listener,
      query: { title, artist, provider: "deezer", sourceId: soloSourceId },
      ip: "youtube-source-pin-solo",
    }), { videoId: null, status: "search_deferred", retryable: false, resolveMethod: "POST" });
    const solo = await coldYouTubeResolve({
      user: listener,
      query: { title, artist, provider: "deezer", sourceId: soloSourceId },
      ip: "youtube-source-pin-solo",
    });
    assert.equal(solo.videoId, soloId);
    assert.equal(solo.status, "artist_catalogue");

    assert.deepEqual(await routes["GET /api/youtube/track"]({
      user: listener,
      query: { title, artist, provider: "deezer", sourceId: featureSourceId },
      ip: "youtube-source-pin-feature",
    }), { videoId: null, status: "search_deferred", retryable: false, resolveMethod: "POST" });
    const feature = await coldYouTubeResolve({
      user: listener,
      query: { title, artist, provider: "deezer", sourceId: featureSourceId },
      ip: "youtube-source-pin-feature",
    });
    assert.equal(feature.videoId, featureId,
      "a feature source must be resolved from authoritative credit proof, not receive the solo tuple pin");
    assert.equal(feature.status, "artist_catalogue");
    assert.equal(deezerCalls, 2);

    const featureCacheKey = youtubeCacheKey(title, artist, `deezer:${featureSourceId}`);
    const soloCacheKey = youtubeCacheKey(title, artist, `deezer:${soloSourceId}`);
    db.prepare(`UPDATE yt_cache SET video_id=?,metadata=?,score=99,updated_at=?,expires_at=? WHERE key=?`)
      .run(
        tuplePinId,
        JSON.stringify({ title, channel: `${artist} - Topic`, reasons: ["official"], duration: 228, matchVersion: YOUTUBE_MATCH_CACHE_VERSION }),
        Date.now(),
        Date.now() + 24 * 60 * 60 * 1000,
        featureCacheKey,
      );
    assert.equal(db.prepare("SELECT video_id FROM yt_cache WHERE key=?").get(featureCacheKey).video_id, tuplePinId,
      "the fixture begins with a wrong source-scoped resolver cache row");

    const report = (sourceId, ip) => routes["POST /api/tracks/report"]({
      user: listener,
      ip,
      body: { title, artist, category: "wrong_video", provider: "deezer", sourceId },
    });
    const featureReport = report(featureSourceId, "source-override-report-feature");
    const soloReport = report(soloSourceId, "source-override-report-solo");
    const pinned = routes["POST /api/admin/tracks/override"]({
      user: moderator,
      requestId: "source-override-pin",
      body: { title, artist, provider: "deezer", sourceId: featureSourceId, url: `https://youtu.be/${exactPinId}` },
    });
    assert.deepEqual({ videoId: pinned.videoId, provider: pinned.provider, sourceId: pinned.sourceId }, {
      videoId: exactPinId,
      provider: "deezer",
      sourceId: featureSourceId,
    });
    assert.equal(db.prepare("SELECT 1 FROM yt_cache WHERE key=?").get(featureCacheKey), undefined,
      "a trusted source pin deletes the exact stale resolver row instead of writing a long-lived negative");
    assert.equal(db.prepare("SELECT video_id FROM yt_cache WHERE key=?").get(soloCacheKey).video_id, soloId,
      "the same-title sibling cache remains isolated");
    assert.equal(db.prepare("SELECT status FROM reports WHERE id=?").get(featureReport.id).status, "actioned");
    assert.equal(db.prepare("SELECT status FROM reports WHERE id=?").get(soloReport.id).status, "open",
      "a source pin closes only reports for that exact provider recording");

    const callsBeforePinnedGet = deezerCalls;
    assert.deepEqual(await routes["GET /api/youtube/track"]({
      query: { title, artist, provider: "deezer", sourceId: featureSourceId },
      ip: "youtube-source-exact-pin",
    }), { videoId: exactPinId, status: "pinned" });
    assert.equal(deezerCalls, callsBeforePinnedGet, "an exact staff pin applies immediately before provider/cache resolution");
    const siblingAfterPin = await routes["GET /api/youtube/track"]({
      query: { title, artist, provider: "deezer", sourceId: soloSourceId },
      ip: "youtube-source-sibling-after-pin",
    });
    assert.equal(siblingAfterPin.videoId, soloId);
    assert.notEqual(siblingAfterPin.videoId, exactPinId);

    db.prepare("UPDATE track_overrides SET video_id=NULL WHERE key=?")
      .run(trackOverrideKey(title, artist));
    assert.deepEqual(await routes["GET /api/youtube/track"]({
      query: { title, artist, provider: "deezer", sourceId: featureSourceId },
      ip: "youtube-source-exact-over-old-null",
    }), { videoId: exactPinId, status: "pinned" },
    "a newer exact source repair wins over an older ambiguous tuple-level unavailable decision");
    db.prepare("UPDATE track_overrides SET video_id=? WHERE key=?")
      .run(tuplePinId, trackOverrideKey(title, artist));

    const listed = routes["GET /api/admin/tracks/overrides"]({ user: moderator }).overrides
      .find((entry) => entry.key === trackSourceOverrideKey("deezer", featureSourceId));
    assert.deepEqual({ provider: listed.provider, sourceId: listed.sourceId, videoId: listed.videoId }, {
      provider: "deezer", sourceId: featureSourceId, videoId: exactPinId,
    });
    assert.throws(() => routes["DELETE /api/admin/tracks/override"]({
      user: moderator,
      requestId: "source-override-stale-unpin",
      body: { title: "Stale Different Song", artist, provider: "deezer", sourceId: featureSourceId },
    }), (error) => error.status === 409 && error.code === "CONFLICT");
    assert.equal(db.prepare("SELECT video_id FROM track_source_overrides WHERE provider='deezer' AND source_id=?")
      .get(featureSourceId).video_id, exactPinId,
    "a stale moderation row cannot delete a provider ID rebound to different metadata");

    routes["POST /api/youtube/invalidate"]({
      user: listener,
      ip: "youtube-source-terminal",
      body: { title, artist, videoId: exactPinId, provider: "deezer", sourceId: featureSourceId },
    });
    const terminalFailure = db.prepare(`SELECT track_key FROM youtube_playback_failures
      WHERE user_id=? AND video_id=?`).get(listener.id, exactPinId);
    assert.equal(terminalFailure.track_key, trackSourceOverrideKey("deezer", featureSourceId));
    const terminalReport = db.prepare(`SELECT reason FROM reports
      WHERE reporter_id=? AND target_id=? AND status='open' ORDER BY created_at DESC LIMIT 1`)
      .get(listener.id, trackSourceOverrideKey("deezer", featureSourceId));
    assert.deepEqual(
      (({ provider, sourceId }) => ({ provider, sourceId }))(JSON.parse(terminalReport.reason)),
      { provider: "deezer", sourceId: featureSourceId },
      "terminal playback reports retain exact source identity for moderation",
    );
    db.prepare("UPDATE track_overrides SET video_id=NULL WHERE key=?")
      .run(trackOverrideKey(title, artist));
    const repairedRead = await routes["GET /api/youtube/track"]({
      user: listener,
      query: { title, artist, provider: "deezer", sourceId: featureSourceId },
      ip: "youtube-source-terminal-alternate",
    });
    assert.equal(repairedRead.status, "search_deferred");
    const repairedAfterTerminal = await coldYouTubeResolve({
      user: listener,
      query: { title, artist, provider: "deezer", sourceId: featureSourceId },
      ip: "youtube-source-terminal-alternate",
    });
    assert.equal(repairedAfterTerminal.videoId, featureId,
      "a failed exact source pin still resolves an alternate instead of inheriting an older tuple NULL");
    assert.notEqual(repairedAfterTerminal.status, "confirmed_unavailable");
    db.prepare("UPDATE track_overrides SET video_id=? WHERE key=?")
      .run(tuplePinId, trackOverrideKey(title, artist));
    assert.equal((await routes["GET /api/youtube/track"]({
      user: listener,
      query: { title, artist, provider: "deezer", sourceId: soloSourceId },
      ip: "youtube-source-terminal-sibling",
    })).videoId, soloId, "a terminal rejection cannot cross to a sibling source");

    routes["DELETE /api/admin/tracks/override"]({
      user: moderator,
      requestId: "source-override-unpin",
      body: { title, artist, provider: "deezer", sourceId: featureSourceId },
    });
    assert.equal(db.prepare("SELECT 1 FROM track_source_overrides WHERE provider='deezer' AND source_id=?").get(featureSourceId), undefined);
    const afterUnpin = await coldYouTubeResolve({
      user: listener,
      query: { title, artist, provider: "deezer", sourceId: featureSourceId },
      ip: "youtube-source-after-unpin",
    });
    assert.equal(afterUnpin.videoId, featureId, "unpin immediately re-enters exact provider proof resolution");
    assert.notEqual(afterUnpin.status, "not_found");

    db.prepare("UPDATE track_overrides SET video_id=NULL WHERE key=?")
      .run(trackOverrideKey(title, artist));
    assert.deepEqual(await routes["GET /api/youtube/track"]({
      query: { title, artist, provider: "deezer", sourceId: featureSourceId },
      ip: "youtube-source-global-unavailable",
    }), { videoId: null, status: "confirmed_unavailable" },
    "a provider query cannot bypass a global confirmed-unavailable moderation outcome");
  } finally {
    globalThis.fetch = previousFetch;
    db.prepare("DELETE FROM track_overrides WHERE key IN (?,?)")
      .run(trackOverrideKey(title, artist), legacyTrackOverrideKey(title, artist));
    db.prepare("DELETE FROM track_override_compat_links WHERE current_key=?")
      .run(trackOverrideKey(title, artist));
    db.prepare("DELETE FROM track_source_overrides WHERE provider='deezer' AND source_id IN (?,?)")
      .run(soloSourceId, featureSourceId);
    db.prepare("DELETE FROM artists WHERE norm=?").run(norm);
    db.prepare("DELETE FROM provider_cache WHERE key LIKE ? OR key LIKE ? OR key LIKE ?")
      .run(`%${channelId}%`, `%${soloSourceId}%`, `%${featureSourceId}%`);
    if (previousApiKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = previousApiKey;
  }
});

test("stable media creation rejects disabled video before reserving a ticket and leaves photos available", () => {
  const user = addUser("u_media_capability_route", "media-capability-route@example.com", "mediacaproute");
  const environmentKeys = [
    "PIT_VIDEO_PUBLISHING_ENABLED",
    "MEDIA_ENDPOINT",
    "MEDIA_BUCKET",
    "MEDIA_SOURCE_BUCKET",
    "MEDIA_REGION",
    "MEDIA_ACCESS_KEY_ID",
    "MEDIA_SECRET_ACCESS_KEY",
    "MEDIA_PUBLIC_BASE_URL",
  ];
  const previous = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    MEDIA_ENDPOINT: "https://objects.example.com/s3",
    MEDIA_BUCKET: "pit-capability-test",
    MEDIA_SOURCE_BUCKET: "pit-capability-test-private",
    MEDIA_REGION: "auto",
    MEDIA_ACCESS_KEY_ID: "capability-test-access",
    MEDIA_SECRET_ACCESS_KEY: "capability-test-secret",
    MEDIA_PUBLIC_BASE_URL: "https://media.example.com/capability",
  });
  const count = (table) => db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE owner_id=?`).get(user.id).count;
  const before = {
    assets: count("media_assets"),
    objects: count("media_objects"),
    issuances: count("media_upload_issuances"),
  };
  try {
    for (const [index, flag] of [undefined, "tru"].entries()) {
      if (flag === undefined) delete process.env.PIT_VIDEO_PUBLISHING_ENABLED;
      else process.env.PIT_VIDEO_PUBLISHING_ENABLED = flag;
      assert.throws(
        () => routes["POST /api/media/assets"]({
          user,
          ip: `media-capability-video-${index}`,
          body: {
            clientAssetId: `media-capability-video-${index}`,
            purpose: "post",
            contentType: "video/mp4",
            fileSize: 2_048,
            name: "blocked.mp4",
          },
        }),
        (error) => error.status === 415
          && error.code === "MEDIA_TYPE_UNSUPPORTED"
          && /being prepared/i.test(error.message),
      );
    }
    assert.deepEqual({
      assets: count("media_assets"),
      objects: count("media_objects"),
      issuances: count("media_upload_issuances"),
    }, before, "disabled video must not reserve, persist, or sign a source ticket");

    process.env.PIT_VIDEO_PUBLISHING_ENABLED = "tru";
    const photo = routes["POST /api/media/assets"]({
      user,
      ip: "media-capability-photo",
      body: {
        clientAssetId: "media-capability-photo",
        purpose: "post",
        contentType: "image/jpeg",
        fileSize: 2_048,
        name: "available.jpg",
      },
    });
    assert.equal(photo.asset.kind, "image");
    assert.equal(typeof photo.upload?.uploadUrl, "string");
    assert.equal(count("media_assets"), before.assets + 1);
    assert.equal(count("media_objects"), before.objects + 1);
    assert.equal(count("media_upload_issuances"), before.issuances + 1);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("owner media polling isolates, joins, completes, safely fails, and resumes after coordinator restart", async () => {
  const owner = addUser("u_video_finalize_poll", "video-finalize-poll@example.com", "videofinalizepoll");
  const stranger = addUser("u_video_finalize_stranger", "video-finalize-stranger@example.com", "videofinalizestranger");
  const keys = [
    "MEDIA_ENDPOINT", "MEDIA_BUCKET", "MEDIA_SOURCE_BUCKET", "MEDIA_REGION",
    "MEDIA_ACCESS_KEY_ID", "MEDIA_SECRET_ACCESS_KEY", "MEDIA_PUBLIC_BASE_URL",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, {
      MEDIA_ENDPOINT: "https://objects.example.com/s3",
      MEDIA_BUCKET: "pit-finalize-poll",
      MEDIA_SOURCE_BUCKET: "pit-finalize-poll-private",
      MEDIA_REGION: "auto",
      MEDIA_ACCESS_KEY_ID: "finalize-poll-access",
      MEDIA_SECRET_ACCESS_KEY: "finalize-poll-secret",
      MEDIA_PUBLIC_BASE_URL: "https://media.example.com/finalize-poll",
    });
    resetVideoFinalizeJobsForTests();
    const createDraft = (clientAssetId) => routes["POST /api/media/assets"]({
      user: owner,
      ip: `finalize-poll-${clientAssetId}`,
      body: {
        clientAssetId,
        purpose: "post",
        contentType: "image/jpeg",
        fileSize: 2_048,
        name: `${clientAssetId}.jpg`,
      },
    }).asset;

    const completing = createDraft("finalize-poll-completing");
    const gate = deferred();
    let runs = 0;
    const first = startVideoFinalizeJob({
      ownerId: owner.id,
      assetId: completing.id,
      fingerprint: "a".repeat(64),
      run: async () => {
        runs += 1;
        await gate.promise;
        db.prepare("UPDATE media_assets SET status='ready',render_state='ready',updated_at=? WHERE id=? AND owner_id=?")
          .run(Date.now(), completing.id, owner.id);
        return { asset: { id: completing.id, status: "ready" } };
      },
    });
    const joined = startVideoFinalizeJob({
      ownerId: owner.id,
      assetId: completing.id,
      fingerprint: "a".repeat(64),
      run: async () => { runs += 100; },
    });
    assert.equal(first.joined, false);
    assert.equal(joined.joined, true);
    assert.throws(() => startVideoFinalizeJob({
      ownerId: owner.id,
      assetId: completing.id,
      fingerprint: "b".repeat(64),
      run: async () => {},
    }), (error) => error.status === 409 && error.code === "CONFLICT");
    await Promise.resolve();
    assert.equal(runs, 1, "same-operation retries share exactly one background job");
    assert.deepEqual(routes["GET /api/media/assets/:id"]({
      user: owner,
      ip: "finalize-poll-processing",
      params: { id: completing.id },
    }).finalize, { state: "processing" });
    assert.throws(() => routes["GET /api/media/assets/:id"]({
      user: stranger,
      ip: "finalize-poll-owner-isolation",
      params: { id: completing.id },
    }), (error) => error.status === 404 && error.code === "NOT_FOUND");
    gate.resolve();
    const completed = await eventually(
      () => routes["GET /api/media/assets/:id"]({
        user: owner,
        ip: "finalize-poll-completed",
        params: { id: completing.id },
      }),
      (value) => value.finalize.state === "completed",
    );
    assert.equal(completed.asset.status, "ready");

    const failing = createDraft("finalize-poll-failing");
    startVideoFinalizeJob({
      ownerId: owner.id,
      assetId: failing.id,
      fingerprint: "c".repeat(64),
      run: async () => { throw new Error("secret=https://private.example/token"); },
    });
    const failed = await eventually(
      () => routes["GET /api/media/assets/:id"]({
        user: owner,
        ip: "finalize-poll-failed",
        params: { id: failing.id },
      }),
      (value) => value.finalize.state === "failed",
    );
    assert.deepEqual(failed.finalize.error, {
      code: "INTERNAL_ERROR",
      status: 500,
      message: "Clip processing failed on our end. Try again.",
      retryable: true,
    });
    assert.equal(JSON.stringify(failed).includes("private.example"), false);
    resetVideoFinalizeJobsForTests();
    assert.deepEqual(routes["GET /api/media/assets/:id"]({
      user: owner,
      ip: "finalize-poll-restart",
      params: { id: failing.id },
    }).finalize, { state: "idle" }, "a process restart safely invites an idempotent resubmission");
  } finally {
    resetVideoFinalizeJobsForTests();
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("normal media preparation routes have no hidden per-member count buckets", async () => {
  const user = addUser("u_media_count_free", "media-count-free@example.com", "mediacountfree");
  const keys = [
    "MEDIA_ENDPOINT", "MEDIA_BUCKET", "MEDIA_SOURCE_BUCKET", "MEDIA_REGION",
    "MEDIA_ACCESS_KEY_ID", "MEDIA_SECRET_ACCESS_KEY", "MEDIA_PUBLIC_BASE_URL",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  try {
    Object.assign(process.env, {
      MEDIA_ENDPOINT: "https://objects.example.com/s3",
      MEDIA_BUCKET: "pit-count-free",
      MEDIA_SOURCE_BUCKET: "pit-count-free-private",
      MEDIA_REGION: "auto",
      MEDIA_ACCESS_KEY_ID: "count-free-access",
      MEDIA_SECRET_ACCESS_KEY: "count-free-secret",
      MEDIA_PUBLIC_BASE_URL: "https://media.example.com/count-free",
    });
    resetRateLimitsForTests();
    const renderVariants = [];
    for (let index = 0; index < 40; index += 1) {
      const created = routes["POST /api/media/assets"]({
        user,
        ip: `media-count-create-${index}`,
        body: {
          clientAssetId: `media-count-source-${index}`,
          purpose: "post",
          contentType: "image/jpeg",
          fileSize: 2_048,
          name: `media-count-source-${index}.jpg`,
        },
      });
      db.prepare(`UPDATE media_assets SET status='render_pending',render_state='pending',finalize_hash=?,
        width=1,height=1,orientation=0,metadata_status='declared',updated_at=? WHERE id=? AND owner_id=?`)
        .run(`count-finalize-${index}`, Date.now(), created.asset.id, user.id);
      renderVariants.push(routes["POST /api/media/assets/:id/variants"]({
        user,
        ip: `media-count-variant-${index}`,
        params: { id: created.asset.id },
        body: {
          clientVariantId: `media-count-render-${index}`,
          role: "render",
          contentType: "image/jpeg",
          fileSize: 1_024,
          name: `media-count-render-${index}.jpg`,
        },
      }));
    }
    assert.equal(renderVariants.length, 40, "more than thirty normal photo renders are admitted");
    assert.equal(renderVariants.every((entry) => entry.variant.status === "upload_pending"), true);

    // PATCH is part of every normal upload, reads are the async video polling
    // path, and source/variant finalize are safe retries. None may become a
    // hidden member plan merely because the caller crossed an arbitrary count.
    const patchAsset = renderVariants[0].asset?.id
      || db.prepare("SELECT id FROM media_assets WHERE owner_id=? AND client_asset_id=?")
        .get(user.id, "media-count-source-0").id;
    for (let index = 0; index < 65; index += 1) {
      const patched = routes["PATCH /api/media/assets/:id"]({
        user,
        ip: "media-count-patch",
        params: { id: patchAsset },
        body: { altText: `count-free-${index}` },
      });
      assert.notEqual(patched?.asset?.status, undefined);
    }
    for (let index = 0; index < 300; index += 1) {
      assert.equal(routes["GET /api/media/assets/:id"]({
        user,
        ip: "media-count-poll",
        params: { id: patchAsset },
      }).asset.id, patchAsset);
    }

    globalThis.fetch = async () => new Response(null, { status: 503 });
    const sourceFinalizeAsset = routes["POST /api/media/assets"]({
      user,
      ip: "media-count-source-finalize-create",
      body: {
        clientAssetId: "media-count-source-finalize",
        purpose: "post",
        contentType: "image/jpeg",
        fileSize: 2_048,
        name: "media-count-source-finalize.jpg",
      },
    }).asset;
    for (let index = 0; index < 65; index += 1) {
      await assert.rejects(routes["POST /api/media/assets/:id/finalize"]({
        user,
        ip: "media-count-source-finalize",
        params: { id: sourceFinalizeAsset.id },
        body: { width: 1, height: 1, orientation: 0, editRecipe: {} },
      }), (error) => error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE");
    }
    const variant = renderVariants[0].variant;
    for (let index = 0; index < 65; index += 1) {
      await assert.rejects(routes["POST /api/media/assets/:id/variants/:variantId/finalize"]({
        user,
        ip: "media-count-variant-finalize",
        params: { id: patchAsset, variantId: variant.id },
        body: { width: 1, height: 1 },
      }), (error) => error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE");
    }
  } finally {
    globalThis.fetch = previousFetch;
    resetRateLimitsForTests();
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("artist search ignores punctuation and spacing for phone-friendly lookup", () => {
  artistStmts.upsert.run(artistRow("j. cole search test", {
    name: "J. Cole Search Test",
    popularity: 99,
  }, "test"));
  const result = routes["GET /api/artists"]({ query: { q: "jcolesearchtest", limit: 5 } });
  assert.equal(result.artists[0]?.name, "J. Cole Search Test");
});

test("exact signed-in artist reads enqueue durable refresh demand without exposing or awaiting it", () => {
  resetRateLimitsForTests();
  const previousKey = process.env.TICKETMASTER_KEY;
  process.env.TICKETMASTER_KEY = "integration-test-key";
  const viewer = addUser(
    "u_artist_tour_demand",
    "artist-tour-demand@example.com",
    "artisttourdemand",
  );
  artistStmts.upsert.run(artistRow("demand refresh artist", {
    name: "Demand Refresh Artist",
    popularity: 98,
  }, "test"));
  const catalog = artistStmts.byNorm.get("demand refresh artist");
  db.prepare("DELETE FROM artist_tourdate_refresh_queue WHERE artist_key=?").run(catalog.norm);
  try {
    const anonymous = routes["GET /api/artists"]({
      query: { q: "Demand Refresh Artist", limit: 5 },
    });
    assert.equal(anonymous.artists[0]?.name, "Demand Refresh Artist");
    assert.equal(
      db.prepare("SELECT COUNT(*) count FROM artist_tourdate_refresh_queue WHERE artist_key=?")
        .get(catalog.norm).count,
      0,
      "anonymous search cannot spend provider quota",
    );

    routes["GET /api/artists"]({
      user: viewer,
      query: { q: "Demand Refresh", limit: 5 },
    });
    assert.equal(
      db.prepare("SELECT COUNT(*) count FROM artist_tourdate_refresh_queue WHERE artist_key=?")
        .get(catalog.norm).count,
      0,
      "partial type-ahead cannot enqueue fuzzy provider work",
    );

    const response = routes["GET /api/artists"]({
      user: viewer,
      query: { q: "Demand Refresh Artist", limit: 5 },
    });
    assert.equal(response.artists[0]?.name, "Demand Refresh Artist");
    assert.equal("refresh" in response || "queued" in response, false,
      "background maintenance stays out of the public response contract");
    const queued = db.prepare("SELECT * FROM artist_tourdate_refresh_queue WHERE artist_key=?")
      .get(catalog.norm);
    assert.equal(queued.status, "pending");
    assert.equal(Object.values(queued).includes(viewer.id), false,
      "the queue stores no requester identity");

    db.prepare("DELETE FROM artist_tourdate_refresh_queue WHERE artist_key=?").run(catalog.norm);
    routes["GET /api/artists/:key/profile"]({
      user: viewer,
      params: { key: catalog.public_slug },
    });
    assert.equal(
      db.prepare("SELECT status FROM artist_tourdate_refresh_queue WHERE artist_key=?")
        .get(catalog.norm).status,
      "pending",
      "a stable public artist URL resolves back to the canonical queue key",
    );
  } finally {
    db.prepare("DELETE FROM artist_tourdate_refresh_queue WHERE artist_key=?").run(catalog.norm);
    resetRateLimitsForTests();
    if (previousKey === undefined) delete process.env.TICKETMASTER_KEY;
    else process.env.TICKETMASTER_KEY = previousKey;
  }
});

test("banned and suspended accounts cannot enqueue artist tour-date refresh demand", () => {
  resetRateLimitsForTests();
  const previousKey = process.env.TICKETMASTER_KEY;
  process.env.TICKETMASTER_KEY = "integration-test-key";
  const bannedSeed = addUser(
    "u_artist_demand_banned",
    "artist-demand-banned@example.com",
    "artistdemandbanned",
  );
  const suspendedSeed = addUser(
    "u_artist_demand_suspended",
    "artist-demand-suspended@example.com",
    "artistdemandsuspended",
  );
  db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(bannedSeed.id);
  db.prepare("UPDATE users SET suspended_until=? WHERE id=?")
    .run(Date.now() + 60_000, suspendedSeed.id);
  const banned = q.userById.get(bannedSeed.id);
  const suspended = q.userById.get(suspendedSeed.id);
  const artists = [
    { key: "banned demand artist", name: "Banned Demand Artist" },
    { key: "suspended demand artist", name: "Suspended Demand Artist" },
  ];
  for (const artist of artists) {
    artistStmts.upsert.run(artistRow(artist.key, {
      name: artist.name,
      popularity: 90,
    }, "test"));
    db.prepare("DELETE FROM artist_tourdate_refresh_queue WHERE artist_key=?").run(artist.key);
  }
  try {
    const searchResponse = routes["GET /api/artists"]({
      user: banned,
      query: { q: "Banned Demand Artist", limit: 5 },
    });
    assert.equal(searchResponse.artists[0]?.name, "Banned Demand Artist",
      "a maintenance admission denial must not fail the artist read");
    const profileResponse = routes["GET /api/artists/:key/profile"]({
      user: suspended,
      params: { key: "suspended demand artist" },
    });
    assert.equal(profileResponse.profile, null,
      "a maintenance admission denial must preserve the profile response");
    for (const artist of artists) {
      assert.equal(
        db.prepare("SELECT COUNT(*) count FROM artist_tourdate_refresh_queue WHERE artist_key=?")
          .get(artist.key).count,
        0,
        `${artist.name} must not be queued by an inactive account`,
      );
    }
  } finally {
    for (const artist of artists) {
      db.prepare("DELETE FROM artist_tourdate_refresh_queue WHERE artist_key=?").run(artist.key);
    }
    resetRateLimitsForTests();
    if (previousKey === undefined) delete process.env.TICKETMASTER_KEY;
    else process.env.TICKETMASTER_KEY = previousKey;
  }
});

test("artist tour-date refresh demand is silently capped at twelve admissions per account per hour", () => {
  resetRateLimitsForTests();
  const previousKey = process.env.TICKETMASTER_KEY;
  process.env.TICKETMASTER_KEY = "integration-test-key";
  const viewer = addUser(
    "u_artist_demand_admission_limit",
    "artist-demand-admission-limit@example.com",
    "artistdemandadmissionlimit",
  );
  const artistKeys = [];
  for (let index = 1; index <= 13; index += 1) {
    const key = `admission limit artist ${String(index).padStart(2, "0")}`;
    artistKeys.push(key);
    artistStmts.upsert.run(artistRow(key, {
      name: `Admission Limit Artist ${String(index).padStart(2, "0")}`,
      popularity: 80 - index,
    }, "test"));
    db.prepare("DELETE FROM artist_tourdate_refresh_queue WHERE artist_key=?").run(key);
  }
  try {
    for (const key of artistKeys) {
      const response = routes["GET /api/artists/:key/profile"]({
        user: viewer,
        params: { key },
      });
      assert.equal(response.profile, null,
        "exhausting maintenance admission must not reject a public profile read");
    }
    const queued = db.prepare(`SELECT artist_key FROM artist_tourdate_refresh_queue
      WHERE artist_key LIKE 'admission limit artist %' ORDER BY artist_key`).all();
    assert.equal(queued.length, 12);
    assert.deepEqual(
      queued.map((row) => row.artist_key),
      artistKeys.slice(0, 12),
      "the thirteenth distinct artist does not enter the shared queue",
    );
  } finally {
    for (const key of artistKeys) {
      db.prepare("DELETE FROM artist_tourdate_refresh_queue WHERE artist_key=?").run(key);
    }
    resetRateLimitsForTests();
    if (previousKey === undefined) delete process.env.TICKETMASTER_KEY;
    else process.env.TICKETMASTER_KEY = previousKey;
  }
});

test("artist-owned profile UGC honors blocks in both directions without hiding catalog metadata", () => {
  const owner = addUser("u_artist_block_owner", "artist-block-owner@example.com", "artistblockowner");
  const viewer = addUser("u_artist_block_viewer", "artist-block-viewer@example.com", "artistblockviewer");
  const key = "block-safe catalog artist";
  artistStmts.upsert.run(artistRow(key, { name: "Block-safe Catalog Artist", genre: "Rap" }, "test"));
  db.prepare("INSERT INTO artist_profiles (artist_key,owner_id,bio,banner,avatar_uri,feed_enabled,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run(key, owner.id, "OWNER_BIO_MUST_HIDE", "https://owner.example/banner.jpg", "https://owner.example/avatar.jpg", 1, Date.now());
  db.prepare("INSERT INTO artist_posts (id,artist_key,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("artist_block_post", key, owner.id, "OWNER_UPDATE_MUST_HIDE", Date.now());
  const getProfile = () => routes["GET /api/artists/:key/profile"]({ user: viewer, params: { key } });

  assert.equal(getProfile().profile.bio, "OWNER_BIO_MUST_HIDE");
  assert.equal(getProfile().posts[0].text, "OWNER_UPDATE_MUST_HIDE");
  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(owner.id, viewer.id, Date.now());
  assert.deepEqual(getProfile(), { profile: null, posts: [] }, "an incoming block hides the complete owner-authored overlay");
  db.prepare("DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?").run(owner.id, viewer.id);
  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(viewer.id, owner.id, Date.now());
  assert.deepEqual(getProfile(), { profile: null, posts: [] }, "an outgoing block hides the same overlay");

  const catalog = routes["GET /api/artists"]({ user: viewer, query: { q: "blocksafecatalogartist", limit: 5 } });
  assert.equal(catalog.artists[0]?.name, "Block-safe Catalog Artist", "provider/catalog identity remains available without owner UGC");
});

test("disabled artist feeds conceal updates from public and non-owners while remaining manageable", () => {
  const ownerSeed = addUser("u_artist_feed_owner", "artist-feed-owner@example.com", "artistfeedowner");
  const outsider = addUser("u_artist_feed_outsider", "artist-feed-outsider@example.com", "artistfeedoutsider");
  const otherArtistSeed = addUser("u_artist_feed_other", "artist-feed-other@example.com", "artistfeedother");
  const adminSeed = addUser("u_artist_feed_admin", "artist-feed-admin@example.com", "artistfeedadmin");
  const key = "private updates artist";
  db.prepare("UPDATE users SET role='artist',artist_name=? WHERE id=?").run("Private Updates Artist", ownerSeed.id);
  db.prepare("UPDATE users SET role='artist',artist_name=? WHERE id=?").run("Different Artist", otherArtistSeed.id);
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(adminSeed.id);
  const owner = q.userById.get(ownerSeed.id);
  const otherArtist = q.userById.get(otherArtistSeed.id);
  const admin = q.userById.get(adminSeed.id);
  db.prepare("INSERT INTO artist_profiles (artist_key,owner_id,bio,feed_enabled,updated_at) VALUES (?,?,?,?,?)")
    .run(key, owner.id, "Public profile, private update feed", 0, Date.now());
  db.prepare("INSERT INTO artist_posts (id,artist_key,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("artist_disabled_feed_post", key, owner.id, "UNPUBLISHED_ARTIST_UPDATE", Date.now());

  const read = (user) => routes["GET /api/artists/:key/profile"]({ user, params: { key } });
  assert.equal(read(undefined).profile.feedEnabled, false);
  assert.deepEqual(read(undefined).posts, [], "public reads cannot disclose disabled-feed posts");
  assert.deepEqual(read(outsider).posts, [], "signed-in fans cannot disclose disabled-feed posts");
  assert.deepEqual(read(otherArtist).posts, [], "an unrelated artist cannot disclose disabled-feed posts");
  assert.equal(read(owner).posts[0]?.text, "UNPUBLISHED_ARTIST_UPDATE", "the owner can still manage hidden updates");
  assert.equal(read(admin).posts[0]?.text, "UNPUBLISHED_ARTIST_UPDATE", "admins retain management visibility");

  db.prepare("UPDATE artist_profiles SET feed_enabled=1 WHERE artist_key=?").run(key);
  assert.equal(read(undefined).posts[0]?.text, "UNPUBLISHED_ARTIST_UPDATE", "enabling the feed publishes its updates");
});

test("unresolved artist search names expire after 30 days and the enrichment queue stays bounded", () => {
  const at = 2_000_000_000_000;
  artistStmts.recordMissing.run("privacy-old-miss", "Privacy Old Miss", at - 31 * 24 * 60 * 60 * 1000);
  artistStmts.recordMissing.run("privacy-recent-a", "Privacy Recent A", at - 3);
  artistStmts.recordMissing.run("privacy-recent-b", "Privacy Recent B", at - 2);
  artistStmts.recordMissing.run("privacy-recent-c", "Privacy Recent C", at - 1);

  const result = pruneMissingArtists(at, { maxRows: 2 });
  assert.equal(result.expired, 1);
  assert.equal(result.overflow >= 1, true);
  assert.deepEqual(
    db.prepare("SELECT norm FROM missing_artists ORDER BY last_at DESC,norm DESC").all().map((row) => row.norm),
    ["privacy-recent-c", "privacy-recent-b"],
  );

  const disclosure = /submitted artist name may remain in a bounded staff enrichment queue for up to 30 days/;
  assert.match(renderPublicPage("/privacy"), disclosure);
  assert.match(readFileSync(new URL("../src/screens/PrivacyScreen.jsx", import.meta.url), "utf8"), disclosure);
});

test("Discover legacy routes share one service and overview opts into a bounded public cache", () => {
  artistStmts.upsert.run(artistRow("discover route alpha", {
    name: "Discover Route Alpha", genre: "rap", country: "Route Test Country", popularity: 99,
    genreClaims: [{ value: "rap", source: "provider", at: 1 }],
  }, "test"));
  artistStmts.upsert.run(artistRow("discover route bravo", {
    name: "Discover Route Bravo", genre: "indie rock", country: "Route Test Country", popularity: 98,
    genreClaims: [{ value: "indie rock", source: "provider", at: 1 }],
  }, "test"));

  const chartHeaders = {};
  const chart = routes["GET /api/discover/chart"]({
    query: { country: "Route Test Country", limit: "24" },
    setHeader: (name, value) => { chartHeaders[name] = value; },
  });
  assert.deepEqual(chart.rows.map((row) => row.name), ["Discover Route Alpha", "Discover Route Bravo"]);
  const genreHeaders = {};
  const genres = routes["GET /api/discover/genres"]({
    query: { country: "Route Test Country", n: "8" },
    setHeader: (name, value) => { genreHeaders[name] = value; },
  });
  assert.equal(genres.total, 2);
  assert.deepEqual(genres.genres.map((row) => row.genre).sort(), ["Hip-Hop", "Indie"]);
  assert.equal(chartHeaders["Cache-Control"], "public, max-age=60, stale-while-revalidate=300");
  assert.equal(genreHeaders["Cache-Control"], "public, max-age=60, stale-while-revalidate=300");

  const countryHeaders = {};
  routes["GET /api/discover/countries"]({
    query: { min: "1" },
    setHeader: (name, value) => { countryHeaders[name] = value; },
  });
  assert.equal(countryHeaders["Cache-Control"], "public, max-age=60, stale-while-revalidate=300");

  const responseHeaders = {};
  const overview = routes["GET /api/discover/overview"]({
    query: { country: "Route Test Country" },
    setHeader: (name, value) => { responseHeaders[name] = value; },
  });
  assert.deepEqual(overview.chart.rows.map((row) => row.name), chart.rows.map((row) => row.name));
  assert.equal(overview.genreTotal, genres.total);
  assert.equal(overview.memberTotal, undefined, "public discovery does not expose an exact account count");
  assert.equal(responseHeaders["Cache-Control"], "public, max-age=60, stale-while-revalidate=300");
});

test("PATCH /api/me schemas extras, filters public song text, and keeps trusted fields authoritative", () => {
  const user = addUser("u_profile", "profile@example.com", "profile");
  const handler = routes["PATCH /api/me"];

  assert.throws(
    () => handler({ user, ip: "profile-test", body: { extras: { value: "x".repeat(9000) } } }),
    (error) => error instanceof ApiError && error.status === 400
  );

  assert.throws(
    () => handler({ user, ip: "profile-test", body: { extras: { role: "admin", verified: true } } }),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_FAILED",
  );
  assert.throws(
    () => handler({ user, ip: "profile-test", body: { extras: { nowPlaying: { title: { nested: true }, artist: [] } } } }),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_FAILED",
  );
  assert.throws(
    () => handler({ user, ip: "profile-test", body: { extras: { nowPlaying: { title: "white power", artist: "Unsafe" } } } }),
    (error) => error instanceof ApiError && error.status === 422 && error.code === "CONTENT_REJECTED",
  );

  const result = handler({ user, ip: "profile-test", body: {
    extras: { theme: "stage", nowPlaying: { title: "  Safe Song  ", artist: " Safe Artist " }, consentAt: 123, termsAcceptedAt: 123 },
  } });
  assert.equal(result.user.role, "fan");
  assert.equal(result.user.verified, false);
  assert.equal(result.user.consentAt, undefined, "generic profile extras cannot forge analytics consent");
  assert.equal(result.user.termsAcceptedAt, undefined, "generic profile extras cannot forge Terms acceptance");
  assert.equal(result.user.nowPlaying, undefined, "paused player state stays out of the profile response");
  assert.deepEqual(
    JSON.parse(q.userById.get(user.id).extras),
    { theme: "stage", nowPlaying: { title: "Safe Song", artist: "Safe Artist" } },
    "pausing the player does not erase the member's stored history",
  );

  assert.throws(
    () => handler({ user: q.userById.get(user.id), ip: "profile-test", body: { searchIndexingOptOut: "yes" } }),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_FAILED",
  );

  const optedOut = handler({
    user: q.userById.get(user.id), ip: "profile-test", body: { searchIndexingOptOut: true },
  });
  assert.equal(optedOut.user.searchIndexingOptOut, true, "the preference rehydrates only in the self projection");
  assert.equal(publicUser(q.userById.get(user.id)).searchIndexingOptOut, undefined);

  const protectedPreference = handler({
    user: q.userById.get(user.id), ip: "profile-test", body: { extras: { theme: "neon", searchIndexingOptOut: false } },
  });
  assert.equal(protectedPreference.user.searchIndexingOptOut, true,
    "generic extras writes cannot silently erase the dedicated privacy preference");
  assert.deepEqual(JSON.parse(q.userById.get(user.id).extras), { theme: "neon", searchIndexingOptOut: true });

  const optedIn = handler({
    user: q.userById.get(user.id), ip: "profile-test", body: { searchIndexingOptOut: false },
  });
  assert.equal(optedIn.user.searchIndexingOptOut, false);
});

test("signup records Terms separately while optional analytics defaults off", () => {
  let sessionCookie;
  const email = "default-private@example.com";
  const result = routes["POST /api/signup"]({
    ip: "signup-consent-test",
    ua: "integrity-test",
    body: {
      name: "Default Private",
      email,
      password: "privatepass123",
      city: "Toronto",
      termsVersion: "2026-08",
      analyticsConsent: false,
    },
    setSession: (value) => { sessionCookie = value; },
  });
  const created = publicUser(q.userByEmail.get(email), { self: true });
  assert.equal(sessionCookie, undefined);
  assert.deepEqual(result, { ok: true, pending: true });
  assert.ok(created.termsAcceptedAt);
  assert.equal(created.termsVersion, "2026-08");
  assert.equal(created.analyticsConsentAt, undefined);
  assert.equal(created.consentAt, undefined);
  assert.throws(() => routes["POST /api/signup"]({
    ip: "signup-consent-test-2", ua: "integrity-test", body: {
      name: "No Terms", email: "no-terms@example.com", password: "privatepass123", city: "Toronto",
    }, setSession: () => {},
  }), (error) => error.status === 400);
});

test("analytics is consented, allow-listed, IP-free, aggregated, and admin-only", () => {
  addUser("u_analytics_member", "analytics-member@example.com", "analyticsmember");
  db.prepare("UPDATE users SET extras=? WHERE id=?").run(JSON.stringify({ consentAt: Date.now(), termsVersion: "2026-07" }), "u_analytics_member");
  const member = q.userById.get("u_analytics_member");
  artistStmts.upsert.run(artistRow("analytics artist", {
    name: "Analytics Artist",
    genre: "Alternative",
  }, "legacy"));
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,review,created_at) VALUES (?,?,?,?,?,?,?)")
    .run("p_internal_001", member.id, "Analytics Artist", "Analytics Venue", 4, "Public fixture", Date.now());
  db.prepare("UPDATE posts SET artist_key=? WHERE id=?").run("analytics artist", "p_internal_001");
  artistStmts.upsert.run(artistRow("analytics verified artist", {
    name: "Analytics Verified Artist",
    genre: "Classical",
    genreClaims: [{ value: "Classical", source: "staff", at: 1 }],
  }, "staff"));
  db.prepare("INSERT INTO posts (id,user_id,artist,artist_key,venue,overall,review,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("p_internal_verified_genre", member.id, "Analytics Verified Artist", "analytics verified artist", "Analytics Venue", 4, "Verified genre fixture", Date.now());
  const ingest = routes["POST /api/events/batch"];
  const events = [
    { id: "evt_search_0001", name: "search", props: { q: "shoegaze", kind: "all", resultBucket: "one_to_five", secret: "must disappear" } },
    { id: "evt_play_000001", name: "play", props: { source: "player", artist: "The Artist", title: "The Song", token: "private" } },
    { id: "evt_impression1", name: "feed_impression", props: { postId: "p_internal_001", position: 2, surface: "everyone", algorithm: "global-personal-v1", review: "must disappear" } },
    { id: "evt_unknown_001", name: "arbitrary_client_event", props: { anything: "no" } },
  ];
  const result = ingest({
    user: member,
    ip: "203.0.113.44",
    body: { events },
  });
  assert.equal(result.stored, 3);
  assert.equal(result.rejected, 1);
  const retry = ingest({ user: member, ip: "203.0.113.44", body: { events } });
  assert.equal(retry.stored, 0);
  assert.equal(retry.duplicates, 3);
  const rows = db.prepare("SELECT name,props,ip FROM events WHERE user_id=? ORDER BY created_at,id").all(member.id);
  assert.equal(rows.every((row) => row.ip == null), true);
  assert.deepEqual(JSON.parse(rows.find((row) => row.name === "play").props), { source: "player" });
  assert.deepEqual(JSON.parse(rows.find((row) => row.name === "search").props), { kind: "all", resultBucket: "one_to_five" });
  assert.equal(rows.some((row) => row.name === "arbitrary_client_event"), false);
  assert.equal(rows.some((row) => /shoegaze|The Artist|The Song|must disappear/.test(row.props)), false);
  assert.equal(ingest({ user: null, ip: "203.0.113.45", body: { events } }).stored, 0);

  addUser("u_analytics_admin", "analytics-admin@example.com", "analyticsadmin");
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run("u_analytics_admin");
  const admin = q.userById.get("u_analytics_admin");
  const dashboard = routes["GET /api/admin/analytics"]({ user: admin });
  assert.equal(dashboard.topGenres.some((row) => row.label === "Alternative"), false);
  assert.deepEqual(dashboard.topGenres.find((row) => row.label === "Classical"), { label: "Classical", count: 1 });
  assert.deepEqual(dashboard.topSearches, []);
  assert.equal(dashboard.growth.length, 30);
  assert.equal(dashboard.retentionDays, 30);
  assert.equal(dashboard.rawEventLimit, 40_000);
  assert.equal(dashboard.rawEventLimitPerAccount, 5_000);
  assert.equal(dashboard.rawWindow.count, 3);
  const detail = routes["GET /api/admin/analytics/users/:id"]({ user: admin, params: { id: member.id } });
  assert.equal(detail.totals.events, 3);
  assert.equal("recent" in detail, false, "admin analytics exposes aggregates, not a named event timeline");
  assert.equal("recent" in dashboard, false, "the global dashboard has no per-handle event tail");
  assert.throws(() => routes["GET /api/admin/analytics"]({ user: member }), (error) => error.status === 403);

  const updated = routes["POST /api/me/analytics-consent"]({ user: member, ip: "profile-test", body: { enabled: false } });
  assert.equal(updated.user.analyticsOptOut, true);
  assert.ok(updated.user.termsAcceptedAt, "legacy combined consent is migrated to a durable Terms acceptance record");
  assert.equal(updated.user.consentAt, undefined);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM events WHERE user_id=?").get(member.id).count, 0);
  assert.equal(ingest({
    user: q.userById.get(member.id),
    ip: "203.0.113.46",
    body: { events: [{ id: "evt_optout_001", name: "play", props: { source: "player" } }] },
  }).stored, 0);

  const legacyEnable = addUser("u_analytics_legacy_enable", "analytics-legacy-enable@example.com", "analyticslegacyenable");
  db.prepare("UPDATE users SET extras=? WHERE id=?").run(JSON.stringify({ consentAt: 12345, termsVersion: "2026-07" }), legacyEnable.id);
  const enabled = routes["POST /api/me/analytics-consent"]({
    user: q.userById.get(legacyEnable.id), ip: "profile-test", body: { enabled: true },
  });
  assert.equal(enabled.user.termsAcceptedAt, 12345);
  assert.ok(enabled.user.analyticsConsentAt >= 12345);
  assert.equal(enabled.user.consentAt, undefined);
});

test("capped social endpoints return the newest window in chronological order", () => {
  const userA = addUser("u_a", "a@example.com", "usera");
  addUser("u_b", "b@example.com", "userb");

  const insertDm = db.prepare("INSERT INTO dms (id,from_id,to_id,text,created_at) VALUES (?,?,?,?,?)");
  for (let i = 1; i <= 505; i++) insertDm.run(`dm_${String(i).padStart(4, "0")}`, "u_a", "u_b", `dm ${i}`, i);

  const direct = routes["GET /api/dms/:otherId"]({ user: userA, params: { otherId: "u_b" } });
  assert.equal(direct.messages.length, 500);
  assert.equal(direct.messages[0].createdAt, 6);
  assert.equal(direct.messages.at(-1).createdAt, 505);
  assert.equal(typeof direct.nextCursor, "string");
  const olderDirect = routes["GET /api/dms/:otherId"]({ user: userA, params: { otherId: "u_b" }, query: { before: direct.nextCursor } });
  assert.deepEqual(olderDirect.messages.map((m) => m.createdAt), [1, 2, 3, 4, 5]);
  assert.equal(olderDirect.nextCursor, null);

  const threads = routes["GET /api/me/threads"]({ user: userA });
  assert.equal(threads.threads[0].messages[0].createdAt, 6);
  assert.equal(threads.threads[0].messages.at(-1).createdAt, 505);
  assert.deepEqual(threads.threads[0].otherUser.home, { city: "Toronto" });
  const threadSummary = routes["GET /api/me/threads"]({ user: userA, query: { summary: "1" } });
  assert.equal(threadSummary.threads.length, 1);
  assert.deepEqual(threadSummary.threads[0].messages.map((message) => message.createdAt), [505]);

  for (let i = 506; i <= 508; i++) insertDm.run(`dm_${String(i).padStart(4, "0")}`, "u_a", "u_b", `dm ${i}`, i);
  const newerDirect = routes["GET /api/dms/:otherId"]({ user: userA, params: { otherId: "u_b" }, query: { after: direct.syncCursor, limit: 2 } });
  assert.deepEqual(newerDirect.messages.map((m) => m.createdAt), [506, 507]);
  assert.equal(newerDirect.hasMore, true);
  const newestDirect = routes["GET /api/dms/:otherId"]({ user: userA, params: { otherId: "u_b" }, query: { after: newerDirect.syncCursor, limit: 2 } });
  assert.deepEqual(newestDirect.messages.map((m) => m.createdAt), [508]);
  assert.equal(newestDirect.hasMore, false);
  assert.throws(
    () => routes["GET /api/dms/:otherId"]({ user: userA, params: { otherId: "u_b" }, query: { before: direct.nextCursor, after: direct.syncCursor } }),
    (error) => error.code === "VALIDATION_FAILED",
  );

  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,created_at) VALUES (?,?,?,?,?,?)")
    .run("post_1", "u_a", "Artist", "Venue", 4, 1);
  const insertComment = db.prepare("INSERT INTO comments (id,post_id,user_id,text,created_at) VALUES (?,?,?,?,?)");
  for (let i = 1; i <= 405; i++) insertComment.run(`c_${String(i).padStart(4, "0")}`, "post_1", "u_a", `comment ${i}`, i);
  const comments = routes["GET /api/posts/:id/comments"]({ user: null, params: { id: "post_1" } });
  assert.equal(comments.comments.length, 400);
  assert.equal(comments.comments[0].createdAt, 6);
  assert.equal(comments.comments.at(-1).createdAt, 405);
  const olderComments = routes["GET /api/posts/:id/comments"]({ user: null, params: { id: "post_1" }, query: { before: comments.nextCursor } });
  assert.deepEqual(olderComments.comments.map((c) => c.createdAt), [1, 2, 3, 4, 5]);

  const insertFanMessage = db.prepare("INSERT INTO fan_club_messages (id,artist,user_id,text,created_at) VALUES (?,?,?,?,?)");
  const insertLoungeMessage = db.prepare("INSERT INTO lounge_messages (id,lounge_id,user_id,text,created_at) VALUES (?,?,?,?,?)");
  for (let i = 1; i <= 305; i++) {
    insertFanMessage.run(`fc_${String(i).padStart(4, "0")}`, "artist", "u_a", `fan ${i}`, i);
    insertLoungeMessage.run(`lm_${String(i).padStart(4, "0")}`, "show", "u_a", `lounge ${i}`, i);
  }
  db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)").run("artist", userA.id);
  db.prepare("INSERT INTO going (user_id,concert_key,artist,venue) VALUES (?,?,?,?)").run(userA.id, "show", "Artist", "Venue");
  const readFan = (query = {}) => routes["GET /api/fanclubs/:artist/messages"]({ user: userA, params: { artist: "artist" }, query });
  const readLounge = (query = {}) => routes["GET /api/lounges/:key/messages"]({ user: userA, params: { key: "show" }, query });

  const fan = readFan();
  assert.equal(fan.messages.length, 300);
  assert.equal(fan.messages[0].createdAt, 6);
  assert.equal(fan.messages.at(-1).createdAt, 305);
  assert.deepEqual(readFan({ before: fan.nextCursor }).messages.map((m) => m.createdAt), [1, 2, 3, 4, 5]);
  insertFanMessage.run("fc_0306", "artist", "u_a", "fan 306", 306);
  const newerFan = readFan({ after: fan.syncCursor });
  assert.deepEqual(newerFan.messages.map((m) => m.createdAt), [306]);
  db.prepare("UPDATE fan_club_messages SET removed=1 WHERE id=?").run("fc_0306");
  assert.ok(readFan({ after: newerFan.syncCursor }).removedIds.includes("fc_0306"));

  const lounge = readLounge();
  assert.equal(lounge.messages.length, 300);
  assert.equal(lounge.messages[0].createdAt, 6);
  assert.equal(lounge.messages.at(-1).createdAt, 305);
  assert.deepEqual(readLounge({ before: lounge.nextCursor }).messages.map((m) => m.createdAt), [1, 2, 3, 4, 5]);
  insertLoungeMessage.run("lm_0306", "show", "u_a", "lounge 306", 306);
  const newerLounge = readLounge({ after: lounge.syncCursor });
  assert.deepEqual(newerLounge.messages.map((m) => m.createdAt), [306]);
  db.prepare("UPDATE lounge_messages SET removed=1 WHERE id=?").run("lm_0306");
  assert.ok(readLounge({ after: newerLounge.syncCursor }).removedIds.includes("lm_0306"));
});

test("group-chat writes require membership and attendance, then succeed on retry", () => {
  const user = verifiedUser("u_chat_integrity", "chat-integrity@example.com", "chatintegrity");
  const fanMessage = routes["POST /api/fanclubs/:artist/messages"];
  const fanContext = (text) => ({ user, ip: "chat-integrity", params: { artist: "The Band" }, body: { text } });

  assert.throws(
    () => fanMessage(fanContext("not joined")),
    (error) => error.code === "FAN_CLUB_MEMBERSHIP_REQUIRED",
  );
  assert.equal(db.prepare("SELECT COUNT(*) c FROM fan_club_messages WHERE user_id=?").get(user.id).c, 0);

  const joinFanClub = routes["POST /api/fanclubs/:artist/join"];
  assert.equal(joinFanClub({ user, ip: "chat-integrity", params: { artist: "The Band" }, body: { joined: true } }).joined, true);
  assert.equal(joinFanClub({ user, ip: "chat-integrity", params: { artist: "The Band" }, body: { joined: true } }).joined, true);
  assert.ok(fanMessage(fanContext("joined now")).id);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM fan_club_messages WHERE user_id=?").get(user.id).c, 1);

  const loungeMessage = routes["POST /api/lounges/:key/messages"];
  const loungeContext = (text) => ({ user, ip: "chat-integrity", params: { key: "Artist|Venue|2026-07-15" }, body: { text } });
  assert.throws(
    () => loungeMessage(loungeContext("not going")),
    (error) => error.code === "LOUNGE_ATTENDANCE_REQUIRED",
  );
  assert.equal(db.prepare("SELECT COUNT(*) c FROM lounge_messages WHERE user_id=?").get(user.id).c, 0);

  const markGoing = routes["POST /api/going"];
  const goingContext = { user, ip: "chat-integrity", body: { key: "artist|venue|2026-07-15", artist: "Artist", venue: "Venue", date: "2026-07-15", going: true } };
  assert.equal(markGoing(goingContext).going, true);
  assert.equal(markGoing(goingContext).going, true);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM going WHERE user_id=? AND concert_key=?").get(user.id, "artist|venue|2026-07-15").c, 1);
  assert.ok(loungeMessage(loungeContext("in the room")).id);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM lounge_messages WHERE user_id=?").get(user.id).c, 1);
});

test("group-chat reads require membership or attendance while gate metadata stays public", () => {
  const member = addUser("u_chat_reader", "chat-reader@example.com", "chatreader");
  const outsider = addUser("u_chat_outsider", "chat-outsider@example.com", "chatoutsider");
  const blockedAuthor = addUser("u_chat_blocked", "chat-blocked@example.com", "chatblocked");
  const artist = "gate artist";
  const loungeKey = "gate artist|gate venue|2026-08-01";

  db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)").run(artist, member.id);
  db.prepare("INSERT INTO going (user_id,concert_key,artist,venue,date) VALUES (?,?,?,?,?)")
    .run(member.id, loungeKey, "Gate Artist", "Gate Venue", "2026-08-01");
  db.prepare("INSERT INTO fan_club_messages (id,artist,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("fc_gate_visible", artist, member.id, "member-only", 100);
  db.prepare("INSERT INTO fan_club_messages (id,artist,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("fc_gate_blocked", artist, blockedAuthor.id, "blocked", 99);
  db.prepare("INSERT INTO fan_club_messages (id,artist,user_id,text,removed,created_at) VALUES (?,?,?,?,?,?)")
    .run("fc_gate_removed", artist, member.id, "removed", 1, 101);
  db.prepare("INSERT INTO lounge_messages (id,lounge_id,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("lm_gate_visible", loungeKey, member.id, "attendees-only", 100);
  db.prepare("INSERT INTO lounge_messages (id,lounge_id,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("lm_gate_blocked", loungeKey, blockedAuthor.id, "blocked", 99);
  db.prepare("INSERT INTO lounge_messages (id,lounge_id,user_id,text,removed,created_at) VALUES (?,?,?,?,?,?)")
    .run("lm_gate_removed", loungeKey, member.id, "removed", 1, 101);
  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)")
    .run(member.id, blockedAuthor.id, 102);

  const fanMeta = routes["GET /api/fanclubs/:artist/meta"]({ params: { artist: "Gate%20Artist" } });
  assert.deepEqual(fanMeta, { members: 1, messageCount: 2 });
  const loungeMeta = routes["GET /api/lounges/:key/meta"]({ params: { key: encodeURIComponent(loungeKey) } });
  assert.deepEqual(loungeMeta, {
    attendeeCount: 1,
    messageCount: 2,
    status: "open",
    timingKnown: false,
    cutoffAt: null,
    cutoffSource: null,
    fanClubArtist: "Gate Artist",
  });

  const fanRead = (user) => routes["GET /api/fanclubs/:artist/messages"]({ user, params: { artist: "Gate%20Artist" } });
  const loungeRead = (user) => routes["GET /api/lounges/:key/messages"]({ user, params: { key: encodeURIComponent(loungeKey) } });
  assert.throws(() => fanRead(null), (error) => error.code === "AUTH_REQUIRED");
  assert.throws(() => fanRead(outsider), (error) => error.code === "FAN_CLUB_MEMBERSHIP_REQUIRED");
  assert.throws(() => loungeRead(null), (error) => error.code === "AUTH_REQUIRED");
  assert.throws(() => loungeRead(outsider), (error) => error.code === "LOUNGE_ATTENDANCE_REQUIRED");

  const fan = fanRead(member);
  assert.deepEqual(fan.messages.map((message) => message.id), ["fc_gate_visible"]);
  assert.ok(fan.removedIds.includes("fc_gate_removed"));
  const lounge = loungeRead(member);
  assert.deepEqual(lounge.messages.map((message) => message.id), ["lm_gate_visible"]);
  assert.ok(lounge.removedIds.includes("lm_gate_removed"));

  db.prepare("DELETE FROM fan_club_members WHERE artist=? AND user_id=?").run(artist, member.id);
  db.prepare("DELETE FROM going WHERE concert_key=? AND user_id=?").run(loungeKey, member.id);
  assert.throws(() => fanRead(member), (error) => error.code === "FAN_CLUB_MEMBERSHIP_REQUIRED");
  assert.throws(() => loungeRead(member), (error) => error.code === "LOUNGE_ATTENDANCE_REQUIRED");
});

test("closed Lounges hide archives from members while moderator legal access remains no-store", () => {
  const member = verifiedUser("u_closed_lounge_member", "closed-lounge@example.com", "closedlounge");
  verifiedUser("u_closed_lounge_mod", "closed-lounge-mod@example.com", "closedloungemod");
  db.prepare("UPDATE users SET role='moderator' WHERE id=?").run("u_closed_lounge_mod");
  const moderator = q.userById.get("u_closed_lounge_mod");
  const key = "closed artist|closed venue|2026-08-20";
  const showId = "show-closed-lounge";
  const showStart = Date.now() - 24 * 60 * 60 * 1000 - 2_000;
  db.prepare(`INSERT INTO shows
    (id,canonical_key,artist,venue,date,start_at,identity_source,public_eligible,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'ticketmaster',1,?,?)`)
    .run(showId, "tour_date_closed_lounge", "Closed Artist", "Closed Venue", "2026-08-20", showStart, showStart, showStart);
  db.prepare("INSERT INTO show_aliases (alias_type,alias_value,show_id,created_at) VALUES ('legacy_concert_key',?,?,?)")
    .run(key, showId, showStart);
  db.prepare("INSERT INTO going (user_id,concert_key,artist,venue,date,created_at) VALUES (?,?,?,?,?,?)")
    .run(member.id, key, "Closed Artist", "Closed Venue", "2026-08-20", showStart);
  db.prepare("INSERT INTO lounge_messages (id,lounge_id,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("lm_closed_archive", key, member.id, "protected archive text", showStart + 1);

  const headers = new Map();
  const meta = routes["GET /api/lounges/:key/meta"]({
    user: member,
    params: { key: encodeURIComponent(key) },
    setHeader: (name, value) => headers.set(name, value),
  });
  assert.equal(headers.get("Cache-Control"), "no-store");
  assert.equal(meta.status, "closed");
  assert.equal(meta.messageCount, 0);
  assert.equal(meta.cutoffSource, "show_start");
  assert.equal(meta.fanClubArtist, "Closed Artist");
  assert.equal(JSON.stringify(meta).includes("protected archive text"), false);
  assert.throws(
    () => routes["GET /api/lounges/:key/messages"]({ user: member, params: { key: encodeURIComponent(key) }, query: {} }),
    (error) => error.status === 410 && error.code === "LOUNGE_CLOSED",
  );
  assert.throws(
    () => routes["POST /api/lounges/:key/messages"]({ user: member, ip: "closed-lounge", params: { key: encodeURIComponent(key) }, body: { text: "too late" } }),
    (error) => error.status === 410 && error.code === "LOUNGE_CLOSED",
  );
  assert.throws(
    () => routes["GET /api/mod/lounges/:key/archive"]({ user: member, params: { key: encodeURIComponent(key) }, query: {} }),
    (error) => error.status === 403 && error.code === "FORBIDDEN",
  );

  const archiveHeaders = new Map();
  const archive = routes["GET /api/mod/lounges/:key/archive"]({
    user: moderator,
    params: { key: encodeURIComponent(key) },
    query: {},
    setHeader: (name, value) => archiveHeaders.set(name, value),
  });
  assert.equal(archiveHeaders.get("Cache-Control"), "no-store");
  assert.equal(archive.lifecycle.status, "closed");
  assert.equal(archive.lifecycle.archived, true);
  assert.equal(archive.lifecycle.retentionPolicyKey, "approval-pending");
  assert.deepEqual(archive.messages.map((message) => message.text), ["protected archive text"]);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM lounge_messages WHERE lounge_id=?").get(key).count, 1);
});

test("desired-state social mutations are idempotent and old toggle calls still work", () => {
  const user = verifiedUser("u_toggle_a", "toggle-a@example.com", "togglea");
  addUser("u_toggle_b", "toggle-b@example.com", "toggleb");
  const follow = routes["POST /api/users/:id/follow"];
  const followCtx = (body) => ({ user, ip: "toggle-test", params: { id: "u_toggle_b" }, body });
  assert.equal(follow(followCtx({ following: true })).following, true);
  assert.equal(follow(followCtx({ following: true })).following, true);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM follows WHERE follower_id=? AND followee_id=?").get(user.id, "u_toggle_b").c, 1);
  assert.equal(follow(followCtx({ following: false })).following, false);
  assert.equal(follow(followCtx({ following: false })).following, false);
  assert.equal(follow(followCtx({})).following, true); // legacy toggle behavior
  assert.throws(() => follow(followCtx({ following: "yes" })), (error) => error.code === "VALIDATION_FAILED");

  const block = routes["POST /api/users/:id/block"];
  const blockCtx = (body) => ({ user, ip: "toggle-test", params: { id: "u_toggle_b" }, body });
  assert.equal(block(blockCtx({ blocked: true })).blocked, true);
  assert.equal(block(blockCtx({ blocked: true })).blocked, true);
  assert.equal(block(blockCtx({ blocked: false })).blocked, false);
  assert.equal(block(blockCtx({ blocked: false })).blocked, false);

  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,created_at) VALUES (?,?,?,?,?,?)")
    .run("post_toggle", "u_toggle_b", "Artist", "Venue", 4, 10);
  const like = routes["POST /api/posts/:id/like"];
  const likeCtx = (body) => ({ user, ip: "toggle-test", params: { id: "post_toggle" }, body });
  assert.equal(like(likeCtx({ liked: true })).liked, true);
  assert.equal(like(likeCtx({ liked: true })).liked, true);
  assert.equal(like(likeCtx({ liked: false })).liked, false);

  const join = routes["POST /api/fanclubs/:artist/join"];
  const joinCtx = (body) => ({ user, ip: "toggle-test", params: { artist: "Test%20Artist" }, body });
  assert.deepEqual(join(joinCtx({ joined: true })), { member: true, joined: true });
  assert.deepEqual(join(joinCtx({ joined: true })), { member: true, joined: true });
  assert.deepEqual(join(joinCtx({ joined: false })), { member: false, joined: false });

  const going = routes["POST /api/going"];
  const goingCtx = (desired) => ({ user, ip: "toggle-test", body: { key: "concert:test", artist: "Artist", venue: "Venue", going: desired } });
  assert.equal(going(goingCtx(true)).going, true);
  assert.equal(going(goingCtx(true)).going, true);
  assert.equal(going(goingCtx(false)).going, false);
  assert.equal(going(goingCtx(false)).going, false);
});

test("every encoded route parameter rejects malformed and overlong identities as 400", () => {
  const user = addUser("u_encoded_path_guard", "encoded-path-guard@example.com", "encodedpathguard");
  const malformed = "%E0%A4%A";
  const cases = [
    ["POST /api/fanclubs/:artist/join", { user, params: { artist: malformed }, body: {} }],
    ["GET /api/fanclubs/:artist/meta", { params: { artist: malformed } }],
    ["GET /api/fanclubs/:artist/messages", { user, params: { artist: malformed }, query: {} }],
    ["POST /api/fanclubs/:artist/messages", { user, params: { artist: malformed }, body: {} }],
    ["GET /api/lounges/:key/meta", { params: { key: malformed } }],
    ["GET /api/lounges/:key/messages", { user, params: { key: malformed }, query: {} }],
    ["POST /api/lounges/:key/messages", { user, params: { key: malformed }, body: {} }],
    ["GET /api/going/:key/attendees", { params: { key: malformed }, query: {} }],
    ["GET /api/venues/:key/photos", { params: { key: malformed } }],
    ["GET /api/venues/:key/reviews", { params: { key: malformed }, query: {} }],
    ["POST /api/venues/:key/reviews", { user, params: { key: malformed }, body: {} }],
    ["GET /api/artists/:key/profile", { params: { key: malformed } }],
    ["PATCH /api/artists/:key/profile", { user, params: { key: malformed }, body: {} }],
    ["POST /api/artists/:key/posts", { user, params: { key: malformed }, body: {} }],
    ["DELETE /api/artists/:key/posts/:id", { user, params: { key: malformed, id: "x" } }],
  ];
  for (const [route, context] of cases) {
    assert.throws(
      () => routes[route]({ ip: "encoded-path-test", body: {}, params: {}, query: {}, ...context }),
      (error) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_FAILED",
      route,
    );
  }
  assert.throws(
    () => routes["GET /api/fanclubs/:artist/meta"]({ params: { artist: "a".repeat(81) } }),
    (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
  );
});

test("tour-date batches are owner-authorized, atomic, canonical, and release-gated", () => {
  const artistSeed = addUser("u_tour_artist", "tour-artist@example.com", "tourartist");
  const other = addUser("u_tour_other", "tour-other@example.com", "tourother");
  const moderatorSeed = addUser("u_tour_mod", "tour-mod@example.com", "tourmoderator");
  const adminSeed = addUser("u_tour_admin", "tour-admin@example.com", "touradmin");
  db.prepare("UPDATE users SET role='artist',artist_name='API Tour Fixture 2822' WHERE id=?").run(artistSeed.id);
  db.prepare("UPDATE users SET role='moderator' WHERE id=?").run(moderatorSeed.id);
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(adminSeed.id);
  const artist = q.userById.get(artistSeed.id);
  const moderator = q.userById.get(moderatorSeed.id);
  const admin = q.userById.get(adminSeed.id);
  const post = routes["POST /api/tourdates"];
  const showDate = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const releaseAt = Date.now() + 86400000;
  const context = (user, dates, extra = {}) => ({
    user,
    ip: `tour-${user?.id || "guest"}`,
    body: { artist: "API Tour Fixture 2822", releaseAt, dates, ...extra },
  });

  assert.throws(() => post({ ip: "tour-guest", body: context(artist, [{ venue: "Room", place: "Toronto, ON", date: showDate }]).body }),
    (error) => error.status === 401);
  assert.throws(() => post(context(other, [{ venue: "Room", place: "Toronto, ON", date: showDate }])),
    (error) => error.status === 403);
  assert.throws(() => post(context(moderator, [{ venue: "Room", place: "Toronto, ON", date: showDate }])),
    (error) => error.status === 403);
  assert.throws(() => post(context(artist, [{ venue: "Room", place: "Toronto, ON", date: showDate }], { artist: "Another Band" })),
    (error) => error.status === 403);

  const before = db.prepare("SELECT COUNT(*) c FROM tour_dates WHERE owner_id=?").get(artist.id).c;
  for (const invalidReleaseAt of [Date.now() - 1000, Date.now()]) {
    assert.throws(() => post(context(artist, [
      { venue: "Past Release Hall", place: "Toronto, Ontario", date: showDate, ticketUrl: "" },
    ], { releaseAt: invalidReleaseAt })), (error) => error.status === 400 && error.code === "VALIDATION_FAILED");
  }
  assert.equal(db.prepare("SELECT COUNT(*) c FROM tour_dates WHERE owner_id=?").get(artist.id).c, before,
    "a nonzero release time that is not future inserts nothing");
  assert.throws(() => post(context(artist, [
    { venue: "Valid Hall", place: "Toronto, Ontario", date: showDate, ticketUrl: "https://tickets.example.com/show" },
    { venue: "Bad Hall", place: "Montreal, Quebec", date: "not-a-date", ticketUrl: "javascript:alert(1)" },
  ])), (error) => error.code === "VALIDATION_FAILED");
  for (const ticketUrl of [
    "https://user:password@tickets.example.com/show",
    "https://tickets.example.com:8443/show",
    "https://ticketmaster.com.evil-site.com/show",
  ]) {
    assert.throws(() => post(context(artist, [
      { venue: "Unsafe Link Hall", place: "Montreal, Quebec", date: showDate, ticketUrl },
    ])), (error) => error.code === "VALIDATION_FAILED", ticketUrl);
  }
  assert.equal(db.prepare("SELECT COUNT(*) c FROM tour_dates WHERE owner_id=?").get(artist.id).c, before,
    "one invalid row leaves the entire batch unwritten");
  assert.throws(() => post(context(artist, [{ venue: "kill yourself", place: "Toronto, Ontario", date: showDate }])),
    (error) => error.code === "CONTENT_REJECTED");
  assert.throws(() => post(context(artist, Array.from({ length: 51 }, (_, index) => ({
    venue: `Hall ${index}`,
    place: "Toronto, Ontario",
    date: showDate,
  })))), (error) => error.code === "VALIDATION_FAILED");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM tour_dates WHERE owner_id=?").get(artist.id).c, before);

  const created = post(context(artist, [
    { venue: "  Valid Hall  ", place: " Toronto, Ontario ", date: showDate, ticketUrl: "https://tickets.example.com/show#checkout" },
    { venue: "Second Hall", place: "Montreal, Quebec", date: showDate, ticketUrl: "" },
  ])).tourDates;
  assert.equal(created.length, 2);
  assert.equal(created[0].artist, "API Tour Fixture 2822");
  assert.equal(created[0].venue, "Valid Hall");
  assert.equal(created[0].ticketUrl, "https://tickets.example.com/show");
  assert.equal(created[0].source, "artist-submitted");
  assert.equal(created[0].createdBy, artist.id);
  assert.equal(created[0].releaseAt, releaseAt);
  assert.equal(post(context(artist, [
    { venue: "Valid Hall", place: "Toronto, Ontario", date: showDate, ticketUrl: "https://tickets.example.com/show" },
    { venue: "Second Hall", place: "Montreal, Quebec", date: showDate, ticketUrl: "" },
  ])).tourDates.length, 2, "a lost-response retry returns the canonical rows");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM tour_dates WHERE owner_id=?").get(artist.id).c, before + 2);

  db.prepare(`INSERT INTO tour_dates
    (id,artist,venue,place,date,ticket_url,sold_out,source,updated_at,release_at)
    VALUES (?,?,?,?,?,?,0,?,?,?)`)
    .run("provider_release_compat", "Provider Band", "Provider Hall", "Ottawa, Ontario", showDate, "", "ticketmaster", Date.now(), releaseAt);
  const publicSharedDate = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  db.prepare(`INSERT INTO tour_dates
    (id,artist,venue,place,date,ticket_url,sold_out,source,updated_at,release_at,
      event_image_url,event_image_attribution,event_image_width,event_image_height)
    VALUES (?,?,?,?,?,?,0,?,?,0,?,?,?,?)`)
    .run("provider_shared_release", "Provider Band", "Valid Hall", "Toronto, Ontario", publicSharedDate,
      "https://www.ticketmaster.ca/event/1#buy", "ticketmaster", Date.now(),
      "https://s1.ticketm.net/dam/a/provider/show.jpg", "Ticketmaster / promoter", 1920, 1080);
  db.prepare(`INSERT INTO tour_dates
    (id,artist,venue,place,date,ticket_url,sold_out,source,updated_at,release_at,
      event_image_url,event_image_attribution,event_image_width,event_image_height)
    VALUES (?,?,?,?,?,?,0,?,?,0,?,?,?,?)`)
    .run("provider_unsafe_ticket", "Provider Band", "Unsafe Hall", "Toronto, Ontario", publicSharedDate,
      "https://ticketmaster.com.evil-site.com/phish", "ticketmaster", Date.now(),
      "https://s1.ticketm.net/dam/a/provider/unsafe.jpg", "Ticketmaster", 1920, 1080);
  const publicTourDates = routes["GET /api/tourdates"]({}).tourDates;
  const publicSharedTourDate = publicTourDates.find((row) => row.id === "provider_shared_release");
  assert.equal(publicSharedTourDate?.ticketUrl, "https://www.ticketmaster.ca/event/1");
  assert.deepEqual(publicSharedTourDate?.eventImage, {
    uri: "https://s1.ticketm.net/dam/a/provider/show.jpg",
    attribution: "Ticketmaster / promoter",
    width: 1920,
    height: 1080,
    sourcePage: "https://www.ticketmaster.ca/event/1",
  });
  const unsafeTicketTourDate = publicTourDates.find((row) => row.id === "provider_unsafe_ticket");
  assert.equal(unsafeTicketTourDate?.ticketUrl, "",
    "unsafe legacy provider destinations are retained as dates but dropped from public projection");
  assert.equal(unsafeTicketTourDate?.eventImage, null,
    "provider imagery fails closed when its public Ticketmaster source page does not validate");
  const guestIds = new Set(routes["GET /api/tourdates"]({}).tourDates.map((row) => row.id));
  const otherIds = new Set(routes["GET /api/tourdates"]({ user: other }).tourDates.map((row) => row.id));
  const ownerIds = new Set(routes["GET /api/tourdates"]({ user: artist }).tourDates.map((row) => row.id));
  const adminIds = new Set(routes["GET /api/tourdates"]({ user: admin }).tourDates.map((row) => row.id));
  assert.equal(guestIds.has(created[0].id), false);
  assert.equal(otherIds.has(created[0].id), false);
  assert.equal(ownerIds.has(created[0].id), true);
  assert.equal(adminIds.has(created[0].id), true);
  assert.equal(guestIds.has("provider_release_compat"), true, "pre-attribution provider rows stay public");
  assert.equal(routes["GET /api/discovery/sidebar"]({}).upcomingEvents.some((row) => row.id === created[0].id), false);
  const guestDiscovery = discoverySidebar(null, { eventLimit: 5000, venueLimit: 5000 });
  assert.equal(guestDiscovery.upcomingEvents.find((row) => row.id === "provider_unsafe_ticket")?.ticketUrl, "",
    "direct discovery-service callers receive the same revalidated ticket projection");
  assert.deepEqual(guestDiscovery.upcomingEvents.find((row) => row.id === "provider_shared_release")?.eventImage,
    publicSharedTourDate.eventImage,
    "tour-date and discovery projections expose the same attributed provider image descriptor");
  assert.equal(guestDiscovery.upcomingEvents.find((row) => row.id === "provider_unsafe_ticket")?.eventImage, null);
  const guestSharedVenue = guestDiscovery.trendingVenues.find((row) => row.name === "Valid Hall");
  assert.equal(guestSharedVenue?.upcoming, 1, "hidden dates do not influence a public venue count");
  assert.equal(guestSharedVenue?.nextDate, publicSharedDate, "hidden dates do not reveal a venue's unreleased next date");
  assert.equal(guestDiscovery.upcomingEvents.some((row) => row.id === created[0].id), false,
    "the discovery service itself excludes hidden dates before ranking");
  const ownerSidebarDate = routes["GET /api/discovery/sidebar"]({ user: artist }).upcomingEvents.find((row) => row.id === created[0].id);
  assert.equal(ownerSidebarDate?.releaseAt, releaseAt);
  assert.equal(ownerSidebarDate?.createdBy, artist.id);
  const ownerDiscovery = discoverySidebar(artist, { eventLimit: 5000, venueLimit: 5000 });
  const ownerSharedVenue = ownerDiscovery.trendingVenues.find((row) => row.name === "Valid Hall");
  assert.equal(ownerSharedVenue?.upcoming, 2, "the owner can preview their unreleased date in discovery");
  assert.equal(ownerSharedVenue?.nextDate, showDate);
  db.prepare("UPDATE tour_dates SET release_at=? WHERE owner_id=?").run(Date.now() - 1, artist.id);
  assert.equal(routes["GET /api/tourdates"]({}).tourDates.some((row) => row.id === created[0].id), true);
  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)")
    .run(artist.id, other.id, Date.now());
  assert.equal(routes["GET /api/tourdates"]({ user: other }).tourDates.some((row) => row.id === created[0].id), false,
    "a released artist-owned date remains hidden across a bilateral block");
  const blockedDiscovery = discoverySidebar(other, { eventLimit: 5000, venueLimit: 5000 });
  const blockedSharedVenue = blockedDiscovery.trendingVenues.find((row) => row.name === "Valid Hall");
  assert.equal(blockedDiscovery.upcomingEvents.some((row) => row.id === created[0].id), false);
  assert.equal(blockedSharedVenue?.upcoming, 1, "blocked dates do not affect discovery aggregates");
  assert.equal(blockedSharedVenue?.nextDate, publicSharedDate);
  db.prepare("DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?").run(artist.id, other.id);

  const adminRows = post(context(admin, [{ venue: "Admin Hall", place: "Calgary, Alberta", date: showDate, ticketUrl: "" }], { releaseAt: 0 })).tourDates;
  assert.equal(adminRows[0].source, "admin-submitted");
  const memorialAt = Date.now();
  const memorialMbid = "11111111-1111-4111-8111-111111111111";
  db.prepare(`INSERT INTO artists (norm,name,mbid,created_at,updated_at)
    VALUES (?,?,?,?,?) ON CONFLICT(norm) DO UPDATE SET name=excluded.name,mbid=excluded.mbid,updated_at=excluded.updated_at`)
    .run("api tour fixture 2822", "API Tour Fixture 2822", memorialMbid, memorialAt, memorialAt);
  db.prepare(`INSERT INTO artist_memorials (
      artist_key,artist_name,artist_mbid,status,death_date,summary,thank_you,accomplishments,
      source_url,published_at,spotlight_started_at,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run("api tour fixture 2822", "API Tour Fixture 2822", memorialMbid, "published", "2026-08-28",
      "A verified memorial used to keep future tour dates off every live product surface.",
      "Thank you for the music.", JSON.stringify(["A lasting live legacy"]),
      "https://example.com/authority-band-memorial", memorialAt, memorialAt, memorialAt, memorialAt);
  assert.throws(() => post(context(artist, [
    { venue: "Future Memorial Hall", place: "Toronto, Ontario", date: showDate },
  ], { releaseAt: 0 })),
  (error) => error.status === 409 && error.code === "ARTIST_MEMORIALIZED");
  const historicalMemorialDate = "2001-06-15";
  const historicalRows = post(context(artist, [
    { venue: "Memorial Archive Hall", place: "Toronto, Ontario", date: historicalMemorialDate },
  ], { releaseAt: 0 })).tourDates;
  assert.equal(historicalRows.length, 1, "a memorial must not erase or block legitimate historical archive imports");
  assert.equal(historicalRows[0].date, historicalMemorialDate);
  assert.equal(routes["GET /api/tourdates"]({ user: admin }).tourDates
    .some((row) => row.artist === "API Tour Fixture 2822"), false,
  "memorialized artists have no current or future dates even for staff");
  assert.equal(routes["GET /api/discovery/sidebar"]({ user: artist }).upcomingEvents
    .some((row) => row.artist === "API Tour Fixture 2822"), false,
  "memorialized artists have no current or future dates in discovery");
  db.prepare("DELETE FROM artist_memorials WHERE artist_key=?").run("api tour fixture 2822");
  db.prepare("DELETE FROM artists WHERE norm=?").run("api tour fixture 2822");
  db.prepare("DELETE FROM tour_dates WHERE owner_id IN (?,?) OR id IN (?,?,?)")
    .run(artist.id, admin.id, "provider_release_compat", "provider_shared_release", "provider_unsafe_ticket");
});

test("tour-date range browsing is bounded, cursor-paged, canonical-location scoped, and privacy safe", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const dateAt = (days) => new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
  const hiddenOwner = addUser("u_range_hidden", "range-hidden@example.com", "rangehidden");
  const ids = [
    "range_api_active", "range_api_ca_10", "range_api_ca_20", "range_api_ca_30",
    "range_api_us_5", "range_api_ca_100", "range_api_hidden",
  ];
  const insert = db.prepare(`INSERT INTO tour_dates (
    id,artist,venue,place,date,ticket_url,sold_out,source,updated_at,owner_id,release_at,
    venue_city,venue_region,venue_country_code,venue_country,music_qualified,provider_active,
    event_kind,event_end_date,event_timezone
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const add = ({ id, days, countryCode = "CA", country = "Canada", ownerId = null,
    releaseAt = 0, eventKind = "concert", eventEndDate = null }) => insert.run(
    id, `Artist ${id}`, "Range Hall", `Rangeville, Ontario, ${country}`, dateAt(days), "", 0,
    ownerId ? "artist-submitted" : "ticketmaster", Date.now(), ownerId, releaseAt,
    "Rangeville", "Ontario", countryCode, country, 1, 1, eventKind, eventEndDate, "America/Toronto",
  );
  const rangeIndexes = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='index' AND name IN (
      'idx_tourdates_range_country_code_city_date',
      'idx_tourdates_range_country_city_date',
      'idx_tourdates_range_country_code_date',
      'idx_tourdates_range_country_date'
    )
    ORDER BY name
  `).all().map((row) => row.name);
  assert.deepEqual(rangeIndexes, [
    "idx_tourdates_range_country_city_date",
    "idx_tourdates_range_country_code_city_date",
    "idx_tourdates_range_country_code_date",
    "idx_tourdates_range_country_date",
  ], "bounded location/date browsing keeps its covering indexes");
  const countryCodePlan = db.prepare(`EXPLAIN QUERY PLAN
    SELECT id FROM tour_dates
    WHERE venue_country_code=? COLLATE NOCASE AND date>=?
    ORDER BY date,id LIMIT ?`).all("CA", dateAt(0), 20);
  assert.match(countryCodePlan.map((row) => row.detail).join(" "),
    /idx_tourdates_range_country_code_date/,
    "country-only range browsing uses the country-code/date cursor index");
  const countryNamePlan = db.prepare(`EXPLAIN QUERY PLAN
    SELECT id FROM tour_dates
    WHERE venue_country=? COLLATE NOCASE AND date>=?
    ORDER BY date,id LIMIT ?`).all("Canada", dateAt(0), 20);
  assert.match(countryNamePlan.map((row) => row.detail).join(" "),
    /idx_tourdates_range_country_date/,
    "country-only range browsing uses the country-name/date cursor index");

  try {
    add({ id: ids[0], days: -3, eventKind: "fair", eventEndDate: dateAt(2) });
    add({ id: ids[1], days: 10 });
    add({ id: ids[2], days: 20 });
    add({ id: ids[3], days: 30 });
    add({ id: ids[4], days: 5, countryCode: "US", country: "United States" });
    add({ id: ids[5], days: 100 });
    add({ id: ids[6], days: 15, ownerId: hiddenOwner.id, releaseAt: Date.now() + DAY_MS });

    const route = routes["GET /api/tourdates"];
    assert.deepEqual(Object.keys(route({})), ["tourDates"],
      "the no-query response shape remains backward compatible");

    const first = route({ query: { days: "90", limit: "2", city: "Rangeville", country: "Canada" } });
    assert.deepEqual(first.tourDates.map((row) => row.id), [ids[0], ids[1]],
      "a currently active multi-day event stays pinned inside the range");
    assert.ok(first.nextCursor);
    assert.deepEqual(first.range, {
      days: 90,
      through: dateAt(90),
      city: "Rangeville",
      country: "Canada",
    });

    const second = route({ query: {
      days: "90", limit: "2", city: "Rangeville", country: "Canada", after: first.nextCursor,
    } });
    assert.deepEqual(second.tourDates.map((row) => row.id), [ids[2], ids[3]]);
    assert.equal(second.nextCursor, null);
    assert.equal([...first.tourDates, ...second.tourDates].some((row) => row.id === ids[4]), false,
      "a different canonical country cannot crowd into the page");
    assert.equal([...first.tourDates, ...second.tourDates].some((row) => row.id === ids[5]), false,
      "events beyond the requested 90-day window stay out");
    assert.equal([...first.tourDates, ...second.tourDates].some((row) => row.id === ids[6]), false,
      "an unreleased artist-owned date remains private");

    const byCode = route({ query: { days: "90", limit: "20", city: "Rangeville", country: "CA" } });
    assert.deepEqual(byCode.tourDates.map((row) => row.id), [ids[0], ids[1], ids[2], ids[3]],
      "two-letter codes use the canonical provider country code");

    const sidebar = routes["GET /api/discovery/sidebar"]({
      query: { days: "90", limit: "2", city: "Rangeville", country: "CA" },
    });
    assert.deepEqual(sidebar.upcomingEvents.map((row) => row.id), [ids[0], ids[1]],
      "the opt-in sidebar range uses the same bounded canonical location filter");

    const clamped = route({ query: { days: "999", limit: "999", city: "Rangeville", country: "CA" } });
    assert.equal(clamped.range.days, 90);
    assert.throws(() => route({ query: {
      days: "90", limit: "20", city: "Rangeville", country: "CA", after: "not-a-cursor",
    } }), (error) => error.status === 400 && error.code === "VALIDATION_FAILED");
    assert.throws(() => route({ query: {
      days: "90", limit: "20", city: "Rangeville", country: "CA", after: "a".repeat(1001),
    } }), (error) => error.status === 400 && error.code === "VALIDATION_FAILED");
  } finally {
    db.prepare(`DELETE FROM tour_dates WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);
    db.prepare("DELETE FROM users WHERE id=?").run(hiddenOwner.id);
  }
});

test("tour-date range pagination fills pages after the timezone safety overlap", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const dateAt = (days) => new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
  const insert = db.prepare(`INSERT INTO tour_dates (
    id,artist,venue,place,date,ticket_url,sold_out,source,updated_at,release_at,
    venue_city,venue_region,venue_country_code,venue_country,music_qualified,provider_active,
    event_kind,event_timezone
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const expiredIds = Array.from({ length: 520 }, (_, index) => `range_scan_expired_${String(index).padStart(3, "0")}`);
  const futureIds = Array.from({ length: 45 }, (_, index) => `range_scan_future_${String(index).padStart(3, "0")}`);
  const add = (id, date) => insert.run(
    id, `Artist ${id}`, "Paging Hall", "Paging City, Testland", date, "", 0,
    "ticketmaster", Date.now(), 0, "Paging City", "Test Region", "ZZ", "Testland",
    1, 1, "concert", "UTC",
  );

  try {
    db.exec("BEGIN");
    for (const id of expiredIds) add(id, dateAt(-1));
    for (const id of futureIds) add(id, dateAt(1));
    db.exec("COMMIT");

    const route = routes["GET /api/tourdates"];
    const first = route({ query: { days: "30", limit: "2", city: "Paging City", country: "ZZ" } });
    assert.deepEqual(first.tourDates.map((row) => row.id), futureIds.slice(0, 2),
      "completed rows admitted by the one-day SQL overlap cannot consume the visible page limit");
    assert.ok(first.nextCursor);
    const second = route({ query: {
      days: "30", limit: "2", city: "Paging City", country: "ZZ", after: first.nextCursor,
    } });
    assert.deepEqual(second.tourDates.map((row) => row.id), futureIds.slice(2, 4),
      "the visible-row cursor continues without gaps or duplicate concerts");

    const sidebar = routes["GET /api/discovery/sidebar"]({
      query: { days: "30", limit: "45", city: "Paging City", country: "ZZ" },
    });
    assert.equal(sidebar.upcomingEvents.length, 45,
      "the opt-in range sidebar is not truncated by the legacy eight-card default or old 40-row cap");
  } finally {
    try { db.exec("ROLLBACK"); }
    catch { /* test cleanup: the committed fixture has no active transaction */ }
    db.prepare("DELETE FROM tour_dates WHERE id LIKE 'range_scan_expired_%' OR id LIKE 'range_scan_future_%'").run();
  }
});

test("verified special-event batches are admin-only, evidence-backed, and fully projected", () => {
  const artistSeed = addUser("u_special_artist", "special-artist@example.com", "specialartist");
  const adminSeed = addUser("u_special_admin", "special-admin@example.com", "specialadmin");
  db.prepare("UPDATE users SET role='artist',artist_name='The Beaches' WHERE id=?").run(artistSeed.id);
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(adminSeed.id);
  const artist = q.userById.get(artistSeed.id);
  const admin = q.userById.get(adminSeed.id);
  const post = routes["POST /api/tourdates"];
  const startAt = Date.now() + 120 * 86400000;
  const date = new Date(startAt).toISOString().slice(0, 10);
  const endDate = new Date(startAt + 17 * 86400000).toISOString().slice(0, 10);
  const beforeDate = new Date(startAt - 86400000).toISOString().slice(0, 10);
  const special = {
    venue: "Bandshell Park",
    place: "Toronto, Ontario, Canada",
    date,
    ticketUrl: "https://www.theex.com/tickets/",
    eventName: "Canadian National Exhibition",
    eventKind: "fair",
    eventEndDate: endDate,
    billedArtists: ["The Beaches", "The Reklaws", "Aysanabee"],
    eventSourceUrl: "https://www.theex.com/?view=music#schedule",
  };
  const context = (user, entry, ip) => ({
    user,
    ip,
    body: { artist: "The Beaches", releaseAt: 0, dates: [entry] },
  });

  assert.throws(
    () => post(context(artist, special, "special-event-artist")),
    (error) => error instanceof ApiError && error.status === 403 && error.code === "FORBIDDEN",
    "an artist may publish ordinary dates, but cannot self-certify a parent event",
  );
  assert.equal(db.prepare("SELECT COUNT(*) count FROM tour_dates WHERE owner_id=?").get(artist.id).count, 0);

  for (const [label, patch] of [
    ["an end before the start", { eventEndDate: beforeDate }],
    ["a same-day multi-day event", { eventKind: "multi_day", eventEndDate: date }],
    ["an insecure evidence URL", { eventSourceUrl: "http://www.theex.com/music" }],
    ["a credential-bearing evidence URL", { eventSourceUrl: "https://staff:secret@www.theex.com/music" }],
  ]) {
    assert.throws(
      () => post(context(admin, { ...special, ...patch }, `special-event-invalid-${label.replace(/\W+/g, "-")}`)),
      (error) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_FAILED",
      label,
    );
  }
  assert.equal(db.prepare("SELECT COUNT(*) count FROM tour_dates WHERE owner_id=?").get(admin.id).count, 0,
    "validation must finish before the batch writes anything");

  const created = post(context(admin, special, "special-event-admin")).tourDates;
  assert.equal(created.length, 1);
  assert.deepEqual({
    artist: created[0].artist,
    venue: created[0].venue,
    date: created[0].date,
    source: created[0].source,
    createdBy: created[0].createdBy,
    eventName: created[0].eventName,
    eventKind: created[0].eventKind,
    eventEndDate: created[0].eventEndDate,
    eventSourceUrl: created[0].eventSourceUrl,
    billedArtists: created[0].billedArtists,
  }, {
    artist: "The Beaches",
    venue: "Bandshell Park",
    date,
    source: "admin-submitted",
    createdBy: admin.id,
    eventName: "Canadian National Exhibition",
    eventKind: "fair",
    eventEndDate: endDate,
    eventSourceUrl: "https://www.theex.com/?view=music",
    billedArtists: ["The Beaches", "The Reklaws", "Aysanabee"],
  });

  const stored = db.prepare(`SELECT event_name,event_kind,event_end_date,event_source_url,
    billed_artists,music_evidence,music_qualified FROM tour_dates WHERE id=?`).get(created[0].id);
  assert.deepEqual({
    eventName: stored.event_name,
    eventKind: stored.event_kind,
    eventEndDate: stored.event_end_date,
    eventSourceUrl: stored.event_source_url,
    billedArtists: JSON.parse(stored.billed_artists),
    evidence: stored.music_evidence,
    qualified: stored.music_qualified,
  }, {
    eventName: "Canadian National Exhibition",
    eventKind: "fair",
    eventEndDate: endDate,
    eventSourceUrl: "https://www.theex.com/?view=music",
    billedArtists: ["The Beaches", "The Reklaws", "Aysanabee"],
    evidence: "staff:verified-official-source",
    qualified: 1,
  });

  const publicRow = routes["GET /api/tourdates"]({}).tourDates.find((row) => row.id === created[0].id);
  assert.ok(publicRow, "an immediately released verified event is publicly readable");
  assert.equal(publicRow.eventName, "Canadian National Exhibition");
  assert.equal(publicRow.eventKind, "fair");
  assert.equal(publicRow.eventEndDate, endDate);
  assert.equal(publicRow.eventSourceUrl, "https://www.theex.com/?view=music");
  assert.deepEqual(publicRow.billedArtists, ["The Beaches", "The Reklaws", "Aysanabee"]);

  db.prepare("DELETE FROM tour_dates WHERE id=?").run(created[0].id);
});

test("attendee pages expose a block-aware authoritative total beyond the page cap", () => {
  const viewer = addUser("u_attendee_viewer", "attendee-viewer@example.com", "attendeeviewer");
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), viewer.id);
  const verifiedViewer = q.userById.get(viewer.id);
  const key = "authority-band|large-hall|2099-01-01";
  const attendees = Array.from({ length: 55 }, (_, index) => verifiedUser(
    `u_attendee_${index}`,
    `attendee-${index}@example.com`,
    `attendee${index}`,
  ));
  const insert = db.prepare(`INSERT INTO going
    (user_id,concert_key,artist,venue,city,date,created_at) VALUES (?,?,?,?,?,?,?)`);
  attendees.forEach((user, index) => insert.run(user.id, key, "Authority Band", "Large Hall", "Toronto", "2099-01-01", 1000 + index));
  db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(attendees[1].id);
  db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 86400000, attendees[2].id);

  const read = (query = {}) => routes["GET /api/going/:key/attendees"]({
    user: verifiedViewer,
    params: { key: encodeURIComponent(key) },
    query: { limit: "50", ...query },
  });
  const first = read();
  assert.equal(first.total, 53);
  assert.equal(first.attendees.length, 50);
  assert.equal(typeof first.nextCursor, "string");
  const second = read({ before: first.nextCursor });
  assert.equal(second.total, 53);
  assert.equal(second.attendees.length, 3);
  assert.equal(second.nextCursor, null);
  const visibleIds = new Set([...first.attendees, ...second.attendees].map((user) => user.id));
  assert.equal(visibleIds.size, 53);
  assert.equal(visibleIds.has(attendees[1].id), false);
  assert.equal(visibleIds.has(attendees[2].id), false);
  const guest = routes["GET /api/going/:key/attendees"]({
    params: { key: encodeURIComponent(key) },
    query: { limit: "1" },
  });
  assert.equal(guest.total, 53);
  assert.deepEqual(guest.attendees, [], "logged-out show pages receive only the aggregate attendance count");
  assert.equal(guest.nextCursor, null);

  routes["POST /api/users/:id/block"]({
    user: verifiedViewer,
    ip: "attendee-total-block",
    params: { id: attendees[0].id },
    body: { blocked: true },
  });
  const blocked = read();
  assert.equal(blocked.total, 52);
  assert.equal(blocked.attendees.some((user) => user.id === attendees[0].id), false);
  assert.equal(blocked.attendees.some((user) => user.id === attendees[1].id || user.id === attendees[2].id), false);
});

test("feed cursor pagination is stable while offset remains compatible", () => {
  db.prepare("DELETE FROM posts").run();
  const user = addUser("u_feed_cursor", "feed-cursor@example.com", "feedcursor");
  for (let i = 1; i <= 7; i++) {
    db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,created_at) VALUES (?,?,?,?,?,?)")
      .run(`cursor_post_${i}`, user.id, "Artist", "Venue", 4, 1000 + i);
  }
  const first = routes["GET /api/feed"]({ user: null, query: { limit: "3" } });
  assert.deepEqual(first.posts.map((p) => p.id), ["cursor_post_7", "cursor_post_6", "cursor_post_5"]);
  assert.equal(typeof first.nextCursor, "string");
  const second = routes["GET /api/feed"]({ user: null, query: { limit: "3", before: first.nextCursor } });
  assert.deepEqual(second.posts.map((p) => p.id), ["cursor_post_4", "cursor_post_3", "cursor_post_2"]);
  const offset = routes["GET /api/feed"]({ user: null, query: { limit: "2", offset: "2" } });
  assert.deepEqual(offset.posts.map((p) => p.id), ["cursor_post_5", "cursor_post_4"]);
});

test("discovery sidebar returns real top artists and local-first shows and venues", () => {
  const user = addUser("u_sidebar", "sidebar@example.com", "sidebaruser");
  const insert = db.prepare(`INSERT INTO tour_dates
    (id,artist,venue,place,lat,lng,date,ticket_url,sold_out,source,updated_at,
      venue_city,venue_region,venue_country_code,event_name,event_kind,music_qualified,
      music_evidence,billed_artists,event_end_date,event_timezone)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run("tm_sidebar_far", "Far Artist", "Far Hall", "Vancouver, British Columbia, Canada", 49.2827, -123.1207, "2099 · 08 · 20", "https://tickets.example/far", 0, "ticketmaster", Date.now(),
    "Vancouver", "British Columbia", "CA", null, "concert", 1, null, "[]", null, "America/Vancouver");
  insert.run("tm_sidebar_local", "Local Artist", "Local Hall", "Not Toronto, Elsewhere", 43.6532, -79.3832, "2099 · 09 · 01", "https://tickets.example/local", 0, "ticketmaster", Date.now(),
    "Toronto", "Ontario", "CA", "Toronto Music Festival", "festival", 1,
    "ticketmaster:classification:music", '["Local Artist","Guest Artist"]', "2099-09-03", "America/Toronto");
  insert.run("tm_sidebar_non_music", "Unknown", "Nearby Field", "Toronto, Ontario, Canada", 43.6533, -79.3833, "2099 · 08 · 01", null, 0, "ticketmaster", Date.now(),
    "Toronto", "Ontario", "CA", "State Fair", "fair", 0, null, "[]", null, "America/Toronto");
  insert.run("tm_sidebar_active_region", "Regional Artist", "Regional Fairgrounds", "Hamilton, Ontario, Canada", null, null, "2099 · 08 · 29", "https://www.ticketmaster.ca/event/active-fair", 0, "ticketmaster", Date.now(),
    "Hamilton", "Ontario", "CA", "Ontario Summer Fair", "fair", 1,
    "ticketmaster:classification:music", '["Regional Artist"]', "2099-09-05", "America/Toronto");

  const result = routes["GET /api/discovery/sidebar"]({ user });
  assert.ok(result.topArtists.length >= 3);
  assert.equal(result.upcomingEvents[0].id, "tm_sidebar_local");
  assert.equal(result.upcomingEvents[0].local, true);
  assert.equal(result.upcomingEvents[0].eventName, "Toronto Music Festival");
  assert.equal(result.upcomingEvents[0].eventKind, "festival");
  assert.deepEqual(result.upcomingEvents[0].billedArtists, ["Local Artist", "Guest Artist"]);
  assert.equal(result.upcomingEvents.some((event) => event.id === "tm_sidebar_non_music"), false);
  assert.equal(result.trendingVenues[0].name, "Local Hall");
  assert.equal(result.location.city, "Toronto");
  const duringRegionalFair = discoverySidebar(user, {
    at: Date.parse("2099-08-31T12:00:00.000Z"),
    eventLimit: 1,
    venueLimit: 1,
    loungeLimit: 0,
  });
  assert.equal(duringRegionalFair.upcomingEvents[0]?.id, "tm_sidebar_active_region",
    "an active event in the local tier leads exact-city future announcements before event trimming");
  assert.equal(duringRegionalFair.trendingVenues[0]?.name, "Local Hall",
    "venue ranking remains exact-locality-first");
  const finalTorontoEvening = discoverySidebar(user, {
    at: Date.parse("2099-09-06T02:30:00.000Z"),
    eventLimit: 5000,
    loungeLimit: 0,
  });
  const finalEveningFair = finalTorontoEvening.upcomingEvents.find((event) => event.id === "tm_sidebar_active_region");
  assert.equal(finalEveningFair?.eventTimezone, "America/Toronto");
  assert.ok(finalEveningFair,
    "Render UTC must not filter an event while its inclusive final day is still active at the venue");
  const afterTorontoFinalDay = discoverySidebar(user, {
    at: Date.parse("2099-09-06T05:30:00.000Z"),
    eventLimit: 5000,
    loungeLimit: 0,
  });
  assert.equal(afterTorontoFinalDay.upcomingEvents.some((event) => event.id === "tm_sidebar_active_region"), false);
  const afterFixture = discoverySidebar(user, {
    at: Date.parse("2100-01-01T00:00:00.000Z"),
    loungeLimit: 0,
  });
  assert.equal(afterFixture.upcomingEvents.some((event) => event.id === "tm_sidebar_local"), false,
    "the supplied clock governs the upcoming-event boundary");
});

test("popular lounge discovery is signed-in, aggregate-only, recent, and bounded", () => {
  const directoryIndexes = new Set(db.prepare(`SELECT name FROM sqlite_master
    WHERE type='index' AND name IN ('idx_lounge_recent_directory','idx_going_lounge_identity')`).all()
    .map((row) => row.name));
  assert.deepEqual(directoryIndexes,
    new Set(["idx_lounge_recent_directory", "idx_going_lounge_identity"]));
  const member = addUser("u_lounge_directory", "lounge-directory@example.com", "loungedirectory");
  const key = "directory band|directory room|2099-09-05";
  db.prepare("INSERT INTO going (user_id,concert_key,artist,venue,city,date,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(member.id, key, "Directory Band", "Directory Room", "Toronto", "2099-09-05", Date.now());
  db.prepare("INSERT INTO lounge_messages (id,lounge_id,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("lm_lounge_directory", key, member.id, "members only message", Date.now());

  // Advance past any discovery result cached by the preceding test. The public
  // projection itself must contain no member identity or message body.
  const signedIn = discoverySidebar(member, { loungeLimit: 12, at: Date.now() + 120_000 });
  assert.ok(signedIn.popularLounges.length <= 12);
  const directoryLounge = signedIn.popularLounges.find((row) => row.key === key);
  assert.ok(directoryLounge);
  assert.deepEqual(directoryLounge, {
    key,
    artist: "Directory Band",
    venue: "Directory Room",
    city: "Toronto",
    place: "Toronto",
    date: "2099-09-05",
    messageCount: 1,
    attendeeCount: 1,
    lastActivityAt: directoryLounge.lastActivityAt,
  });
  assert.equal("text" in directoryLounge, false);
  assert.equal("userId" in directoryLounge, false);

  const guest = discoverySidebar(null, { loungeLimit: 12, at: Date.now() + 240_000 });
  assert.deepEqual(guest.popularLounges, []);
  const landing = routes["GET /api/landing/media"]({ user: null, query: {}, setHeader() {} });
  assert.equal(Object.hasOwn(landing, "live"), false,
    "landing media does not duplicate the existing discovery request");
});

test("rewards use authoritative server activity and persist each award once", () => {
  const user = addUser("u_rewards", "rewards@example.com", "rewardsuser");
  const fan = addUser("u_rewards_fan", "rewards-fan@example.com", "rewardsfan");
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,city,overall,review,photos,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run("post_rewards", user.id, "Artist One", "Venue One", "Toronto", 4.5, "A proper review", '["https://cdn.example/photo.jpg"]', 100);
  db.prepare("INSERT INTO likes (post_id,user_id) VALUES (?,?)").run("post_rewards", fan.id);
  db.prepare("INSERT INTO follows (follower_id,followee_id) VALUES (?,?)").run(user.id, fan.id);
  db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)").run("artist one", user.id);

  const handler = routes["GET /api/users/:id/rewards"];
  const first = handler({ user, params: { id: user.id } });
  const second = handler({ user, params: { id: user.id } });
  assert.equal(first.stats.shows, 1);
  assert.equal(first.stats.reviews, 1);
  assert.equal(first.stats.likes, 1);
  assert.equal(first.stats.photos, 1);
  assert.ok(first.earnedIds.includes("first_show"));
  assert.deepEqual(second.earnedIds, first.earnedIds);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM user_achievements WHERE user_id=? AND badge_id='first_show'").get(user.id).c, 1);
});

test("status posts earn social rewards but never concert achievements", () => {
  const user = addUser("u_status_rewards", "status-rewards@example.com", "statusrewards");
  const fans = Array.from({ length: 4 }, (_, i) =>
    addUser(`u_status_rewards_fan_${i}`, `status-rewards-fan-${i}@example.com`, `statusfan${i}`));
  const insertStatus = db.prepare(`INSERT INTO posts
    (id,user_id,kind,artist,venue,city,overall,review,photos,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const like = db.prepare("INSERT INTO likes (post_id,user_id) VALUES (?,?)");

  for (let i = 0; i < 25; i += 1) {
    const postId = `post_status_rewards_${i}`;
    insertStatus.run(
      postId, user.id, "status", `Status Artist ${i}`, "", `Status City ${i}`,
      0, `Ordinary update ${i}`, JSON.stringify([`https://cdn.example/status-${i}.jpg`]), 100 + i
    );
    for (const fan of fans) like.run(postId, fan.id);
  }
  for (let i = 0; i < 3; i += 1) {
    db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)").run(`status rewards club ${i}`, user.id);
  }

  const handler = routes["GET /api/users/:id/rewards"];
  const socialOnly = handler({ user, params: { id: user.id } });
  assert.deepEqual(
    {
      shows: socialOnly.stats.shows,
      reviews: socialOnly.stats.reviews,
      photos: socialOnly.stats.photos,
      cities: socialOnly.stats.cities,
      artists: socialOnly.stats.artists,
    },
    { shows: 0, reviews: 0, photos: 0, cities: 0, artists: 0 }
  );
  assert.equal(socialOnly.stats.likes, 100);
  assert.equal(socialOnly.stats.fanClubs, 3);
  assert.ok(socialOnly.earnedIds.includes("tastemaker"));
  assert.ok(socialOnly.earnedIds.includes("superfan"));
  for (const id of ["first_show", "regular", "road_warrior", "critic", "photographer", "globetrotter", "explorer"]) {
    assert.ok(!socialOnly.earnedIds.includes(id), `${id} must ignore status posts`);
  }

  db.prepare(`INSERT INTO posts
    (id,user_id,kind,artist,venue,city,overall,review,photos,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run("post_status_rewards_real_show", user.id, "review", "Real Artist", "Real Venue", "Toronto", 4.5, "A real show review", '["https://cdn.example/show.jpg"]', 200);

  const withShow = handler({ user, params: { id: user.id } });
  assert.equal(withShow.stats.shows, 1);
  assert.equal(withShow.stats.reviews, 1);
  assert.equal(withShow.stats.photos, 1);
  assert.equal(withShow.stats.cities, 1);
  assert.equal(withShow.stats.artists, 1);
  assert.ok(withShow.earnedIds.includes("first_show"));
  assert.ok(withShow.earnedIds.includes("tastemaker"));
  assert.ok(withShow.earnedIds.includes("superfan"));
  assert.equal(
    db.prepare("SELECT definition_version FROM user_achievements WHERE user_id=? AND badge_id='first_show'").get(user.id).definition_version,
    2
  );
});

test("reward rule v2 preserves ambiguous legacy awards instead of revoking legitimate history", () => {
  const user = addUser("u_legacy_rewards", "legacy-rewards@example.com", "legacyrewards");
  db.prepare(`INSERT INTO user_achievements
    (user_id,badge_id,definition_version,points,earned_at,progress_snapshot)
    VALUES (?,?,?,?,?,?)`)
    .run(user.id, "first_show", 1, 25, 100, JSON.stringify({ shows: 1 }));

  const rewards = routes["GET /api/users/:id/rewards"]({ user, params: { id: user.id } });
  assert.equal(rewards.stats.shows, 0);
  assert.ok(rewards.earnedIds.includes("first_show"));
  assert.equal(rewards.points, 25);
  assert.equal(
    db.prepare("SELECT definition_version FROM user_achievements WHERE user_id=? AND badge_id='first_show'").get(user.id).definition_version,
    1
  );
});

test("blocking closes direct profile, content, interaction, and community read paths", () => {
  const blocker = addUser("u_block_matrix_a", "block-matrix-a@example.com", "blockmatrixa");
  const blocked = addUser("u_block_matrix_b", "block-matrix-b@example.com", "blockmatrixb");
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), blocker.id);
  const verifiedBlocker = q.userById.get(blocker.id);
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,created_at) VALUES (?,?,?,?,?,?)").run("post_block_matrix", blocked.id, "Artist", "Venue", 4, 100);
  db.prepare("INSERT INTO playlists (id,user_id,name,tracks,created_at) VALUES (?,?,?,?,?)").run("playlist_block_matrix", blocked.id, "List", '[{"title":"Song"}]', 100);
  db.prepare("INSERT INTO fan_club_messages (id,artist,user_id,text,created_at) VALUES (?,?,?,?,?)").run("fan_block_matrix", "artist", blocked.id, "hidden", 100);
  db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)").run("artist", blocker.id);
  db.prepare("INSERT INTO going (user_id,concert_key,artist,venue) VALUES (?,?,?,?)").run(blocked.id, "show-block-matrix", "Artist", "Venue");
  db.prepare("INSERT INTO venue_reviews (id,venue_key,user_id,rating,text,created_at) VALUES (?,?,?,?,?,?)").run("venue_block_matrix", "venue", blocked.id, 4, "hidden", 100);
  db.prepare("INSERT INTO notifications (id,user_id,actor_id,type,created_at) VALUES (?,?,?,?,?)").run("notif_block_matrix", blocker.id, blocked.id, "follow", 100);

  routes["POST /api/users/:id/block"]({ user: blocker, ip: "block-matrix", params: { id: blocked.id }, body: { blocked: true } });
  for (const [route, params] of [
    ["GET /api/users/:id", { id: blocked.id }],
    ["GET /api/users/:id/posts", { id: blocked.id }],
    ["GET /api/users/:id/playlists", { id: blocked.id }],
    ["GET /api/users/:id/rewards", { id: blocked.id }],
  ]) assert.throws(() => routes[route]({ user: blocker, params }), (error) => error.status === 404);
  assert.throws(() => routes["POST /api/posts/:id/like"]({ user: blocker, ip: "block-like", params: { id: "post_block_matrix" }, body: { liked: true } }), (error) => error.status === 403);
  assert.throws(() => routes["POST /api/posts/:id/comments"]({ user: blocker, ip: "block-comment", params: { id: "post_block_matrix" }, body: { text: "nope" } }), (error) => error.status === 403);
  assert.equal(routes["GET /api/fanclubs/:artist/messages"]({ user: blocker, params: { artist: "artist" } }).messages.some((message) => message.userId === blocked.id), false);
  assert.equal(routes["GET /api/going/:key/attendees"]({ user: verifiedBlocker, params: { key: "show-block-matrix" } }).attendees.length, 0);
  assert.equal(routes["GET /api/venues/:key/reviews"]({ user: blocker, params: { key: "venue" } }).reviews.length, 0);
  assert.equal(routes["GET /api/me/notifications"]({ user: blocker }).unread, 0);
});

test("comment reads and author deletion preserve thread integrity and post visibility", () => {
  const owner = addUser("u_comment_owner", "comment-owner@example.com", "commentowner");
  const replier = addUser("u_comment_replier", "comment-replier@example.com", "commentreplier");
  const stranger = addUser("u_comment_stranger", "comment-stranger@example.com", "commentstranger");
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,created_at) VALUES (?,?,?,?,?,?)")
    .run("post_comment_integrity", owner.id, "Artist", "Venue", 4, 100);
  const insert = db.prepare("INSERT INTO comments (id,post_id,user_id,text,parent_id,created_at) VALUES (?,?,?,?,?,?)");
  insert.run("comment_leaf", "post_comment_integrity", owner.id, "leaf", null, 101);
  insert.run("comment_parent", "post_comment_integrity", owner.id, "parent", null, 102);
  insert.run("comment_child", "post_comment_integrity", replier.id, "child", "comment_parent", 103);

  const remove = routes["DELETE /api/posts/:postId/comments/:id"];
  const ownerContext = (id) => ({ user: owner, ip: `comment-delete-${id}`, params: { postId: "post_comment_integrity", id } });
  assert.equal(remove(ownerContext("comment_leaf")).tombstone, false);
  assert.equal(remove(ownerContext("comment_leaf")).tombstone, false); // desired-state/idempotent
  assert.throws(
    () => remove({ user: stranger, ip: "comment-delete-stranger", params: { postId: "post_comment_integrity", id: "comment_parent" } }),
    (error) => error.status === 404,
  );
  assert.equal(remove(ownerContext("comment_parent")).tombstone, true);

  const thread = routes["GET /api/posts/:id/comments"]({ user: stranger, params: { id: "post_comment_integrity" } });
  assert.equal(thread.comments.some((comment) => comment.id === "comment_leaf"), false);
  const parent = thread.comments.find((comment) => comment.id === "comment_parent");
  assert.equal(parent.deleted, true);
  assert.equal(parent.text, "");
  assert.equal(thread.comments.find((comment) => comment.id === "comment_child").parentId, "comment_parent");
  assert.ok(thread.removedIds.includes("comment_leaf"));

  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,created_at) VALUES (?,?,?,?,?,?)")
    .run("post_comment_blocked", owner.id, "Artist", "Venue", 4, 200);
  routes["POST /api/users/:id/block"]({ user: stranger, ip: "comment-block", params: { id: owner.id }, body: { blocked: true } });
  assert.throws(
    () => routes["GET /api/posts/:id/comments"]({ user: stranger, params: { id: "post_comment_blocked" } }),
    (error) => error.status === 403,
  );
  db.prepare("UPDATE posts SET removed=1 WHERE id=?").run("post_comment_integrity");
  assert.throws(
    () => routes["GET /api/posts/:id/comments"]({ user: owner, params: { id: "post_comment_integrity" } }),
    (error) => error.status === 404,
  );
});

test("track reports preserve a constrained playback category and replacement candidate", () => {
  const listener = addUser("u_track_report", "track-report@example.com", "trackreport");
  const handler = routes["POST /api/tracks/report"];
  const result = handler({
    user: listener,
    ip: "track-report",
    body: {
      title: "The Song",
      artist: "The Artist",
      category: "wont_play",
      url: "https://youtu.be/dQw4w9WgXcQ",
      note: "Player showed an unavailable message",
      provider: "deezer",
      sourceId: "1124841682",
    },
  });
  const stored = db.prepare("SELECT reason FROM reports WHERE id=?").get(result.id);
  assert.deepEqual(JSON.parse(stored.reason), {
    title: "The Song",
    artist: "The Artist",
    category: "wont_play",
    suggestedVideoId: "dQw4w9WgXcQ",
    note: "Player showed an unavailable message",
    provider: "deezer",
    sourceId: "1124841682",
  });
  const sibling = handler({
    user: listener,
    ip: "track-report-sibling",
    body: { title: "The Song", artist: "The Artist", provider: "deezer", sourceId: "1234638792" },
  });
  assert.equal(sibling.duplicate, undefined);
  assert.notEqual(
    db.prepare("SELECT target_id FROM reports WHERE id=?").get(result.id).target_id,
    db.prepare("SELECT target_id FROM reports WHERE id=?").get(sibling.id).target_id,
    "same-display provider recordings retain separate moderation targets",
  );
  assert.throws(
    () => handler({ user: listener, ip: "track-report-invalid", body: { title: "Another Song", category: "database_is_broken" } }),
    (error) => error.code === "VALIDATION_FAILED",
  );
  assert.throws(
    () => handler({ user: listener, ip: "track-report-invalid-source", body: { title: "Another Song", provider: "deezer", sourceId: "not-a-track" } }),
    (error) => error.code === "VALIDATION_FAILED",
  );
});

test("moderators have real bounded actions and every content change is audited", () => {
  addUser("u_mod_actions", "mod-actions@example.com", "modactions");
  addUser("u_mod_peer", "mod-peer@example.com", "modpeer");
  const target = addUser("u_mod_target", "mod-target@example.com", "modtarget");
  db.prepare("UPDATE users SET role='moderator' WHERE id IN ('u_mod_actions','u_mod_peer')").run();
  const moderator = q.userById.get("u_mod_actions");
  const peerModerator = q.userById.get("u_mod_peer");
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,created_at) VALUES (?,?,?,?,?,?)").run("post_mod_actions", target.id, "Artist", "Venue", 4, 100);

  const result = routes["POST /api/admin/content/:type/:id"]({ user: moderator, requestId: "request-mod-actions", params: { type: "post", id: "post_mod_actions" }, body: { removed: true } });
  assert.equal(result.removed, true);
  assert.equal(db.prepare("SELECT removed FROM posts WHERE id='post_mod_actions'").get().removed, 1);
  const audit = db.prepare("SELECT * FROM moderation_actions WHERE target_id='post_mod_actions'").get();
  assert.equal(audit.actor_id, moderator.id);
  assert.equal(audit.action, "remove");
  assert.equal(audit.request_id, "request-mod-actions");
  const memberHeaders = {};
  assert.doesNotThrow(() => routes["GET /api/admin/members"]({
    user: moderator,
    setHeader: (name, value) => { memberHeaders[name] = value; },
  }));
  assert.equal(memberHeaders["Cache-Control"], "no-store");
  assert.throws(() => routes["POST /api/admin/users/:id/ban"]({ user: moderator, params: { id: target.id }, body: {} }), (error) => error.status === 403);
  assert.throws(
    () => routes["POST /api/admin/users/:id/suspend"]({ user: moderator, params: { id: peerModerator.id }, body: { days: 1 } }),
    (error) => error.code === "FORBIDDEN",
  );
  db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 86_400_000, peerModerator.id);
  assert.throws(
    () => routes["POST /api/admin/users/:id/unsuspend"]({ user: moderator, params: { id: peerModerator.id }, body: {} }),
    (error) => error.code === "FORBIDDEN",
  );
  assert.equal(routes["POST /api/admin/users/:id/suspend"]({ user: moderator, params: { id: target.id }, body: { days: 1 } }).ok, true);
});

test("account export covers owned social data without secrets or raw IP addresses", () => {
  const user = addUser("u_export", "export@example.com", "exportuser");
  db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 86_400_000, user.id);
  const restrictedUser = q.userById.get(user.id);
  const other = addUser("u_export_other", "export-other@example.com", "exportother");
  const follower = addUser("u_export_follower", "export-follower@example.com", "exportfollower");
  const blockedAccount = addUser("u_export_blocked", "export-blocked@example.com", "exportblocked");
  db.prepare("INSERT INTO venue_reviews (id,venue_key,user_id,rating,text,photos,created_at) VALUES (?,?,?,?,?,?,?)")
    .run("vr_export", "the-venue", user.id, 4.5, "Great room", '["https://cdn.example/review.jpg"]', 10);
  db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)").run("The Band", user.id);
  db.prepare("INSERT INTO fan_club_messages (id,artist,user_id,text,created_at) VALUES (?,?,?,?,?)").run("fcm_export", "The Band", user.id, "hello fans", 11);
  db.prepare("INSERT INTO lounge_messages (id,lounge_id,user_id,text,created_at) VALUES (?,?,?,?,?)").run("lm_export", "show-1", user.id, "hello lounge", 12);
  db.prepare("INSERT INTO artist_requests (id,user_id,artist_name,note,status,created_at) VALUES (?,?,?,?,?,?)").run("ar_export", user.id, "The Band", "I am the singer", "pending", 13);
  db.prepare("INSERT INTO artist_profiles (artist_key,bio,owner_id,updated_at) VALUES (?,?,?,?)").run("the band", "Official bio", user.id, 14);
  db.prepare("INSERT INTO artist_posts (id,artist_key,user_id,text,created_at) VALUES (?,?,?,?,?)").run("ap_export", "the band", user.id, "Tour soon", 15);
  db.prepare("INSERT INTO reports (id,target_type,target_id,reason,reporter_id,created_at) VALUES (?,?,?,?,?,?)").run("rep_export", "post", "missing", "spam", user.id, 16);
  db.prepare("INSERT INTO events (id,user_id,name,props,ip,created_at) VALUES (?,?,?,?,?,?)").run("evt_export", user.id, "view_artist", '{"artist":"The Band"}', "203.0.113.10", 17);
  db.prepare("INSERT INTO dms (id,from_id,to_id,text,created_at) VALUES (?,?,?,?,?)").run("dm_export_in", other.id, user.id, "incoming", 18);
  db.prepare("INSERT INTO dms (id,from_id,to_id,text,created_at) VALUES (?,?,?,?,?)").run("dm_export_out", user.id, other.id, "outgoing", 18);
  db.prepare("INSERT INTO follows (follower_id,followee_id) VALUES (?,?)").run(user.id, other.id);
  db.prepare("INSERT INTO follows (follower_id,followee_id) VALUES (?,?)").run(follower.id, user.id);
  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(user.id, blockedAccount.id, 18);
  db.prepare("INSERT INTO notifications (id,user_id,actor_id,type,text,created_at) VALUES (?,?,?,?,?,?)")
    .run("notif_export_in", user.id, other.id, "comment", "notification copy", 18);
  db.prepare(`INSERT INTO shows
    (id,canonical_key,artist,venue,city,date,created_at,updated_at)
    VALUES ('show_export','export band|export room|2026-08-21','Export Band','Export Room','Toronto','2026-08-21',18,18)`).run();
  db.prepare(`INSERT INTO show_attendance
    (show_id,user_id,state,visibility,created_at,updated_at)
    VALUES ('show_export',?,'went','private',18,18)`).run(user.id);
  const exportedCampaign = { version: 1, treatment: "after-dark", artistKey: "the band" };
  db.prepare(`INSERT INTO posts (id,user_id,kind,artist,venue,overall,review,campaign,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    "post_export_campaign", user.id, "status", "", "", 0, "New music tonight", JSON.stringify(exportedCampaign), 19,
  );
  db.prepare(`INSERT INTO posts (id,user_id,artist,venue,overall,tagged_user_ids,created_at)
    VALUES (?,?,?,?,?,?,?)`).run("post_export_tagged", other.id, "The Band", "The Venue", 4, JSON.stringify([user.id]), 20);
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,created_at) VALUES (?,?,?,?,?,?)")
    .run("post_export_rejected", other.id, "The Band", "The Venue", 4, 21);
  db.prepare("INSERT INTO post_tag_rejections (post_id,user_id,created_at) VALUES (?,?,?)")
    .run("post_export_rejected", user.id, 22);

  db.prepare("UPDATE users SET pass_hash=? WHERE id=?").run(hashPassword("export-password1"), restrictedUser.id);
  const data = routes["POST /api/me/export"]({ user: q.userById.get(restrictedUser.id), ip: "export-test", body: { password: "export-password1" } });
  assert.equal(data.venueReviews[0].id, "vr_export");
  assert.deepEqual(data.fanClubs.memberships, ["The Band"]);
  assert.equal(data.loungeMessages[0].id, "lm_export");
  assert.equal(data.artistAccount.requests[0].id, "ar_export");
  assert.equal(data.artistAccount.profiles[0].artistKey, "the band");
  assert.equal(data.artistAccount.posts[0].id, "ap_export");
  assert.equal(data.reportsSubmitted[0].id, "rep_export");
  assert.deepEqual(data.activityEvents[0].properties, { artist: "The Band" });
  assert.equal(data.messagesReceived[0].text, "incoming");
  assert.deepEqual(data.messagesReceived[0].from, { id: other.id });
  assert.equal(data.messagesSent[0].text, "outgoing");
  assert.deepEqual(data.messagesSent[0].to, { id: other.id });
  assert.deepEqual(data.following, [{ id: other.id }]);
  assert.deepEqual(data.followers, [{ id: follower.id }]);
  assert.deepEqual(data.blocked, [{ id: blockedAccount.id }]);
  assert.deepEqual(data.notifications[0].from, { id: other.id });
  assert.deepEqual(data.attendance, [{
    showId: "show_export",
    key: "export band|export room|2026-08-21",
    canonicalKey: "export band|export room|2026-08-21",
    artist: "Export Band",
    venue: "Export Room",
    city: "Toronto",
    date: "2026-08-21",
    state: "went",
    visibility: "private",
    checkedInAt: null,
    verified: false,
    createdAt: 18,
    updatedAt: 18,
  }]);
  assert.deepEqual(data.posts.find((post) => post.id === "post_export_campaign").campaign, exportedCampaign);
  assert.deepEqual(data.taggedInPosts.find((post) => post.postId === "post_export_tagged"), {
    postId: "post_export_tagged",
    authorId: other.id,
    removed: false,
    createdAt: 20,
  });
  assert.deepEqual(data.removedPostTags.find((tag) => tag.postId === "post_export_rejected"), {
    postId: "post_export_rejected",
    createdAt: 22,
  });
  assert.ok(data.exportNotes.some((note) => note.includes("1,000 posts tagging you") && note.includes("1,000 tags you removed")));
  assert.ok(data.exportNotes.some((note) => note.includes("stable internal ids only") && note.includes("blocks")));
  const encoded = JSON.stringify(data);
  for (const account of [other, follower, blockedAccount]) {
    assert.equal(encoded.includes(account.handle), false, "exports must not resolve live third-party profile fields");
  }
  assert.equal(encoded.includes("203.0.113.10"), false);
  assert.equal(encoded.includes("pass_hash"), false);
  assert.equal(encoded.includes("test-hash"), false);
});

test("account deletion requires the password and erases SET NULL privacy rows atomically", () => {
  const password = "ConcertPassword9";
  const user = addUser("u_delete", "delete@example.com", "deleteuser");
  db.prepare("UPDATE users SET pass_hash=? WHERE id=?").run(hashPassword(password), user.id);
  db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(user.id);
  const freshUser = q.userById.get(user.id);
  const survivor = addUser("u_delete_survivor", "delete-survivor@example.com", "deletesurvivor");
  db.prepare("INSERT INTO events (id,user_id,name,props,ip,created_at) VALUES (?,?,?,?,?,?)").run("evt_delete", user.id, "login", "{}", "203.0.113.20", 20);
  db.prepare("INSERT INTO reports (id,target_type,target_id,reason,reporter_id,created_at) VALUES (?,?,?,?,?,?)").run("rep_delete", "user", survivor.id, "test", user.id, 21);
  db.prepare("INSERT INTO reports (id,target_type,target_id,reason,reporter_id,created_at) VALUES (?,?,?,?,?,?)").run("rep_delete_target", "user", user.id, "target gone", survivor.id, 21);
  db.prepare("INSERT INTO artist_profiles (artist_key,bio,owner_id,updated_at) VALUES (?,?,?,?)").run("delete band", "bio", user.id, 22);
  db.prepare("INSERT INTO artist_posts (id,artist_key,user_id,text,created_at) VALUES (?,?,?,?,?)").run("ap_delete", "delete band", user.id, "post", 23);
  db.prepare("INSERT INTO notifications (id,user_id,actor_id,type,created_at) VALUES (?,?,?,?,?)").run("n_delete", survivor.id, user.id, "follow", 24);
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,created_at) VALUES (?,?,?,?,?,?)").run("post_delete", user.id, "Band", "Venue", 4, 25);
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,tagged_user_ids,created_at) VALUES (?,?,?,?,?,?,?)")
    .run("post_delete_survivor_tag", survivor.id, "Band", "Venue", 4, JSON.stringify([user.id, survivor.id]), 26);
  db.prepare("INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)").run("session_delete", user.id, 1, Date.now() + 100000);
  const deleteShowKey = "delete band|delete venue|2026-08-27";
  db.prepare(`INSERT INTO shows
    (id,canonical_key,identity_source,created_at,updated_at)
    VALUES ('show_delete_account',?,'member_legacy_alias',26,26)`).run(deleteShowKey);
  db.prepare(`INSERT INTO show_aliases
    (alias_type,alias_value,show_id,created_at)
    VALUES ('legacy_concert_key',?,'show_delete_account',26)`).run(deleteShowKey);
  db.prepare(`INSERT INTO show_attendance
    (show_id,user_id,state,visibility,legacy_artist,legacy_venue,legacy_date,created_at,updated_at)
    VALUES ('show_delete_account',?,'going','members','Delete Band','Delete Venue','2026-08-27',26,26)`)
    .run(user.id);
  db.prepare(`INSERT INTO show_attendance_verifications
    (show_id,user_id,source,verified_at)
    VALUES ('show_delete_account',?,'ticket_import',26)`).run(user.id);
  db.prepare(`INSERT INTO going
    (user_id,concert_key,artist,venue,city,date,created_at)
    VALUES (?,?,'Delete Band','Delete Venue','Toronto','2026-08-27',26)`).run(user.id, deleteShowKey);
  const legacyStagingKey = `users/${user.id}/avatar/delete-legacy-staging.jpg`;
  const legacyOutputKey = `users/${user.id}/avatar/delete-legacy-safe.webp`;
  const legacyOutputUrl = `https://media.example.com/cdn/${legacyOutputKey}`;
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at)
    VALUES (?,?,'private','avatar',1024,'issued',?,?), (?,?,'public','avatar',512,'issued',?,?)`)
    .run(legacyStagingKey, user.id, 27, 27, legacyOutputKey, user.id, 27, 27);
  db.prepare(`INSERT INTO legacy_media_finalize_descriptors
    (id,owner_id,token_hash,purpose,staging_object_key,staging_mime_type,staging_byte_size,
      output_mime_type,output_object_key,output_url,output_byte_size,width,height,status,expires_at,
      finalized_at,created_at,updated_at)
    VALUES ('lm_deletelegacydescriptor',? ,?,'avatar',?,'image/jpeg',1024,'image/webp',?,?,512,64,64,
      'finalized',?,?,?,?)`)
    .run(user.id, "e".repeat(64), legacyStagingKey, legacyOutputKey, legacyOutputUrl,
      Date.now() + 60_000, 27, 27, 27);

  const handler = routes["DELETE /api/me"];
  assert.throws(
    () => handler({ user: freshUser, ip: "delete-test-wrong", body: { password: "WrongPassword1" } }),
    (error) => error instanceof ApiError && error.status === 401 && error.code === "AUTH_INVALID"
  );
  assert.ok(q.userById.get(user.id));

  let cleared = false;
  assert.deepEqual(handler({ user: freshUser, ip: "delete-test", body: { password }, clearSession: () => { cleared = true; } }), { ok: true });
  assert.equal(cleared, true);
  assert.equal(q.userById.get(user.id), undefined);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM show_attendance WHERE user_id=?").get(user.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM show_attendance_verifications WHERE user_id=?").get(user.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM going WHERE user_id=?").get(user.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM shows WHERE id='show_delete_account'").get().count, 1,
    "shared blank Show identity may remain after the member relationship is erased");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM show_aliases WHERE show_id='show_delete_account'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM legacy_media_finalize_descriptors WHERE owner_id=?")
    .get(user.id).count, 0, "account erasure removes owner-bound legacy finalize descriptors");
  for (const key of [legacyStagingKey, legacyOutputKey]) {
    assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(key).status,
      "delete_queued", "account erasure keeps both private staging and sanitized output recoverably queued");
  }
  assert.ok(q.userById.get(survivor.id));
  for (const [table, column] of [
    ["events", "user_id"],
    ["reports", "reporter_id"],
    ["artist_profiles", "owner_id"],
    ["artist_posts", "user_id"],
    ["notifications", "actor_id"],
    ["posts", "user_id"],
    ["sessions", "user_id"],
  ]) {
    assert.equal(db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE ${column}=?`).get(user.id).count, 0, `${table} retained deleted-account data`);
  }
  assert.equal(db.prepare("SELECT COUNT(*) count FROM reports WHERE id='rep_delete_target'").get().count, 0);
  assert.equal(
    db.prepare("SELECT tagged_user_ids FROM posts WHERE id='post_delete_survivor_tag'").get().tagged_user_ids,
    JSON.stringify([survivor.id]),
    "account erasure must scrub structured associations from posts that survive",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) count FROM post_user_tags WHERE user_id=?").get(user.id).count,
    0,
    "account erasure must leave no normalized tag association for the deleted account",
  );
});

test("account export media projection never serializes private-source capabilities", () => {
  const signedSource = `https://objects.example.test/private/source.mp4?X-Amz-Credential=test&X-Amz-Signature=${"a".repeat(64)}`;
  const projected = portableMediaAsset({
    id: "ma_portable",
    kind: "video",
    purpose: "post",
    sourceUrl: signedSource,
    storageCredential: "future-provider-secret",
    url: "https://media.example.test/public/render.mp4",
    posterUrl: "https://media.example.test/public/poster.webp",
    durationMs: 12_000,
    status: "ready",
  });

  assert.equal(Object.hasOwn(projected, "sourceUrl"), false);
  assert.equal(Object.hasOwn(projected, "storageCredential"), false);
  assert.equal(JSON.stringify(projected).includes("X-Amz-"), false);
  assert.equal(projected.id, "ma_portable");
  assert.equal(projected.url, "https://media.example.test/public/render.mp4");
  assert.equal(projected.posterUrl, "https://media.example.test/public/poster.webp");
});

// Discover looked broken because the catalogue seeder published its MusicBrainz
// crawl bucket as the artist's genre: Justin Bieber came back under "Metal".
// A bucket is a discovery hint, so the projection must not state it as fact.
test("a crawl-bucket genre is offered as a hint, never stated as the artist's genre", () => {
  artistStmts.upsert.run(artistRow("justin bieber", { name: "Justin Bieber", genre: "Metal" }, "musicbrainz"));
  const shown = publicArtist(artistStmts.byNorm.get("justin bieber"));
  assert.equal(shown.genre, null, "a crawl bucket must not be presented as the genre");
  assert.equal(shown.genreHint, "Metal", "but it stays available for staff review");
  assert.equal(shown.genreSource, "tag_hint");

  // Provider enrichment is evidence because it records provenance, not because
  // the stored string happens to be lowercased.
  artistStmts.upsert.run(artistRow("taylor swift", {
    name: "Taylor Swift", genre: "pop",
    genreClaims: [{ value: "pop", source: "provider", at: 1 }],
  }, "deezer"));
  const evidence = publicArtist(artistStmts.byNorm.get("taylor swift"));
  assert.equal(evidence.genre, "pop");
  assert.equal(evidence.genreSource, "provider");
});

test("an admin genre correction outranks the crawl, is audited, and is reversible", () => {
  artistStmts.upsert.run(artistRow("rihanna", { name: "Rihanna", genre: "House" }, "musicbrainz"));
  const admin = addUser("u_genreadmin", "genreadmin@example.com", "genreadmin");
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
  const staff = q.userById.get(admin.id);
  const setGenre = routes["POST /api/admin/artists/genre"];

  const fixed = setGenre({ user: staff, ip: "genre-fix", body: { name: "Rihanna", genre: "r&b", reason: "obviously not house" } });
  assert.equal(fixed.artist.genre, "r&b");
  assert.equal(fixed.artist.genreSource, "staff");

  const audit = db.prepare("SELECT * FROM moderation_actions WHERE action='artist_genre' AND target_id='rihanna'").get();
  assert.ok(audit, "the correction is auditable");
  assert.equal(JSON.parse(audit.prior_state).genre, "House");
  assert.equal(JSON.parse(audit.next_state).genre, "r&b");

  // An ordinary user cannot reach it.
  assert.throws(
    () => setGenre({ user: addUser("u_genrefan", "genrefan@example.com", "genrefan"), ip: "genre-deny", body: { name: "Rihanna", genre: "polka" } }),
    (error) => error instanceof ApiError && (error.status === 403 || error.status === 404),
  );

  // Undo drops back to the evidence underneath, not to nothing forever.
  const undone = setGenre({ user: staff, ip: "genre-undo", body: { name: "Rihanna", genre: "" } });
  assert.equal(undone.artist.genre, null);
  assert.equal(undone.artist.genreHint, "House");
});

test("fan-club directory aggregates authoritative memberships and visible messages", () => {
  const first = addUser("u_fan_directory_1", "fan-directory-1@example.com", "fandirone");
  const second = addUser("u_fan_directory_2", "fan-directory-2@example.com", "fandirtwo");
  db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)").run("directory headliner", first.id);
  db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)").run("directory headliner", second.id);
  db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)").run("directory opener", first.id);
  db.prepare("INSERT INTO fan_club_messages (id,artist,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("fc_directory_visible", "directory headliner", first.id, "visible", 1);
  db.prepare("INSERT INTO fan_club_messages (id,artist,user_id,text,removed,created_at) VALUES (?,?,?,?,?,?)")
    .run("fc_directory_removed", "directory headliner", first.id, "removed", 1, 2);
  db.prepare("INSERT INTO fan_club_messages (id,artist,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("fc_directory_message_only", "directory archive", first.id, "still active", 3);

  const result = routes["GET /api/fanclubs"]({ ip: "fan-directory-test" });
  assert.equal(result.total, result.clubs.length);
  assert.deepEqual({ ...result.clubs.find((club) => club.artist === "directory headliner") }, {
    artist: "directory headliner",
    members: 2,
    messages: 1,
  });
  assert.deepEqual({ ...result.clubs.find((club) => club.artist === "directory opener") }, {
    artist: "directory opener",
    members: 1,
    messages: 0,
  });
  assert.deepEqual({ ...result.clubs.find((club) => club.artist === "directory archive") }, {
    artist: "directory archive",
    members: 0,
    messages: 1,
  });
});

test("public UGC surfaces share one banned and live-suspension visibility rule", () => {
  const author = addUser("u_public_visibility_author", "public-visibility-author@example.com", "publicvisibilityauthor");
  const viewer = addUser("u_public_visibility_viewer", "public-visibility-viewer@example.com", "publicvisibilityviewer");
  const postId = "p_public_visibility";
  const hostPostId = "p_public_visibility_host";
  const artist = "public visibility club";
  const lounge = "public-visibility-lounge";
  const venue = "public-visibility-venue";
  const artistKey = "public visibility artist";
  const nowAt = Date.now();

  db.prepare(`INSERT INTO posts (id,user_id,artist,venue,overall,review,photos,photos_public,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(postId, author.id, "Visibility Artist", "Visibility Venue", 4, "visible post", '["https://media.example/users/u_public_visibility_author/post/visible.mp4"]', 1, nowAt);
  const visibilityClipKey = "users/u_public_visibility_author/post/visible.mp4";
  const visibilityClipUrl = "https://media.example/users/u_public_visibility_author/post/visible.mp4";
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,purpose,byte_size,status,created_at,associated_at,updated_at)
    VALUES (?,?, 'post',2048,'associated',?,?,?)`).run(visibilityClipKey, author.id, nowAt, nowAt, nowAt);
  db.prepare(`INSERT INTO media_assets
    (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,original_name,mime_type,byte_size,
      width,height,duration_ms,metadata_status,codec_status,codec_verified_at,status,source_verified_at,created_at,updated_at)
    VALUES ('ma_public_visibility_clip',?,?,?,'post','video',?,?, 'visible.mp4','video/mp4',2048,
      1080,1920,15000,'declared','verified',?,'ready',?,?,?)`).run(
    author.id, "public-visibility-clip", "visibility-hash", visibilityClipKey, visibilityClipUrl,
    nowAt, nowAt, nowAt, nowAt,
  );
  db.prepare("INSERT INTO post_media (post_id,asset_id,position,created_at) VALUES (?,'ma_public_visibility_clip',0,?)")
    .run(postId, nowAt);
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,review,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(hostPostId, viewer.id, "Host Artist", "Host Venue", 4, "host", nowAt - 1);
  db.prepare("INSERT INTO comments (id,post_id,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("c_public_visibility", hostPostId, author.id, "visible comment", nowAt);
  db.prepare("INSERT INTO playlists (id,user_id,name,tracks,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run("pls_public_visibility", author.id, "Visible playlist", "[]", "public", nowAt, nowAt);
  db.prepare("INSERT INTO venue_reviews (id,venue_key,user_id,rating,text,photos,created_at) VALUES (?,?,?,?,?,?,?)")
    .run("vr_public_visibility", venue, author.id, 4, "visible venue review", "[]", nowAt);
  db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)").run(artist, author.id);
  db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)").run(artist, viewer.id);
  db.prepare("INSERT INTO fan_club_messages (id,artist,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("fc_public_visibility", artist, author.id, "visible fan message", nowAt);
  db.prepare("INSERT INTO going (user_id,concert_key,artist,venue,created_at) VALUES (?,?,?,?,?)")
    .run(viewer.id, lounge, "Visibility Artist", "Visibility Venue", nowAt);
  db.prepare("INSERT INTO lounge_messages (id,lounge_id,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("lm_public_visibility", lounge, author.id, "visible lounge message", nowAt);
  db.prepare(`INSERT INTO artist_profiles (artist_key,owner_id,bio,feed_enabled,updated_at)
    VALUES (?,?,?,1,?)`).run(artistKey, author.id, "visible artist bio", nowAt);
  db.prepare("INSERT INTO artist_posts (id,artist_key,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("ap_public_visibility", artistKey, author.id, "visible artist update", nowAt);
  db.prepare(`INSERT INTO tour_dates (id,artist,venue,date,source,updated_at,owner_id,release_at)
    VALUES (?,?,?,?,?,?,?,0)`).run("td_public_visibility", "Visibility Artist", "Visibility Venue", "2027-01-01", "artist-submitted", nowAt, author.id);
  db.prepare("INSERT INTO ratings (user_id,kind,ref,rating) VALUES (?,?,?,?)")
    .run(author.id, "album", "public-visibility-album", 5);

  const read = () => ({
    feed: routes["GET /api/feed"]({ user: viewer, query: {} }).posts.some((post) => post.id === postId),
    clips: routes["GET /api/clips"]({ user: viewer, query: {} }).clips.some((post) => post.id === postId),
    comments: routes["GET /api/posts/:id/comments"]({ user: viewer, params: { id: hostPostId }, query: {} }).comments.some((comment) => comment.id === "c_public_visibility"),
    venue: routes["GET /api/venues/:key/reviews"]({ user: viewer, params: { key: venue }, query: {} }).reviews.some((review) => review.id === "vr_public_visibility"),
    fan: routes["GET /api/fanclubs/:artist/messages"]({ user: viewer, params: { artist }, query: {} }).messages.some((message) => message.id === "fc_public_visibility"),
    lounge: routes["GET /api/lounges/:key/messages"]({ user: viewer, params: { key: lounge }, query: {} }).messages.some((message) => message.id === "lm_public_visibility"),
    artist: routes["GET /api/artists/:key/profile"]({ user: viewer, params: { key: artistKey } }),
    tour: routes["GET /api/tourdates"]({ user: viewer }).tourDates.some((date) => date.id === "td_public_visibility"),
    ratingCount: routes["GET /api/ratings"]({ user: viewer, query: { kind: "album", ref: "public-visibility-album" } }).count,
    people: routes["GET /api/people"]({ user: viewer, query: { q: "publicvisibilityauthor" } }).users.some((user) => user.id === author.id),
  });

  const visible = read();
  assert.deepEqual({ ...visible, artist: !!visible.artist.profile && visible.artist.posts.length === 1 }, {
    feed: true, clips: true, comments: true, venue: true, fan: true, lounge: true,
    artist: true, tour: true, ratingCount: 1, people: true,
  });

  db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 60_000, author.id);
  const suspended = read();
  assert.deepEqual({ ...suspended, artist: suspended.artist.profile === null && suspended.artist.posts.length === 0 }, {
    feed: false, clips: false, comments: false, venue: false, fan: false, lounge: false,
    artist: true, tour: false, ratingCount: 0, people: false,
  });
  assert.throws(
    () => routes["GET /api/posts/:id"]({ user: viewer, params: { id: postId } }),
    (error) => error.status === 404,
  );

  db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() - 1_000, author.id);
  assert.equal(read().feed, true, "expired suspensions restore public content without a data rewrite");
  db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(author.id);
  const banned = read();
  assert.equal(banned.feed, false);
  assert.equal(banned.comments, false);
  assert.equal(banned.tour, false);
  assert.equal(banned.ratingCount, 0);
});

test("For You is global-first, cursor-stable, and an allegation alone cannot suppress a post", () => {
  const author = addUser("u_for_you_author", "for-you-author@example.com", "foryouauthor");
  const reporter = addUser("u_for_you_reporter", "for-you-reporter@example.com", "foryoureporter");
  const authorProfileUpdatedAt = 1_725_000_000_000;
  db.prepare("UPDATE users SET profile_updated_at=? WHERE id=?").run(authorProfileUpdatedAt, author.id);
  for (let index = 1; index <= 6; index++) {
    db.prepare("INSERT INTO posts (id,user_id,artist,venue,city,overall,review,photos,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(`p_for_you_${index}`, author.id, `Global Artist ${index}`, "Global Venue", "Toronto", 4, "A complete public concert review that gives the ranking useful quality context.", "[]", Date.now() - (7 - index) * 1000);
  }
  db.prepare("INSERT INTO reports (id,target_type,target_id,reason,reporter_id,status,created_at) VALUES (?,?,?,?,?,?,?)")
    .run("rep_for_you_open", "post", "p_for_you_6", "Unadjudicated report", reporter.id, "open", Date.now());

  clearRecommendationSnapshotsForTests();
  const first = routes["GET /api/feed/for-you"]({ user: null, ip: "for-you-test", query: { limit: "3" } });
  const second = routes["GET /api/feed/for-you"]({ user: null, ip: "for-you-test", query: { limit: "3", cursor: first.nextCursor } });
  const ids = [...first.posts, ...second.posts].map((post) => post.id);
  assert.equal(new Set(ids).size, ids.length, "snapshot pages never duplicate a post");
  assert.equal(first.algorithm.candidateSource, "global");
  assert.equal(first.algorithm.version, 1);
  assert.equal(first.posts.every((post) => post.recommendation?.algorithm === first.algorithm.id), true);
  assert.equal(first.posts.every((post) => post.recommendation?.algorithmVersion === 1 && post.recommendation?.feedContext?.startsWith("discover:")), true);

  const repeated = routes["GET /api/feed/for-you"]({ user: null, ip: "for-you-test", query: { limit: "3" } });
  assert.deepEqual(repeated.posts.map((post) => post.id), first.posts.map((post) => post.id), "unexpired guest snapshot is reused");
  assert.equal(repeated.nextCursor, first.nextCursor);

  // Traverse the snapshot instead of assuming a reported post must rank in the
  // first six among unrelated test fixtures. The policy under test is
  // eligibility: an allegation alone must not erase otherwise-live content.
  const snapshotPosts = [...first.posts];
  const snapshotIds = [...snapshotPosts.map((post) => post.id)];
  let cursor = first.nextCursor;
  while (cursor) {
    const page = routes["GET /api/feed/for-you"]({ user: null, ip: "for-you-test", query: { limit: "50", cursor } });
    snapshotPosts.push(...page.posts);
    snapshotIds.push(...page.posts.map((post) => post.id));
    cursor = page.nextCursor;
  }
  assert.ok(snapshotIds.includes("p_for_you_6"), "an open report is an allegation, not a moderation state");
  assert.equal(
    snapshotPosts.find((post) => post.id === "p_for_you_6")?.user?.profileUpdatedAt,
    authorProfileUpdatedAt,
    "For You author snapshots retain the avatar freshness version",
  );

  db.prepare("INSERT INTO posts (id,user_id,artist,venue,city,overall,review,photos,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run("p_for_you_fresh", author.id, "Fresh Global Artist", "Global Venue", "Toronto", 5, "A newly published review must enter an already-open feed on its next head refresh.", "[]", Date.now());
  const refreshed = routes["GET /api/feed/for-you"]({ user: null, ip: "for-you-test", query: { limit: "3" } });
  assert.notEqual(refreshed.nextCursor, repeated.nextCursor, "a newly-created post replaces the active head snapshot");
  const refreshedIds = [...refreshed.posts.map((post) => post.id)];
  cursor = refreshed.nextCursor;
  while (cursor) {
    const page = routes["GET /api/feed/for-you"]({ user: null, ip: "for-you-test", query: { limit: "50", cursor } });
    refreshedIds.push(...page.posts.map((post) => post.id));
    cursor = page.nextCursor;
  }
  assert.ok(refreshedIds.includes("p_for_you_fresh"), "new content enters the refreshed recommendation snapshot without a reload");
});

test("feed cache revalidation returns authoritative moderation, block, and preference tombstones", () => {
  const viewer = addUser("u_revalidate_viewer", "revalidate-viewer@example.com", "revalidateviewer");
  const author = addUser("u_revalidate_author", "revalidate-author@example.com", "revalidateauthor");
  const insert = db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,review,created_at) VALUES (?,?,?,?,?,?,?)");
  insert.run("p_revalidate_live", author.id, "Live Artist", "Live Venue", 4, "Still live", Date.now());
  insert.run("p_revalidate_removed", author.id, "Removed Artist", "Removed Venue", 4, "Removed", Date.now());
  db.prepare("UPDATE posts SET removed=1 WHERE id=?").run("p_revalidate_removed");

  const revalidate = routes["POST /api/feed/revalidate"];
  let result = revalidate({
    user: viewer, ip: "revalidate-test", body: { postIds: ["p_revalidate_live", "p_revalidate_removed", "not_an_id"] },
  });
  assert.deepEqual(result.invalidPostIds, ["p_revalidate_removed"]);

  db.prepare("INSERT INTO recommendation_preferences (user_id,post_id,action,created_at) VALUES (?,?,?,?)")
    .run(viewer.id, "p_revalidate_live", "not_interested", Date.now());
  result = revalidate({ user: viewer, ip: "revalidate-test", body: { postIds: ["p_revalidate_live"] } });
  assert.deepEqual(result.invalidPostIds, ["p_revalidate_live"]);

  db.prepare("DELETE FROM recommendation_preferences WHERE user_id=?").run(viewer.id);
  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(author.id, viewer.id, Date.now());
  result = revalidate({ user: viewer, ip: "revalidate-test", body: { postIds: ["p_revalidate_live"] } });
  assert.deepEqual(result.invalidPostIds, ["p_revalidate_live"], "an incoming author block invalidates an already-cached card");
});

test("admin Deezer enrichment records provider evidence and preserves staff authority", async () => {
  artistStmts.upsert.run(artistRow("provider exact label", { name: "Provider Exact Label", genre: "Metal" }, "musicbrainz"));
  artistStmts.upsert.run(artistRow("staff genre keeper", {
    name: "Staff Genre Keeper",
    genre: "r&b",
    genreClaims: [{ value: "r&b", source: "staff", at: 1 }],
  }, "staff"));
  const admin = addUser("u_provider_enrich_admin", "provider-enrich-admin@example.com", "providerenrichadmin");
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
  const staff = q.userById.get(admin.id);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    let payload;
    if (value.includes("/search/artist")) {
      const name = decodeURIComponent(value).includes("Staff Genre Keeper") ? "Staff Genre Keeper" : "Provider Exact Label";
      payload = { data: [{ id: name.startsWith("Staff") ? 202 : 101, name, nb_fan: 1000 }] };
    } else if (value.includes("/artist/202/top")) payload = { data: [
      { id: 2, title: "Staff Song One", album: { id: 2002 } },
      { id: 3, title: "Staff Song Two", album: { id: 2003 } },
      { id: 4, title: "Staff Song Three", album: { id: 2004 } },
    ] };
    else if (value.includes("/artist/101/top")) payload = { data: [
      { id: 1, title: "Provider Song One", album: { id: 1001 } },
      { id: 5, title: "Provider Song Two", album: { id: 1002 } },
      { id: 6, title: "Provider Song Three", album: { id: 1003 } },
    ] };
    else if (/\/album\/(?:2002|2003|2004|1001|1002|1003)$/.test(value)) {
      payload = { genres: { data: [{ name: "Pop" }] } };
    }
    else throw new Error(`unexpected provider request: ${value}`);
    return { ok: true, status: 200, json: async () => payload };
  };
  try {
    const result = await routes["POST /api/admin/artists/enrich"]({
      user: staff,
      body: { names: ["Provider Exact Label", "Staff Genre Keeper"] },
      requestId: "provider-enrich-test",
    });
    assert.equal(result.enriched, 2);
    assert.equal(result.requested, 2);
    assert.equal(result.artists.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const provider = publicArtist(artistStmts.byNorm.get("provider exact label"));
  assert.equal(provider.genre, "Pop", "an exact-title provider label must not be demoted to a crawl hint");
  assert.equal(provider.genreSource, "release_consensus");
  const preserved = publicArtist(artistStmts.byNorm.get("staff genre keeper"));
  assert.equal(preserved.genre, "r&b");
  assert.equal(preserved.genreSource, "staff");
  const stored = JSON.parse(artistStmts.byNorm.get("staff genre keeper").data);
  assert.equal(stored.genreClaims.find((claim) => claim.source === "release_consensus")?.value, "Pop");
  assert.equal(stored.genreEvidence?.basis, "release-consensus-v1");
  assert.equal(stored.genreEvidence?.sampleCount, 3);
  assert.equal(stored.genreEvidence?.supportingCount, 3);
});

test("admin exact identity enrichment persists a missing artist and keeps its MBID through Deezer", async () => {
  const name = "Ｅxact Missing Artist Fixture";
  const canonicalName = "EXACT MISSING ARTIST FIXTURE";
  const mbid = "11111111-1111-4111-8111-111111111111";
  const admin = addUser("u_exact_identity_admin", "exact-identity-admin@example.com", "exactidentityadmin");
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
  const staff = q.userById.get(admin.id);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    let payload;
    if (value.includes("musicbrainz.org/ws/2/artist")) {
      payload = {
        artists: [{
          id: mbid,
          name: canonicalName,
          score: 100,
          area: { name: "Canada" },
          "life-span": { begin: "2018-01-01" },
          tags: [{ name: "indie rock", count: 9 }],
        }],
      };
    } else if (value.includes("/search/artist")) {
      payload = {
        data: [{
          id: 919,
          name: canonicalName,
          nb_fan: 12000,
          picture_xl: "https://cdn.example.com/exact-missing-artist.jpg",
        }],
      };
    } else if (value.includes("/artist/919/top")) {
      payload = {
        data: [
          { id: 91, title: "Exact Song One", album: { id: 9191, title: "Exact Album One" } },
          { id: 92, title: "Exact Song Two", album: { id: 9192, title: "Exact Album Two" } },
          { id: 93, title: "Exact Song Three", album: { id: 9193, title: "Exact Album Three" } },
        ],
      };
    } else if (value.includes("/album/")) {
      payload = { genres: { data: [{ name: "Alternative" }] } };
    } else {
      throw new Error("unexpected provider request: " + value);
    }
    return { ok: true, status: 200, json: async () => payload };
  };

  let result;
  try {
    result = await routes["POST /api/admin/artists/enrich"]({
      user: staff,
      body: { names: [name], requireExactIdentity: true },
      requestId: "exact-identity-create-test",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(result.requested, 1);
  assert.equal(result.enriched, 1);
  assert.equal(result.artists.length, 1);
  assert.equal(result.artists[0].mbid, mbid);
  assert.equal(result.artists[0].deezerId, 919);
  const persisted = artistStmts.byNorm.get("exact missing artist fixture");
  assert.ok(persisted);
  assert.equal(persisted.mbid, mbid);
  const data = JSON.parse(persisted.data);
  assert.equal(data.mbid, mbid, "Deezer enrichment must retain the exact MusicBrainz identity in rich data");
  assert.equal(data.deezerId, 919);
  assert.equal(data.country, "Canada");
});

test("a verified composer selection persists an exact MusicBrainz identity before post binding", async () => {
  const name = "Composer Durable Artist Fixture";
  const mbid = "77777777-7777-4777-8777-777777777777";
  const user = verifiedUser("u_composer_artist", "composer-artist@example.com", "composerartist");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    assert.match(String(url), /musicbrainz\.org\/ws\/2\/artist/);
    assert.ok(options.signal, "provider lookup must receive the request cancellation signal");
    return {
      ok: true,
      status: 200,
      json: async () => ({ artists: [{ id: mbid, name, score: 100, area: { name: "Canada" } }] }),
    };
  };

  let attached;
  try {
    attached = await routes["POST /api/artists/resolve"]({
      user,
      body: { name, mbid },
      ip: "198.51.100.77",
      signal: new AbortController().signal,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(attached.created, true);
  assert.equal(attached.artist.key, name.toLowerCase());
  assert.equal(artistStmts.byNorm.get(name.toLowerCase())?.mbid, mbid);

  const created = routes["POST /api/posts"]({
    user,
    ip: "198.51.100.77",
    body: {
      clientMutationId: "composer_artist_binding_1",
      artist: name,
      artistKey: attached.artist.key,
      venue: "History",
      city: "Toronto",
      date: "2026-08-20",
      overall: 5,
      band: 5,
      room: 4,
      review: "A durable artist binding test.",
    },
  });
  assert.equal(created.post.artistKey, name.toLowerCase());
  assert.equal(created.post.artistMbid, mbid);
});

test("cancelling public artist resolution aborts the outbound MusicBrainz request", async () => {
  const controller = new AbortController();
  const originalFetch = globalThis.fetch;
  let providerSignal = null;
  globalThis.fetch = async (_url, options = {}) => new Promise((_resolve, reject) => {
    providerSignal = options.signal;
    options.signal?.addEventListener("abort", () => reject(options.signal.reason), { once: true });
  });

  const pending = routes["GET /api/artists/resolve"]({
    query: { name: "Cancelled Composer Fixture" },
    ip: "198.51.100.78",
    signal: controller.signal,
  });
  try {
    await eventually(() => providerSignal, Boolean);
    controller.abort();
    await assert.rejects(pending, (error) => error?.name === "AbortError");
    assert.equal(providerSignal.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin exact identity enrichment rejects a fuzzy MusicBrainz result without persisting it", async () => {
  const name = "Fuzzy Rejection Fixture";
  const admin = addUser("u_fuzzy_identity_admin", "fuzzy-identity-admin@example.com", "fuzzyidentityadmin");
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
  const staff = q.userById.get(admin.id);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    assert.ok(value.includes("musicbrainz.org/ws/2/artist"));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        artists: [{
          id: "22222222-2222-4222-8222-222222222222",
          name: "Fuzzy Rejection Fixture Tribute",
          score: 99,
        }],
      }),
    };
  };
  try {
    await assert.rejects(
      () => routes["POST /api/admin/artists/enrich"]({
        user: staff,
        body: { names: [name], requireExactIdentity: true },
        requestId: "exact-identity-fuzzy-test",
      }),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 404);
        assert.equal(error.code, "NOT_FOUND");
        assert.match(error.message, /exact artist match/i);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(artistStmts.byNorm.get("fuzzy rejection fixture"), undefined);
});

test("admin exact identity enrichment rejects a conflicting stored MBID without overwriting rich data", async () => {
  const name = "Identity Conflict Fixture";
  const storedMbid = "33333333-3333-4333-8333-333333333333";
  const incomingMbid = "44444444-4444-4444-8444-444444444444";
  artistStmts.upsert.run(artistRow(name, {
    name,
    mbid: storedMbid,
    bio: "Keep this catalog biography.",
    topTracks: [{ id: 1, title: "Keep This Track" }],
  }, "musicbrainz"));

  const admin = addUser("u_conflict_identity_admin", "conflict-identity-admin@example.com", "conflictidentityadmin");
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
  const staff = q.userById.get(admin.id);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      artists: [{ id: incomingMbid, name, score: 100 }],
    }),
  });
  try {
    await assert.rejects(
      () => routes["POST /api/admin/artists/enrich"]({
        user: staff,
        body: { names: [name], requireExactIdentity: true },
        requestId: "exact-identity-conflict-test",
      }),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 409);
        assert.equal(error.code, "CONFLICT");
        assert.match(error.message, /different identity/i);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  const persisted = artistStmts.byNorm.get("identity conflict fixture");
  assert.equal(persisted.mbid, storedMbid);
  const data = JSON.parse(persisted.data);
  assert.equal(data.bio, "Keep this catalog biography.");
  assert.deepEqual(data.topTracks, [{ id: 1, title: "Keep This Track" }]);
});
test("withdrawing a sole staff genre cannot resurrect the stale column as provider evidence", () => {
  artistStmts.upsert.run(artistRow("sole staff genre", {
    name: "Sole Staff Genre",
    genre: "r&b",
    genreClaims: [{ value: "r&b", source: "staff", at: 1 }],
  }, "staff"));
  const admin = addUser("u_sole_genre_admin", "sole-genre-admin@example.com", "solegenreadmin");
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(admin.id);
  const result = routes["POST /api/admin/artists/genre"]({
    user: q.userById.get(admin.id),
    body: { name: "Sole Staff Genre", genre: "", reason: "withdraw unsupported claim" },
    requestId: "sole-genre-undo",
  });
  assert.equal(result.artist.genre, null);
  assert.equal(result.artist.genreHint, null);
  const row = artistStmts.byNorm.get("sole staff genre");
  assert.equal(row.genre, "r&b", "the additive upsert may retain the typed column");
  assert.deepEqual(JSON.parse(row.data).genreClaims, [], "the explicit empty claim set remains authoritative");
  assert.equal(publicArtist(row).genre, null);
});

// A playlist snapshot has to replay the same recording later, so the exact
// video id is preserved however the client supplied it: as a bare id, inside a
// watch URL, or as another provider's track id.
test("playlist tracks keep their exact recording identity", () => {
  const owner = addUser("u_playlistid", "playlistid@example.com", "playlistid");
  const create = routes["POST /api/playlists"];
  const made = create({
    user: owner, ip: "playlist-id",
    body: { name: "Identity", visibility: "public", tracks: [
      { title: "Bare", artist: "A", videoId: "dQw4w9WgXcQ", art: "https://tracker.example/pixel/bare" },
      { title: "FromUrl", artist: "A", url: "https://www.youtube.com/watch?v=oHg5SJYRHA0" },
      { title: "Deezer", artist: "A", sourceId: "12345", provider: "deezer", art: "https://e-cdns-images.dzcdn.net/images/cover/trusted/500x500.jpg?viewer=secret" },
      { title: "NoIdentity", artist: "A", art: "https://tracker.example/pixel/no-identity" },
    ] },
  });
  const id = made.playlist?.id || made.id;
  const tracks = routes["GET /api/playlists/:id"]({ user: owner, params: { id } }).playlist.tracks;
  const byTitle = Object.fromEntries(tracks.map((t) => [t.title, t]));

  assert.equal(byTitle.Bare.videoId, "dQw4w9WgXcQ");
  assert.equal(byTitle.FromUrl.videoId, "oHg5SJYRHA0", "the id must be recovered from a watch link");
  assert.equal(byTitle.Deezer.sourceId, "12345");
  assert.equal(byTitle.Deezer.provider, "deezer");
  assert.equal(byTitle.Bare.art, "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    "a caller cannot replace deterministic YouTube art with a tracking pixel");
  assert.equal(byTitle.Deezer.art, "https://e-cdns-images.dzcdn.net/images/cover/trusted/500x500.jpg",
    "provider artwork keeps only its provider-owned path");
  assert.equal(byTitle.NoIdentity.art, null, "arbitrary artwork never reaches another playlist viewer");
  // A track with only title/artist is still a complete reference; the player
  // resolves it when it becomes current.
  assert.equal(byTitle.NoIdentity.videoId, null);
  assert.equal(byTitle.NoIdentity.title, "NoIdentity");
});

test("play history round-trips exact provider recordings to history, friends, and export", () => {
  const owner = addUser("u_play_source_owner", "play-source-owner@example.com", "playsourceowner");
  const viewer = addUser("u_play_source_viewer", "play-source-viewer@example.com", "playsourceviewer");
  db.prepare("INSERT INTO follows (follower_id,followee_id) VALUES (?,?)").run(viewer.id, owner.id);
  const postPlay = routes["POST /api/plays"];
  const shared = { title: "Same Display Recording", artist: "Exact Recording Artist", provider: "deezer" };
  const solo = postPlay({
    user: owner,
    ip: "play-source-owner",
    body: { ...shared, sourceId: "1124841682", videoId: "histSolo001", url: "https://www.deezer.com/track/1124841682" },
  }).play;
  const feature = postPlay({
    user: owner,
    ip: "play-source-owner",
    body: { ...shared, sourceId: "1234638792", videoId: "histFeat001", url: "https://www.deezer.com/track/1234638792" },
  }).play;
  const untrusted = postPlay({
    user: owner,
    ip: "play-source-owner",
    body: { title: "Untrusted Source", artist: "Exact Recording Artist", provider: "filesystem", sourceId: "../../private", art: "https://tracker.example/pixel/history" },
  }).play;
  assert.equal(untrusted.provider, null);
  assert.equal(untrusted.sourceId, null, "unknown provider namespaces never become durable recording identities");
  assert.equal(untrusted.art, null, "play history cannot carry a cross-user tracking pixel");
  db.prepare("UPDATE plays SET created_at=? WHERE id=?").run(100, solo.id);
  db.prepare("UPDATE plays SET created_at=? WHERE id=?").run(200, feature.id);
  db.prepare("UPDATE plays SET created_at=? WHERE id=?").run(50, untrusted.id);

  const history = routes["GET /api/me/plays"]({ user: owner, query: { limit: "50" } }).plays
    .filter((play) => play.title === shared.title);
  assert.deepEqual(history.map((play) => ({
    provider: play.provider,
    sourceId: play.sourceId,
    videoId: play.videoId,
  })), [
    { provider: "deezer", sourceId: "1234638792", videoId: "histFeat001" },
    { provider: "deezer", sourceId: "1124841682", videoId: "histSolo001" },
  ]);

  const friendTrack = routes["GET /api/plays/friends"]({ user: viewer }).listening[0].track;
  assert.deepEqual({
    title: friendTrack.title,
    provider: friendTrack.provider,
    sourceId: friendTrack.sourceId,
    videoId: friendTrack.videoId,
  }, {
    title: shared.title,
    provider: "deezer",
    sourceId: "1234638792",
    videoId: "histFeat001",
  });

  db.prepare("UPDATE users SET pass_hash=? WHERE id=?").run(hashPassword("play-export-password1"), owner.id);
  const exported = routes["POST /api/me/export"]({ user: q.userById.get(owner.id), ip: "play-source-export", body: { password: "play-export-password1" } })
    .listeningHistory.filter((play) => play.title === shared.title);
  assert.deepEqual(exported.map((play) => ({
    provider: play.provider,
    sourceId: play.sourceId,
    videoId: play.videoId,
  })), [
    { provider: "deezer", sourceId: "1234638792", videoId: "histFeat001" },
    { provider: "deezer", sourceId: "1124841682", videoId: "histSolo001" },
  ]);
});

test("playlist create defaults only omitted visibility and rejects invalid privacy values before insert", () => {
  const owner = addUser("u_playlist_visibility", "playlist-visibility@example.com", "playlistvisibility");
  const create = routes["POST /api/playlists"];
  const body = (visibility) => ({
    name: "Privacy boundary",
    tracks: [{ title: "Exact song", artist: "Exact artist" }],
    ...(visibility === undefined ? {} : { visibility }),
  });
  for (const visibility of ["privatee", "PRIVATE"]) {
    assert.throws(() => create({ user: owner, ip: "playlist-visibility", body: body(visibility) }),
      (error) => error.status === 400 && error.code === "VALIDATION_FAILED");
  }
  assert.equal(db.prepare("SELECT COUNT(*) c FROM playlists WHERE user_id=?").get(owner.id).c, 0);
  assert.deepEqual(routes["GET /api/users/:id/playlists"]({ params: { id: owner.id } }).playlists, []);

  const legacy = create({ user: owner, ip: "playlist-visibility", body: body(undefined) });
  assert.equal(legacy.visibility, "public");
});
