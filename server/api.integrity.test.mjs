import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-api-integrity-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q, publicUser } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");

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

  const lounge = routes["GET /api/lounges/:key/messages"]({ user: null, params: { key: "show" } });
  assert.equal(lounge.messages.length, 300);
  assert.equal(lounge.messages[0].createdAt, 6);
  assert.equal(lounge.messages.at(-1).createdAt, 305);
});
