import { createHash } from "node:crypto";

const HOUR_MS = 3_600_000;
const MAX_DIGEST_ROWS = 20;
const SERIOUS_GENERAL = `(e.level='fatal' OR e.status=0 OR e.status>=500)
  AND NOT (e.method='GET' AND e.route='/api/readiness' AND e.status=503 AND e.code='MEDIA_STORAGE_UNAVAILABLE')`;

export function alertCooldownMs(env = process.env) {
  const raw = Number(env?.ERROR_ALERT_COOLDOWN_MIN);
  return Number.isFinite(raw) && raw > 0 ? raw * 60_000 : 30 * 60_000;
}

// Called inside db.js's existing startup write transaction. Historical delivery
// is unknowable: baseline old history, but preserve recent bucket counts as an
// explicitly labelled initial catch-up instead of silently marking them sent.
export function ensureErrorAlertSchema(database, { now = Date.now(), lookbackMs = alertCooldownMs() } = {}) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS error_alert_checkpoints (
      fingerprint TEXT PRIMARY KEY REFERENCES error_events(fingerprint) ON DELETE CASCADE,
      through_count INTEGER NOT NULL DEFAULT 0 CHECK (through_count>=0),
      legacy_through_count INTEGER NOT NULL DEFAULT 0 CHECK (legacy_through_count>=0)
    );
    CREATE TABLE IF NOT EXISTS error_alert_delivery (
      singleton INTEGER PRIMARY KEY CHECK (singleton=1),
      last_sent_at INTEGER NOT NULL DEFAULT 0,
      pending_key TEXT,
      pending_payload TEXT CHECK (pending_payload IS NULL OR
        (json_valid(pending_payload) AND length(pending_payload)<=24000))
    );
  `);
  if (database.prepare("SELECT 1 FROM error_alert_delivery WHERE singleton=1").get()) return;
  const cutoff = now - lookbackMs;
  const bucketStart = Math.floor(cutoff / HOUR_MS) * HOUR_MS;
  database.prepare(`INSERT INTO error_alert_checkpoints (fingerprint,through_count,legacy_through_count)
    SELECT e.fingerprint,
      CASE WHEN e.last_seen>=? AND ${SERIOUS_GENERAL}
        THEN MAX(0,e.count-COALESCE((SELECT SUM(b.count) FROM error_occurrence_buckets b
          WHERE b.fingerprint=e.fingerprint AND b.hour_start>=?),e.count))
        ELSE e.count END,
      CASE WHEN e.last_seen>=? AND ${SERIOUS_GENERAL} THEN e.count ELSE 0 END
    FROM error_events e WHERE true ON CONFLICT(fingerprint) DO NOTHING`).run(cutoff, bucketStart, cutoff);
  database.prepare("INSERT INTO error_alert_delivery (singleton,last_sent_at) VALUES (1,0)").run();
}

function transaction(database, action) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try { database.exec("ROLLBACK"); }
    catch { /* architecture: allow-empty-catch -- preserve the original alert checkpoint transaction failure */ }
    throw error;
  }
}

export function createErrorAlertDelivery(database) {
  const state = database.prepare("SELECT * FROM error_alert_delivery WHERE singleton=1");
  const pending = database.prepare(`SELECT e.fingerprint,e.level,e.code,e.status,e.method,e.route,e.cause,
      e.last_request_id,e.first_seen,e.last_seen,e.count through_count,
      e.count-COALESCE(c.through_count,0) count,
      COALESCE(c.through_count,0) acknowledged_count,
      COALESCE(c.legacy_through_count,0) legacy_through_count
    FROM error_events e LEFT JOIN error_alert_checkpoints c ON c.fingerprint=e.fingerprint
    WHERE e.count>COALESCE(c.through_count,0) AND ${SERIOUS_GENERAL}
    ORDER BY e.last_seen ASC,e.fingerprint ASC LIMIT ?`);
  const save = database.prepare("UPDATE error_alert_delivery SET pending_key=?,pending_payload=? WHERE singleton=1");
  const acknowledge = database.prepare(`INSERT INTO error_alert_checkpoints (fingerprint,through_count,legacy_through_count)
    SELECT fingerprint,MIN(count,?),0 FROM error_events WHERE fingerprint=? AND first_seen=?
    ON CONFLICT(fingerprint) DO UPDATE SET through_count=MAX(error_alert_checkpoints.through_count,excluded.through_count)`);
  const finish = database.prepare(`UPDATE error_alert_delivery SET last_sent_at=MAX(last_sent_at,?),
    pending_key=NULL,pending_payload=NULL WHERE singleton=1 AND pending_key=?`);

  return Object.freeze({
    nextBatch({ now, force = false, cooldownMs = alertCooldownMs() }) {
      return transaction(database, () => {
        const current = state.get();
        if (!current) throw new Error("Alert delivery state is unavailable");
        if (!force && now - current.last_sent_at < cooldownMs) return { reason: "cooling-down" };
        // Freeze retries across restarts and concurrent arrivals. A new error
        // must not change the provider idempotency key of an uncertain send.
        if (current.pending_key) return { batch: { ...JSON.parse(current.pending_payload), key: current.pending_key } };
        const rows = pending.all(MAX_DIGEST_ROWS).map((row) => ({ ...row }));
        if (!rows.length) return { reason: "nothing-serious" };
        const payload = { rows, initialCatchUp: rows.some((row) => row.acknowledged_count < row.legacy_through_count) };
        const serialized = JSON.stringify(payload);
        const key = "error-alert-v2-" + createHash("sha256").update(serialized).digest("hex").slice(0, 40);
        save.run(key, serialized);
        return { batch: { ...payload, key } };
      });
    },
    acknowledge(key, now) {
      return transaction(database, () => {
        const current = state.get();
        if (current?.pending_key !== key) return false;
        const { rows } = JSON.parse(current.pending_payload);
        for (const row of rows) acknowledge.run(row.through_count, row.fingerprint, row.first_seen);
        finish.run(now, key);
        return true;
      });
    },
  });
}
