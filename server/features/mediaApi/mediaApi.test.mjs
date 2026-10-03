import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { ApiError } from "../../errors.js";
import { createMediaApiService } from "./mediaApiService.js";
import { ensureMediaApiSchema } from "./mediaApiPolicy.js";

const at = 1_700_000_000_000;

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      email_verified_at INTEGER,
      is_banned INTEGER NOT NULL DEFAULT 0,
      suspended_until INTEGER,
      dormant_at INTEGER
    );
    CREATE TABLE news_drafts (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      origin TEXT NOT NULL DEFAULT 'generated',
      created_by TEXT,
      story_post_id TEXT,
      created_actor_type TEXT,
      created_actor_label TEXT,
      created_grant_id TEXT,
      revision INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
  `);
  ensureMediaApiSchema(db);
  db.prepare("INSERT INTO users(id,role,email_verified_at) VALUES ('owner_1','admin',?)").run(at - 1);
  return db;
}

function expectApiError(work, code) {
  assert.throws(work, (error) => error instanceof ApiError && error.code === code);
}

function service(db, extra = {}) {
  return createMediaApiService({
    database: db,
    env: { PIT_MEDIA_API_ENABLED: "true" },
    now: () => at,
    ...extra,
  });
}

test("nonce migration preserves existing completed receipts, lease timestamps and grant scopes", () => {
  const db = database();
  db.exec("ALTER TABLE media_api_idempotency DROP COLUMN lease_nonce");
  db.prepare(`INSERT INTO media_api_grants
    (id,owner_id,actor_type,actor_label,scopes,status,issued_at,expires_at,updated_at)
    VALUES ('migration_grant','owner_1','assistant','SyntheticMigration','["news:write"]','active',?,?,?)`)
    .run(at, at + 86_400_000, at);
  const insert = db.prepare(`INSERT INTO media_api_idempotency
    (grant_id,operation,idempotency_key,payload_hash,status,response_json,created_at,updated_at,expires_at)
    VALUES ('migration_grant','news.create',?,'synthetic-hash',?,?,?,?,?)`);
  insert.run("legacy-completed", "completed", '{"draft":{"id":"existing"}}', at, at, at + 72 * 3_600_000);
  insert.run("legacy-reserved", "reserved", null, at, at, at + 72 * 3_600_000);
  const before = db.prepare("SELECT * FROM media_api_idempotency ORDER BY idempotency_key").all();
  ensureMediaApiSchema(db);
  ensureMediaApiSchema(db);
  const after = db.prepare("SELECT * FROM media_api_idempotency ORDER BY idempotency_key").all();
  assert.deepEqual(after.map(({ lease_nonce, ...row }) => ({ ...row })), before.map(row => ({ ...row })));
  assert.ok(after.every(row => row.lease_nonce === null));
  assert.equal(db.prepare("SELECT scopes FROM media_api_grants WHERE id='migration_grant'").get().scopes, '["news:write"]');
  db.close();
});

function issue(serviceInstance, scopes = ["news:write", "media:write"]) {
  return serviceInstance.issuePairing({
    ownerId: "owner_1",
    actorType: "assistant",
    actorLabel: "Jeeves",
    scopes,
    requestId: "req_pair_1",
  });
}

test("Media API is disabled unless explicitly activated", () => {
  const db = database();
  const disabled = createMediaApiService({ database: db, env: {}, now: () => at });
  expectApiError(() => disabled.issuePairing({ ownerId: "owner_1", actorType: "assistant", actorLabel: "Jeeves", scopes: ["news:write"] }), "NOT_FOUND");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media_api_pairings").get().n, 0);
});

test("audit migration removes legacy foreign keys without weakening append-only history", () => {
  const legacy = new DatabaseSync(":memory:");
  legacy.exec("PRAGMA foreign_keys=ON; CREATE TABLE users (id TEXT PRIMARY KEY);");
  ensureMediaApiSchema(legacy);
  legacy.exec(`
    DROP TRIGGER media_api_audit_no_update;
    DROP TRIGGER media_api_audit_no_delete;
    DROP TABLE media_api_audit;
    CREATE TABLE media_api_audit (
      id TEXT PRIMARY KEY,
      grant_id TEXT REFERENCES media_api_grants(id) ON DELETE SET NULL,
      owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      actor_type TEXT NOT NULL,
      actor_label TEXT NOT NULL,
      request_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      payload_hash TEXT,
      result TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  legacy.prepare("INSERT INTO users(id) VALUES ('owner_legacy')").run();
  legacy.prepare(`INSERT INTO media_api_grants
    (id,owner_id,actor_type,actor_label,scopes,status,token_hash,issued_at,expires_at,updated_at)
    VALUES ('grant_legacy','owner_legacy','assistant','Jeeves','["news:write"]','active','hash_legacy',1,2,1)`).run();
  legacy.prepare(`INSERT INTO media_api_audit
    (id,grant_id,owner_id,actor_type,actor_label,action,target_type,target_id,result,created_at)
    VALUES ('audit_legacy','grant_legacy','owner_legacy','assistant','Jeeves','news_published','news_post','post_legacy','completed',1)`).run();

  ensureMediaApiSchema(legacy);
  assert.equal(legacy.prepare("PRAGMA foreign_key_list(media_api_audit)").all().length, 0);
  legacy.prepare("DELETE FROM media_api_grants WHERE id='grant_legacy'").run();
  legacy.prepare("DELETE FROM users WHERE id='owner_legacy'").run();
  assert.equal(legacy.prepare("SELECT grant_id,owner_id FROM media_api_audit WHERE id='audit_legacy'").get().grant_id, "grant_legacy");
  assert.throws(() => legacy.prepare("DELETE FROM media_api_audit WHERE id='audit_legacy'").run(), /append-only/);

  legacy.exec(`
    DROP TRIGGER media_api_audit_no_update;
    DROP TRIGGER media_api_audit_no_delete;
    DROP INDEX idx_media_api_audit_created;
    ALTER TABLE media_api_audit RENAME TO media_api_audit_legacy;
    CREATE TABLE media_api_audit (
      id TEXT PRIMARY KEY,
      grant_id TEXT,
      owner_id TEXT,
      actor_type TEXT NOT NULL,
      actor_label TEXT NOT NULL,
      request_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      payload_hash TEXT,
      result TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  ensureMediaApiSchema(legacy);
  assert.equal(legacy.prepare("SELECT COUNT(*) AS n FROM media_api_audit WHERE id='audit_legacy'").get().n, 1);
  assert.equal(legacy.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='media_api_audit_legacy'").get(), undefined);
});

test("pairing is hash-only, single-use, and grants preserve distinct actor identity", () => {
  const db = database();
  const api = service(db);
  const pairing = issue(api);
  const stored = db.prepare("SELECT code_hash FROM media_api_pairings WHERE id=?").get(pairing.pairingId);
  assert.notEqual(stored.code_hash, pairing.pairingCode);
  assert.match(stored.code_hash, /^[a-f0-9]{64}$/u);
  const grant = api.exchangePairing({ pairingCode: pairing.pairingCode, requestId: "req_exchange_1" });
  assert.notEqual(grant.accessToken, pairing.pairingCode);
  assert.deepEqual(grant.actor, { actorType: "assistant", actorLabel: "Jeeves" });
  assert.equal(db.prepare("SELECT actor_type,actor_label FROM media_api_grants WHERE id=?").get(grant.grantId).actor_type, "assistant");
  expectApiError(() => api.exchangePairing({ pairingCode: pairing.pairingCode }), "AUTH_INVALID");
});

test("invalid actor identity is a client validation error", () => {
  const db = database();
  const api = service(db);
  expectApiError(() => api.issuePairing({
    ownerId: "owner_1", actorType: "assistant", actorLabel: "bad\nlabel", scopes: ["news:write"],
  }), "VALIDATION_FAILED");
});

test("grants live for seven days after exchange; expired pairing attempts are recorded", () => {
  const db = database();
  let current = at;
  const api = service(db, { now: () => current });
  const pairing = api.issuePairing({
    ownerId: "owner_1",
    actorType: "assistant",
    actorLabel: "Jeeves",
    scopes: ["news:write"],
    expiresInSeconds: 60,
  });
  const grant = api.exchangePairing({ pairingCode: pairing.pairingCode });
  assert.equal(db.prepare("SELECT expires_at FROM media_api_grants WHERE id=?").get(grant.grantId).expires_at,
    at + 7 * 24 * 60 * 60 * 1000);

  current = at + 60_001;
  assert.equal(api.authorize(`Bearer ${grant.accessToken}`, "news:write").id, grant.grantId);
  current = at + 7 * 24 * 60 * 60 * 1000;
  expectApiError(() => api.authorize(`Bearer ${grant.accessToken}`, "news:write"), "AUTH_INVALID");
  current = at + 60_001;
  expectApiError(() => api.exchangePairing({ pairingCode: pairing.pairingCode }), "AUTH_INVALID");
  assert.deepEqual({
    ...db.prepare("SELECT status,attempts FROM media_api_pairings WHERE id=?").get(pairing.pairingId),
  }, { status: "consumed", attempts: 0 });

  current = at;
  const expired = api.issuePairing({
    ownerId: "owner_1",
    actorType: "assistant",
    actorLabel: "Jeeves",
    scopes: ["news:write"],
    expiresInSeconds: 60,
  });
  current = at + 60_001;
  expectApiError(() => api.exchangePairing({ pairingCode: expired.pairingCode }), "AUTH_INVALID");
  assert.deepEqual({
    ...db.prepare("SELECT status,attempts FROM media_api_pairings WHERE id=?").get(expired.pairingId),
  }, { status: "expired", attempts: 1 });
});

test("expired and revoked grants cannot be reused, and owner role changes fail closed", () => {
  const db = database();
  const api = service(db);
  const grant = api.exchangePairing({ pairingCode: issue(api).pairingCode });
  db.prepare("UPDATE users SET role='fan' WHERE id='owner_1'").run();
  expectApiError(() => api.authorize(`Bearer ${grant.accessToken}`, "news:write"), "FORBIDDEN");
  db.prepare("UPDATE users SET role='admin' WHERE id='owner_1'").run();
  api.revokeGrant({ ownerId: "owner_1", grantId: grant.grantId });
  expectApiError(() => api.authorize(`Bearer ${grant.accessToken}`, "news:write"), "AUTH_INVALID");
});

test("dormant editorial accounts cannot exchange, authorize or replay grants until account reactivation", async t => {
  for (const role of ["admin", "editor"]) await t.test(role, t => {
    const db = database(); t.after(() => db.close());
    db.prepare("UPDATE users SET role=? WHERE id='owner_1'").run(role);
    let creates = 0;
    const api = service(db, { media: { create: () => { creates++; return { asset: { id: "dormancy-fixture", status: "ready" } }; } } });
    const grant = api.exchangePairing({ pairingCode: issue(api).pairingCode });
    const pending = issue(api), authorization = `Bearer ${grant.accessToken}`;
    const request = { authorization, body: { contentType: "image/jpeg" }, idempotencyKey: "dormancy-replay-key" };
    const response = api.createMedia(request);
    db.prepare("UPDATE users SET dormant_at=? WHERE id='owner_1'").run(at);
    for (const scope of ["news:write", "media:write"]) expectApiError(() => api.authorize(authorization, scope), "FORBIDDEN");
    expectApiError(() => api.createMedia(request), "FORBIDDEN");
    expectApiError(() => api.exchangePairing({ pairingCode: pending.pairingCode }), "FORBIDDEN");
    expectApiError(() => issue(api), "FORBIDDEN");
    assert.equal(creates, 1);
    assert.equal(db.prepare("SELECT dormant_at FROM users WHERE id='owner_1'").get().dormant_at, at);
    assert.equal(db.prepare("SELECT status FROM media_api_pairings WHERE id=?").get(pending.pairingId).status, "pending");
    assert.equal(db.prepare("SELECT status FROM media_api_grants WHERE id=?").get(grant.grantId).status, "active");
    // Interactive account reactivation clears dormancy elsewhere; a bearer
    // request never clears it or permanently revokes a still-current grant.
    db.exec("UPDATE users SET dormant_at=NULL WHERE id='owner_1'");
    assert.equal(api.authorize(authorization, "news:write").id, grant.grantId);
    assert.deepEqual(api.createMedia(request), response); assert.equal(creates, 1);
    api.revokeGrant({ ownerId: "owner_1", grantId: grant.grantId });
    expectApiError(() => api.authorize(authorization, "media:write"), "AUTH_INVALID");
  });
});

test("dormancy during asynchronous media preparation fences the durable commit and releases its receipt", async t => {
  const db = database(); t.after(() => db.close());
  let commits = 0;
  const api = service(db, { media: { finalize: async () => {
    await Promise.resolve();
    db.prepare("UPDATE users SET dormant_at=? WHERE id='owner_1'").run(at);
    return { deferredCommit: true, commit: () => { commits++; return { asset: { id: "dormancy-fixture", status: "ready" } }; } };
  } } });
  const grant = api.exchangePairing({ pairingCode: issue(api).pairingCode });
  await assert.rejects(api.finalizeMedia({ authorization: `Bearer ${grant.accessToken}`, assetId: "dormancy-fixture",
    body: {}, idempotencyKey: "dormancy-finalize-key" }), error => error instanceof ApiError && error.code === "FORBIDDEN");
  assert.equal(commits, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM media_api_idempotency").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM media_api_audit WHERE action='media_finalized'").get().n, 0);
});

test("revoking an owner grant cancels all pending owner pairings but preserves other owners and future issuance", () => {
  const db = database();
  db.prepare("INSERT INTO users(id,role,email_verified_at) VALUES ('owner_2','admin',?)").run(at - 1);
  const api = service(db);
  const selected = issue(api);
  const cancelled = issue(api);
  const ownerTwoPairing = api.issuePairing({ ownerId: "owner_2", actorType: "human", actorLabel: "OwnerTwo", scopes: ["news:write"] });
  const selectedGrant = api.exchangePairing({ pairingCode: selected.pairingCode });

  api.revokeGrant({ ownerId: "owner_1", grantId: selectedGrant.grantId, requestId: "revoke-owner-pairings" });
  expectApiError(() => api.exchangePairing({ pairingCode: cancelled.pairingCode }), "AUTH_INVALID");
  assert.equal(db.prepare("SELECT status FROM media_api_pairings WHERE id=?").get(cancelled.pairingId).status, "revoked");
  assert.equal(db.prepare("SELECT status FROM media_api_pairings WHERE id=?").get(ownerTwoPairing.pairingId).status, "pending");
  assert.equal(api.exchangePairing({ pairingCode: ownerTwoPairing.pairingCode }).scopes.includes("news:write"), true);

  const future = issue(api);
  assert.equal(api.exchangePairing({ pairingCode: future.pairingCode }).scopes.includes("news:write"), true);
  assert.equal(db.prepare("SELECT payload_hash FROM media_api_audit WHERE action='grant_revoked' AND grant_id=?").get(selectedGrant.grantId).payload_hash.length, 64);
});

test("grant and pending-pairing revocation roll back together when its audit fails", () => {
  const db = database();
  const api = service(db);
  const selected = issue(api);
  const pending = issue(api);
  const grant = api.exchangePairing({ pairingCode: selected.pairingCode });
  db.exec("CREATE TEMP TRIGGER reject_grant_revocation_audit BEFORE INSERT ON media_api_audit WHEN NEW.action='grant_revoked' BEGIN SELECT RAISE(ABORT,'synthetic revoke audit failure'); END");
  assert.throws(() => api.revokeGrant({ ownerId: "owner_1", grantId: grant.grantId }), /synthetic revoke audit failure/);
  db.exec("DROP TRIGGER reject_grant_revocation_audit");
  assert.equal(db.prepare("SELECT status,token_hash FROM media_api_grants WHERE id=?").get(grant.grantId).status, "active");
  assert.equal(db.prepare("SELECT status FROM media_api_pairings WHERE id=?").get(pending.pairingId).status, "pending");
});

test("scope and idempotency boundaries prevent cross-operation reuse", () => {
  const db = database();
  const calls = [];
  const api = service(db, {
    media: { create: (_db, options) => {
      calls.push(options.ownerId);
      return { asset: { id: "ma_test_1", status: "upload_pending" }, upload: null };
    } },
  });
  const newsOnly = api.exchangePairing({ pairingCode: issue(api, ["news:write"]).pairingCode });
  expectApiError(() => api.createMedia({ authorization: `Bearer ${newsOnly.accessToken}`, body: { clientAssetId: "client_1" }, idempotencyKey: "media-key-1" }), "FORBIDDEN");

  const mediaGrant = api.exchangePairing({ pairingCode: issue(api, ["media:write"]).pairingCode });
  const body = { clientAssetId: "client_1", purpose: "post", contentType: "image/jpeg", fileSize: 100, name: "cover.jpg" };
  const first = api.createMedia({ authorization: `Bearer ${mediaGrant.accessToken}`, body, idempotencyKey: "media-key-1" });
  const replay = api.createMedia({ authorization: `Bearer ${mediaGrant.accessToken}`, body, idempotencyKey: "media-key-1" });
  assert.deepEqual(replay, first);
  assert.deepEqual(calls, ["owner_1"]);
  expectApiError(() => api.createMedia({ authorization: `Bearer ${mediaGrant.accessToken}`, body: { ...body, fileSize: 101 }, idempotencyKey: "media-key-1" }), "IDEMPOTENCY_MISMATCH");
});

test("self-written news uses the owner only as asset owner, keeps actor distinct, and never calls a provider", () => {
  const db = database();
  let providerCalls = 0;
  const drafts = new Map();
  const editor = {
    writeSelfWritten(input) {
      const draft = { id: "draft_test_1", status: "draft", origin: "self_written", createdBy: input.actorId };
      drafts.set(draft.id, draft);
      db.prepare("INSERT INTO news_drafts(id,status,origin,created_by) VALUES (?,?,?,?)").run(draft.id, draft.status, draft.origin, input.actorId);
      input.onSaved(draft);
      return draft;
    },
    publish(id, { onPublished }) {
      const postId = "news_post_test_1";
      const draft = { ...drafts.get(id), status: "published", postId };
      onPublished({ draft, postId });
      return { draft, postId };
    },
  };
  const api = service(db, { editor });
  const grant = api.exchangePairing({ pairingCode: issue(api, ["news:write"]).pairingCode });
  const authorization = `Bearer ${grant.accessToken}`;
  const created = api.createNewsDraft({ authorization, body: { headline: "A release arrives", body: "direct", sources: [], photo: null }, idempotencyKey: "news-key-1" });
  assert.equal(created.draft.createdBy, "owner_1");
  expectApiError(() => api.publishNewsDraft({ authorization, draftId: created.draft.id, idempotencyKey: "publish-missing-revision" }), "VALIDATION_FAILED");
  expectApiError(() => api.publishNewsDraft({ authorization, draftId: created.draft.id, expectedRevision: null, idempotencyKey: "publish-null-revision" }), "VALIDATION_FAILED");
  const published = api.publishNewsDraft({ authorization, draftId: created.draft.id, expectedRevision: 0, idempotencyKey: "publish-key-1" });
  assert.equal(published.postId, "news_post_test_1");
  assert.equal(providerCalls, 0);
  const audit = db.prepare("SELECT actor_type,actor_label,action,target_type FROM media_api_audit ORDER BY rowid").all();
  assert.deepEqual(audit.map((row) => [row.actor_type, row.actor_label, row.action, row.target_type]), [
    ["owner", "owner", "pairing_issued", "media_api_pairing"],
    ["owner", "owner", "grant_issued", "media_api_grant"],
    ["assistant", "Jeeves", "news_draft_created", "news_draft"],
    ["assistant", "Jeeves", "news_published", "news_post"],
  ]);
});

test("media failure rolls back its idempotency receipt and audit", () => {
  const db = database();
  const api = service(db, { media: { create: () => { throw new ApiError(503, "storage", "MEDIA_STORAGE_UNAVAILABLE"); } } });
  const grant = api.exchangePairing({ pairingCode: issue(api, ["media:write"]).pairingCode });
  expectApiError(() => api.createMedia({ authorization: `Bearer ${grant.accessToken}`, body: { clientAssetId: "client_2", purpose: "post", contentType: "image/jpeg", fileSize: 100, name: "cover.jpg" }, idempotencyKey: "media-fail-1" }), "MEDIA_STORAGE_UNAVAILABLE");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media_api_idempotency WHERE idempotency_key='media-fail-1'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media_api_audit WHERE action='media_created'").get().n, 0);
});

test("finalization rechecks the grant before completion and records no provider work", async () => {
  const db = database();
  let checked = 0;
  const api = service(db, { media: { finalize: async (_db, options) => {
    options.assertAuthorized();
    checked += 1;
    return { asset: { id: options.assetId, status: "ready" } };
  } } });
  const grant = api.exchangePairing({ pairingCode: issue(api, ["media:write"]).pairingCode });
  const result = await api.finalizeMedia({ authorization: `Bearer ${grant.accessToken}`, assetId: "ma_test_2", body: {}, idempotencyKey: "finalize-1" });
  assert.equal(result.finalize.state, "completed");
  assert.equal(checked, 1);
  assert.equal(db.prepare("SELECT result FROM media_api_audit WHERE action='media_finalized'").get().result, "completed");
});

test("revocation during asynchronous media work blocks completion and retains a bounded reconciliation lease", async () => {
  const db = database();
  let grantId;
  const api = service(db, { media: { finalize: async (_db, options) => {
    options.assertAuthorized();
    db.prepare("UPDATE media_api_grants SET status='revoked',token_hash=NULL,revoked_at=?,updated_at=? WHERE id=?")
      .run(at, at, grantId);
    return { asset: { id: options.assetId, status: "ready" } };
  } } });
  const grant = api.exchangePairing({ pairingCode: issue(api, ["media:write"]).pairingCode });
  grantId = grant.grantId;
  await assert.rejects(
    api.finalizeMedia({ authorization: `Bearer ${grant.accessToken}`, assetId: "ma_inflight", body: {}, idempotencyKey: "inflight-1" }),
    (error) => error instanceof ApiError && error.code === "AUTH_INVALID",
  );
  assert.equal(db.prepare("SELECT status FROM media_api_idempotency WHERE idempotency_key='inflight-1'").get().status, "reserved");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media_api_audit WHERE action='media_finalized'").get().n, 0);
});
