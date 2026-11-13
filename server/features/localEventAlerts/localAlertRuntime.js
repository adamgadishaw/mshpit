import { withImmediateWrite } from "../../databaseTransaction.js";
import { startPeriodicJob } from "../../periodicJobScheduler.js";
import { runBackgroundJob } from "../../backgroundJobCoordinator.js";
import { pruneLocalPushOutbox } from "./localAlertPrivacy.js";

// Migration records a finite historical boundary. New writes enter the queue in
// their own transaction; bootstrap and worker pages never scan an unbounded set.
export function ensureLocalAlertRuntimeSchema(db) {
  return withImmediateWrite(db, () => {
    db.exec(`CREATE TABLE IF NOT EXISTS local_alert_runtime (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS local_alert_event_queue (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE REFERENCES tour_dates(id) ON DELETE CASCADE ON UPDATE CASCADE,
        baseline INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS local_alert_event_queue_due ON local_alert_event_queue(next_at,event_id);
      INSERT OR IGNORE INTO local_alert_runtime VALUES ('baseline_end',CAST((SELECT COALESCE(MAX(rowid),0) FROM tour_dates) AS TEXT));
      INSERT OR IGNORE INTO local_alert_runtime VALUES ('baseline_cursor','0');
      CREATE TRIGGER IF NOT EXISTS local_alert_new_event AFTER INSERT ON tour_dates BEGIN
        INSERT INTO local_alert_event_queue(event_id,baseline) VALUES (NEW.id,0) ON CONFLICT(event_id) DO UPDATE SET next_at=0;
      END;
      CREATE TRIGGER IF NOT EXISTS local_alert_changed_event AFTER UPDATE ON tour_dates BEGIN
        INSERT INTO local_alert_event_queue(event_id,baseline) VALUES (NEW.id,NEW.rowid<=CAST((SELECT value FROM local_alert_runtime WHERE key='baseline_end') AS INTEGER))
        ON CONFLICT(event_id) DO UPDATE SET next_at=0;
      END;`);
    // All current writers (including linked-account setup) receive the same
    // durable scan intent. These triggers grant no roles or page ownership.
    const queueAccount = reference => `INSERT INTO local_alert_account_scans(account_id,requested_at) VALUES (${reference},unixepoch()*1000)
      ON CONFLICT(account_id) DO UPDATE SET event_cursor='',requested_at=excluded.requested_at;`;
    db.exec(`CREATE TRIGGER IF NOT EXISTS local_alert_profile_changed AFTER UPDATE OF favorite_artists,home_city ON users BEGIN ${queueAccount("NEW.id")} END;`);
    for (const [table, column] of [["fan_club_members", "user_id"], ["creator_follows", "account_id"]]) {
      for (const operation of ["INSERT", "UPDATE", "DELETE"]) {
        const reference = `${operation === "DELETE" ? "OLD" : "NEW"}.${column}`;
        db.exec(`CREATE TRIGGER IF NOT EXISTS local_alert_${table}_${operation.toLowerCase()} AFTER ${operation} ON ${table}
          WHEN EXISTS(SELECT 1 FROM users WHERE id=${reference}) BEGIN ${queueAccount(reference)} END;`);
      }
    }
  });
}

export function createLocalAlertRuntime({ db, alerts, now = Date.now }) {
  const read = key => db.prepare("SELECT value FROM local_alert_runtime WHERE key=?").get(key)?.value || "";
  const save = (key, value) => db.prepare("INSERT INTO local_alert_runtime VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, String(value));
  const fairPage = (key, table, column, where, limit) => {
    const cursor = read(key);
    let rows = db.prepare(`SELECT ${column} AS id FROM ${table} WHERE ${where} AND ${column}>? ORDER BY ${column} LIMIT ?`).all(cursor, limit);
    if (!rows.length && cursor) rows = db.prepare(`SELECT ${column} AS id FROM ${table} WHERE ${where} ORDER BY ${column} LIMIT ?`).all(limit);
    save(key, rows.at(-1)?.id || "");
    return rows;
  };
  function tick({ events = 20, recipients = 100 } = {}) {
    const outer = Math.max(1, Math.min(50, Math.floor(events) || 20));
    const inner = Math.max(1, Math.min(500, Math.floor(recipients) || 100));
    return withImmediateWrite(db, () => {
      const at = now(), end = Number(read("baseline_end")), cursor = Number(read("baseline_cursor"));
      const historical = db.prepare("SELECT rowid,id FROM tour_dates WHERE rowid>? AND rowid<=? ORDER BY rowid LIMIT ?").all(cursor, end, outer);
      for (const row of historical) db.prepare("INSERT OR IGNORE INTO local_alert_event_queue(event_id,baseline) VALUES (?,1)").run(row.id);
      save("baseline_cursor", historical.at(-1)?.rowid || end);
      const due = db.prepare("SELECT * FROM local_alert_event_queue WHERE next_at<=? ORDER BY next_at,event_id LIMIT ?").all(at, outer);
      for (const row of due) {
        const historicalRow = row.sequence <= Number(read("activation_queue_end"));
        const result = alerts.reconcileEvent(row.event_id, { baseline: !!row.baseline || historicalRow, limit: inner });
        const release = db.prepare("SELECT release_at FROM tour_dates WHERE id=?").get(row.event_id)?.release_at;
        db.prepare("UPDATE local_alert_event_queue SET next_at=? WHERE event_id=?").run(
          result.more ? at + 60000 : release > at ? Math.min(release, at + 3600000) : at + 3600000, row.event_id);
      }
      for (const row of fairPage("reconcile", "local_event_observations", "event_id", "reconcile_complete=0", outer)) alerts.reconcileEvent(row.id, { limit: inner });
      for (const row of fairPage("plan", "local_event_observations", "event_id", "reconcile_complete=1 AND scan_complete=0", outer)) alerts.planEventPage(row.id, { limit: inner });
      for (const row of fairPage("accounts", "local_alert_account_scans", "account_id", "1=1", outer)) alerts.planAccountSalesPage(row.id, { limit: inner });
      const cancellation = alerts.cancelPendingPushPage({ limit: inner });
      const delivery = alerts.deliverDue({ limit: inner });
      const pruned = pruneLocalPushOutbox(db, { at, limit: inner });
      return { historical: historical.length, events: due.length, cancellation, delivery, pruned };
    });
  }
  return { tick, activate: () => withImmediateWrite(db, () => {
    if (read("activated")) return;
    // Enabling after a long disabled interval must not announce the backlog.
    save("baseline_end", db.prepare("SELECT COALESCE(MAX(rowid),0) AS id FROM tour_dates").get().id);
    save("baseline_cursor", 0);
    save("activation_queue_end", db.prepare("SELECT COALESCE(MAX(sequence),0) AS id FROM local_alert_event_queue").get().id);
    save("activated", 1);
  }) };
}

export function startLocalAlertRuntime(runtime, { enabled = false, coordinate = runBackgroundJob, ...timers } = {}) {
  if (!enabled) return { stop: async () => {}, trigger: async () => false };
  runtime.activate?.();
  return startPeriodicJob({ initialDelayMs: 2000, intervalMs: 60000,
    run: () => coordinate(() => runtime.tick()), report: error => console.error("[show-alerts]", error.code || "tick failed"), ...timers });
}
