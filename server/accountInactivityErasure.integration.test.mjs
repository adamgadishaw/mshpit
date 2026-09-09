import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "pit-inactivity-full-erasure-"));
process.env.PIT_DATA_DIR = directory;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
const { db, q } = await import("./db.js");
const { eraseAccountForInactivity, routes } = await import("./api.js");
const { createSession, hashPassword } = await import("./auth.js");
const { ownerIdentity, storeOwnerIdentity } = await import("./ownerIdentity.js");
const { eraseInactiveAccount, ACCOUNT_INACTIVITY_DAY_MS: DAY } = await import("./features/accountLifecycle/accountLifecycle.js");
const { recordMediaObjectTicket } = await import("./mediaDeletion.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

const AT = 1_850_000_000_000;
let sequence = 0;
function member({ email = `erase-${++sequence}@example.test`, role = "fan" } = {}) {
  const id = `erase_${++sequence}`;
  q.insertUser.run(id, email, id, id, hashPassword("Same-password1"), role, null, null, null, "ER", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
const owner = member({ role: "admin" });
storeOwnerIdentity(db, ownerIdentity(owner.email, owner.id, Date.now()));
function due(user, { activeAt = AT - 731 * DAY, warnedAt = activeAt + 700 * DAY, receipt = "delivered-fixture" } = {}) {
  db.prepare(`UPDATE users SET last_active_at=?,dormant_at=?,inactivity_warning_sent_at=?,
    inactivity_warning_activity_at=?,inactivity_warning_receipt=? WHERE id=?`)
    .run(activeAt, activeAt + 365 * DAY, warnedAt, activeAt, receipt, user.id);
  return q.userById.get(user.id);
}
function locked(action) {
  db.exec("BEGIN IMMEDIATE");
  try { const result = action(); db.exec("COMMIT"); return result; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
function erase(user) {
  return eraseInactiveAccount(db, { userId: user.id, expectedLastActiveAt: user.last_active_at, at: AT,
    eraseAccount: eraseAccountForInactivity });
}

test("full-erasure export requires a transaction and repeats policy, receipt, and Owner checks", () => {
  const user = due(member());
  assert.throws(() => eraseAccountForInactivity(user, { at: AT }), /worker transaction/);
  assert.throws(() => locked(() => eraseAccountForInactivity(user, { at: AT, reason: "rollout" })), /Invalid inactivity/);
  assert.equal(locked(() => eraseAccountForInactivity(owner, { at: AT })), false);
  assert.ok(q.userById.get(owner.id));
  for (const options of [{ activeAt: AT - 729 * DAY }, { receipt: null }, { warnedAt: AT - 29 * DAY }]) {
    const protectedUser = due(member(), options);
    assert.equal(locked(() => eraseAccountForInactivity(protectedUser, { at: AT })), false);
    assert.ok(q.userById.get(protectedUser.id));
  }
  const snapshot = due(member());
  db.prepare("UPDATE users SET last_active_at=last_active_at+1 WHERE id=?").run(snapshot.id);
  assert.equal(locked(() => eraseAccountForInactivity(snapshot, { at: AT })), false);
  assert.ok(q.userById.get(snapshot.id));
});

test("eligible lifecycle erasure reuses complete media, session, link, post, and tag cleanup without touching the sibling", async () => {
  const user = member();
  const sibling = member({ email: user.email });
  const session = createSession(user.id);
  const siblingSession = createSession(sibling.id);
  await routes["POST /api/me/accounts/connect"]({ user, token: session.token, body: { password: "Same-password1" },
    ip: "erasure-proof", setHeader() {} });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM linked_account_pairs WHERE user_a_id=? OR user_b_id=?").get(user.id, user.id).n, 1);
  const key = `users/${user.id}/post/never-attached.jpg`;
  const siblingKey = `users/${sibling.id}/post/retain.jpg`;
  recordMediaObjectTicket(db, { ownerId: user.id, objectKey: key, at: AT - DAY });
  recordMediaObjectTicket(db, { ownerId: sibling.id, objectKey: siblingKey, at: AT - DAY });
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,review,created_at) VALUES (?,?,'Fixture Artist','Fixture Venue',4,?,?)").run(`post_${user.id}`, user.id, "Remove authored post", AT - DAY);
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,kind,review,tagged_user_ids,created_at) VALUES (?,?,'Fixture Artist','Fixture Venue',4,?,?,?,?)")
    .run(`post_${sibling.id}`, sibling.id, "status", "Keep sibling post", JSON.stringify([user.id]), AT - DAY);
  assert.equal(erase(due(user)), true);
  assert.equal(q.userById.get(user.id), undefined);
  assert.ok(q.userById.get(sibling.id));
  assert.ok(db.prepare("SELECT 1 FROM sessions WHERE user_id=?").get(sibling.id));
  assert.ok(siblingSession.token);
  assert.equal(db.prepare("SELECT 1 FROM sessions WHERE user_id=?").get(user.id), undefined);
  assert.equal(db.prepare("SELECT 1 FROM linked_account_pairs WHERE user_a_id=? OR user_b_id=?").get(user.id, user.id), undefined);
  assert.equal(db.prepare("SELECT 1 FROM posts WHERE id=?").get(`post_${user.id}`), undefined);
  assert.deepEqual(JSON.parse(db.prepare("SELECT tagged_user_ids FROM posts WHERE id=?").get(`post_${sibling.id}`).tagged_user_ids), []);
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(key).status, "delete_queued");
  assert.ok(db.prepare("SELECT 1 FROM media_deletion_queue WHERE object_key=?").get(key));
  assert.ok(db.prepare("SELECT 1 FROM media_owner_sweeps WHERE owner_id=?").get(user.id));
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(siblingKey).status, "issued");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("a downstream cleanup failure rolls back the user, session, and queued media changes together", () => {
  const user = member();
  createSession(user.id);
  const key = `users/${user.id}/post/rollback.jpg`;
  recordMediaObjectTicket(db, { ownerId: user.id, objectKey: key, at: AT - DAY });
  const snapshot = due(user);
  db.exec(`CREATE TEMP TRIGGER fail_inactivity_erasure BEFORE DELETE ON users
    WHEN OLD.id='${user.id}' BEGIN SELECT RAISE(ABORT,'injected erasure failure'); END;`);
  try { assert.throws(() => erase(snapshot), /injected erasure failure/); }
  finally { db.exec("DROP TRIGGER fail_inactivity_erasure"); }
  assert.ok(q.userById.get(user.id));
  assert.ok(db.prepare("SELECT 1 FROM sessions WHERE user_id=?").get(user.id));
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(key).status, "issued");
  assert.equal(db.prepare("SELECT 1 FROM media_deletion_queue WHERE object_key=?").get(key), undefined);
  assert.equal(db.prepare("SELECT 1 FROM media_owner_sweeps WHERE owner_id=?").get(user.id), undefined);
  assert.equal(db.isTransaction, false);
});
