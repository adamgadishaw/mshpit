import { withImmediateWrite } from "../../databaseTransaction.js";

// Called explicitly by the database migration boundary. Importing this feature
// never opens a database, starts a worker, registers a device or sends a push.
export function ensureLocalAlertSchema(db) {
  if (!db.prepare("PRAGMA foreign_keys").get().foreign_keys) throw new Error("Local alerts require SQLite foreign-key enforcement");
  return withImmediateWrite(db, () => {
  const hadReceipts = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_push_installation_receipts'").get();
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_alert_preferences (
      account_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      dates_inbox INTEGER NOT NULL DEFAULT 1 CHECK(dates_inbox IN (0,1)),
      sales_inbox INTEGER NOT NULL DEFAULT 1 CHECK(sales_inbox IN (0,1)),
      dates_push INTEGER NOT NULL DEFAULT 0 CHECK(dates_push IN (0,1)),
      sales_push INTEGER NOT NULL DEFAULT 0 CHECK(sales_push IN (0,1))
    );
    CREATE TABLE IF NOT EXISTS local_event_sales (
      event_id TEXT PRIMARY KEY REFERENCES tour_dates(id) ON DELETE CASCADE,
      provider_event_id TEXT NOT NULL, starts_at INTEGER, ends_at INTEGER,
      observed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS local_alert_account_scans (
      account_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      event_cursor TEXT NOT NULL DEFAULT '', requested_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS local_event_observations (
      event_id TEXT PRIMARY KEY REFERENCES tour_dates(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL, first_seen_at INTEGER NOT NULL,
      announce_until INTEGER NOT NULL, scan_cursor TEXT NOT NULL DEFAULT '',
      scan_complete INTEGER NOT NULL DEFAULT 0,
      reconcile_cursor TEXT NOT NULL DEFAULT '', reconcile_complete INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS local_event_alerts (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES tour_dates(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('date','sale')), trigger_key TEXT NOT NULL,
      fingerprint TEXT NOT NULL, delivery_fingerprint TEXT, city_path TEXT NOT NULL,
      due_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','delivered','cancelled')),
      delivery_locked INTEGER NOT NULL DEFAULT 0 CHECK(delivery_locked IN (0,1)),
      notification_id TEXT REFERENCES notifications(id) ON DELETE SET NULL,
      owns_notice INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      UNIQUE(account_id,event_id,kind,trigger_key)
    );
    CREATE INDEX IF NOT EXISTS local_event_alerts_due ON local_event_alerts(state,due_at,id);
    CREATE INDEX IF NOT EXISTS local_event_alerts_notice ON local_event_alerts(notification_id,account_id,owns_notice,state);
    CREATE INDEX IF NOT EXISTS local_event_alerts_event ON local_event_alerts(event_id);
    CREATE INDEX IF NOT EXISTS local_event_alerts_event_page ON local_event_alerts(event_id,id);
    CREATE TABLE IF NOT EXISTS local_push_installations (
      installation_id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL,
      account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE, platform TEXT NOT NULL CHECK(platform IN ('ios','android')),
      generation INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      permission TEXT NOT NULL CHECK(permission IN ('granted','denied')),
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS local_push_installations_account ON local_push_installations(account_id);
    CREATE INDEX IF NOT EXISTS local_push_installations_session ON local_push_installations(session_hash);
    CREATE TABLE IF NOT EXISTS local_push_installation_receipts (
      installation_id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL,
      account_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      generation INTEGER NOT NULL CHECK(generation>0), revoked_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS local_push_installation_receipts_account ON local_push_installation_receipts(account_id);
    CREATE TRIGGER IF NOT EXISTS local_push_receipt_remove_account BEFORE DELETE ON users
      BEGIN UPDATE local_push_installation_receipts SET account_id=NULL,revoked_at=NULL WHERE account_id=OLD.id; END;
    CREATE TABLE IF NOT EXISTS local_push_outbox (
      id TEXT PRIMARY KEY,
      alert_id TEXT NOT NULL REFERENCES local_event_alerts(id) ON DELETE CASCADE,
      installation_id TEXT NOT NULL REFERENCES local_push_installations(installation_id) ON DELETE CASCADE,
      generation INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','sending','accepted','delivered','failed','unknown','cancelled')),
      attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL,
      lease_until INTEGER, lease_key TEXT, ticket_id TEXT, sent_at INTEGER, error_code TEXT,
      UNIQUE(alert_id,installation_id,generation)
    );
    CREATE INDEX IF NOT EXISTS local_push_outbox_due ON local_push_outbox(state,next_at,id);
    CREATE INDEX IF NOT EXISTS local_push_outbox_installation ON local_push_outbox(installation_id,generation);
    CREATE INDEX IF NOT EXISTS local_push_outbox_alert_page ON local_push_outbox(alert_id,id);
    CREATE TRIGGER IF NOT EXISTS local_alert_remove_owned_notice BEFORE DELETE ON local_event_alerts
      WHEN OLD.owns_notice=1 AND OLD.notification_id IS NOT NULL
      BEGIN DELETE FROM notifications WHERE id=OLD.notification_id; END;
  `);
    if (!hadReceipts) db.exec(`INSERT INTO local_push_installation_receipts(installation_id,secret_hash,account_id,generation,revoked_at)
      SELECT installation_id,secret_hash,account_id,generation,NULL FROM local_push_installations`);
    const observationColumns = db.prepare("PRAGMA table_info(local_event_observations)").all();
    if (!observationColumns.some(column => column.name === "reconcile_cursor")) db.exec("ALTER TABLE local_event_observations ADD COLUMN reconcile_cursor TEXT NOT NULL DEFAULT ''");
    if (!observationColumns.some(column => column.name === "reconcile_complete")) db.exec("ALTER TABLE local_event_observations ADD COLUMN reconcile_complete INTEGER NOT NULL DEFAULT 0");
    db.exec("CREATE INDEX IF NOT EXISTS local_event_observations_reconcile ON local_event_observations(reconcile_complete,event_id)");
    if (!db.prepare("PRAGMA table_info(local_event_alerts)").all().some(column => column.name === "delivery_locked")) {
      db.exec(`ALTER TABLE local_event_alerts ADD COLUMN delivery_locked INTEGER NOT NULL DEFAULT 0 CHECK(delivery_locked IN (0,1));
        UPDATE local_event_alerts SET delivery_locked=1 WHERE state<>'queued' OR notification_id IS NOT NULL
          OR EXISTS (SELECT 1 FROM local_push_outbox p WHERE p.alert_id=local_event_alerts.id);`);
    }
    if (!db.prepare("PRAGMA table_info(local_event_alerts)").all().some(column => column.name === "delivery_fingerprint")) {
      // A missing snapshot is not evidence that a historical edit was harmless.
      // The service adopts it only while the full stored fingerprint still matches.
      db.exec("ALTER TABLE local_event_alerts ADD COLUMN delivery_fingerprint TEXT");
      db.exec("UPDATE local_event_observations SET reconcile_cursor='',reconcile_complete=0");
    }
    // Old cancelled rows lost their original delivery state. Lock them rather
    // than guess that an inbox-only or uncertain push delivery never happened.
    // The trigger also preserves receipts if an older writer shares this DB.
    db.exec(`CREATE TRIGGER IF NOT EXISTS local_alert_lock_delivery AFTER UPDATE OF state ON local_event_alerts
      WHEN NEW.state='delivered' AND NEW.delivery_locked=0
      BEGIN UPDATE local_event_alerts SET delivery_locked=1 WHERE id=NEW.id; END;
      CREATE TRIGGER IF NOT EXISTS local_alert_keep_delivery_lock BEFORE UPDATE OF delivery_locked ON local_event_alerts
      WHEN OLD.delivery_locked=1 AND NEW.delivery_locked<>1
      BEGIN SELECT RAISE(ABORT,'A committed alert cannot be replayed'); END;`);
  });
}

export const LOCAL_ALERT_TABLES = Object.freeze([
  "local_alert_preferences", "local_alert_account_scans", "local_event_sales", "local_event_observations",
  "local_event_alerts", "local_push_installations", "local_push_outbox", "local_push_installation_receipts",
]);
