import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-dm-read-through-"));
process.env.PIT_DATA_DIR = dataDir;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { directMessageReadFor, directMessageReadProjection } = await import("./dmReadRoutes.js");
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

let sequence = 0;
const paths = ["POST /api/dms/:otherId/read-through", "POST /api/dms/:otherId/read"];
function user() {
  const id = `read_target_user_${++sequence}`;
  q.insertUser.run(id, `${id}@example.com`, id, `target_${sequence}`, "test-hash", "fan", "Toronto", 43.65, -79.38, "RT", "#123456", Date.now());
  return q.userById.get(id);
}
function fixture() {
  const viewer = user(), peer = user(), prefix = `target_${++sequence}`;
  const message = (label, at, { from = peer.id, to = viewer.id, removed = false, notify = true } = {}) => {
    const id = `${prefix}_${label}`;
    db.prepare("INSERT INTO dms(id,from_id,to_id,text,removed,created_at) VALUES(?,?,?,?,?,?)")
      .run(id, from, to, label, Number(removed), at);
    if (notify) db.prepare("INSERT INTO notifications(id,user_id,actor_id,type,post_id,text,created_at) VALUES(?,?,?,'dm',?,?,?)")
      .run(`notif_${id}`, to, from, id, label, at);
    return id;
  };
  const read = (body, path = paths[0], currentUser = viewer, otherId = peer.id) => routes[path]({ user: currentUser, params: { otherId }, body });
  const page = (query = {}) => routes["GET /api/dms/:otherId"]({ user: viewer, params: { otherId: peer.id }, query: { context: "0", ...query } });
  const inbox = (summary = true) => routes["GET /api/me/threads"]({ user: viewer, query: summary ? { summary: "1" } : {} })
    .threads.find(thread => thread.otherId === peer.id);
  const cursor = () => db.prepare("SELECT last_read_at,last_read_id FROM dm_reads WHERE user_id=? AND other_id=?").get(viewer.id, peer.id);
  const notification = id => db.prepare("SELECT read FROM notifications WHERE id=?").get(`notif_${id}`).read;
  return { viewer, peer, message, read, page, inbox, cursor, notification };
}

test("arrival between GET and targeted POST remains unread and its notification remains intact", () => {
  const f = fixture(), seen = f.message("a", 100);
  db.prepare("INSERT INTO follows(follower_id,followee_id) VALUES(?,?)").run(f.viewer.id, f.peer.id);
  const notificationPage = () => routes["GET /api/me/notifications"]({ user: f.viewer, query: {} });
  const fetched = f.page();
  assert.deepEqual(fetched.latestIncomingCursor, { createdAt: 100, id: seen });
  const later = f.message("b", 101);
  assert.equal(notificationPage().inboxUnread, 2);
  const receipt = f.read({ messageId: seen });
  assert.deepEqual(receipt.readCursor, { createdAt: 100, id: seen });
  assert.deepEqual(receipt.latestIncomingCursor, { createdAt: 101, id: later });
  assert.equal(receipt.unread, 1);
  assert.equal(receipt.hasReplied, false);
  assert.deepEqual(receipt.notificationIds, [`notif_${seen}`]);
  assert.equal(f.notification(seen), 1);
  assert.equal(f.notification(later), 0);
  assert.equal(f.inbox().unread, 1);
  assert.equal(notificationPage().inboxUnread, 1, "the global Inbox badge retains the unobserved arrival too");
  assert.equal(f.page({ after: fetched.syncCursor }).unread, 1);
});

test("old endpoint requires an explicit target too; neither route has a broad-read fallback", () => {
  for (const path of paths) {
    const f = fixture(), id = f.message("a", 100);
    for (const body of [undefined, null, {}, { messageId: null }, { messageId: 123 }, { messageId: [] }, { messageId: "" }, { messageId: "  " }, { messageId: "x".repeat(201) }, { readCursor: { createdAt: 100, id } }]) {
      assert.throws(() => f.read(body, path), error => error.status === 400 && error.code === "VALIDATION_FAILED");
      assert.equal(f.cursor(), undefined);
      assert.equal(f.notification(id), 0);
    }
    const result = f.read({ messageId: id }, path);
    assert.equal(result.ok, true);
    assert.equal(result.unread, 0);
  }
});

test("target ID cannot select an outgoing, foreign, removed, nonexistent or injected message", () => {
  for (const path of paths) {
    const f = fixture(), outsider = user(), own = f.message("own", 100);
    const outgoing = f.message("outgoing", 101, { from: f.viewer.id, to: f.peer.id });
    const otherSender = f.message("other_sender", 102, { from: outsider.id });
    const otherRecipient = f.message("other_recipient", 103, { to: outsider.id });
    const removed = f.message("removed", 104, { removed: true });
    const self = f.message("self", 105, { from: f.viewer.id });
    for (const messageId of [outgoing, otherSender, otherRecipient, removed, "nonexistent", `${own}' OR 1=1 --`]) {
      assert.throws(() => f.read({ messageId }, path), error => error.status === 404 && error.code === "NOT_FOUND");
      assert.equal(f.cursor(), undefined);
      assert.equal(f.notification(own), 0);
    }
    assert.equal(f.notification(otherSender), 0);
    assert.equal(f.notification(otherRecipient), 0);
    assert.throws(() => f.read({ messageId: self }, path, f.viewer, f.viewer.id), error => error.status === 404);
  }
});

test("client timestamp, cursor, account and sender fields cannot advance beyond the canonical target", () => {
  const f = fixture(), first = f.message("a", 100), later = f.message("b", 200);
  const receipt = f.read({ messageId: first, createdAt: Number.MAX_SAFE_INTEGER,
    readCursor: { createdAt: Number.MAX_SAFE_INTEGER, id: later },
    latestIncomingCursor: { createdAt: Number.MAX_SAFE_INTEGER, id: later },
    userId: f.peer.id, fromId: f.viewer.id, otherId: f.viewer.id });
  assert.deepEqual(receipt.readCursor, { createdAt: 100, id: first });
  assert.equal(receipt.unread, 1);
  assert.equal(f.notification(later), 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dm_reads WHERE user_id=?").get(f.peer.id).n, 0);
});

test("same-time ID ordering and stale receipts are monotonic without clearing subsequent arrivals", () => {
  const f = fixture(), a = f.message("a", 100), b = f.message("b", 100);
  const first = f.read({ messageId: b });
  assert.deepEqual(first.notificationIds.sort(), [`notif_${a}`, `notif_${b}`]);
  const c = f.message("c", 100);
  for (const messageId of [a, b, a]) {
    const stale = f.read({ messageId });
    assert.deepEqual(stale.readCursor, { createdAt: 100, id: b });
    assert.deepEqual(stale.latestIncomingCursor, { createdAt: 100, id: c });
    assert.equal(stale.unread, 1);
    assert.deepEqual(stale.notificationIds, []);
    assert.equal(f.notification(c), 0);
  }
  assert.equal(f.read({ messageId: c }).unread, 0);
});

test("blocks in either direction and absent sessions cannot save read receipts", () => {
  for (const reverse of [false, true]) for (const path of paths) {
    const f = fixture(), id = f.message("a", 100);
    assert.throws(() => f.read({ messageId: id }, path, null), error => error.status === 401);
    db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)")
      .run(reverse ? f.peer.id : f.viewer.id, reverse ? f.viewer.id : f.peer.id, 200);
    assert.throws(() => f.read({ messageId: id }, path), error => error.status === 403);
    assert.equal(f.cursor(), undefined);
    assert.equal(f.notification(id), 0);
    assert.throws(() => f.page(), error => error.status === 403);
  }
});

test("a target removed after fetch is refused without advancing the durable marker", () => {
  const f = fixture(), a = f.message("a", 100), b = f.message("b", 200);
  f.read({ messageId: a });
  f.page();
  db.prepare("UPDATE dms SET removed=1 WHERE id=?").run(b);
  assert.throws(() => f.read({ messageId: b }), error => error.status === 404);
  assert.equal(f.cursor().last_read_id, a);
  const summary = f.page();
  assert.equal(summary.unread, 0);
  assert.deepEqual(summary.latestIncomingCursor, { createdAt: 100, id: a });
});

test("authoritative counts and incoming boundaries survive summary previews and500-row history windows", () => {
  const f = fixture();
  db.exec("BEGIN");
  for (let i = 0; i < 800; i++) f.message(`inbound_${String(i).padStart(4, "0")}`, i + 1, { notify: false });
  f.message("outgoing", 900, { from: f.viewer.id, to: f.peer.id, notify: false });
  db.exec("COMMIT");
  const summaries = [f.inbox(), f.inbox(false), f.page(), f.page({ before: Buffer.from(JSON.stringify([500, "boundary"])).toString("base64url") })];
  assert.equal(summaries[0].messages.length, 1);
  assert.equal(summaries[0].messages[0].from, f.viewer.id);
  assert.equal(summaries[2].messages.length, 500);
  for (const summary of summaries) {
    assert.equal(summary.unread, 800);
    assert.equal(summary.readCursor, null);
    assert.equal(summary.latestIncomingCursor.createdAt, 800);
    assert.equal(summary.hasReplied, true);
  }
  assert.deepEqual(directMessageReadFor(db, f.viewer.id, f.peer.id), directMessageReadProjection(db, f.viewer.id).forOther(f.peer.id));
});

test("outbound-only conversations expose a null incoming boundary and cannot use an outgoing receipt", () => {
  const f = fixture(), outgoing = f.message("outgoing", 100, { from: f.viewer.id, to: f.peer.id });
  const summary = f.page();
  assert.equal(summary.unread, 0);
  assert.equal(summary.readCursor, null);
  assert.equal(summary.latestIncomingCursor, null);
  assert.equal(summary.hasReplied, true);
  assert.throws(() => f.read({ messageId: outgoing }), error => error.status === 404);
});

test("single-peer projection uses indexed pair/range lookups rather than an account-wide message scan", () => {
  const f = fixture(), a = f.message("a", 100);
  f.message("b", 200);
  f.read({ messageId: a });
  const statements = [];
  const instrumented = { prepare(sql) { statements.push(sql); return db.prepare(sql); } };
  const result = directMessageReadFor(instrumented, f.viewer.id, f.peer.id);
  assert.equal(result.unread, 1);
  assert.equal(statements.length, 1, "count, cursor and boundary use one SQLite snapshot");
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${statements[0]}`).all({ $viewer: f.viewer.id, $other: f.peer.id })
    .map(row => row.detail).join("\n");
  assert.doesNotMatch(plan, /\bSCAN (?:d|sent|dms)\b/u);
  assert.match(plan, /SEARCH d USING COVERING INDEX idx_dms_visible_cursor/u);
  assert.match(plan, /created_at>\?/u, "the read cursor bounds the unread index range");
});
