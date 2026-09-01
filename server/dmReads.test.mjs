import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-dm-reads-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id) {
  q.insertUser.run(
    id,
    `${id}@example.com`,
    id,
    id.replace(/[^a-z0-9_]/g, "").slice(0, 20),
    "test-hash",
    "fan",
    "Toronto",
    43.65,
    -79.38,
    id.slice(0, 2).toUpperCase(),
    "#123456",
    Date.now(),
  );
  return q.userById.get(id);
}

const sender = addUser("read_sender");
const recipient = addUser("read_recipient");

const insertDm = db.prepare("INSERT INTO dms (id,from_id,to_id,text,created_at) VALUES (?,?,?,?,?)");
const insertNotification = db.prepare(
  "INSERT INTO notifications (id,user_id,actor_id,type,post_id,text,created_at) VALUES (?,?,?,?,?,?,?)",
);

test("direct-message reads have cursor indexes in both directions", () => {
  const indexes = new Set(db.prepare("PRAGMA index_list(dms)").all().map((row) => row.name));
  assert.ok(indexes.has("idx_dms_cursor"), "sent-message cursor index should exist");
  assert.ok(indexes.has("idx_dms_recipient_cursor"), "received-message cursor index should exist");
  assert.deepEqual(
    db.prepare("PRAGMA index_info(idx_dms_recipient_cursor)").all().map((row) => row.name),
    ["to_id", "from_id", "created_at", "id"],
  );
});

test("opening a DM thread durably clears only messages through its read cursor", () => {
  insertDm.run("dm_read_a", sender.id, recipient.id, "first", 100);
  insertDm.run("dm_read_b", sender.id, recipient.id, "second", 100);
  insertDm.run("dm_outgoing", recipient.id, sender.id, "reply", 101);
  insertNotification.run("notif_read_a", recipient.id, sender.id, "dm", "dm_read_a", "first", 100);
  insertNotification.run("notif_read_b", recipient.id, sender.id, "dm", "dm_read_b", "second", 100);

  const before = routes["GET /api/me/threads"]({ user: recipient, query: { summary: "1" } }).threads[0];
  assert.equal(before.unread, 2);
  assert.equal(before.readCursor, null);

  const marked = routes["POST /api/dms/:otherId/read"]({
    user: recipient,
    params: { otherId: sender.id },
  });
  assert.equal(marked.ok, true);
  assert.deepEqual(marked.readCursor, { createdAt: 100, id: "dm_read_b" });
  assert.deepEqual(marked.notificationIds.sort(), ["notif_read_a", "notif_read_b"]);

  const afterReload = routes["GET /api/me/threads"]({ user: recipient, query: { summary: "1" } }).threads[0];
  assert.equal(afterReload.unread, 0, "server hydration must not resurrect opened messages");
  assert.deepEqual(afterReload.readCursor, marked.readCursor);
  assert.equal(routes["GET /api/me/notifications"]({ user: recipient }).unread, 0);

  insertDm.run("dm_read_c", sender.id, recipient.id, "new arrival", 100);
  insertNotification.run("notif_read_c", recipient.id, sender.id, "dm", "dm_read_c", "new arrival", 102);
  const withNewMessage = routes["GET /api/me/threads"]({ user: recipient, query: { summary: "1" } }).threads[0];
  assert.equal(withNewMessage.unread, 1, "a later same-millisecond id must still notify");
  assert.equal(routes["GET /api/me/notifications"]({ user: recipient }).unread, 1);

  const markedAgain = routes["POST /api/dms/:otherId/read"]({
    user: recipient,
    params: { otherId: sender.id },
  });
  assert.deepEqual(markedAgain.readCursor, { createdAt: 100, id: "dm_read_c" });
  assert.deepEqual(markedAgain.notificationIds, ["notif_read_c"]);
});

test("reading one conversation never marks another sender's messages", () => {
  const other = addUser("read_other");
  insertDm.run("dm_other_a", other.id, recipient.id, "separate thread", 200);
  insertNotification.run("notif_other_a", recipient.id, other.id, "dm", "dm_other_a", "separate thread", 200);

  routes["POST /api/dms/:otherId/read"]({ user: recipient, params: { otherId: sender.id } });
  const thread = routes["GET /api/me/threads"]({ user: recipient, query: { summary: "1" } })
    .threads.find((item) => item.otherId === other.id);
  assert.equal(thread.unread, 1);
  assert.equal(db.prepare("SELECT read FROM notifications WHERE id=?").get("notif_other_a").read, 0);
});
