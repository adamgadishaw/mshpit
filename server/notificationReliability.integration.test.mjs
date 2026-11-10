import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pit-notification-reliability-"));
process.env.PIT_DATA_DIR = directory;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
let sequence = 0;
function account() {
  const id = `notification_account_${++sequence}`;
  q.insertUser.run(id, `${id}@example.test`, id, id, "unused-test-hash", "fan", "Toronto", 43, -79, "QA", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
function notification(owner, actor = null, timestamp = 1000, type = "follow") {
  const id = `notification_${String(++sequence).padStart(6, "0")}`;
  db.prepare("INSERT INTO notifications(id,user_id,actor_id,type,created_at) VALUES(?,?,?,?,?)")
    .run(id, owner.id, actor?.id ?? null, type, timestamp);
  return id;
}
const page = (owner, query = {}) => routes["GET /api/me/notifications"]({ user: owner, query });
const acknowledge = (owner, body) => routes["POST /api/me/notifications/read/scoped"]({ user: owner, body });
const isRead = (id) => db.prepare("SELECT read FROM notifications WHERE id=?").get(id).read;

test("100-row pages and scoped acknowledgement leave older and simultaneously arriving rows unread", () => {
  const owner = account();
  const ids = Array.from({ length: 125 }, () => notification(owner));
  const first = page(owner);
  assert.equal(first.readContract, "notification-ids-v1");
  assert.equal(first.notifications.length, 100);
  assert.equal(first.unread, 125);
  assert.ok(first.nextCursor);
  const arriving = notification(owner, null, 2000);
  const captured = first.notifications.map((n) => n.id);
  const result = acknowledge(owner, { notificationIds: captured });
  assert.deepEqual(result.notificationIds, captured);
  assert.equal(result.unread, 26);
  assert.equal(isRead(arriving), 0);
  assert.equal(ids.filter((id) => !isRead(id)).length, 25);
  const second = page(owner, { before: first.nextCursor });
  assert.equal(second.notifications.length, 25);
  assert.equal(second.nextCursor, null);
  assert.equal(second.unread, 26);
  assert.ok(second.notifications.every((n) => !n.read && !captured.includes(n.id)));
  assert.deepEqual(acknowledge(owner, { notificationIds: captured }), result);
});

test("visibility filtering happens before pagination and agrees with count and acknowledgement", () => {
  const owner = account(), blocked = account(), blocking = account(), muted = account(), visible = account();
  db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)").run(owner.id, blocked.id, 1);
  db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)").run(blocking.id, owner.id, 1);
  db.prepare("INSERT INTO account_mutes(muter_id,muted_id,created_at) VALUES(?,?,?)").run(owner.id, muted.id, 1);
  const hidden = Array.from({ length: 110 }, (_, i) => notification(owner, [blocked, blocking, muted][i % 3], 2000));
  const visibleIds = Array.from({ length: 4 }, () => notification(owner, visible));
  const withdrawn = notification(owner, visible, 3000, "repost");
  const first = page(owner, { limit: 2 });
  assert.equal(first.notifications.length, 2);
  assert.equal(first.unread, 4);
  const second = page(owner, { limit: 2, before: first.nextCursor });
  assert.equal(second.notifications.length, 2);
  assert.equal(second.nextCursor, null);
  assert.deepEqual([...first.notifications, ...second.notifications].map((n) => n.id), visibleIds.toReversed());
  const result = acknowledge(owner, { notificationIds: [hidden[0], withdrawn, visibleIds[2], hidden[1], visibleIds[0], visibleIds[2]] });
  assert.deepEqual(result.notificationIds, [visibleIds[2], visibleIds[0]]);
  assert.equal(result.unread, 2);
  assert.ok([...hidden, withdrawn].every((id) => !isRead(id)));
});

test("a block added after fetching excludes that ID from the server confirmation", () => {
  const owner = account(), actor = account();
  const id = notification(owner, actor);
  assert.equal(page(owner).notifications.length, 1);
  db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)").run(actor.id, owner.id, 1);
  assert.deepEqual(acknowledge(owner, { notificationIds: [id] }).notificationIds, []);
  assert.equal(isRead(id), 0);
});

test("acknowledgements are account-scoped, deduplicated and ordered, with harmless legacy requests", () => {
  const owner = account(), other = account();
  const first = notification(owner), second = notification(owner), foreign = notification(other);
  for (const body of [undefined, null, {}, { oldClient: true }, { notificationIds: [] }]) {
    const result = acknowledge(owner, body);
    assert.deepEqual(result.notificationIds, []);
    assert.equal(result.unread, 2);
    assert.equal(result.ok, true);
  }
  const result = acknowledge(owner, { notificationIds: [second, foreign, "missing", first, second] });
  assert.deepEqual(result.notificationIds, [second, first]);
  assert.equal(result.unread, 0);
  assert.equal(isRead(foreign), 0);
  assert.equal(page(other).unread, 1);
});

test("invalid and oversized input is rejected atomically, including mixed valid and malformed IDs", () => {
  const owner = account(), id = notification(owner);
  for (const body of [[], "bad", 1, { notificationIds: null }, { notificationIds: id },
    { notificationIds: [id, null] }, { notificationIds: [id, ""] }, { notificationIds: [id, " spaced "] },
    { notificationIds: [id, "x".repeat(101)] }, { notificationIds: Array(101).fill(id) }]) {
    assert.throws(() => acknowledge(owner, body), (error) => error.status === 400 && error.code === "VALIDATION_FAILED");
    assert.equal(isRead(id), 0);
  }
});

test("guests cannot read or acknowledge notification state", () => {
  assert.throws(() => page(null), (error) => error.status === 401);
  assert.throws(() => acknowledge(null, { notificationIds: [] }), (error) => error.status === 401);
});


test("legacy endpoint is a safe no-op without IDs and remains scoped with explicit IDs", () => {
  const owner = account(), first = notification(owner), second = notification(owner);
  const legacy = (body) => routes["POST /api/me/notifications/read"]({ user: owner, body });
  for (const body of [undefined, null, {}]) {
    assert.deepEqual(legacy(body).notificationIds, []);
    assert.equal(isRead(first), 0);
    assert.equal(isRead(second), 0);
  }
  assert.deepEqual(legacy({ notificationIds: [first] }).notificationIds, [first]);
  assert.equal(isRead(first), 1);
  assert.equal(isRead(second), 0);
});


test("three new cross-account likes reach Activity unread without any read mutation", () => {
  const owner = account(), founder = account();
  assert.equal(page(owner).unread, 0);
  const ids = Array.from({ length: 3 }, (_, i) => `liked_post_${++sequence}_${i}`);
  for (const id of ids) {
    db.prepare("INSERT INTO posts(id,user_id,artist,venue,overall,created_at) VALUES(?,?,?,?,?,?)").run(id, owner.id, "Test artist", "Test venue", 4, 100);
    const ctx = { user: founder, ip: "notification-like-test", params: { id }, body: { liked: true } };
    assert.equal(routes["POST /api/posts/:id/like"](ctx).liked, true);
    assert.equal(routes["POST /api/posts/:id/like"](ctx).liked, true);
  }
  const result = page(owner);
  assert.equal(result.unread, 3); assert.equal(result.notifications.length, 3);
  assert.deepEqual(new Set(result.notifications.map(row => row.postId)), new Set(ids));
  assert.ok(result.notifications.every(row => row.type === "like" && row.actorId === founder.id && !row.read));
  assert.equal(page(owner).unread, 3); assert.equal(page(founder).unread, 0);
});

test("accepted Inbox total uses all unread messages, independent of latest preview and thread cap", () => {
  const owner = account(), followed = account(), replied = account(), request = account(), blocked = account();
  const send = (from, to, at, removed = 0) => {
    const id = `dm_count_${String(++sequence).padStart(6, "0")}`;
    db.prepare("INSERT INTO dms(id,from_id,to_id,text,created_at,removed) VALUES(?,?,?,?,?,?)").run(id, from.id, to.id, "synthetic test message", at, removed);
    return id;
  };
  for (const actor of [followed, blocked]) db.prepare("INSERT INTO follows(follower_id,followee_id) VALUES(?,?)").run(owner.id, actor.id);
  for (let i = 0; i < 123; i++) send(followed, owner, 100 + i);
  send(owner, replied, 1); send(replied, owner, 2); send(request, owner, 3); send(blocked, owner, 4);
  send(followed, owner, 400, 1);
  db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)").run(blocked.id, owner.id, 1);
  assert.equal(page(owner).inboxUnread, 124);
  const first = db.prepare("SELECT id,created_at FROM dms WHERE from_id=? AND to_id=? ORDER BY created_at LIMIT 1").get(followed.id, owner.id);
  db.prepare("INSERT INTO dm_reads(user_id,other_id,last_read_at,last_read_id) VALUES(?,?,?,?)").run(owner.id, followed.id, first.created_at, first.id);
  assert.equal(page(owner).inboxUnread, 123);
  // More than 200 accepted peers: the badge is not the capped inbox preview.
  for (let i = 0; i < 205; i++) {
    const peer = account(); db.prepare("INSERT INTO follows(follower_id,followee_id) VALUES(?,?)").run(owner.id, peer.id);
    send(peer, owner, 1000 + i);
  }
  assert.equal(page(owner).inboxUnread, 328);
  assert.equal(page(request).inboxUnread, 0);
});


test("reply proof agrees with Inbox totals outside the summary and full-history windows", () => {
  const owner = account(), replied = account(), request = account(), removedReply = account(), another = account();
  const insert = db.prepare("INSERT INTO dms(id,from_id,to_id,text,created_at,removed) VALUES(?,?,?,?,?,?)");
  const send = (from, to, at, removed = 0) => {
    const id = `dm_reply_proof_${++sequence}`;
    insert.run(id, from.id, to.id, "synthetic message", at, removed);
    return id;
  };
  const oldReply = send(owner, replied, 1);
  for (let i = 0; i < 505; i++) send(replied, owner, 100 + i);
  send(request, owner, 1000);
  send(owner, removedReply, 1, 1); send(removedReply, owner, 1001);
  send(another, request, 2); // Another account's reply cannot accept this owner's request.
  for (const query of [{ summary: "1" }, {}]) {
    const threads = routes["GET /api/me/threads"]({ user: owner, query }).threads;
    const accepted = threads.find(t => t.otherId === replied.id);
    assert.equal(accepted.hasReplied, true);
    assert.equal(accepted.readCursor, null);
    assert.ok(accepted.messages.every(m => m.from === replied.id), "proof survives outside both message windows");
    assert.equal(threads.find(t => t.otherId === request.id).hasReplied, false);
    assert.equal(threads.find(t => t.otherId === removedReply.id).hasReplied, false);
  }
  assert.equal(page(owner).inboxUnread, 505);
  db.prepare("UPDATE dms SET removed=1 WHERE id=?").run(oldReply);
  const refreshed = routes["GET /api/me/threads"]({ user: owner, query: { summary: "1" } }).threads;
  assert.equal(refreshed.find(t => t.otherId === replied.id).hasReplied, false);
  assert.equal(page(owner).inboxUnread, 0);
  db.prepare("UPDATE dms SET removed=0 WHERE id=?").run(oldReply);
  assert.equal(routes["GET /api/me/threads"]({ user: owner, query: { summary: "1" } }).threads.find(t => t.otherId === replied.id).hasReplied, true);
  const secondReply = send(owner, replied, 3);
  db.prepare("UPDATE dms SET removed=1 WHERE id=?").run(oldReply);
  assert.equal(routes["GET /api/me/threads"]({ user: owner, query: { summary: "1" } }).threads.find(t => t.otherId === replied.id).hasReplied, true, "a remaining retained reply still accepts the peer");
  db.prepare("UPDATE dms SET removed=1 WHERE id=?").run(secondReply);
  assert.equal(routes["GET /api/me/threads"]({ user: owner, query: { summary: "1" } }).threads.find(t => t.otherId === replied.id).hasReplied, false);
  db.prepare("INSERT INTO follows(follower_id,followee_id) VALUES(?,?)").run(owner.id, request.id);
  assert.equal(page(owner).inboxUnread, 1, "following accepts a peer without inventing reply evidence");
  db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)").run(request.id, owner.id, 1);
  assert.equal(page(owner).inboxUnread, 0);
  assert.ok(!routes["GET /api/me/threads"]({ user: owner, query: { summary: "1" } }).threads.some(t => t.otherId === request.id));
});
