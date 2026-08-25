import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, afterEach } from "node:test";
import { DatabaseSync } from "node:sqlite";

const applicationDataDir = mkdtempSync(join(tmpdir(), "pit-owner-approval-import-"));
process.env.PIT_DATA_DIR = applicationDataDir;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;

const {
  createOwnerApprovalRequest,
  decideOwnerApproval,
  ownerApprovalReview,
  ownerIdentityDeliveryScope,
  recordAndEmailDeploymentStamp,
} = await import("./ownerApprovals.js");
const { db: applicationDb } = await import("./db.js");

const databases = new Set();

function database() {
  const value = new DatabaseSync(":memory:");
  databases.add(value);
  value.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE
    );
    CREATE TABLE app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE owner_approval_requests (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_by TEXT,
      target_user_id TEXT,
      safe_summary TEXT NOT NULL,
      payload TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      token_hash TEXT UNIQUE,
      requested_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      decided_at INTEGER,
      decided_by TEXT,
      receipt_id TEXT,
      request_id TEXT
    );
    CREATE TABLE owner_approval_receipts (
      id TEXT PRIMARY KEY,
      request_id TEXT,
      kind TEXT NOT NULL,
      decision TEXT NOT NULL,
      requested_by TEXT,
      decided_by TEXT,
      target_user_id TEXT,
      safe_summary TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      previous_stamp TEXT NOT NULL,
      stamp TEXT NOT NULL UNIQUE,
      release_commit TEXT,
      requested_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX owner_receipt_request_unique
      ON owner_approval_receipts(request_id) WHERE request_id IS NOT NULL;
    CREATE TRIGGER owner_receipt_no_update BEFORE UPDATE ON owner_approval_receipts
    BEGIN SELECT RAISE(ABORT, 'append-only'); END;
    CREATE TRIGGER owner_receipt_no_delete BEFORE DELETE ON owner_approval_receipts
    BEGIN SELECT RAISE(ABORT, 'append-only'); END;
  `);
  return value;
}

afterEach(() => {
  for (const value of databases) value.close();
  databases.clear();
});

after(() => {
  applicationDb.close();
  rmSync(applicationDataDir, { recursive: true, force: true });
});

function roleInput(overrides = {}) {
  return {
    kind: "privileged_role_change",
    requestedBy: "admin_requester",
    targetUserId: "member_target",
    summary: "Privileged role change awaiting Owner review",
    payload: {
      expectedRole: "fan",
      expectedHandle: "listener",
      requestedRole: "moderator",
      requestedHandle: "listener_mod",
    },
    requestId: "http_request_1",
    at: 1_000,
    ...overrides,
  };
}

test("approval tokens are one-time bearer secrets and only their digest is stored", () => {
  const db = database();
  const created = createOwnerApprovalRequest(db, roleInput());
  assert.match(created.token, /^[A-Za-z0-9_-]{40,}$/u);
  const stored = db.prepare("SELECT token_hash,payload,payload_hash FROM owner_approval_requests WHERE id=?")
    .get(created.request.id);
  assert.notEqual(stored.token_hash, created.token);
  assert.equal(stored.payload.includes(created.token), false);
  assert.equal(ownerApprovalReview(db, created.token, { at: 1_001 }).request.id, created.request.id);

  let applied = 0;
  const decided = decideOwnerApproval(db, {
    token: created.token,
    ownerId: "locked_owner",
    decision: "approved",
    at: 1_002,
    applyApprovedAction: () => { applied += 1; return { changed: true }; },
  });
  assert.equal(decided.ok, true);
  assert.equal(decided.receipt.decision, "approved");
  assert.equal(applied, 1);
  assert.equal(db.prepare("SELECT token_hash FROM owner_approval_requests WHERE id=?").get(created.request.id).token_hash, null);

  const replay = decideOwnerApproval(db, {
    token: created.token,
    ownerId: "locked_owner",
    decision: "approved",
    at: 1_003,
    applyApprovedAction: () => { applied += 1; },
  });
  assert.deepEqual(replay, { ok: false, reason: "invalid-or-expired" });
  assert.equal(applied, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM owner_approval_receipts").get().count, 1);
});

test("rejection records a chained receipt without applying the protected action", () => {
  const db = database();
  const first = createOwnerApprovalRequest(db, roleInput());
  const firstResult = decideOwnerApproval(db, {
    token: first.token,
    ownerId: "locked_owner",
    decision: "rejected",
    at: 1_100,
    applyApprovedAction: () => assert.fail("rejection must not apply"),
  });
  assert.equal(firstResult.ok, true);
  assert.equal(firstResult.receipt.previousStamp, "0".repeat(64));

  const second = createOwnerApprovalRequest(db, roleInput({
    targetUserId: "member_two",
    requestId: "http_request_2",
    at: 1_200,
  }));
  const secondResult = decideOwnerApproval(db, {
    token: second.token,
    ownerId: "locked_owner",
    decision: "rejected",
    at: 1_201,
  });
  assert.equal(secondResult.receipt.previousStamp, firstResult.receipt.stamp);
  assert.notEqual(secondResult.receipt.stamp, firstResult.receipt.stamp);
  assert.throws(() => db.prepare("UPDATE owner_approval_receipts SET safe_summary='changed'").run(), /append-only/u);
  assert.throws(() => db.prepare("DELETE FROM owner_approval_receipts").run(), /append-only/u);
});

test("new requests supersede obsolete target state and expired links fail closed", () => {
  const db = database();
  const first = createOwnerApprovalRequest(db, roleInput());
  const replacement = createOwnerApprovalRequest(db, roleInput({
    payload: { ...roleInput().payload, requestedRole: "admin", requestedHandle: "listener_admin" },
    at: 2_000,
  }));
  assert.equal(db.prepare("SELECT status FROM owner_approval_requests WHERE id=?").get(first.request.id).status, "superseded");
  assert.equal(ownerApprovalReview(db, first.token, { at: 2_001 }), null);
  assert.equal(ownerApprovalReview(db, replacement.token, { at: replacement.request.expiresAt }), null);
  assert.deepEqual(decideOwnerApproval(db, {
    token: replacement.token,
    ownerId: "locked_owner",
    decision: "approved",
    at: replacement.request.expiresAt,
  }), { ok: false, reason: "invalid-or-expired" });
});

test("payload tampering cannot be approved and rolls back every side effect", () => {
  const db = database();
  const created = createOwnerApprovalRequest(db, roleInput());
  db.prepare("UPDATE owner_approval_requests SET payload=? WHERE id=?")
    .run(JSON.stringify({ requestedRole: "admin" }), created.request.id);
  let applied = false;
  const result = decideOwnerApproval(db, {
    token: created.token,
    ownerId: "locked_owner",
    decision: "approved",
    at: 1_100,
    applyApprovedAction: () => { applied = true; },
  });
  assert.deepEqual(result, { ok: false, reason: "payload-mismatch" });
  assert.equal(applied, false);
  assert.equal(db.prepare("SELECT status FROM owner_approval_requests WHERE id=?").get(created.request.id).status, "pending");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM owner_approval_receipts").get().count, 0);
});

test("a v1 deployment claim cannot suppress the same commit receipt for the locked v2 Founder", async () => {
  const db = database();
  const commit = "abcdef0123456789abcdef0123456789abcdef01";
  assert.notEqual(
    ownerIdentityDeliveryScope({ version: 1, userId: "same_owner_row" }),
    ownerIdentityDeliveryScope({ version: 2, userId: "same_owner_row" }),
  );
  db.prepare("INSERT INTO users (id,email) VALUES (?,?),(?,?)")
    .run("legacy_owner", "legacy-owner@example.test", "founder_owner", "founder@example.test");
  db.prepare("INSERT INTO app_meta (key,value) VALUES (?,?)").run(
    "security.bootstrap_admin_identity.v1",
    JSON.stringify({ version: 1, email: "legacy-owner@example.test", userId: "legacy_owner" }),
  );

  const deliveries = [];
  const sendTemplateImpl = async (key, options) => {
    deliveries.push({ key, ...options });
    return { sent: true };
  };
  const legacy = await recordAndEmailDeploymentStamp(db, {
    commit,
    at: 1_000,
    sendTemplateImpl,
  });

  db.prepare("UPDATE app_meta SET value=? WHERE key=?").run(
    JSON.stringify({
      version: 2,
      email: "founder@example.test",
      userId: "founder_owner",
      lockedAt: 2_000,
    }),
    "security.bootstrap_admin_identity.v1",
  );
  const founder = await recordAndEmailDeploymentStamp(db, {
    commit,
    at: 2_001,
    sendTemplateImpl,
  });
  const duplicate = await recordAndEmailDeploymentStamp(db, {
    commit,
    at: 2_002,
    sendTemplateImpl,
  });

  assert.equal(legacy.created, true);
  assert.equal(founder.created, true);
  assert.equal(duplicate.created, false);
  assert.deepEqual(deliveries.map((delivery) => delivery.to), [
    "legacy-owner@example.test",
    "founder@example.test",
  ]);
  assert.equal(new Set(deliveries.map((delivery) => delivery.idempotencyKey)).size, 2);
  const receipts = db.prepare("SELECT * FROM owner_approval_receipts ORDER BY created_at,id").all();
  assert.equal(receipts.length, 2);
  assert.equal(receipts[1].previous_stamp, receipts[0].stamp);
  assert.notEqual(receipts[0].request_id, receipts[1].request_id);
  assert.equal(receipts.every((receipt) => !receipt.request_id.includes("@")), true);
  assert.throws(() => db.prepare("UPDATE owner_approval_receipts SET safe_summary='changed'").run(), /append-only/u);
});
