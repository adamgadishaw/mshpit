import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { profileAudienceAllows } from "./accountVisibility.js";
import { ApiError } from "./errors.js";
import { createRelationshipManagementProjection } from "./relationshipManagementProjection.js";
import { accountMuteRoutes } from "./features/accountMute/accountMuteRoutes.js";
import { publicProfileCacheEntry } from "../src/domain/dataPolicy.mjs";

function fixture(t) {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec(`CREATE TABLE users (id TEXT PRIMARY KEY,name TEXT,handle TEXT,bio TEXT,home_city TEXT,
    avatar_uri TEXT,avatar_color TEXT,profile_updated_at INTEGER,profile_audience TEXT,
    is_banned INTEGER DEFAULT 0,suspended_until INTEGER,dormant_at INTEGER);
    CREATE TABLE blocks (blocker_id TEXT,blocked_id TEXT,PRIMARY KEY(blocker_id,blocked_id));
    CREATE TABLE follows (follower_id TEXT,followee_id TEXT,PRIMARY KEY(follower_id,followee_id));
    CREATE TABLE account_mutes (muter_id TEXT,muted_id TEXT,created_at INTEGER,PRIMARY KEY(muter_id,muted_id));`);
  const insert = database.prepare("INSERT INTO users(id,name,handle,bio,home_city,avatar_uri,avatar_color,profile_updated_at,profile_audience) VALUES(?,?,?,?,?,?,?,?,?)");
  for (const id of ["viewer", "otherViewer", "target", "secondTarget"]) {
    insert.run(id, `Name ${id}`, `handle_${id}`, `Biography ${id}`, `City ${id}`,
      `https://fixture.test/${id}.jpg`, "#123456", 1, "everyone");
  }
  const userById = id => database.prepare("SELECT * FROM users WHERE id=?").get(id);
  let projections = 0;
  const project = createRelationshipManagementProjection({
    visibleProfileOrNull: (id, viewer) => profileAudienceAllows(userById(id), viewer) ? userById(id) : null,
    blockedEitherWay: (a, b) => !!database.prepare("SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)").get(a, b, b, a),
    projectUser(row) {
      projections += 1;
      return { id: row.id, name: row.name, handle: row.handle, initials: "NA", avatarUri: row.avatar_uri,
        avatarColor: row.avatar_color, profileUpdatedAt: row.profile_updated_at, bio: row.bio,
        home: { city: row.home_city }, email: "excluded@example.test", futurePrivateField: "excluded" };
    },
  });
  const routes = accountMuteRoutes({ database, ApiError,
    requireUser: ctx => { if (!ctx.user) throw new ApiError(401, "Log in first.", "AUTH_REQUIRED"); return ctx.user; },
    rateLimit() {}, now: Date.now, desiredState: (body, field, current) => body?.[field] ?? !current,
    userById, projectManagedUser: project, invalidateRecommendations() {},
  });
  const context = (id = "viewer", body = {}, target = "target") => ({ user: userById(id), body, params: { id: target }, setHeader() {} });
  const mute = (id = "viewer", target = "target", muted = true) => routes["POST /api/users/:id/mute"](context(id, { muted }, target));
  const list = id => routes["GET /api/me/muted"](context(id)).users;
  return { database, userById, project, routes, context, mute, list, projections: () => projections };
}

function assertUnavailable(value, id) {
  assert.deepEqual(value, { id, name: "Unavailable account", handle: "unavailable", initials: "?",
    avatarUri: null, avatarColor: null, profileUpdatedAt: 0, unavailable: true });
}

test("visible muted members receive only management identity and safe avatar fields", t => {
  const f = fixture(t);
  f.mute();
  const result = f.list("viewer")[0];
  assert.deepEqual(result, { id: "target", name: "Name target", handle: "handle_target", initials: "NA",
    avatarUri: "https://fixture.test/target.jpg", avatarColor: "#123456", profileUpdatedAt: 1 });
  assert.equal(f.projections(), 1);
});

test("new and existing mute relationships cannot disclose a newly private profile", t => {
  const f = fixture(t);
  f.mute();
  assert.equal(f.list("viewer")[0].name, "Name target");
  f.database.prepare("UPDATE users SET profile_audience='only_me',name='Private changed name',bio='Private changed bio' WHERE id='target'").run();
  f.mute("otherViewer");
  const before = f.projections();
  assertUnavailable(f.list("viewer")[0], "target");
  assertUnavailable(f.list("otherViewer")[0], "target");
  assert.equal(f.projections(), before, "inaccessible rows never reach the public projector");
  f.database.prepare("UPDATE users SET profile_audience='members' WHERE id='target'").run();
  assert.equal(f.list("viewer")[0].name, "Private changed name", "a fresh authorized read restores the live identity");
});

test("a block in either direction overrides existing follows and new mute relationships", t => {
  const f = fixture(t);
  f.database.exec("INSERT INTO follows VALUES('viewer','target'),('target','viewer')");
  for (const [from, to] of [["viewer", "target"], ["target", "viewer"]]) {
    f.database.prepare("INSERT INTO blocks VALUES(?,?)").run(from, to);
    f.mute();
    assertUnavailable(f.list("viewer")[0], "target");
    f.mute("viewer", "target", false);
    assert.deepEqual(f.list("viewer"), [], "unmute remains available without target profile access");
    f.database.exec("DELETE FROM blocks");
  }
});

test("banned, dormant and currently suspended targets are unavailable without exposing the reason", t => {
  const f = fixture(t);
  f.mute();
  for (const [field, value] of [["is_banned", 1], ["dormant_at", Date.now()], ["suspended_until", Date.now() + 60_000]]) {
    f.database.prepare(`UPDATE users SET ${field}=? WHERE id='target'`).run(value);
    assertUnavailable(f.list("viewer")[0], "target");
    f.database.prepare(`UPDATE users SET ${field}=? WHERE id='target'`).run(field === "is_banned" ? 0 : null);
  }
  f.database.prepare("UPDATE users SET suspended_until=1 WHERE id='target'").run();
  assert.equal(f.list("viewer")[0].name, "Name target", "expired suspension does not hide an active profile");
});

test("mute directory is account-owned, noncacheable, and cannot be selected through request parameters", t => {
  const f = fixture(t);
  f.mute();
  f.mute("otherViewer", "secondTarget");
  const headers = {};
  const ctx = { ...f.context(), query: { userId: "otherViewer" }, params: { id: "otherViewer" },
    setHeader: (key, value) => { headers[key] = value; } };
  assert.deepEqual(f.routes["GET /api/me/muted"](ctx).users.map(user => user.id), ["target"]);
  assert.equal(headers["Cache-Control"], "private, no-store");
  assert.throws(() => f.routes["GET /api/me/muted"]({}), { code: "AUTH_REQUIRED" });
  f.mute("viewer", "target", false);
  assert.deepEqual(f.list("otherViewer").map(user => user.id), ["secondTarget"]);
});

test("unavailable identity hydrates existing web/native Settings and clears a previously cached avatar", t => {
  const f = fixture(t);
  const old = f.project(f.userById("target"), f.userById("viewer"));
  f.database.prepare("UPDATE users SET profile_audience='only_me' WHERE id='target'").run();
  const unavailable = f.project(f.userById("target"), f.userById("viewer"));
  const hydrated = { ...old, ...publicProfileCacheEntry(unavailable) };
  assert.equal(hydrated.id, "target");
  assert.equal(hydrated.name, "Unavailable account");
  assert.equal(hydrated.handle, "unavailable");
  assert.equal(hydrated.initials, "?");
  assert.equal(hydrated.avatarUri, null);
  assert.equal(hydrated.avatarColor, null);
});
