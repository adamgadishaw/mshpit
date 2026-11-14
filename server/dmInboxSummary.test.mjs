import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-dm-inbox-summary-"));
process.env.PIT_DATA_DIR = dataDir;
process.env.NODE_ENV = "test";
globalThis.fetch = async () => { throw new Error("Inbox fixtures forbid network access"); };
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { directMessageInboxRemovedIds, directMessageLatestPerPeer } = await import("./features/messaging/directMessageThreads.js");
const { directMessageReadProjection, directMessageInboxUnread } = await import("./dmReadRoutes.js");
const { directMessageConsentProjection } = await import("./features/messaging/directMessageConsent.js");
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

let sequence = 0;
function user(id = `inbox_user_${++sequence}`) {
  const handle = `inbox_handle_${++sequence}`;
  q.insertUser.run(id, `${handle}@example.invalid`, "Synthetic", handle, "test-hash", "fan", "", 0, 0, "AU", "#000000", 1);
  return q.userById.get(id);
}
function message(from, to, at, { id = `inbox_message_${++sequence}`, removed = 0 } = {}) {
  db.prepare("INSERT INTO dms(id,from_id,to_id,text,created_at,removed) VALUES(?,?,?,?,?,?)")
    .run(id, from.id, to.id, "Synthetic message", at, removed);
  return id;
}
function summary(viewer) {
  return routes["GET /api/me/threads"]({ user: viewer, query: { summary: "1" } });
}
function legacyLatest(viewer, limit = 200) {
  return db.prepare(`SELECT id,from_id,to_id,text,created_at,other_id FROM (
    SELECT id,from_id,to_id,text,created_at,
      CASE WHEN from_id=$viewer THEN to_id ELSE from_id END AS other_id,
      ROW_NUMBER() OVER (PARTITION BY CASE WHEN from_id=$viewer THEN to_id ELSE from_id END
        ORDER BY created_at DESC,id DESC) AS row_number
    FROM dms WHERE removed=0 AND (from_id=$viewer OR to_id=$viewer)
  ) WHERE row_number=1 ORDER BY created_at DESC,id DESC LIMIT $limit`)
    .all({ $viewer: viewer.id, $limit: limit });
}

test("latest seeks agree with complete-history ranking for arbitrary peer IDs and both directions", () => {
  const viewer = user();
  const peers = ["", "A", "a", " apostrophe' peer", "é/peer", "🎵"].map(id => user(id));
  let seed = 271828;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  db.exec("BEGIN");
  for (let i = 0; i < 1200; i++) {
    const peer = peers[i % peers.length];
    const outgoing = random() % 3 === 0;
    message(outgoing ? viewer : peer, outgoing ? peer : viewer, random() % 40, { removed: random() % 5 === 0 ? 1 : 0 });
  }
  db.exec("COMMIT");
  assert.deepEqual(directMessageLatestPerPeer(db, viewer.id), legacyLatest(viewer));
  for (const peer of peers) {
    const row = directMessageLatestPerPeer(db, viewer.id).find(row => row.other_id === peer.id);
    assert.ok(row, `peer ${JSON.stringify(peer.id)} is enumerated`);
    db.prepare("UPDATE dms SET removed=1 WHERE id=?").run(row.id);
    assert.deepEqual(directMessageLatestPerPeer(db, viewer.id), legacyLatest(viewer), "removal seeks back to the next visible row");
  }
  db.prepare("DELETE FROM dms WHERE from_id=? OR to_id=?").run(viewer.id, viewer.id);
  assert.deepEqual(directMessageLatestPerPeer(db, viewer.id), []);
});

test("timestamp ties use message IDs across directions and removed-only peers stay absent", () => {
  const viewer = user(), peer = user(), removedOnly = user(), receiptOnly = user();
  message(peer, viewer, 100, { id: "inbox_tie_a" });
  message(viewer, peer, 100, { id: "inbox_tie_z" });
  message(peer, viewer, 200, { removed: 1 });
  message(removedOnly, viewer, 500, { removed: 1 });
  db.prepare("INSERT INTO dm_reads VALUES(?,?,?,?)").run(viewer.id, receiptOnly.id, 10, "historical_marker");
  assert.deepEqual(directMessageLatestPerPeer(db, viewer.id).map(row => row.id), ["inbox_tie_z"]);
  assert.deepEqual(directMessageReadProjection(db, viewer.id).forOther(receiptOnly.id), {
    readCursor: { createdAt: 10, id: "historical_marker" }, unread: 0, latestIncomingCursor: null, hasReplied: false,
  });
  db.prepare("UPDATE dms SET removed=1 WHERE id='inbox_tie_z'").run();
  const thread = summary(viewer).threads[0];
  assert.equal(thread.messages[0].id, "inbox_tie_a");
  assert.equal(thread.hasReplied, false);
  assert.equal(thread.requestState, "accepted", "durable send consent survives removal");
  assert.equal(thread.unread, 1);
  assert.equal(directMessageConsentProjection(db, viewer.id).forOther(removedOnly.id).requestState, "none");
  db.prepare("DELETE FROM users WHERE id=?").run(peer.id);
  assert.deepEqual(summary(viewer).threads, []);
});

test("summary cap, blocks, directional consent and full unread totals retain their boundaries", () => {
  const viewer = user(), pending = user(), outgoingOnly = user(), hiddenForward = user(), hiddenReverse = user();
  const accepted = Array.from({ length: 205 }, () => user());
  db.exec("BEGIN");
  for (let i = 0; i < accepted.length; i++) {
    message(accepted[i], viewer, i + 1);
    db.prepare("INSERT INTO dm_acceptances VALUES(?,?,1,'explicit')").run(viewer.id, accepted[i].id);
  }
  message(pending, viewer, 1000);
  message(viewer, outgoingOnly, 1001);
  for (const peer of [hiddenForward, hiddenReverse]) {
    message(peer, viewer, 2000);
    db.prepare("INSERT INTO dm_acceptances VALUES(?,?,1,'explicit')").run(viewer.id, peer.id);
  }
  db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,1)").run(viewer.id, hiddenForward.id);
  db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,1)").run(hiddenReverse.id, viewer.id);
  db.exec("COMMIT");
  const result = summary(viewer);
  const blocked = new Set([hiddenForward.id, hiddenReverse.id]);
  assert.deepEqual(result.threads.map(thread => thread.messages[0].id),
    legacyLatest(viewer).filter(row => !blocked.has(row.other_id)).map(row => row.id));
  assert.equal(result.threads.find(thread => thread.otherId === pending.id).requestState, "pending");
  assert.equal(result.threads.find(thread => thread.otherId === outgoingOnly.id).requestState, "accepted");
  assert.equal(directMessageInboxUnread(db, viewer.id), 205, "counts every accepted peer beyond the preview cap, excluding requests and bilateral blocks");
  const full = routes["GET /api/me/threads"]({ user: viewer, query: {} });
  assert.equal(full.threads.length, 207, "all eligible conversations remain available through full hydration");
  assert.ok(full.threads.some(thread => thread.otherId === accepted[0].id));
});

test("older message pages remain complete and stable past the 500-message hydration window", () => {
  const viewer = user(), peer = user(), ids = [];
  db.exec("BEGIN");
  for (let i = 0; i < 1103; i++) {
    ids.push(message(i % 2 ? viewer : peer, i % 2 ? peer : viewer, Math.floor(i / 7),
      { id: `inbox_history_${String(i).padStart(5, "0")}` }));
  }
  db.exec("COMMIT");
  const removed = ids.splice(600, 1)[0];
  db.prepare("UPDATE dms SET removed=1 WHERE id=?").run(removed);
  assert.equal(summary(viewer).threads[0].messages[0].id, ids.at(-1));
  const found = [];
  let before;
  do {
    const page = routes["GET /api/dms/:otherId"]({ user: viewer, params: { otherId: peer.id }, query: { context: "0", limit: "137", ...(before ? { before } : {}) } });
    found.unshift(...page.messages.map(row => row.id));
    before = page.nextCursor;
  } while (before);
  assert.deepEqual(found, ids, "pagination returns all visible messages exactly once with tied timestamps");
});

test("inbox tombstones retain the global top 750 and thread pages retain all older removals", () => {
  const viewer = user(), first = user(), second = user();
  db.exec("BEGIN");
  for (let i = 0; i < 3500; i++) {
    const peer = i % 3 ? first : second;
    message(i % 2 ? viewer : peer, i % 2 ? peer : viewer, Math.floor(i / 5),
      { id: `inbox_removed_${String(i).padStart(5, "0")}`, removed: 1 });
  }
  // Legacy/self rows must not produce duplicate tombstones when both indexed
  // directions encounter the same message.
  message(viewer, viewer, 1000, { id: "inbox_removed_self", removed: 1 });
  db.exec("COMMIT");
  const expected = db.prepare(`SELECT id FROM dms WHERE removed=1 AND (from_id=? OR to_id=?)
    ORDER BY created_at DESC,id DESC LIMIT 750`).all(viewer.id, viewer.id).map(row => row.id);
  assert.equal(expected.length, 750);
  assert.deepEqual(directMessageInboxRemovedIds(db, viewer.id, 750), expected);
  assert.deepEqual(summary(viewer).removedIds, expected);
  const page = routes["GET /api/dms/:otherId"]({ user: viewer, params: { otherId: first.id }, query: { context: "0" } });
  const allForPeer = db.prepare(`SELECT id FROM dms WHERE removed=1
    AND ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?))
    ORDER BY created_at DESC,id DESC`).all(viewer.id, first.id, first.id, viewer.id).map(row => row.id);
  assert.ok(allForPeer.length > 750);
  assert.deepEqual(page.removedIds, allForPeer);
});

test("summary, removals, read, consent and unread plans seek peer keys and message pair ranges", () => {
  const viewer = user(), peer = user();
  message(peer, viewer, 100);
  message(viewer, peer, 200);
  const queries = [];
  const instrumented = { prepare(sql) { queries.push(sql); return db.prepare(sql); } };
  directMessageLatestPerPeer(instrumented, viewer.id);
  directMessageInboxRemovedIds(instrumented, viewer.id, 750);
  directMessageReadProjection(instrumented, viewer.id);
  directMessageConsentProjection(instrumented, viewer.id);
  directMessageInboxUnread(instrumented, viewer.id);
  const recursiveQueries = queries.filter(sql => sql.includes("WITH RECURSIVE"));
  assert.equal(recursiveQueries.length, 5);
  for (const sql of recursiveQueries) {
    const parameters = { $viewer: viewer.id, ...(sql.includes("$limit") ? { $limit: 200 } : {}) };
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(parameters).map(row => row.detail).join("\n");
    assert.doesNotMatch(plan, /\bSCAN (?:d|sent|dms)\b/u);
    assert.match(plan, /idx_dms_recipient_cursor \(to_id=\? AND from_id>\?\)/u);
    if (sql.includes("outgoing_peers")) assert.match(plan, /\(from_id=\? AND to_id>\?\)/u);
    assert.match(plan, /idx_dms_visible_cursor \(from_id=\? AND to_id=\? AND removed=\?/u);
  }
});
