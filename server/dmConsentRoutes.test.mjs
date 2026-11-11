import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-dm-consent-"));
process.env.PIT_DATA_DIR = dataDir;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { hashPasswordAsync } = await import("./auth.js");
const { isSuccessfulInteractiveMutation } = await import("./features/accountLifecycle/interactiveActivity.js");
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

function user(id, age = "18_plus") {
  q.insertUser.run(id, `${id}@example.com`, id, id, "test-hash", "fan", "Toronto", 43.65, -79.38, "DM", "#123456", Date.now());
  db.prepare("UPDATE users SET age_band=? WHERE id=?").run(age, id);
  return q.userById.get(id);
}
const insert = db.prepare("INSERT INTO dms(id,from_id,to_id,text,created_at) VALUES(?,?,?,?,?)");
const context = (viewer, other, body = {}) => ({ user: q.userById.get(viewer.id), params: { otherId: other.id }, body, ip: viewer.id });
const accept = (viewer, other) => routes["POST /api/dms/:otherId/accept"](context(viewer, other));
const get = (viewer, other, query = {}) => routes["GET /api/dms/:otherId"]({ ...context(viewer, other), query });
const summary = (viewer, other, brief = true) => routes["GET /api/me/threads"]({ user: viewer, query: brief ? { summary: "1" } : {} }).threads.find(thread => thread.otherId === other.id);

test("accept is directional, idempotent, and independent of content, follows and read state", () => {
  const sender = user("consent_sender"); const recipient = user("consent_recipient");
  insert.run("consent_inbound", sender.id, recipient.id, "a request", 100);
  assert.equal(summary(recipient, sender).requestState, "pending");
  assert.equal(summary(sender, recipient).requestState, "accepted");
  const original = db.prepare("SELECT * FROM dms WHERE id='consent_inbound'").get();
  const beforeNotif = db.prepare("SELECT COUNT(*) n FROM notifications").get().n;
  assert.deepEqual(accept(recipient, sender), { ok: true, requestState: "accepted" });
  const saved = db.prepare("SELECT * FROM dm_acceptances WHERE user_id=? AND other_id=?").get(recipient.id, sender.id);
  assert.deepEqual(accept(recipient, sender), { ok: true, requestState: "accepted" });
  assert.deepEqual(db.prepare("SELECT * FROM dm_acceptances WHERE user_id=? AND other_id=?").get(recipient.id, sender.id), saved);
  assert.equal(summary(recipient, sender).requestState, "accepted");
  assert.equal(summary(recipient, sender, false).requestState, "accepted");
  const page = get(recipient, sender);
  assert.equal(page.requestState, "accepted");
  assert.equal(get(recipient, sender, { after: page.syncCursor }).requestState, "accepted");
  assert.deepEqual(db.prepare("SELECT * FROM dms WHERE id='consent_inbound'").get(), original);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM follows WHERE follower_id=? AND followee_id=?").get(recipient.id, sender.id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM dm_reads WHERE user_id=?").get(recipient.id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications").get().n, beforeNotif);
});

test("latest-only hydration keeps historical sent consent beyond the cache window", () => {
  const a = user("history_a"); const b = user("history_b");
  insert.run("history_reply", a.id, b.id, "old reply", 1);
  db.exec("BEGIN");
  for (let i = 0; i < 800; i++) insert.run(`history_${i}`, b.id, a.id, "later", i + 2);
  db.exec("COMMIT");
  const inbox = summary(a, b);
  assert.equal(inbox.messages.length, 1);
  assert.equal(inbox.messages[0].from, b.id);
  assert.equal(inbox.requestState, "accepted");
  assert.equal(get(a, b).requestState, "accepted");
});

test("unrelated, self and removed-only requests cannot be accepted", () => {
  const a = user("scope_a"); const b = user("scope_b"); const c = user("scope_c");
  insert.run("scope_message", a.id, b.id, "private", 1);
  assert.throws(() => accept(c, a), error => error.status === 404);
  assert.throws(() => accept(a, a), error => error.status === 400);
  assert.throws(() => routes["POST /api/dms/:otherId/accept"]({ params: { otherId: a.id }, ip: "guest" }), error => error.status === 401);
  db.prepare("UPDATE dms SET removed=1 WHERE id='scope_message'").run();
  assert.throws(() => accept(b, a), error => error.status === 404);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM dm_acceptances WHERE user_id=? AND other_id=?").get(b.id, a.id).n, 0);
});

test("acceptance cannot bypass a block in either direction", () => {
  for (const reverse of [false, true]) {
    const a = user(`block_a_${reverse}`); const b = user(`block_b_${reverse}`);
    insert.run(`blocked_${reverse}`, a.id, b.id, "request", 1);
    db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)").run(reverse ? a.id : b.id, reverse ? b.id : a.id, 2);
    assert.throws(() => accept(b, a), error => error.status === 403);
    assert.throws(() => get(b, a), error => error.status === 403);
    assert.equal(summary(b, a), undefined);
  }
});

test("age rules still apply and acceptance does not create permission for new contact", () => {
  const adult = user("age_adult"); const teen = user("age_teen", "13_17"); const unknown = user("age_unknown", "unknown");
  insert.run("age_request", adult.id, teen.id, "legacy", 1);
  insert.run("unknown_request", adult.id, unknown.id, "legacy", 1);
  assert.throws(() => accept(teen, adult), error => error.code === "CONTACT_NOT_ALLOWED");
  assert.throws(() => accept(unknown, adult), error => error.code === "CONTACT_NOT_ALLOWED");
  db.prepare("INSERT INTO follows(follower_id,followee_id) VALUES(?,?),(?,?)").run(teen.id, adult.id, adult.id, teen.id);
  assert.equal(accept(teen, adult).ok, true);
  db.prepare("DELETE FROM follows WHERE follower_id=?").run(teen.id);
  assert.throws(() => routes["POST /api/dms/:otherId"](context(teen, adult, { text: "not allowed" })), error => error.code === "CONTACT_NOT_ALLOWED");
  const stranger = user("age_stranger");
  db.prepare("INSERT INTO dm_acceptances VALUES(?,?,?,'explicit')").run(stranger.id, adult.id, 1);
  assert.throws(() => routes["POST /api/dms/:otherId"](context(stranger, adult, { text: "still not allowed" })), error => error.code === "CONTACT_NOT_ALLOWED");
});

test("existing adult conversations remain writable when first contact closes", () => {
  const a = user("adult_a"); const b = user("adult_b");
  insert.run("adult_existing", a.id, b.id, "old conversation", 1);
  db.prepare("UPDATE users SET dm_policy='nobody' WHERE id IN (?,?)").run(a.id, b.id);
  assert.equal(accept(b, a).ok, true);
  const sent = routes["POST /api/dms/:otherId"](context(b, a, { text: "existing reply", clientMutationId: "consent-existing-reply" }));
  assert.ok(sent.id);
  assert.equal(summary(b, a).requestState, "accepted");
});

test("acceptance belongs to the owner's export and cascades on account deletion", async () => {
  const a = user("export_a"); const b = user("export_b");
  insert.run("export_request", a.id, b.id, "request", 1);
  accept(b, a);
  const password = "synthetic-export-passphrase";
  db.prepare("UPDATE users SET pass_hash=? WHERE id=?").run(await hashPasswordAsync(password), b.id);
  const exported = await routes["POST /api/me/export"]({ user: q.userById.get(b.id), body: { password }, ip: b.id });
  assert.equal(exported.messageAcceptances.length, 1);
  assert.deepEqual(exported.messageAcceptances[0].other, { id: a.id });
  assert.equal(exported.messageAcceptances[0].source, "explicit");
  assert.equal(isSuccessfulInteractiveMutation({ method: "POST", routePattern: "/api/dms/:otherId/accept", user: b, result: { ok: true } }), true);
  let clearedSession = false;
  assert.deepEqual(await routes["DELETE /api/me"]({ user: q.userById.get(b.id), body: { password }, ip: b.id,
    clearSession: () => { clearedSession = true; } }), { ok: true });
  assert.equal(clearedSession, true);
  assert.equal(q.userById.get(b.id), undefined);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM dm_acceptances WHERE user_id=? OR other_id=?").get(b.id, b.id).n, 0);
});

const inboxUnread = viewer => routes["GET /api/me/notifications"]({ user: q.userById.get(viewer.id), query: {} }).inboxUnread;

test("explicit acceptance contributes unread messages without a reply or follow and preserves the read cursor", () => {
  const sender = user("badge_explicit_sender"), recipient = user("badge_explicit_recipient");
  insert.run("badge_explicit_a", sender.id, recipient.id, "read earlier", 10);
  insert.run("badge_explicit_b", sender.id, recipient.id, "same timestamp, later id", 10);
  insert.run("badge_explicit_c", sender.id, recipient.id, "newer", 11);
  insert.run("badge_explicit_removed", sender.id, recipient.id, "removed", 12);
  db.prepare("UPDATE dms SET removed=1 WHERE id='badge_explicit_removed'").run();
  db.prepare("INSERT INTO dm_reads VALUES (?,?,?,?)").run(recipient.id, sender.id, 10, "badge_explicit_a");
  assert.equal(inboxUnread(recipient), 0, "pending requests stay outside Main's badge");
  assert.equal(accept(recipient, sender).ok, true);
  assert.equal(summary(recipient, sender).requestState, "accepted");
  assert.equal(inboxUnread(recipient), 2, "durable consent counts only unremoved messages after the exact read cursor");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM dms WHERE from_id=? AND to_id=?").get(recipient.id, sender.id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM follows WHERE follower_id=? AND followee_id=?").get(recipient.id, sender.id).n, 0);
  assert.equal(inboxUnread(sender), 0, "recipient acceptance does not invent incoming messages for the sender");
});

test("durable sent acceptance survives removal of the final reply but never bypasses either block direction", () => {
  for (const reverse of [false, true]) {
    const owner = user('badge_removed_owner_' + reverse), peer = user('badge_removed_peer_' + reverse);
    const sent = 'badge_removed_sent_' + reverse, received = 'badge_removed_received_' + reverse;
    insert.run(sent, owner.id, peer.id, "a previous reply", 1);
    insert.run(received, peer.id, owner.id, "still unread", 2);
    assert.equal(inboxUnread(owner), 1);
    db.prepare("UPDATE dms SET removed=1 WHERE id=?").run(sent);
    assert.equal(summary(owner, peer).hasReplied, false, "retained reply evidence stays truthful");
    assert.equal(summary(owner, peer).requestState, "accepted", "the user's earlier consent remains durable");
    assert.equal(inboxUnread(owner), 1, "deleting message content cannot undo accepted Inbox unread");
    db.prepare("INSERT INTO blocks VALUES(?,?,?)").run(reverse ? peer.id : owner.id, reverse ? owner.id : peer.id, 3);
    assert.equal(summary(owner, peer), undefined);
    assert.equal(inboxUnread(owner), 0, "durable acceptance cannot expose blocked activity");
  }
});
