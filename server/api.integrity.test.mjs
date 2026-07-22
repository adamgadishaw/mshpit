import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-api-integrity-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q, publicUser } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");
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
    extras: JSON.stringify({ id: "spoofed", email: "leak@example.com", role: "admin", verified: true, home: { city: "Spoofed" }, theme: "stage" }),
  };

  const publicProjection = publicUser(base);
  assert.equal(publicProjection.id, "u_projection");
  assert.equal(publicProjection.role, "fan");
  assert.equal(publicProjection.verified, false);
  assert.equal(publicProjection.email, undefined);
  assert.equal(publicProjection.home, null);
  assert.equal(publicProjection.theme, "stage");
  assert.deepEqual(publicProjection.genres, []);
  assert.deepEqual(publicProjection.favoriteArtists, []);

  assert.equal(publicUser(base, { self: true }).email, "real@example.com");
  assert.doesNotThrow(() => publicUser({ ...base, extras: "{broken" }));
});

test("health reflects database readiness without exposing configuration values", () => {
  const health = routes["GET /api/health"]({});
  assert.equal(health.ok, true);
  assert.equal(health.services.database, true);
  assert.equal(typeof health.services.youtubeConfigured, "boolean");
  assert.equal(typeof health.services.mailConfigured, "boolean");
  assert.equal(typeof health.services.mediaStorageConfigured, "boolean");
});

test("PATCH /api/me rejects oversized extras and keeps trusted fields authoritative", () => {
  const user = addUser("u_profile", "profile@example.com", "profile");
  const handler = routes["PATCH /api/me"];

  assert.throws(
    () => handler({ user, ip: "profile-test", body: { extras: { value: "x".repeat(9000) } } }),
    (error) => error instanceof ApiError && error.status === 400
  );

  const result = handler({ user, ip: "profile-test", body: { extras: { role: "admin", verified: true, consentAt: 123 } } });
  assert.equal(result.user.role, "fan");
  assert.equal(result.user.verified, false);
  assert.equal(result.user.consentAt, 123);
});

test("analytics is consented, allow-listed, IP-free, aggregated, and admin-only", () => {
  addUser("u_analytics_member", "analytics-member@example.com", "analyticsmember");
  db.prepare("UPDATE users SET extras=? WHERE id=?").run(JSON.stringify({ consentAt: Date.now(), termsVersion: "2026-07" }), "u_analytics_member");
  const member = q.userById.get("u_analytics_member");
  const ingest = routes["POST /api/events"];
  const result = ingest({
    user: member,
    ip: "203.0.113.44",
    body: { events: [
      { name: "search", props: { q: "shoegaze", secret: "must disappear" } },
      { name: "search", props: { q: "shoegaze" } },
      { name: "search", props: { q: "shoegaze" } },
      { name: "search", props: { q: "person@example.com" } },
      { name: "play", props: { artist: "The Artist", title: "The Song", token: "private" } },
      { name: "arbitrary_client_event", props: { anything: "no" } },
    ] },
  });
  assert.equal(result.stored, 5);
  const rows = db.prepare("SELECT name,props,ip FROM events WHERE user_id=? ORDER BY created_at,id").all(member.id);
  assert.equal(rows.every((row) => row.ip == null), true);
  assert.deepEqual(JSON.parse(rows.find((row) => row.name === "play").props), { artist: "The Artist", title: "The Song" });
  assert.equal(rows.some((row) => row.name === "arbitrary_client_event"), false);
  assert.equal(rows.some((row) => row.props.includes("example.com")), false);
  assert.equal(ingest({ user: null, ip: "203.0.113.45", body: { events: [{ name: "search", props: { q: "guest" } }] } }).stored, 0);

  addUser("u_analytics_admin", "analytics-admin@example.com", "analyticsadmin");
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run("u_analytics_admin");
  const admin = q.userById.get("u_analytics_admin");
  const dashboard = routes["GET /api/admin/analytics"]({ user: admin });
  assert.ok(dashboard.topSearches.some((entry) => entry.label === "shoegaze" && entry.count === 3));
  assert.equal(dashboard.growth.length, 30);
  assert.equal(dashboard.retentionDays >= 30, true);
  const detail = routes["GET /api/admin/analytics/users/:id"]({ user: admin, params: { id: member.id } });
  assert.equal(detail.totals.events, 5);
  assert.equal(detail.recent.find((event) => event.name === "search").props.q, undefined);
  assert.throws(() => routes["GET /api/admin/analytics"]({ user: member }), (error) => error.status === 403);

  const updated = routes["PATCH /api/me"]({
    user: member,
    ip: "profile-test",
    body: { extras: { consentAt: Date.now(), termsVersion: "2026-07", analyticsOptOut: true } },
  });
  assert.equal(updated.user.analyticsOptOut, true);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM events WHERE user_id=?").get(member.id).count, 0);
  assert.equal(ingest({
    user: q.userById.get(member.id),
    ip: "203.0.113.46",
    body: { events: [{ name: "play", props: { artist: "No", title: "Tracking" } }] },
  }).stored, 0);
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

  const fan = routes["GET /api/fanclubs/:artist/messages"]({ params: { artist: "artist" } });
  assert.equal(fan.messages.length, 300);
  assert.equal(fan.messages[0].createdAt, 6);
  assert.equal(fan.messages.at(-1).createdAt, 305);
  assert.deepEqual(routes["GET /api/fanclubs/:artist/messages"]({ params: { artist: "artist" }, query: { before: fan.nextCursor } }).messages.map((m) => m.createdAt), [1, 2, 3, 4, 5]);
  insertFanMessage.run("fc_0306", "artist", "u_a", "fan 306", 306);
  const newerFan = routes["GET /api/fanclubs/:artist/messages"]({ params: { artist: "artist" }, query: { after: fan.syncCursor } });
  assert.deepEqual(newerFan.messages.map((m) => m.createdAt), [306]);
  db.prepare("UPDATE fan_club_messages SET removed=1 WHERE id=?").run("fc_0306");
  assert.ok(routes["GET /api/fanclubs/:artist/messages"]({ params: { artist: "artist" }, query: { after: newerFan.syncCursor } }).removedIds.includes("fc_0306"));

  const lounge = routes["GET /api/lounges/:key/messages"]({ user: null, params: { key: "show" } });
  assert.equal(lounge.messages.length, 300);
  assert.equal(lounge.messages[0].createdAt, 6);
  assert.equal(lounge.messages.at(-1).createdAt, 305);
  assert.deepEqual(routes["GET /api/lounges/:key/messages"]({ user: null, params: { key: "show" }, query: { before: lounge.nextCursor } }).messages.map((m) => m.createdAt), [1, 2, 3, 4, 5]);
  insertLoungeMessage.run("lm_0306", "show", "u_a", "lounge 306", 306);
  const newerLounge = routes["GET /api/lounges/:key/messages"]({ user: null, params: { key: "show" }, query: { after: lounge.syncCursor } });
  assert.deepEqual(newerLounge.messages.map((m) => m.createdAt), [306]);
  db.prepare("UPDATE lounge_messages SET removed=1 WHERE id=?").run("lm_0306");
  assert.ok(routes["GET /api/lounges/:key/messages"]({ user: null, params: { key: "show" }, query: { after: newerLounge.syncCursor } }).removedIds.includes("lm_0306"));
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

test("blocking closes direct profile, content, interaction, and community read paths", () => {
  const blocker = addUser("u_block_matrix_a", "block-matrix-a@example.com", "blockmatrixa");
  const blocked = addUser("u_block_matrix_b", "block-matrix-b@example.com", "blockmatrixb");
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,created_at) VALUES (?,?,?,?,?,?)").run("post_block_matrix", blocked.id, "Artist", "Venue", 4, 100);
  db.prepare("INSERT INTO playlists (id,user_id,name,tracks,created_at) VALUES (?,?,?,?,?)").run("playlist_block_matrix", blocked.id, "List", '[{"title":"Song"}]', 100);
  db.prepare("INSERT INTO fan_club_messages (id,artist,user_id,text,created_at) VALUES (?,?,?,?,?)").run("fan_block_matrix", "artist", blocked.id, "hidden", 100);
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
  assert.doesNotThrow(() => routes["GET /api/admin/members"]({ user: moderator }));
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
