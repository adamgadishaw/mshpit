// Inactivity starts when reliable tracking is deployed, not at a guessed historic
// creation date. This migration never suspends, warns, or deletes an account.
export const ACCOUNT_INACTIVITY_DAY_MS = 24 * 60 * 60 * 1000;
export const ACCOUNT_DORMANCY_MS = 365 * ACCOUNT_INACTIVITY_DAY_MS;
export const ACCOUNT_DELETION_MS = 730 * ACCOUNT_INACTIVITY_DAY_MS;
export const ACCOUNT_DELETION_WARNING_MS = 30 * ACCOUNT_INACTIVITY_DAY_MS;

export function ensureAccountLifecycleSchema(database, { at = Date.now() } = {}) {
  if (!Number.isSafeInteger(at) || at <= 0) throw new TypeError("Invalid lifecycle rollout timestamp");
  database.exec("BEGIN IMMEDIATE");
  try {
    const existing = new Set(database.prepare("PRAGMA table_info(users)").all().map((row) => row.name));
    for (const [name, type] of [
      ["last_active_at", "INTEGER"],
      ["dormant_at", "INTEGER"],
      ["inactivity_warning_sent_at", "INTEGER"],
      ["inactivity_warning_activity_at", "INTEGER"],
      ["inactivity_warning_receipt", "TEXT"],
      ["inactivity_warning_attempted_at", "INTEGER"],
      ["inactivity_next_check_at", "INTEGER"],
    ]) {
      if (!existing.has(name)) database.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
    }
    // NULL is unknown, never ancient. Repeated migrations preserve real activity.
    database.prepare(`UPDATE users SET last_active_at=?,inactivity_next_check_at=?
      WHERE last_active_at IS NULL OR last_active_at<=0`).run(at, at + ACCOUNT_DORMANCY_MS);
    database.prepare(`UPDATE users SET inactivity_next_check_at=last_active_at+?
      WHERE inactivity_next_check_at IS NULL`).run(ACCOUNT_DORMANCY_MS);
    database.exec(`CREATE TABLE IF NOT EXISTS account_inactivity_warnings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      activity_at INTEGER NOT NULL,recipient_email TEXT NOT NULL,requested_at INTEGER NOT NULL,
      delete_after INTEGER NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,
      provider_id TEXT,accepted_at INTEGER,receipt_unavailable INTEGER NOT NULL DEFAULT 0
    );
    CREATE TRIGGER IF NOT EXISTS trg_users_clear_inactivity_warning AFTER UPDATE OF last_active_at ON users
    WHEN OLD.last_active_at IS NOT NEW.last_active_at
    BEGIN DELETE FROM account_inactivity_warnings WHERE user_id=NEW.id; END;`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_users_inactivity_due
      ON users(inactivity_next_check_at,id);
      CREATE TRIGGER IF NOT EXISTS trg_users_initialize_inactivity AFTER INSERT ON users
      WHEN NEW.last_active_at IS NULL OR NEW.last_active_at<=0
      BEGIN
        UPDATE users SET last_active_at=CAST(unixepoch('subsec')*1000 AS INTEGER),
          inactivity_next_check_at=CAST(unixepoch('subsec')*1000 AS INTEGER)+${ACCOUNT_DORMANCY_MS}
        WHERE id=NEW.id;
      END;`);
    database.exec(`CREATE TRIGGER IF NOT EXISTS owner_account_no_dormancy
      BEFORE UPDATE OF dormant_at ON users
      WHEN NEW.dormant_at IS NOT NULL AND OLD.id=(
        SELECT json_extract(CASE WHEN json_valid(value) THEN value ELSE '{}' END,'$.userId')
        FROM app_meta WHERE key='security.bootstrap_admin_identity.v1'
          AND json_extract(CASE WHEN json_valid(value) THEN value ELSE '{}' END,'$.version')=2)
      BEGIN SELECT RAISE(ABORT,'the Owner account cannot become dormant'); END;`);
    database.exec("COMMIT");
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Lifecycle schema migration and rollback failed");
    }
    throw error;
  }
}
