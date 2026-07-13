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

  const lounge = routes["GET /api/lounges/:key/messages"]({ user: null, params: { key: "show" } });
  assert.equal(lounge.messages.length, 300);
  assert.equal(lounge.messages[0].createdAt, 6);
  assert.equal(lounge.messages.at(-1).createdAt, 305);
  assert.deepEqual(routes["GET /api/lounges/:key/messages"]({ user: null, params: { key: "show" }, query: { before: lounge.nextCursor } }).messages.map((m) => m.createdAt), [1, 2, 3, 4, 5]);
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
