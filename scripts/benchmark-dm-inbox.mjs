#!/usr/bin/env node
// Disposable, local-only DB13 benchmark. No database path or server URL input.
// node scripts/benchmark-dm-inbox.mjs --output docs/performance/dm-inbox-results.json
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import net from "node:net";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const position = args.indexOf(name);
  return position < 0 ? fallback : args[position + 1];
};
const repetitions = Number(option("--iterations", "7"));
assert(Number.isInteger(repetitions) && repetitions >= 3 && repetitions <= 30, "Use 3–30 iterations");
for (let i = 0; i < args.length; i += 2) {
  assert(["--output", "--iterations"].includes(args[i]) && args[i + 1], "Only --output and --iterations are supported");
}
const output = option("--output", null);
const scratch = mkdtempSync(resolve(tmpdir(), "pit-dm-inbox-benchmark-"));
process.env.NODE_ENV = "test";
process.env.PIT_DATA_DIR = scratch;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "false";
for (const key of Object.keys(process.env)) {
  if (/KEY|TOKEN|PASSWORD|SECRET|MAIL_FROM|ADMIN_EMAIL|RENDER|R2_|S3_|AWS_/iu.test(key)) delete process.env[key];
}
const refuseNetwork = () => { throw new Error("Synthetic inbox benchmark forbids network access"); };
globalThis.fetch = async () => refuseNetwork();
net.Socket.prototype.connect = refuseNetwork;

// Frozen released queries from c2bbe88246f249a5fa7cd60f3184f55b6b8794bf.
// Keep these independent of the optimized implementation for result comparisons.
const legacyLatestSql = `SELECT id,from_id,to_id,text,created_at,other_id FROM (
  SELECT id,from_id,to_id,text,created_at,
    CASE WHEN from_id=$viewer THEN to_id ELSE from_id END AS other_id,
    ROW_NUMBER() OVER (
      PARTITION BY CASE WHEN from_id=$viewer THEN to_id ELSE from_id END
      ORDER BY created_at DESC,id DESC
    ) AS row_number
  FROM dms WHERE removed=0 AND (from_id=$viewer OR to_id=$viewer)
) WHERE row_number=1 ORDER BY created_at DESC,id DESC LIMIT 200`;
const legacyReadsSql = `WITH peers AS MATERIALIZED (
  SELECT to_id AS other_id FROM dms WHERE from_id=$viewer
  UNION SELECT from_id AS other_id FROM dms WHERE to_id=$viewer
  UNION SELECT other_id FROM dm_reads WHERE user_id=$viewer
) SELECT peers.other_id,r.last_read_at,r.last_read_id,
  (SELECT d.id FROM dms d WHERE d.from_id=peers.other_id AND d.to_id=$viewer AND d.removed=0
    ORDER BY d.created_at DESC,d.id DESC LIMIT 1) AS latest_incoming_id,
  (SELECT d.created_at FROM dms d WHERE d.from_id=peers.other_id AND d.to_id=$viewer AND d.removed=0
    ORDER BY d.created_at DESC,d.id DESC LIMIT 1) AS latest_incoming_at,
  EXISTS(SELECT 1 FROM dms sent WHERE sent.from_id=$viewer AND sent.to_id=peers.other_id AND sent.removed=0) AS has_replied,
  CASE WHEN r.user_id IS NULL THEN (
    SELECT COUNT(*) FROM dms d WHERE d.from_id=peers.other_id AND d.to_id=$viewer AND d.removed=0
  ) ELSE (
    SELECT COUNT(*) FROM dms d WHERE d.from_id=peers.other_id AND d.to_id=$viewer AND d.removed=0
      AND (d.created_at,d.id)>(r.last_read_at,r.last_read_id)
  ) END AS unread
  FROM peers LEFT JOIN dm_reads r ON r.user_id=$viewer AND r.other_id=peers.other_id`;
const legacyUnreadSql = `WITH peers AS MATERIALIZED (
  SELECT DISTINCT from_id AS other_id FROM dms WHERE to_id=$viewer
) SELECT COALESCE(SUM(CASE WHEN r.user_id IS NULL THEN (
    SELECT COUNT(*) FROM dms d WHERE d.to_id=$viewer AND d.from_id=peers.other_id AND d.removed=0
  ) ELSE (
    SELECT COUNT(*) FROM dms d WHERE d.to_id=$viewer AND d.from_id=peers.other_id AND d.removed=0
      AND (d.created_at,d.id)>(r.last_read_at,r.last_read_id)
  ) END),0) AS count FROM peers
JOIN users actor ON actor.id=peers.other_id
LEFT JOIN dm_reads r ON r.user_id=$viewer AND r.other_id=peers.other_id
WHERE NOT EXISTS (SELECT 1 FROM blocks b
  WHERE (b.blocker_id=$viewer AND b.blocked_id=peers.other_id)
     OR (b.blocker_id=peers.other_id AND b.blocked_id=$viewer))
AND (EXISTS (SELECT 1 FROM dm_acceptances a WHERE a.user_id=$viewer AND a.other_id=peers.other_id)
  OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id=$viewer AND f.followee_id=peers.other_id)
  OR EXISTS (SELECT 1 FROM dms sent WHERE sent.from_id=$viewer AND sent.to_id=peers.other_id AND sent.removed=0))`;
const legacyConsentSql = "SELECT DISTINCT from_id FROM dms WHERE to_id=? AND removed=0";
const acceptanceSql = "SELECT other_id FROM dm_acceptances WHERE user_id=?";
const legacyRemovedSql = `SELECT id FROM dms WHERE removed=1 AND (from_id=$viewer OR to_id=$viewer)
  ORDER BY created_at DESC,id DESC LIMIT 750`;

function measure(fn) {
  for (let i = 0; i < 3; i++) fn();
  const elapsed = [];
  for (let i = 0; i < repetitions; i++) {
    const started = performance.now();
    fn();
    elapsed.push(performance.now() - started);
  }
  elapsed.sort((a, b) => a - b);
  return {
    repetitions,
    medianMs: elapsed[Math.floor(elapsed.length / 2)],
    p95Ms: elapsed[Math.min(elapsed.length - 1, Math.floor(elapsed.length * 0.95))],
    maxMs: elapsed.at(-1),
  };
}

let database;
try {
  const { db, q } = await import("../server/db.js");
  database = db;
  const { routes } = await import("../server/api.js");
  const { directMessageReadProjection, directMessageInboxUnread } = await import("../server/dmReadRoutes.js");
  const { directMessageConsentProjection } = await import("../server/features/messaging/directMessageConsent.js");
  const { directMessageLatestPerPeer, directMessageInboxRemovedIds } = await import("../server/features/messaging/directMessageThreads.js");

  function legacyReads(viewer) {
    const rows = db.prepare(legacyReadsSql).all({ $viewer: viewer });
    const values = new Map(rows.map(row => [row.other_id, {
      readCursor: row.last_read_id ? { createdAt: row.last_read_at, id: row.last_read_id } : null,
      unread: row.unread || 0,
      latestIncomingCursor: row.latest_incoming_id ? { createdAt: row.latest_incoming_at, id: row.latest_incoming_id } : null,
      hasReplied: !!row.has_replied,
    }]));
    return { forOther: other => values.get(other) };
  }
  function legacyConsent(viewer) {
    const accepted = new Set(db.prepare(acceptanceSql).all(viewer).map(row => row.other_id));
    const inbound = new Set(db.prepare(legacyConsentSql).all(viewer).map(row => row.from_id));
    return { forOther: other => ({ requestState: accepted.has(other) ? "accepted" : inbound.has(other) ? "pending" : "none" }) };
  }
  const legacyLatest = viewer => db.prepare(legacyLatestSql).all({ $viewer: viewer });
  const legacyUnread = viewer => db.prepare(legacyUnreadSql).get({ $viewer: viewer }).count;
  const legacyRemoved = viewer => db.prepare(legacyRemovedSql).all({ $viewer: viewer }).map(row => row.id);
  function legacySummaryData(viewer) {
    const reads = legacyReads(viewer), consent = legacyConsent(viewer);
    return legacyLatest(viewer).map(row => ({ ...row, ...reads.forOther(row.other_id), ...consent.forOther(row.other_id) }));
  }
  function optimizedSummaryData(viewer) {
    const reads = directMessageReadProjection(db, viewer), consent = directMessageConsentProjection(db, viewer);
    return directMessageLatestPerPeer(db, viewer).map(row => ({ ...row, ...reads.forOther(row.other_id), ...consent.forOther(row.other_id) }));
  }
  function capturePlans(fn) {
    const statements = [];
    const wrapper = { prepare(sql) {
      const prepared = db.prepare(sql);
      return {
        all(...params) { statements.push({ sql, params }); return prepared.all(...params); },
        get(...params) { statements.push({ sql, params }); return prepared.get(...params); },
      };
    } };
    fn(wrapper);
    return statements.map(({ sql, params }) => ({ sql, plan: db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map(row => row.detail) }));
  }
  function captureRouteQueries(fn) {
    const originalPrepare = db.prepare, statements = [];
    db.prepare = function (sql) {
      statements.push(sql);
      return originalPrepare.call(this, sql);
    };
    try { fn(); } finally { db.prepare = originalPrepare; }
    return statements;
  }
  const insertMessage = db.prepare("INSERT INTO dms(id,from_id,to_id,text,created_at,removed) VALUES(?,?,?,?,?,?)");
  const insertRead = db.prepare("INSERT INTO dm_reads(user_id,other_id,last_read_at,last_read_id) VALUES(?,?,?,?)");
  function fixture(label, rows, peerCount, mixed) {
    const viewer = `${label}_viewer`;
    const peers = Array.from({ length: peerCount }, (_, i) => `${label}_peer_${String(i).padStart(4, "0")}`);
    db.exec("BEGIN");
    for (const id of [viewer, ...peers]) {
      q.insertUser.run(id, `${id}@example.invalid`, id, id, "synthetic-noncredential", "fan", "Synthetic", 0, 0, "SY", "#000000", 1);
    }
    const latestIncoming = peers.map(() => []);
    let removed = 0;
    for (let i = 0; i < rows; i++) {
      const peer = i % peerCount, ordinal = Math.floor(i / peerCount);
      const outbound = mixed && ordinal % 4 === 1 && peer % 4 !== 0;
      const isRemoved = mixed && (ordinal + peer) % 17 === 0;
      const at = Math.floor(i / 2) + 1, id = `${label}_dm_${String(i).padStart(7, "0")}`;
      insertMessage.run(id, outbound ? viewer : peers[peer], outbound ? peers[peer] : viewer, "Synthetic fixture", at, Number(isRemoved));
      if (isRemoved) removed++;
      if (!outbound && !isRemoved) {
        latestIncoming[peer].push({ at, id });
        if (latestIncoming[peer].length > 3) latestIncoming[peer].shift();
      }
    }
    for (let i = 0; i < peers.length; i++) {
      if (!mixed) insertRead.run(viewer, peers[i], rows, "~");
      else if (latestIncoming[i].length >= 3) insertRead.run(viewer, peers[i], latestIncoming[i][0].at, latestIncoming[i][0].id);
      if (mixed && i % 8 === 0) db.prepare("INSERT INTO dm_acceptances(user_id,other_id,accepted_at,source) VALUES(?,?,1,'explicit')").run(viewer, peers[i]);
      if (mixed && i % 19 === 0) db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,1)").run(i % 2 ? viewer : peers[i], i % 2 ? peers[i] : viewer);
    }
    db.exec("COMMIT");
    return { viewer, peers, removed };
  }

  const measurements = [];
  for (const distribution of [{ label: "five_peers_all_read", peers: 5, mixed: false }, { label: "250_peers_mixed", peers: 250, mixed: true }]) {
    for (const rows of [1_000, 10_000, 100_000]) {
      const f = fixture(`${distribution.label}_${rows}`, rows, distribution.peers, distribution.mixed);
      const oldData = legacySummaryData(f.viewer), newData = optimizedSummaryData(f.viewer);
      assert.deepEqual(newData, oldData, "Latest message, stable ordering, read totals and directional consent must match");
      const oldRemoved = legacyRemoved(f.viewer);
      assert.deepEqual(directMessageInboxRemovedIds(db, f.viewer, 750), oldRemoved, "The same latest 750 removal IDs must remain available");
      const oldReads = legacyReads(f.viewer), newReads = directMessageReadProjection(db, f.viewer);
      const oldConsent = legacyConsent(f.viewer), newConsent = directMessageConsentProjection(db, f.viewer);
      for (const peer of f.peers) {
        assert.deepEqual(newReads.forOther(peer), oldReads.forOther(peer));
        assert.deepEqual(newConsent.forOther(peer), oldConsent.forOther(peer));
      }
      const unread = legacyUnread(f.viewer);
      assert.equal(directMessageInboxUnread(db, f.viewer), unread, "Global unread remains complete beyond 200 previews and excludes blocks");
      const user = q.userById.get(f.viewer);
      const summary = () => routes["GET /api/me/threads"]({ user, query: { summary: "1" } });
      const hidden = new Set(db.prepare("SELECT CASE WHEN blocker_id=? THEN blocked_id ELSE blocker_id END id FROM blocks WHERE blocker_id=? OR blocked_id=?").all(f.viewer, f.viewer, f.viewer).map(row => row.id));
      const expected = oldData.filter(row => !hidden.has(row.other_id));
      const actual = summary();
      assert.deepEqual(actual.removedIds, oldRemoved);
      const routeQueries = captureRouteQueries(summary);
      assert(routeQueries.some(sql => sql.includes("WITH RECURSIVE") && sql.includes("removed=1") && sql.includes("LIMIT $limit")),
        "The actual loaded API route must use bounded removal queries as well");
      assert.deepEqual(actual.threads.map(thread => ({ otherId: thread.otherId, preview: thread.messages[0], unread: thread.unread, requestState: thread.requestState })), expected.map(row => ({
        otherId: row.other_id, preview: { id: row.id, from: row.from_id, text: row.text, createdAt: row.created_at }, unread: row.unread, requestState: row.requestState,
      })));
      const result = {
        distribution: distribution.label, rows, peers: distribution.peers, removedRows: f.removed, globalUnread: unread,
        visibleSummaryThreads: actual.threads.length,
        currentSummaryUsesBoundedRemovalQuery: true,
        latestRows: { before: measure(() => legacyLatest(f.viewer)), after: measure(() => directMessageLatestPerPeer(db, f.viewer)) },
        allPeerReadProjection: { before: measure(() => legacyReads(f.viewer)), after: measure(() => directMessageReadProjection(db, f.viewer)) },
        consentProjection: { before: measure(() => legacyConsent(f.viewer)), after: measure(() => directMessageConsentProjection(db, f.viewer)) },
        globalUnreadCount: { before: measure(() => legacyUnread(f.viewer)), after: measure(() => directMessageInboxUnread(db, f.viewer)) },
        removedIds: { before: measure(() => legacyRemoved(f.viewer)), after: measure(() => directMessageInboxRemovedIds(db, f.viewer, 750)) },
        summaryDataWork: { before: measure(() => legacySummaryData(f.viewer)), after: measure(() => optimizedSummaryData(f.viewer)) },
        summaryDataWithRemovals: {
          before: measure(() => { legacySummaryData(f.viewer); legacyRemoved(f.viewer); }),
          after: measure(() => { optimizedSummaryData(f.viewer); directMessageInboxRemovedIds(db, f.viewer, 750); }),
        },
        currentSummaryRoute: measure(summary),
      };
      if (rows === 100_000) result.plans = {
        legacyLatest: db.prepare(`EXPLAIN QUERY PLAN ${legacyLatestSql}`).all({ $viewer: f.viewer }).map(row => row.detail),
        legacyReads: db.prepare(`EXPLAIN QUERY PLAN ${legacyReadsSql}`).all({ $viewer: f.viewer }).map(row => row.detail),
        legacyUnread: db.prepare(`EXPLAIN QUERY PLAN ${legacyUnreadSql}`).all({ $viewer: f.viewer }).map(row => row.detail),
        legacyConsent: db.prepare(`EXPLAIN QUERY PLAN ${legacyConsentSql}`).all(f.viewer).map(row => row.detail),
        legacyRemoved: db.prepare(`EXPLAIN QUERY PLAN ${legacyRemovedSql}`).all({ $viewer: f.viewer }).map(row => row.detail),
        optimizedLatest: capturePlans(wrapped => directMessageLatestPerPeer(wrapped, f.viewer)),
        optimizedReads: capturePlans(wrapped => directMessageReadProjection(wrapped, f.viewer)),
        optimizedUnread: capturePlans(wrapped => directMessageInboxUnread(wrapped, f.viewer)),
        optimizedConsent: capturePlans(wrapped => directMessageConsentProjection(wrapped, f.viewer)),
        optimizedRemoved: capturePlans(wrapped => directMessageInboxRemovedIds(wrapped, f.viewer, 750)),
      };
      measurements.push(result);
      console.error(`${distribution.label}: ${rows} rows, summary data ${result.summaryDataWork.before.medianMs.toFixed(3)} -> ${result.summaryDataWork.after.medianMs.toFixed(3)} ms`);
    }
  }
  const result = {
    measuredAt: new Date().toISOString(),
    baselineCommit: "c2bbe88246f249a5fa7cd60f3184f55b6b8794bf",
    node: process.version,
    sqlite: db.prepare("SELECT sqlite_version() version").get().version,
    scope: "Local synthetic data only; not production performance, an SLO or a capacity guarantee. Before/after summaryDataWork measures SQL/read/consent assembly; summaryDataWithRemovals also includes removal IDs; currentSummaryRoute separately includes current API hydration and relationship contexts.",
    warmupIterations: 3,
    measurements,
    integrity: db.prepare("PRAGMA integrity_check").get().integrity_check,
    foreignKeyViolations: db.prepare("PRAGMA foreign_key_check").all().length,
  };
  assert.equal(result.integrity, "ok");
  assert.equal(result.foreignKeyViolations, 0);
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (output) {
    mkdirSync(dirname(resolve(output)), { recursive: true });
    writeFileSync(resolve(output), json);
    console.log(`Saved synthetic results to ${resolve(output)}`);
  } else console.log(json);
} finally {
  database?.close();
  const target = resolve(scratch), temporaryRoot = `${resolve(tmpdir())}${sep}`;
  assert(target.startsWith(temporaryRoot) && basename(target).startsWith("pit-dm-inbox-benchmark-"));
  rmSync(target, { recursive: true, force: true });
}
