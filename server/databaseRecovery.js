import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

export const RESTORE_GATE_KEY = "database:restore-gate:v1";

function tables(database) {
  return new Set(database.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map((row) => row.name));
}

export function assertDatabaseRecoveryReady(database) {
  if (!tables(database).has("app_meta")) return;
  const row = database.prepare("SELECT value FROM app_meta WHERE key=?").get(RESTORE_GATE_KEY);
  if (!row) return; // Existing live databases and historical backups predate the fence.
  let gate;
  try { gate = JSON.parse(row.value); } catch { /* malformed is not approval */ }
  let referencesValid = false;
  try {
    reviewReference(gate?.privacyReplayReference, "Privacy replay");
    reviewReference(gate?.credentialReviewReference, "Credential review");
    referencesValid = true;
  } catch { /* Invalid recovery evidence must never grant startup approval. */ }
  if (gate?.version !== 1 || gate?.state !== "reviewed" || !referencesValid
    || !Number.isSafeInteger(gate?.preparedAt) || gate.preparedAt < 1) {
    throw Object.assign(new Error("Restored snapshot is quarantined. Prepare an offline recovery copy with scripts/prepare-db-restore.mjs after privacy and credential review before serving traffic."), {
      code: "DATABASE_RESTORE_REVIEW_REQUIRED",
    });
  }
}

export function assertDatabaseRecoveryPathReady(path) {
  if (!existsSync(path)) return;
  const database = new DatabaseSync(path, { readOnly: true });
  try { assertDatabaseRecoveryReady(database); } finally { database.close(); }
}

// Only call this on the newly-created snapshot, NEVER on the running database.
// Its safety marker is copied to R2 with the DB, and is checked before migrations.
export function fenceBackupSnapshot(database, at = Date.now()) {
  database.prepare("INSERT INTO app_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(RESTORE_GATE_KEY, JSON.stringify({ version: 1, state: "snapshot", snapshotAt: at }));
}

function reviewReference(value, name) {
  const reference = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/.test(reference)) {
    throw new Error(`${name} requires a non-secret incident/review reference (3–160 characters).`);
  }
  return reference;
}

// Offline recovery only: approval references assert that the operator has
// replayed deletions/consent/restrictions and reconciled credential changes.
// They are NOT an automated proof that a missing external journal exists.
export function prepareRecoveryDatabase(database, { privacyReplayReference, credentialReviewReference, at = Date.now() } = {}) {
  const privacy = reviewReference(privacyReplayReference, "Privacy replay");
  const credentials = reviewReference(credentialReviewReference, "Credential review");
  if (!Number.isSafeInteger(at) || at < 1) throw new Error("A valid recovery timestamp is required.");
  const present = tables(database);
  if (!present.has("users") || !present.has("app_meta")) throw new Error("This is not a supported Mshpit recovery database.");
  const columns = new Set(database.prepare("PRAGMA table_info(users)").all().map((column) => column.name));
  const nulled = ["reset_hash", "email_verify_hash", "signup_cancel_hash"].filter((column) => columns.has(column));
  const expired = ["reset_expires", "email_verify_expires"].filter((column) => columns.has(column));
  const changes = {};
  database.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
  try {
    for (const table of ["linked_account_session_grants", "email_verification_receipts", "sessions"]) {
      if (present.has(table)) changes[table] = database.prepare(`DELETE FROM ${table}`).run().changes;
    }
    // Guest reservations have no session to cascade from. Remove their pending
    // confirmation/cancellation capabilities and staged password data; retain
    // terminal outcomes, which cannot create an account.
    if (present.has("signup_reservations")) {
      changes.signupReservations = database.prepare("DELETE FROM signup_reservations WHERE status='pending'").run().changes;
    }
    // A snapshot can predate API revocation too. Invalidate every restored
    // audience even when its runtime flag is off, and retain grant/receipt and
    // append-only audit history. Historical snapshots may lack these tables.
    if (present.has("media_api_grants")) {
      changes.mediaApiGrants = database.prepare(`UPDATE media_api_grants
        SET status='revoked',token_hash=NULL,revoked_at=?,updated_at=?
        WHERE status='active'`).run(at, at).changes;
    }
    if (present.has("api_grants")) {
      changes.apiGrants = database.prepare(`UPDATE api_grants SET status='revoked',revoked_at=?
        WHERE status='active'`).run(at).changes;
    }
    if (present.has("media_api_pairings")) {
      changes.mediaApiPairings = database.prepare("UPDATE media_api_pairings SET status='revoked' WHERE status='pending'").run().changes;
    }
    // A restore can resurrect links that were already decided after the
    // snapshot. Retain request/receipt history but require fresh approval.
    if (present.has("owner_approval_requests")) {
      changes.ownerApprovalRequests = database.prepare(`UPDATE owner_approval_requests SET token_hash=NULL,
        decided_at=CASE WHEN status='pending' THEN ? ELSE decided_at END,
        status=CASE WHEN status='pending' THEN 'expired' ELSE status END
        WHERE status='pending' OR token_hash IS NOT NULL`).run(at).changes;
    }
    const assignments = [...nulled.map((column) => `${column}=NULL`), ...expired.map((column) => `${column}=0`)];
    if (assignments.length) changes.invalidatedUserTokens = database.prepare(`UPDATE users SET ${assignments.join(",")}`).run().changes;
    // Queued mail can contain old recovery links or notifications about erased
    // content. Do not send a restored queue; reviewed jobs can recreate it.
    if (present.has("email_queue")) changes.email_queue = database.prepare("DELETE FROM email_queue").run().changes;
    database.prepare("INSERT INTO app_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(RESTORE_GATE_KEY, JSON.stringify({ version: 1, state: "reviewed", preparedAt: at,
        privacyReplayReference: privacy, credentialReviewReference: credentials }));
    if (database.prepare("PRAGMA foreign_key_check").get()) throw new Error("Recovery preparation failed foreign-key verification.");
    if (Object.values(database.prepare("PRAGMA integrity_check").get())[0] !== "ok") throw new Error("Recovery preparation failed database integrity verification.");
    database.exec("COMMIT");
    return changes;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
