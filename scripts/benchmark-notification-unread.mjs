// Disposable synthetic fixture only: no database-path or remote-target option.
// Run: node scripts/benchmark-notification-unread.mjs [output.json]
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const directory = mkdtempSync(join(tmpdir(), "pit-notification-benchmark-"));
process.env.NODE_ENV = "test";
process.env.PIT_DATA_DIR = directory;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "false";
for (const key of Object.keys(process.env)) {
  if (/KEY|TOKEN|PASSWORD|SECRET|MAIL_FROM|ADMIN_EMAIL|RENDER|R2_|S3_|AWS_/i.test(key)) delete process.env[key];
}
globalThis.fetch = async () => { throw new Error("Synthetic benchmark forbids network"); };
const { db, q } = await import("../server/db.js");
const { notificationRoutes } = await import("../server/features/notifications/notificationRoutes.js");
let unreadSql;
const database = {
  get isTransaction() { return db.isTransaction; },
  exec: (sql) => db.exec(sql),
  prepare(sql) {
    if (sql.includes("SELECT COUNT(*) c FROM notifications")) unreadSql = sql;
    return db.prepare(sql);
  },
};
const viewer = "synthetic_notification_viewer";
q.insertUser.run(viewer, `${viewer}@example.invalid`, viewer, viewer, "synthetic-noncredential", "fan", "Synthetic", 0, 0, "QA", "#000000", 1);
const owner = q.userById.get(viewer);
const routes = notificationRoutes({ database, requireUser: () => owner, ApiError: Error,
  pageRequest: () => ({ cursor: null, limit: 100 }),
  finishPage: (rows, limit) => ({ rows: rows.slice(0, limit), nextCursor: rows.length > limit ? "synthetic" : null }),
  safePublicProfileImage: () => null });
const acknowledge = (ids = []) => routes["POST /api/me/notifications/read/scoped"]({ body: { notificationIds: ids } });
const historyPage = () => routes["GET /api/me/notifications"]({});
const indexSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_notifs_unread_user'").get().sql;
const insert = db.prepare("INSERT INTO notifications(id,user_id,type,text,created_at,read) VALUES(?,?,'system','Synthetic fixture',?,?)");
const update = db.prepare("UPDATE notifications SET read=1 WHERE id=? AND user_id=?");
function measure(action, repetitions = 15) {
  for (let i = 0; i < 3; i++) action();
  const times = [];
  for (let i = 0; i < repetitions; i++) {
    const started = performance.now(); action(); times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  return { repetitions, medianMs: times[Math.floor(times.length / 2)], maxMs: times.at(-1) };
}
function rolledBack(action) {
  db.exec("BEGIN IMMEDIATE");
  try { action(); } finally { db.exec("ROLLBACK"); }
}
function sample() {
  assert.equal(acknowledge().unread, 100);
  const statement = db.prepare(unreadSql);
  const ids = Array.from({ length: 100 }, (_, i) => `synthetic_n_${String(i).padStart(7, "0")}`);
  return {
    unreadCount: measure(() => assert.equal(statement.get({ $viewer: viewer }).c, 100)),
    historyPage: measure(() => assert.equal(historyPage().unread, 100)),
    // Rolled-back writes measure SQLite statement/index work with no repeated
    // fixture growth. They are not durable fsync/production throughput timings.
    insert1000UnreadRollback: measure(() => rolledBack(() => {
      for (let i = 0; i < 1000; i++) insert.run(`synthetic_write_${i}`, viewer, 200000 + i, 0);
    }), 7),
    mark100ReadRollback: measure(() => rolledBack(() => {
      for (const id of ids) update.run(id, viewer);
    }), 7),
    scoped100AckRollback: measure(() => rolledBack(() => {
      const result = acknowledge(ids);
      assert.equal(result.unread, 0); assert.equal(result.notificationIds.length, 100);
    }), 7),
    plan: db.prepare(`EXPLAIN QUERY PLAN ${unreadSql}`).all({ $viewer: viewer }).map((row) => row.detail),
  };
}
try {
  const results = [];
  let inserted = 0;
  for (const rows of [1000, 10000, 100000]) {
    db.exec("BEGIN IMMEDIATE");
    for (let i = inserted; i < rows; i++) insert.run(`synthetic_n_${String(i).padStart(7, "0")}`, viewer, i, i < 100 ? 0 : 1);
    db.exec("COMMIT"); inserted = rows;
    db.exec("DROP INDEX idx_notifs_unread_user");
    const before = sample();
    const buildStart = performance.now(); db.exec(indexSql);
    const indexBuildMs = performance.now() - buildStart;
    const after = sample();
    results.push({ rows, unreadRows: 100, before, after, indexBuildMs });
  }
  const result = {
    kind: "Local synthetic SQLite fixture; not production measurements, SLOs, or a capacity guarantee",
    node: process.version, sqlite: db.prepare("SELECT sqlite_version() AS v").get().v,
    method: "3 warmups; count/page 15 samples; rolled-back write batches 7 samples; baseline is the same fixture with only the new index dropped",
    index: indexSql, results,
    integrity: db.prepare("PRAGMA integrity_check").get().integrity_check,
    foreignKeyViolations: db.prepare("PRAGMA foreign_key_check").all().length,
  };
  assert.equal(result.integrity, "ok"); assert.equal(result.foreignKeyViolations, 0);
  const json = JSON.stringify(result, null, 2) + "\n";
  if (process.argv[2]) writeFileSync(process.argv[2], json);
  console.log(json);
} finally {
  db.close(); rmSync(directory, { recursive: true, force: true });
}
