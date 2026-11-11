import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-dm-history-removals-"));
process.env.PIT_DATA_DIR = dataDir;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

function addUser(id) {
  q.insertUser.run(id, `${id}@example.com`, id, id, "test-hash", "fan", "Toronto", 43.65, -79.38, "HT", "#123456", Date.now());
  return q.userById.get(id);
}
const me = addUser("history_me"), peer = addUser("history_peer"), outsider = addUser("history_outsider");
const insert = db.prepare("INSERT INTO dms(id,from_id,to_id,text,removed,created_at) VALUES (?,?,?,?,?,?)");
const get = (query = {}, user = me, otherId = peer.id) => routes["GET /api/dms/:otherId"]({ user, params: { otherId }, query: { context: "0", ...query } });

test("single-conversation sync reports an old fetched message behind more than750 newer tombstones", () => {
  insert.run("history_old", peer.id, me.id, "old private text", 0, 1);
  insert.run("history_live", peer.id, me.id, "recent", 0, 1000);
  const initial = get();
  assert.ok(initial.messages.some((row) => row.id === "history_old"));
  db.exec("BEGIN");
  for (let index = 0; index < 800; index++) insert.run(`history_removed_${index}`, peer.id, me.id, "removed", 1, 10 + index);
  insert.run("unrelated_removed", outsider.id, me.id, "other conversation", 1, 1100);
  db.prepare("UPDATE dms SET removed=1 WHERE id='history_old'").run();
  db.exec("COMMIT");
  const update = get({ after: initial.syncCursor });
  assert.equal(update.removedIds.length, 801);
  assert.ok(update.removedIds.includes("history_old"));
  assert.ok(!update.removedIds.includes("unrelated_removed"));
  assert.deepEqual(update.messages, [], "the removal arrives without needing a new message");
  assert.deepEqual(get().messages.map((row) => row.id), ["history_live"]);
  assert.equal(routes["GET /api/me/threads"]({ user: me, query: { summary: "1" } }).removedIds.length, 750,
    "the account-wide inbox still has its existing bounded tombstone response");
  assert.deepEqual(get({}, outsider).removedIds, [], "an outsider cannot retrieve this pair's tombstones");
});

test("older-page responses share complete pair-scoped removals and a block refuses all history", () => {
  const head = get({ limit: "1" });
  const cursor = Buffer.from(JSON.stringify([2000, "last"])).toString("base64url");
  const earlier = get({ before: cursor, limit: "1" });
  assert.ok(earlier.removedIds.includes("history_old"));
  assert.equal(earlier.removedIds.length, head.removedIds.length);
  db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(peer.id, me.id, Date.now());
  assert.throws(() => get(), { status: 403 });
  assert.throws(() => get({ before: cursor }), { status: 403 });
});
