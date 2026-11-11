import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const directory = mkdtempSync(join(tmpdir(), "pit-notification-index-"));
process.env.PIT_DATA_DIR = directory;
const { db, q } = await import("./db.js");
const { notificationRoutes } = await import("./features/notifications/notificationRoutes.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
let sequence = 0, unreadSql;
const database = {
  get isTransaction() { return db.isTransaction; },
  exec: (sql) => db.exec(sql),
  prepare(sql) {
    if (sql.includes("SELECT COUNT(*) c FROM notifications")) unreadSql = sql;
    return db.prepare(sql);
  },
};
const routes = notificationRoutes({ database, requireUser: (ctx) => ctx.user, ApiError: Error,
  pageRequest: () => ({ cursor: null, limit: 100 }),
  finishPage: (rows, limit) => ({ rows: rows.slice(0, limit), nextCursor: null }),
  safePublicProfileImage: () => null });
const acknowledge = (owner, ids = []) => routes["POST /api/me/notifications/read/scoped"]({ user: owner, body: { notificationIds: ids } });
function account() {
  const id = `index_account_${++sequence}`;
  q.insertUser.run(id, `${id}@example.invalid`, id, id, "synthetic-noncredential", "fan", "Synthetic", 0, 0, "QA", "#000000", 1);
  return q.userById.get(id);
}
function notification(owner, { actor = null, read = 0, type = "system" } = {}) {
  const id = `index_notification_${++sequence}`;
  db.prepare("INSERT INTO notifications(id,user_id,actor_id,type,read,created_at) VALUES(?,?,?,?,?,?)")
    .run(id, owner.id, actor?.id ?? null, type, read, sequence);
  return id;
}
const plan = (owner) => db.prepare(`EXPLAIN QUERY PLAN ${unreadSql}`).all({ $viewer: owner.id }).map((row) => row.detail).join("\n");

test("unread index excludes read history while count, rows and acknowledgements preserve visibility", () => {
  const owner = account(), foreign = account(), actor = account(), blocked = account(), blocking = account(), muted = account();
  db.exec("BEGIN");
  for (let i = 0; i < 5000; i++) notification(owner, { read: 1 });
  db.exec("COMMIT");
  const visible = notification(owner), changing = notification(owner, { actor });
  const foreignId = notification(foreign);
  const hidden = [notification(owner, { actor: blocked }), notification(owner, { actor: blocking }),
    notification(owner, { actor: muted }), notification(owner, { actor, type: "repost" })];
  db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,1)").run(owner.id, blocked.id);
  db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,1)").run(blocking.id, owner.id);
  db.prepare("INSERT INTO account_mutes(muter_id,muted_id,created_at) VALUES(?,?,1)").run(owner.id, muted.id);
  assert.equal(acknowledge(owner).unread, 2);
  assert.match(plan(owner), /SEARCH n USING INDEX idx_notifs_unread_user \(user_id=\?\)/);
  const page = routes["GET /api/me/notifications"]({ user: owner });
  assert.equal(page.unread, 2);
  assert.ok(!page.notifications.some((row) => hidden.includes(row.id)));
  // Privacy changes are effective immediately; no materialized visibility count.
  db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,1)").run(actor.id, owner.id);
  assert.equal(acknowledge(owner).unread, 1);
  const arrival = notification(owner);
  const result = acknowledge(owner, [visible, changing, foreignId, ...hidden]);
  assert.deepEqual(result.notificationIds, [visible]);
  assert.equal(result.unread, 1);
  assert.equal(db.prepare("SELECT read FROM notifications WHERE id=?").get(arrival).read, 0);
  assert.equal(acknowledge(foreign).unread, 1);
  assert.equal(acknowledge(owner, [visible]).unread, 1);
  db.prepare("DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?").run(actor.id, owner.id);
  assert.equal(acknowledge(owner).unread, 2);
  db.prepare("DELETE FROM notifications WHERE id=?").run(changing);
  assert.equal(acknowledge(owner).unread, 1);
});

test("failed acknowledgement rolls back both read flags and partial-index membership", () => {
  const owner = account(), first = notification(owner), second = notification(owner);
  db.exec(`CREATE TEMP TRIGGER reject_index_ack BEFORE UPDATE OF read ON notifications
    WHEN OLD.id='${second}' BEGIN SELECT RAISE(ABORT,'synthetic acknowledgement fault'); END`);
  try {
    assert.throws(() => acknowledge(owner, [first, second]), /synthetic acknowledgement fault/);
    assert.equal(acknowledge(owner).unread, 2);
    assert.equal(db.prepare("SELECT read FROM notifications WHERE id=?").get(first).read, 0);
  } finally { db.exec("DROP TRIGGER reject_index_ack"); }
  assert.equal(acknowledge(owner, [first, second]).unread, 0);
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("ordinary startup adds the index to an existing populated database and is repeatable", () => {
  const owner = account(); notification(owner); notification(owner, { read: 1 });
  db.exec("DROP INDEX idx_notifs_unread_user");
  const script = `const { db } = await import(${JSON.stringify(new URL("./db.js", import.meta.url).href)}); db.close();`;
  for (let i = 0; i < 2; i++) {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8", env: { ...process.env, NODE_ENV: "test", PIT_DATA_DIR: directory },
    });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(acknowledge(owner).unread, 1);
    assert.match(plan(owner), /idx_notifs_unread_user/);
  }
});
