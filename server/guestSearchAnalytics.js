import {
  GUEST_SEARCH_KINDS,
  GUEST_SEARCH_OUTCOMES,
  GUEST_SEARCH_RESULT_BUCKETS,
  guestSearchRetentionCutoffDay,
  guestSearchUtcDay,
  sanitizeGuestSearchPayload,
} from "../src/domain/guestSearchAnalytics.mjs";

const quoted = (values) => values.map((value) => `'${value.replaceAll("'", "''")}'`).join(",");

export const GUEST_SEARCH_ANALYTICS_TABLE = "guest_search_daily";

export function ensureGuestSearchAnalyticsSchema(database) {
  if (!database?.exec) throw new TypeError("Guest search analytics requires a database.");
  database.exec(`
    CREATE TABLE IF NOT EXISTS guest_search_daily (
      day           TEXT NOT NULL CHECK(
                      length(day)=10 AND
                      day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                    ),
      kind          TEXT NOT NULL CHECK(kind IN (${quoted(GUEST_SEARCH_KINDS)})),
      result_bucket TEXT NOT NULL CHECK(result_bucket IN (${quoted(GUEST_SEARCH_RESULT_BUCKETS)})),
      outcome       TEXT NOT NULL CHECK(outcome IN (${quoted(GUEST_SEARCH_OUTCOMES)})),
      count         INTEGER NOT NULL CHECK(typeof(count)='integer' AND count > 0),
      PRIMARY KEY (day, kind, result_bucket, outcome),
      CHECK(
        (outcome='failed' AND result_bucket='unknown') OR
        (outcome='success' AND result_bucket<>'unknown')
      )
    ) WITHOUT ROWID;
  `);
  return database;
}

export function pruneGuestSearchAnalytics({ database, at = Date.now() } = {}) {
  if (!database?.prepare) throw new TypeError("Guest search analytics requires a database.");
  const cutoffDay = guestSearchRetentionCutoffDay(at);
  const result = database.prepare("DELETE FROM guest_search_daily WHERE day < ?").run(cutoffDay);
  return { cutoffDay, removed: Number(result?.changes) || 0 };
}

export function recordGuestSearchAggregate(payload, { database, user = null, at = Date.now() } = {}) {
  // This table measures only account-free usage. Member analytics remains in
  // the separately consented events pipeline and must never be double-counted.
  if (user?.id) return { ok: false, accepted: false, reason: "signed_in" };
  const metric = sanitizeGuestSearchPayload(payload);
  if (!metric) return { ok: false, accepted: false, reason: "invalid" };
  if (!database?.prepare) throw new TypeError("Guest search analytics requires a database.");

  const day = guestSearchUtcDay(at);
  pruneGuestSearchAnalytics({ database, at });
  database.prepare(`
    INSERT INTO guest_search_daily (day,kind,result_bucket,outcome,count)
    VALUES (?,?,?,?,1)
    ON CONFLICT(day,kind,result_bucket,outcome) DO UPDATE SET
      count=guest_search_daily.count+1
  `).run(day, metric.kind, metric.resultBucket, metric.outcome);
  const row = database.prepare(`
    SELECT day,kind,result_bucket AS resultBucket,outcome,count
    FROM guest_search_daily
    WHERE day=? AND kind=? AND result_bucket=? AND outcome=?
  `).get(day, metric.kind, metric.resultBucket, metric.outcome);
  return { ok: true, accepted: true, aggregate: row };
}

export function readGuestSearchAnalytics({ database, at = Date.now(), days = 30 } = {}) {
  if (!database?.prepare) throw new TypeError("Guest search analytics requires a database.");
  const startDay = guestSearchRetentionCutoffDay(at, days);
  const rows = database.prepare(`
    SELECT day,kind,result_bucket AS resultBucket,outcome,count
    FROM guest_search_daily
    WHERE day >= ?
    ORDER BY day,kind,result_bucket,outcome
  `).all(startDay);
  return { startDay, rows };
}
