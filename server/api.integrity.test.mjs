import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-api-integrity-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q, publicUser, artistStmts, artistRow, publicArtist, pruneMissingArtists } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");
const { renderPublicPage } = await import("./publicPages.js");
const { clearRecommendationSnapshotsForTests } = await import("./recommendationService.js");
const { hashPassword } = await import("./auth.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id, email, handle) {
  q.insertUser.run(id, email, handle, handle, "test-hash", "fan", "Toronto", 43.65, -79.38, handle.slice(0, 2).toUpperCase(), "#123456", Date.now());
  return q.userById.get(id);
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
    genres: "not-json",
    favorite_artists: "null",
    extras: JSON.stringify({
      id: "spoofed", email: "leak@example.com", role: "admin", verified: true, home: { city: "Spoofed" }, theme: "stage",
      nowPlaying: { title: { nested: "crash" }, artist: ["not", "a", "string"] },
    }),
  };

  const publicProjection = publicUser(base);
  assert.equal(publicProjection.id, "u_projection");
  assert.equal(publicProjection.role, "fan");
  assert.equal(publicProjection.verified, false);
  assert.equal(publicProjection.email, undefined);
  assert.equal(publicProjection.home, null);
  assert.equal(publicProjection.theme, "stage");
  assert.equal(publicProjection.nowPlaying, undefined);
  assert.deepEqual(publicProjection.genres, []);
  assert.deepEqual(publicProjection.favoriteArtists, []);

  assert.equal(publicUser(base, { self: true }).email, "real@example.com");
  assert.doesNotThrow(() => publicUser({ ...base, extras: "{broken" }));
});

test("health reflects database readiness without exposing configuration values", () => {
  const health = routes["GET /api/health"]({});
  assert.equal(health.ok, true);
  assert.equal(health.services.database, true);
  assert.equal(typeof health.uptimeSeconds, "number");
  assert.equal(typeof health.services.storageConfigured, "boolean");
  assert.deepEqual(health.services.storage, {
    configured: true,
    databaseFilePresent: true,
    bootstrapAllowed: false,
  });
  assert.equal(typeof health.services.backgroundJobs.cacheWarmEnabled, "boolean");
  assert.equal(typeof health.services.backgroundJobs.tourDateRefreshEnabled, "boolean");
  assert.equal(typeof health.services.youtubeConfigured, "boolean");
  assert.equal(typeof health.services.mailConfigured, "boolean");
  assert.equal(typeof health.services.mail.apiKeyPresent, "boolean");
  assert.equal(typeof health.services.mail.fromValid, "boolean");
  assert.equal(health.services.mail.configured, health.services.mailConfigured);
  assert.equal(typeof health.services.mediaStorageConfigured, "boolean");
});

test("artist search ignores punctuation and spacing for phone-friendly lookup", () => {
  artistStmts.upsert.run(artistRow("j. cole search test", {
    name: "J. Cole Search Test",
    popularity: 99,
  }, "test"));
  const result = routes["GET /api/artists"]({ query: { q: "jcolesearchtest", limit: 5 } });
  assert.equal(result.artists[0]?.name, "J. Cole Search Test");
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
  }, "test"));
  artistStmts.upsert.run(artistRow("discover route bravo", {
    name: "Discover Route Bravo", genre: "indie rock", country: "Route Test Country", popularity: 98,
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
  assert.equal(overview.memberTotal, db.prepare("SELECT COUNT(*) count FROM users WHERE is_banned=0").get().count);
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
  assert.deepEqual(result.user.nowPlaying, { title: "Safe Song", artist: "Safe Artist" });
  assert.deepEqual(JSON.parse(q.userById.get(user.id).extras), { theme: "stage", nowPlaying: { title: "Safe Song", artist: "Safe Artist" } });
});

test("signup records Terms separately while optional analytics defaults off", () => {
  let sessionCookie;
  const result = routes["POST /api/signup"]({
    ip: "signup-consent-test",
    ua: "integrity-test",
    body: {
      name: "Default Private",
      email: "default-private@example.com",
      password: "privatepass123",
      city: "Toronto",
      termsVersion: "2026-08",
      analyticsConsent: false,
    },
    setSession: (value) => { sessionCookie = value; },
  });
  assert.ok(sessionCookie?.token);
  assert.ok(result.user.termsAcceptedAt);
  assert.equal(result.user.termsVersion, "2026-08");
  assert.equal(result.user.analyticsConsentAt, undefined);
  assert.equal(result.user.consentAt, undefined);
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
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,review,created_at) VALUES (?,?,?,?,?,?,?)")
    .run("p_internal_001", member.id, "Analytics Artist", "Analytics Venue", 4, "Public fixture", Date.now());
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
  const user = addUser("u_chat_integrity", "chat-integrity@example.com", "chatintegrity");
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
  assert.deepEqual(loungeMeta, { attendeeCount: 1, messageCount: 2 });

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

test("desired-state social mutations are idempotent and old toggle calls still work", () => {
  const user = addUser("u_toggle_a", "toggle-a@example.com", "togglea");
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
    (id,artist,venue,place,lat,lng,date,ticket_url,sold_out,source,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run("tm_sidebar_far", "Far Artist", "Far Hall", "Vancouver, British Columbia, Canada", 49.2827, -123.1207, "2099 · 08 · 20", "https://tickets.example/far", 0, "ticketmaster", Date.now());
  insert.run("tm_sidebar_local", "Local Artist", "Local Hall", "Toronto, Ontario, Canada", 43.6532, -79.3832, "2099 · 09 · 01", "https://tickets.example/local", 0, "ticketmaster", Date.now());

  const result = routes["GET /api/discovery/sidebar"]({ user });
  assert.ok(result.topArtists.length >= 3);
  assert.equal(result.upcomingEvents[0].id, "tm_sidebar_local");
  assert.equal(result.upcomingEvents[0].local, true);
  assert.equal(result.trendingVenues[0].name, "Local Hall");
  assert.equal(result.location.city, "Toronto");
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
  assert.equal(routes["GET /api/going/:key/attendees"]({ user: blocker, params: { key: "show-block-matrix" } }).attendees.length, 0);
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
    },
  });
  const stored = db.prepare("SELECT reason FROM reports WHERE id=?").get(result.id);
  assert.deepEqual(JSON.parse(stored.reason), {
    title: "The Song",
    artist: "The Artist",
    category: "wont_play",
    suggestedVideoId: "dQw4w9WgXcQ",
    note: "Player showed an unavailable message",
  });
  assert.throws(
    () => handler({ user: listener, ip: "track-report-invalid", body: { title: "Another Song", category: "database_is_broken" } }),
    (error) => error.code === "VALIDATION_FAILED",
  );
});

test("moderators have real bounded actions and every content change is audited", () => {
  addUser("u_mod_actions", "mod-actions@example.com", "modactions");
  const target = addUser("u_mod_target", "mod-target@example.com", "modtarget");
  db.prepare("UPDATE users SET role='moderator' WHERE id='u_mod_actions'").run();
  const moderator = q.userById.get("u_mod_actions");
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
  assert.equal(routes["POST /api/admin/users/:id/suspend"]({ user: moderator, params: { id: target.id }, body: { days: 1 } }).ok, true);
});

test("account export covers owned social data without secrets or raw IP addresses", () => {
  const user = addUser("u_export", "export@example.com", "exportuser");
  db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 86_400_000, user.id);
  const restrictedUser = q.userById.get(user.id);
  const other = addUser("u_export_other", "export-other@example.com", "exportother");
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

  const data = routes["GET /api/me/export"]({ user: restrictedUser, ip: "export-test" });
  assert.equal(data.venueReviews[0].id, "vr_export");
  assert.deepEqual(data.fanClubs.memberships, ["The Band"]);
  assert.equal(data.loungeMessages[0].id, "lm_export");
  assert.equal(data.artistAccount.requests[0].id, "ar_export");
  assert.equal(data.artistAccount.profiles[0].artistKey, "the band");
  assert.equal(data.artistAccount.posts[0].id, "ap_export");
  assert.equal(data.reportsSubmitted[0].id, "rep_export");
  assert.deepEqual(data.activityEvents[0].properties, { artist: "The Band" });
  assert.equal(data.messagesReceived[0].text, "incoming");
  const encoded = JSON.stringify(data);
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
  db.prepare("INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)").run("session_delete", user.id, 1, Date.now() + 100000);

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

  // Provider enrichment arrives lowercased and is real evidence, so it shows.
  artistStmts.upsert.run(artistRow("taylor swift", { name: "Taylor Swift", genre: "pop" }, "deezer"));
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

test("For You is global-first, cursor-stable, and an allegation alone cannot suppress a post", () => {
  const author = addUser("u_for_you_author", "for-you-author@example.com", "foryouauthor");
  const reporter = addUser("u_for_you_reporter", "for-you-reporter@example.com", "foryoureporter");
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
  assert.equal(first.posts.every((post) => post.recommendation?.algorithm === first.algorithm.id), true);

  const repeated = routes["GET /api/feed/for-you"]({ user: null, ip: "for-you-test", query: { limit: "3" } });
  assert.deepEqual(repeated.posts.map((post) => post.id), first.posts.map((post) => post.id), "unexpired guest snapshot is reused");
  assert.equal(repeated.nextCursor, first.nextCursor);

  // Traverse the snapshot instead of assuming a reported post must rank in the
  // first six among unrelated test fixtures. The policy under test is
  // eligibility: an allegation alone must not erase otherwise-live content.
  const snapshotIds = [...first.posts.map((post) => post.id)];
  let cursor = first.nextCursor;
  while (cursor) {
    const page = routes["GET /api/feed/for-you"]({ user: null, ip: "for-you-test", query: { limit: "50", cursor } });
    snapshotIds.push(...page.posts.map((post) => post.id));
    cursor = page.nextCursor;
  }
  assert.ok(snapshotIds.includes("p_for_you_6"), "an open report is an allegation, not a moderation state");
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
    } else if (value.includes("/artist/202/top")) payload = { data: [{ id: 2, title: "Staff Song", album: { id: 2002 } }] };
    else if (value.includes("/artist/101/top")) payload = { data: [{ id: 1, title: "Provider Song", album: { id: 1001 } }] };
    else if (value.includes("/album/2002")) payload = { genres: { data: [{ name: "Pop" }] } };
    else if (value.includes("/album/1001")) payload = { genres: { data: [{ name: "Pop" }] } };
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
  } finally {
    globalThis.fetch = originalFetch;
  }

  const provider = publicArtist(artistStmts.byNorm.get("provider exact label"));
  assert.equal(provider.genre, "Pop", "an exact-title provider label must not be demoted to a crawl hint");
  assert.equal(provider.genreSource, "provider");
  const preserved = publicArtist(artistStmts.byNorm.get("staff genre keeper"));
  assert.equal(preserved.genre, "r&b");
  assert.equal(preserved.genreSource, "staff");
  const stored = JSON.parse(artistStmts.byNorm.get("staff genre keeper").data);
  assert.equal(stored.genreClaims.find((claim) => claim.source === "provider")?.value, "Pop");
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
      { title: "Bare", artist: "A", videoId: "dQw4w9WgXcQ" },
      { title: "FromUrl", artist: "A", url: "https://www.youtube.com/watch?v=oHg5SJYRHA0" },
      { title: "Deezer", artist: "A", sourceId: "12345", provider: "deezer" },
      { title: "NoIdentity", artist: "A" },
    ] },
  });
  const id = made.playlist?.id || made.id;
  const tracks = routes["GET /api/playlists/:id"]({ user: owner, params: { id } }).playlist.tracks;
  const byTitle = Object.fromEntries(tracks.map((t) => [t.title, t]));

  assert.equal(byTitle.Bare.videoId, "dQw4w9WgXcQ");
  assert.equal(byTitle.FromUrl.videoId, "oHg5SJYRHA0", "the id must be recovered from a watch link");
  assert.equal(byTitle.Deezer.sourceId, "12345");
  assert.equal(byTitle.Deezer.provider, "deezer");
  // A track with only title/artist is still a complete reference; the player
  // resolves it when it becomes current.
  assert.equal(byTitle.NoIdentity.videoId, null);
  assert.equal(byTitle.NoIdentity.title, "NoIdentity");
});
