import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { prepareRecoveryDatabase, fenceBackupSnapshot, assertDatabaseRecoveryReady } from "./databaseRecovery.js";
import { createMediaApiService } from "./features/mediaApi/mediaApiService.js";

const at = 1_800_000_000_000;
const reviews = { privacyReplayReference: "synthetic-restore/privacy", credentialReviewReference: "synthetic-restore/auth", at };
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE app_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE users (id TEXT PRIMARY KEY,role TEXT,email_verified_at INTEGER,is_banned INTEGER,suspended_until INTEGER);
    INSERT INTO users VALUES ('editor','editor',1,0,NULL);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id));
    INSERT INTO sessions VALUES ('old-session','editor');
    CREATE TABLE email_queue (id TEXT); INSERT INTO email_queue VALUES ('old-mail');
    CREATE TABLE retained_content (id TEXT PRIMARY KEY); INSERT INTO retained_content VALUES ('keep-content');`);
  const api = createMediaApiService({ database: db, env: { PIT_MEDIA_API_ENABLED: "true" }, now: () => at });
  const issue = () => api.issuePairing({ ownerId: "editor", actorType: "assistant", actorLabel: "Synthetic fixture",
    scopes: ["news:write", "media:write"] });
  fenceBackupSnapshot(db, at - 1000);
  return { db, api, issue };
}

test("restore invalidates independent media grants and pending pairings while preserving immutable history", t => {
  const { db, api, issue } = fixture(t);
  const consumed = issue(), grant = api.exchangePairing({ pairingCode: consumed.pairingCode });
  const pending = issue();
  const authorization = `Bearer ${grant.accessToken}`;
  assert.equal(api.authorize(authorization, "news:write").id, grant.grantId);
  db.prepare(`INSERT INTO media_api_idempotency VALUES (?,?,?,?,'completed',?,?,?,?)`)
    .run(grant.grantId, "news.create", "synthetic-request", "synthetic-digest", '{"draft":"retained"}', at, at, at + 60_000);
  const audit = db.prepare("SELECT * FROM media_api_audit ORDER BY id").all();
  const receipt = db.prepare("SELECT * FROM media_api_idempotency").all();
  const consumedBefore = db.prepare("SELECT * FROM media_api_pairings WHERE id=?").get(consumed.pairingId);
  const changes = prepareRecoveryDatabase(db, reviews);
  assert.throws(() => api.authorize(authorization, "news:write"), { code: "AUTH_INVALID" });
  assert.throws(() => api.authorize(authorization, "media:write"), { code: "AUTH_INVALID" });
  assert.throws(() => api.exchangePairing({ pairingCode: pending.pairingCode }), { code: "AUTH_INVALID" });
  assert.equal(changes.mediaApiGrants, 1);
  assert.equal(changes.mediaApiPairings, 1);
  assert.deepEqual({ ...db.prepare("SELECT status,token_hash,revoked_at,updated_at FROM media_api_grants WHERE id=?").get(grant.grantId) },
    { status: "revoked", token_hash: null, revoked_at: at, updated_at: at });
  assert.equal(db.prepare("SELECT status FROM media_api_pairings WHERE id=?").get(pending.pairingId).status, "revoked");
  assert.deepEqual(db.prepare("SELECT * FROM media_api_pairings WHERE id=?").get(consumed.pairingId), consumedBefore);
  assert.deepEqual(db.prepare("SELECT * FROM media_api_audit ORDER BY id").all(), audit);
  assert.deepEqual(db.prepare("SELECT * FROM media_api_idempotency").all(), receipt);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM retained_content").get().n, 1);
  assert.doesNotThrow(() => assertDatabaseRecoveryReady(db));
  const beforeRetry = db.prepare("SELECT * FROM media_api_grants").all();
  const repeated = prepareRecoveryDatabase(db, { ...reviews, at: at + 1000 });
  assert.equal(repeated.mediaApiGrants, 0); assert.equal(repeated.mediaApiPairings, 0);
  assert.deepEqual(db.prepare("SELECT * FROM media_api_grants").all(), beforeRetry);
});

test("a restored pending pairing cannot create a fresh seven-day grant", t => {
  const { db, api, issue } = fixture(t);
  const pending = issue();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM media_api_grants").get().n, 0);
  prepareRecoveryDatabase(db, reviews);
  assert.throws(() => api.exchangePairing({ pairingCode: pending.pairingCode }), { code: "AUTH_INVALID" });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM media_api_grants").get().n, 0);
});

test("failed grant invalidation rolls back prior session cleanup and never approves recovery", t => {
  const { db, api, issue } = fixture(t);
  const grant = api.exchangePairing({ pairingCode: issue().pairingCode });
  db.exec("CREATE TRIGGER fail_grant_restore BEFORE UPDATE ON media_api_grants BEGIN SELECT RAISE(ABORT,'synthetic grant revocation failure'); END;");
  assert.throws(() => prepareRecoveryDatabase(db, reviews), /synthetic grant revocation failure/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM email_queue").get().n, 1);
  assert.equal(api.authorize(`Bearer ${grant.accessToken}`, "news:write").id, grant.grantId);
  assert.equal(db.isTransaction, false);
  assert.throws(() => assertDatabaseRecoveryReady(db), { code: "DATABASE_RESTORE_REVIEW_REQUIRED" });
});

test("restore removes residual token hashes but preserves terminal grant and pairing history", t => {
  const { db, api, issue } = fixture(t);
  const expired = api.exchangePairing({ pairingCode: issue().pairingCode });
  const revoked = api.exchangePairing({ pairingCode: issue().pairingCode });
  db.prepare("UPDATE media_api_grants SET status='expired',updated_at=? WHERE id=?").run(at - 3000, expired.grantId);
  db.prepare("UPDATE media_api_grants SET status='revoked',revoked_at=?,updated_at=? WHERE id=?")
    .run(at - 2000, at - 2000, revoked.grantId);
  const pending = issue();
  db.prepare("UPDATE media_api_pairings SET status='expired' WHERE id=?").run(pending.pairingId);
  const pairings = db.prepare("SELECT * FROM media_api_pairings ORDER BY id").all();
  const changes = prepareRecoveryDatabase(db, reviews);
  assert.equal(changes.mediaApiGrants, 2);
  assert.equal(changes.mediaApiPairings, 0);
  for (const [id, status, revokedAt] of [[expired.grantId, "expired", null], [revoked.grantId, "revoked", at - 2000]]) {
    const row = db.prepare("SELECT * FROM media_api_grants WHERE id=?").get(id);
    assert.equal(row.status, status); assert.equal(row.revoked_at, revokedAt); assert.equal(row.token_hash, null);
  }
  assert.deepEqual(db.prepare("SELECT * FROM media_api_pairings ORDER BY id").all(), pairings);
});

test("a later recovery failure atomically rolls back media revocation and keeps the snapshot fenced", t => {
  const { db, api, issue } = fixture(t);
  const grant = api.exchangePairing({ pairingCode: issue().pairingCode }), pending = issue();
  const grants = db.prepare("SELECT * FROM media_api_grants").all();
  const pairings = db.prepare("SELECT * FROM media_api_pairings ORDER BY id").all();
  db.exec("CREATE TRIGGER fail_restore_mail BEFORE DELETE ON email_queue BEGIN SELECT RAISE(ABORT,'synthetic restore failure'); END;");
  assert.throws(() => prepareRecoveryDatabase(db, reviews), /synthetic restore failure/);
  assert.deepEqual(db.prepare("SELECT * FROM media_api_grants").all(), grants);
  assert.deepEqual(db.prepare("SELECT * FROM media_api_pairings ORDER BY id").all(), pairings);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions").get().n, 1);
  assert.equal(api.authorize(`Bearer ${grant.accessToken}`, "news:write").id, grant.grantId);
  assert.equal(db.prepare("SELECT status FROM media_api_pairings WHERE id=?").get(pending.pairingId).status, "pending");
  assert.equal(db.isTransaction, false);
  assert.throws(() => assertDatabaseRecoveryReady(db), { code: "DATABASE_RESTORE_REVIEW_REQUIRED" });
});

test("legacy recovery without media API tables remains supported", t => {
  const { db } = fixture(t);
  db.exec("DROP TABLE media_api_idempotency; DROP TABLE media_api_grants; DROP TABLE media_api_pairings;");
  const changes = prepareRecoveryDatabase(db, reviews);
  assert.equal(changes.sessions, 1);
  assert.equal(changes.mediaApiGrants, undefined); assert.equal(changes.mediaApiPairings, undefined);
  assert.doesNotThrow(() => assertDatabaseRecoveryReady(db));
});
