import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

// Select an isolated database before importing server modules.
const dataDir = mkdtempSync(join(tmpdir(), "pit-social-revocation-"));
process.env.PIT_DATA_DIR = dataDir;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

let sequence = 0;
function user() {
  const id = `revoke_user_${++sequence}`;
  q.insertUser.run(id, `${id}@example.test`, id, id, "test-hash", "fan", "Toronto", 43.65, -79.38,
    "QA", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}

function fixture() {
  const actor = user();
  const target = user();
  const other = user();
  const postId = `revoke_post_${sequence}`;
  db.prepare("INSERT INTO posts(id,user_id,artist,venue,overall,created_at) VALUES(?,?,?,?,?,?)")
    .run(postId, target.id, "Private artist", "Private venue", 4, Date.now());
  for (const owner of [actor, other]) {
    db.prepare("INSERT INTO follows(follower_id,followee_id) VALUES(?,?)").run(owner.id, target.id);
    db.prepare("INSERT INTO likes(post_id,user_id) VALUES(?,?)").run(postId, owner.id);
  }
  return { actor, target, other, postId };
}

function restrict(state, mode) {
  if (mode === "private") db.prepare("UPDATE users SET profile_audience='only_me' WHERE id=?").run(state.target.id);
  if (mode === "dormant") db.prepare("UPDATE users SET dormant_at=? WHERE id=?").run(Date.now(), state.target.id);
  if (mode === "banned") db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(state.target.id);
  if (mode === "suspended") db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 60_000, state.target.id);
  if (mode === "blocked") db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)")
    .run(state.target.id, state.actor.id, Date.now());
  if (mode === "removed") db.prepare("UPDATE posts SET removed=1 WHERE id=?").run(state.postId);
}

for (const mode of ["private", "dormant", "banned", "suspended", "blocked"]) {
  test(`a member can revoke only their own follow of a ${mode} target`, () => {
    const state = fixture();
    restrict(state, mode);
    const ctx = { user: state.actor, params: { id: state.target.id }, body: { following: false, userId: state.other.id } };
    const route = routes["POST /api/users/:id/follow"];
    assert.deepEqual(route(ctx), { following: false });
    assert.deepEqual(route(ctx), { following: false }, "removal retry is idempotent");
    assert.equal(db.prepare("SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?").get(state.actor.id, state.target.id), undefined);
    assert.ok(db.prepare("SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?").get(state.other.id, state.target.id));
    assert.throws(() => route({ ...ctx, body: { following: true } }), (error) => [403, 404].includes(error.status));
    assert.equal(db.prepare("SELECT COUNT(*) count FROM notifications WHERE actor_id=?").get(state.actor.id).count, 0);
  });
}

for (const mode of ["dormant", "banned", "suspended", "blocked", "removed"]) {
  test(`a member can revoke only their own like of ${mode} content`, () => {
    const state = fixture();
    restrict(state, mode);
    const ctx = { user: state.actor, params: { id: state.postId }, body: { liked: false, userId: state.other.id } };
    const route = routes["POST /api/posts/:id/like"];
    assert.deepEqual(route(ctx), { liked: false });
    assert.deepEqual(route(ctx), { liked: false }, "removal retry is idempotent");
    assert.equal(db.prepare("SELECT 1 FROM likes WHERE user_id=? AND post_id=?").get(state.actor.id, state.postId), undefined);
    assert.ok(db.prepare("SELECT 1 FROM likes WHERE user_id=? AND post_id=?").get(state.other.id, state.postId));
    assert.throws(() => route({ ...ctx, body: { liked: true } }), (error) => [403, 404].includes(error.status));
    assert.equal(db.prepare("SELECT COUNT(*) count FROM notifications WHERE actor_id=?").get(state.actor.id).count, 0);
  });
}

test("explicit removals disclose no target identity or existence and require authentication", () => {
  const state = fixture();
  restrict(state, "private");
  restrict(state, "blocked");
  restrict(state, "removed");
  for (const [name, field, present] of [
    ["POST /api/users/:id/follow", "following", state.target.id],
    ["POST /api/posts/:id/like", "liked", state.postId],
  ]) {
    const route = routes[name];
    const ctx = { user: state.other, params: { id: present }, body: { [field]: false } };
    assert.deepEqual(route(ctx), { [field]: false });
    assert.deepEqual(route({ ...ctx, params: { id: "missing_unavailable_identity" } }), { [field]: false });
    assert.deepEqual(route({ ...ctx, params: { id: "missing_unavailable_identity" } }), { [field]: false });
    assert.throws(() => route({ ...ctx, user: null }), (error) => error.status === 401);
    assert.throws(() => route({ ...ctx, body: { [field]: "false" } }), (error) => error.status === 400);
  }
});

test("legacy toggle removal works for an existing own relationship but cannot grant access", () => {
  const state = fixture();
  restrict(state, "blocked");
  for (const [name, field, id] of [
    ["POST /api/users/:id/follow", "following", state.target.id],
    ["POST /api/posts/:id/like", "liked", state.postId],
  ]) {
    const ctx = { user: state.actor, params: { id }, body: {} };
    assert.deepEqual(routes[name](ctx), { [field]: false });
    assert.throws(() => routes[name](ctx), (error) => error.status === 403);
  }
});

for (const [routeName, field, relation] of [
  ["POST /api/users/:id/follow", "following", "follows"],
  ["POST /api/posts/:id/like", "liked", "likes"],
]) {
  test(`${relation} and their notification commit or roll back together`, () => {
    const state = fixture();
    db.prepare("DELETE FROM follows WHERE follower_id=?").run(state.actor.id);
    db.prepare("DELETE FROM likes WHERE user_id=?").run(state.actor.id);
    const ctx = { user: state.actor, params: { id: field === "following" ? state.target.id : state.postId }, body: { [field]: true } };
    db.exec("CREATE TEMP TRIGGER fail_social_notification BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT,'injected notification failure'); END");
    try {
      assert.throws(() => routes[routeName](ctx), /injected notification failure/);
      const count = relation === "follows"
        ? db.prepare("SELECT COUNT(*) count FROM follows WHERE follower_id=?").get(state.actor.id).count
        : db.prepare("SELECT COUNT(*) count FROM likes WHERE user_id=?").get(state.actor.id).count;
      assert.equal(count, 0, "failed notification must not leave a committed social relationship");
    } finally {
      db.exec("DROP TRIGGER fail_social_notification");
    }
    assert.deepEqual(routes[routeName](ctx), { [field]: true });
    assert.deepEqual(routes[routeName](ctx), { [field]: true });
    assert.equal(db.prepare("SELECT COUNT(*) count FROM notifications WHERE actor_id=?").get(state.actor.id).count, 1);
  });
}

test("a comment and both recipient notifications roll back if the second notification fails", () => {
  const state = fixture();
  const parentId = `parent_${sequence}`;
  db.prepare("INSERT INTO comments(id,post_id,user_id,text,created_at) VALUES(?,?,?,?,?)")
    .run(parentId, state.postId, state.other.id, "Parent comment", Date.now());
  // Fixture ids are controlled test identifiers, never request data.
  db.exec(`CREATE TEMP TRIGGER fail_comment_notification BEFORE INSERT ON notifications
    WHEN NEW.user_id='${state.other.id}' BEGIN SELECT RAISE(ABORT,'injected second notification failure'); END`);
  const ctx = { user: state.actor, params: { id: state.postId }, body: { text: "Reply", parentId } };
  try {
    assert.throws(() => routes["POST /api/posts/:id/comments"](ctx), /injected second notification failure/);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM comments WHERE user_id=?").get(state.actor.id).count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM notifications WHERE actor_id=?").get(state.actor.id).count, 0);
  } finally {
    db.exec("DROP TRIGGER fail_comment_notification");
  }
  const result = routes["POST /api/posts/:id/comments"](ctx);
  assert.equal(result.parentId, parentId);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM comments WHERE user_id=?").get(state.actor.id).count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM notifications WHERE actor_id=?").get(state.actor.id).count, 2);
});
