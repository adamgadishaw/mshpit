import { randomUUID } from "node:crypto";
import { withImmediateWrite } from "../../databaseTransaction.js";
import { ApiError } from "../../errors.js";
import { CATALOG_KNOWLEDGE_KEY, readCatalogKnowledgeControl } from "../../catalogKnowledgeControl.js";
import { payloadDigest } from "../mediaApi/mediaApiPolicy.js";
import { CATALOG_LIMITS, catalogConflict } from "../catalogApi/catalogApiPolicy.js";

const DAY = 86_400_000;
const day = at => new Date(at).toISOString().slice(0, 10);
export function ensureCatalogWorkSchema(database) {
  return withImmediateWrite(database, () => {
  database.exec(`CREATE TABLE IF NOT EXISTS catalog_work_control (
    singleton INTEGER PRIMARY KEY CHECK(singleton=1), paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)),
    revision INTEGER NOT NULL DEFAULT 0, utc_day TEXT NOT NULL DEFAULT '',
    claims INTEGER NOT NULL DEFAULT 0, commits INTEGER NOT NULL DEFAULT 0);
  INSERT OR IGNORE INTO catalog_work_control(singleton) VALUES (1);
  CREATE TABLE IF NOT EXISTS catalog_work_items (
    entity_type TEXT NOT NULL CHECK(entity_type IN ('artist','venue','event')),
    entity_key TEXT NOT NULL CHECK(length(entity_key) BETWEEN 1 AND 600),
    field_group TEXT NOT NULL DEFAULT 'research' CHECK(field_group='research'),
    status TEXT NOT NULL CHECK(status IN ('leased','proposed','completed','failed','quarantined')),
    worker TEXT NOT NULL CHECK(worker IN ('assistant','claude')),
    grant_id TEXT, actor_label TEXT NOT NULL, authorization_hash TEXT,
    nonce TEXT NOT NULL, lease_until INTEGER NOT NULL, claimed_at INTEGER NOT NULL,
    base_revision INTEGER NOT NULL, base_hash TEXT NOT NULL, identity_hash TEXT NOT NULL,
    control_stamp TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 1,
    next_attempt_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
    PRIMARY KEY(entity_type,entity_key,field_group));
  CREATE INDEX IF NOT EXISTS idx_catalog_work_leases ON catalog_work_items(status,lease_until);
  CREATE TABLE IF NOT EXISTS catalog_entity_versions (
    entity_type TEXT NOT NULL,entity_key TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(entity_type,entity_key));
  CREATE TABLE IF NOT EXISTS catalog_proposals (
    id TEXT PRIMARY KEY,entity_type TEXT NOT NULL,entity_key TEXT NOT NULL,grant_id TEXT NOT NULL,
    claim_nonce TEXT NOT NULL,base_revision INTEGER NOT NULL,base_hash TEXT NOT NULL,identity_hash TEXT NOT NULL,
    patch_json TEXT NOT NULL CHECK(length(patch_json)<=20000),
    evidence_json TEXT NOT NULL CHECK(length(evidence_json)<=20000),
    payload_hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','committed')),
    reviewed_by TEXT,reviewed_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_catalog_proposals_grant ON catalog_proposals(grant_id,created_at,id);
  CREATE TABLE IF NOT EXISTS catalog_event_enrichment (
    event_id TEXT PRIMARY KEY,findings TEXT NOT NULL CHECK(length(findings)<=20000),updated_at INTEGER NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0 CHECK(hidden IN (0,1)));
  CREATE TABLE IF NOT EXISTS catalog_api_receipts (
    grant_id TEXT NOT NULL,operation TEXT NOT NULL,idempotency_key TEXT NOT NULL,payload_hash TEXT NOT NULL,
    response_json TEXT NOT NULL CHECK(length(response_json)<=32768),created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
    PRIMARY KEY(grant_id,operation,idempotency_key));
  CREATE INDEX IF NOT EXISTS idx_catalog_receipts_expiry ON catalog_api_receipts(expires_at);
  CREATE TABLE IF NOT EXISTS catalog_work_audit (
    id TEXT PRIMARY KEY,actor_type TEXT NOT NULL CHECK(actor_type IN ('owner','assistant','claude')),
    actor_label TEXT NOT NULL,grant_id TEXT,action TEXT NOT NULL,entity_type TEXT,entity_key TEXT,
    proposal_id TEXT,prior_hash TEXT,next_hash TEXT,created_at INTEGER NOT NULL);
  CREATE TRIGGER IF NOT EXISTS catalog_work_audit_no_update BEFORE UPDATE ON catalog_work_audit
    BEGIN SELECT RAISE(ABORT,'catalog audit is append-only'); END;
  CREATE TRIGGER IF NOT EXISTS catalog_work_audit_no_delete BEFORE DELETE ON catalog_work_audit
    BEGIN SELECT RAISE(ABORT,'catalog audit is append-only'); END;`);
  if (database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='app_meta'").get()) {
    // The legacy control has millisecond timestamps rather than a generation.
    // Fence even same-tick pause/resume and delete/recreate. Ordinary budget
    // reservations do not change mode, so they do not disturb research leases.
    database.exec(`CREATE TRIGGER IF NOT EXISTS catalog_legacy_control_insert AFTER INSERT ON app_meta
      WHEN NEW.key='${CATALOG_KNOWLEDGE_KEY}' BEGIN
        UPDATE catalog_work_control SET revision=revision+1 WHERE singleton=1; END;
      CREATE TRIGGER IF NOT EXISTS catalog_legacy_control_delete AFTER DELETE ON app_meta
      WHEN OLD.key='${CATALOG_KNOWLEDGE_KEY}' BEGIN
        UPDATE catalog_work_control SET revision=revision+1 WHERE singleton=1; END;
      CREATE TRIGGER IF NOT EXISTS catalog_legacy_control_change AFTER UPDATE OF value ON app_meta
      WHEN NEW.key='${CATALOG_KNOWLEDGE_KEY}' AND
        (CASE WHEN json_valid(OLD.value) THEN json_extract(OLD.value,'$.mode') END)
        IS NOT (CASE WHEN json_valid(NEW.value) THEN json_extract(NEW.value,'$.mode') END)
      BEGIN UPDATE catalog_work_control SET revision=revision+1 WHERE singleton=1; END;`);
  }
  });
}
export function catalogControl(database) {
  const control = database.prepare("SELECT * FROM catalog_work_control WHERE singleton=1").get();
  const raw = database.prepare("SELECT value FROM app_meta WHERE key=?").get(CATALOG_KNOWLEDGE_KEY)?.value;
  const legacy = raw == null ? null : readCatalogKnowledgeControl(database, { env: {} });
  return { ...control, paused: !control || !!control.paused || legacy?.mode === "paused"
      || (raw != null && !legacy),
    stamp: payloadDigest([control?.revision, legacy?.mode || null, legacy?.updatedAt || null]) };
}
export function assertCatalogRunning(database) {
  const control = catalogControl(database);
  if (control.paused) throw new ApiError(409, "Catalog work is paused.", "CONFLICT");
  return control;
}
export function catalogAudit(database, { actorType, actorLabel, grantId = null, action, type = null, key = null,
  proposalId = null, priorHash = null, nextHash = null, at, disablingControl = false }) {
  // Exhaustion must not retain a grant or prevent the owner from stopping work.
  // Callers permit this exception only for an actual disabling transition;
  // repeated controls are no-ops and enabling transitions still obey the cap.
  const canDisable = disablingControl && actorType === "owner" && ["paused", "revoked"].includes(action);
  if (!canDisable && database.prepare("SELECT COUNT(*) n FROM catalog_work_audit").get().n >= CATALOG_LIMITS.auditRows) {
    throw new ApiError(429, "Catalog audit capacity needs review.", "RATE_LIMITED");
  }
  database.prepare(`INSERT INTO catalog_work_audit
    (id,actor_type,actor_label,grant_id,action,entity_type,entity_key,proposal_id,prior_hash,next_hash,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(randomUUID(), actorType, actorLabel, grantId, action, type, key, proposalId, priorHash, nextHash, at);
}
export function catalogRevision(database, type, key) {
  return database.prepare("SELECT revision FROM catalog_entity_versions WHERE entity_type=? AND entity_key=?").get(type, key)?.revision || 0;
}
export function bumpCatalogRevision(database, type, key) {
  database.prepare(`INSERT INTO catalog_entity_versions(entity_type,entity_key,revision) VALUES (?,?,1)
    ON CONFLICT(entity_type,entity_key) DO UPDATE SET revision=revision+1`).run(type, key);
  return catalogRevision(database, type, key);
}
function reserveDaily(database, kind, at) {
  const cap = kind === "claims" ? CATALOG_LIMITS.dailyClaims : CATALOG_LIMITS.dailyCommits;
  const current = day(at);
  database.prepare("UPDATE catalog_work_control SET utc_day=?,claims=0,commits=0 WHERE singleton=1 AND utc_day<?").run(current, current);
  if (!database.prepare(`UPDATE catalog_work_control SET ${kind}=${kind}+1 WHERE singleton=1 AND ${kind}<?`).run(cap).changes) {
    throw new ApiError(429, "The catalog work allowance is used for today.", "RATE_LIMITED");
  }
}
export function claimCatalogWork(database, { snapshot, worker, grantId = null, actorLabel, authorizationHash = null, at }) {
  return withImmediateWrite(database, () => {
    const control = assertCatalogRunning(database);
    if (!snapshot?.eligible) throw catalogConflict();
    const { type, key, revision, valueHash, identityHash } = snapshot;
    // An upgrade can inherit an in-flight pre-queue Claude reservation. Keep
    // its original lease even though it has no shared work row yet. Older
    // binaries cannot enforce this fence; deployments must drain old writers.
    if (type !== "event" && database.prepare(`SELECT 1 FROM catalog_research WHERE entity_type=? AND entity_key=?
      AND status='leased' AND next_attempt_at>?`).get(type, key, at)) throw catalogConflict();
    const previous = database.prepare("SELECT * FROM catalog_work_items WHERE entity_type=? AND entity_key=?").get(type, key);
    if (previous && (previous.status === "quarantined" || previous.next_attempt_at > at
      || (["leased","proposed"].includes(previous.status) && previous.lease_until > at))) throw catalogConflict();
    if (database.prepare("SELECT COUNT(*) n FROM catalog_work_items WHERE status IN ('leased','proposed') AND lease_until>?").get(at).n >= CATALOG_LIMITS.active) {
      throw new ApiError(429, "The catalog workers are occupied.", "RATE_LIMITED");
    }
    database.prepare("DELETE FROM catalog_work_items WHERE rowid IN (SELECT rowid FROM catalog_work_items WHERE status IN ('completed','failed') AND updated_at<? LIMIT 100)")
      .run(at - 30 * DAY);
    if (!previous && database.prepare("SELECT COUNT(*) n FROM catalog_work_items").get().n >= CATALOG_LIMITS.workRows) {
      throw new ApiError(429, "The catalog queue needs review.", "RATE_LIMITED");
    }
    reserveDaily(database, "claims", at);
    const nonce = randomUUID(), leaseUntil = at + CATALOG_LIMITS.leaseMs;
    database.prepare(`INSERT INTO catalog_work_items
      (entity_type,entity_key,status,worker,grant_id,actor_label,authorization_hash,nonce,lease_until,claimed_at,base_revision,base_hash,identity_hash,control_stamp,updated_at)
      VALUES (?,?,'leased',?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(entity_type,entity_key,field_group) DO UPDATE SET status='leased',worker=excluded.worker,grant_id=excluded.grant_id,
      actor_label=excluded.actor_label,authorization_hash=excluded.authorization_hash,nonce=excluded.nonce,lease_until=excluded.lease_until,claimed_at=excluded.claimed_at,
      base_revision=excluded.base_revision,base_hash=excluded.base_hash,identity_hash=excluded.identity_hash,
      control_stamp=excluded.control_stamp,attempts=catalog_work_items.attempts+1,next_attempt_at=0,updated_at=excluded.updated_at`)
      .run(type, key, worker, grantId, actorLabel, authorizationHash, nonce, leaseUntil, at, revision, valueHash, identityHash, control.stamp, at);
    catalogAudit(database, { actorType: worker, actorLabel, grantId, action: "claimed", type, key, at });
    return { type, key, fieldGroup: "research", nonce, leaseUntil, revision, valueHash, identityHash };
  });
}
export function assertCatalogClaim(database, { type, key, nonce, grantId = null, worker, authorizationHash = null, snapshot, at }) {
  const control = assertCatalogRunning(database);
  const row = database.prepare("SELECT * FROM catalog_work_items WHERE entity_type=? AND entity_key=?").get(type, key);
  if (!row || !["leased","proposed"].includes(row.status) || row.nonce !== nonce || row.lease_until <= at
    || row.grant_id !== grantId || row.worker !== worker || row.control_stamp !== control.stamp || row.authorization_hash !== authorizationHash
    || !snapshot || !snapshot.eligible || snapshot.revision !== row.base_revision
    || snapshot.valueHash !== row.base_hash || snapshot.identityHash !== row.identity_hash) throw catalogConflict();
  return row;
}
export function finishCatalogWork(database, { type, key, nonce, status = "completed", committed = true, at, nextAttemptAt = at }) {
  if (status === "completed" && committed) reserveDaily(database, "commits", at);
  if (!database.prepare(`UPDATE catalog_work_items SET status=?,lease_until=0,next_attempt_at=?,updated_at=?
    WHERE entity_type=? AND entity_key=? AND nonce=? AND status IN ('leased','proposed') AND lease_until>?`)
    .run(status, nextAttemptAt, at, type, key, nonce, at).changes) throw catalogConflict();
}
export function pauseCatalogWork(database, { paused, expectedRevision, actorId, at }) {
  return withImmediateWrite(database, () => {
    const current = database.prepare("SELECT * FROM catalog_work_control WHERE singleton=1").get();
    if (typeof paused !== "boolean" || expectedRevision !== current.revision) throw catalogConflict();
    if (paused === !!current.paused) return { paused, revision: current.revision };
    database.prepare("UPDATE catalog_work_control SET paused=?,revision=revision+1 WHERE singleton=1").run(paused ? 1 : 0);
    catalogAudit(database, { actorType: "owner", actorLabel: "owner", action: paused ? "paused" : "resumed",
      priorHash: payloadDigest(current.revision), nextHash: payloadDigest([actorId, current.revision + 1]), at, disablingControl: paused });
    return { paused, revision: current.revision + 1 };
  });
}
