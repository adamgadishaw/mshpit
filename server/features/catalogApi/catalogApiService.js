import { randomUUID } from "node:crypto";
import { ApiError } from "../../errors.js";
import { withImmediateWrite } from "../../databaseTransaction.js";
import { isOwnerId } from "../../ownerIdentity.js";
import { createApiGrantService } from "../apiGrants/apiGrantService.js";
import { normalizeIdempotencyKey, payloadDigest } from "../mediaApi/mediaApiPolicy.js";
import { assertCatalogClaim, assertCatalogRunning, bumpCatalogRevision, catalogAudit, catalogControl,
  claimCatalogWork, finishCatalogWork, pauseCatalogWork } from "../catalogResearch/catalogWorkQueue.js";
import { validateCatalogProposal } from "../catalogResearch/catalogProposals.js";
import { listCatalogInventory, publicCatalogEntity, readCatalogEntity } from "./catalogApiInventory.js";
import { CATALOG_LIMITS, catalogApiEnabled, catalogCommitEnabled, catalogConflict, catalogKey,
  catalogObject, catalogType } from "./catalogApiPolicy.js";

// Deliberately synchronous. Claims, current-value checks, writes, receipts and
// audit records share one SQLite IMMEDIATE transaction. No provider adapter or
// network callback can run inside this service.
export function createCatalogApiService({ database, env = process.env, now = Date.now }) {
  const grants = createApiGrantService({ database, now });
  const assertEnabled = () => {
    if (!catalogApiEnabled(env)) throw new ApiError(404, "This API is unavailable.", "NOT_FOUND");
  };
  const scope = (type, action) => `catalog:${catalogType(type)}:${action}`;
  const authorize = (authorization, required) => { assertEnabled(); return grants.authorize(authorization, required); };
  const assertOwner = ownerId => {
    assertEnabled();
    const owner = database.prepare("SELECT role,email_verified_at,is_banned,suspended_until FROM users WHERE id=?").get(ownerId);
    if (!owner || !isOwnerId(database, ownerId) || owner.role !== "admin" || !(owner.email_verified_at > 0)
      || owner.is_banned || owner.suspended_until > now()) throw new ApiError(403, "Only the owner can review catalog work.", "FORBIDDEN");
  };
  const snapshot = (type, key, at) => {
    const result = readCatalogEntity(database, { type, key: catalogKey(key), at });
    if (!result) throw new ApiError(404, "This catalog page is unavailable.", "NOT_FOUND");
    return result;
  };
  const claim = (body, grant, at) => {
    const page = snapshot(body.type, body.key, at);
    const row = assertCatalogClaim(database, { type: body.type, key: body.key, nonce: body.nonce,
      grantId: grant.id, worker: "assistant", authorizationHash: payloadDigest(grant), snapshot: page, at });
    return { page, row };
  };
  const audit = (grant, action, body, at, extra = {}) => catalogAudit(database, { actorType: "assistant",
    actorLabel: grant.actorLabel, grantId: grant.id, action, type: body.type, key: body.key, at, ...extra });
  const proposalView = row => ({ id: row.id, type: row.entity_type, key: row.entity_key,
    status: row.status, payloadHash: row.payload_hash, createdAt: row.created_at, reviewedAt: row.reviewed_at });
  const getProposal = (id, grantId) => {
    catalogKey(id);
    const row = database.prepare("SELECT * FROM catalog_proposals WHERE id=? AND grant_id=?").get(id, grantId);
    if (!row) throw new ApiError(404, "This proposal is unavailable.", "NOT_FOUND");
    return row;
  };
  function write({ authorization, body, idempotencyKey }, operation, action, keys, execute) {
    assertEnabled();
    catalogObject(body, keys);
    catalogType(body.type); catalogKey(body.key);
    let receiptKey;
    try { receiptKey = normalizeIdempotencyKey(idempotencyKey); }
    catch { throw new ApiError(400, "Use an idempotency key for catalog writes.", "VALIDATION_FAILED"); }
    const required = scope(body.type, action);
    authorize(authorization, required);
    return withImmediateWrite(database, () => {
      const at = now(), grant = authorize(authorization, required);
      assertCatalogRunning(database);
      if (action === "commit") {
        if (!catalogCommitEnabled(env)) throw new ApiError(403, "Catalog commits are disabled.", "FORBIDDEN");
        grants.assertActive(grant.id, scope(body.type, "propose"));
      }
      const digest = payloadDigest(body);
      const previous = database.prepare(`SELECT * FROM catalog_api_receipts
        WHERE grant_id=? AND operation=? AND idempotency_key=?`).get(grant.id, operation, receiptKey);
      if (previous && previous.expires_at > at) {
        if (previous.payload_hash !== digest) throw catalogConflict();
        return JSON.parse(previous.response_json);
      }
      database.prepare(`DELETE FROM catalog_api_receipts WHERE rowid IN
        (SELECT rowid FROM catalog_api_receipts WHERE expires_at<=? LIMIT 100)`).run(at);
      // Always retire this expired key even if the bounded cleanup page did
      // not reach it. A key may execute again only after documented retention.
      if (previous) database.prepare("DELETE FROM catalog_api_receipts WHERE grant_id=? AND operation=? AND idempotency_key=?")
        .run(grant.id, operation, receiptKey);
      if (database.prepare("SELECT COUNT(*) n FROM catalog_api_receipts").get().n >= CATALOG_LIMITS.receiptRows) {
        throw new ApiError(429, "Catalog receipts need review.", "RATE_LIMITED");
      }
      const response = execute(grant, at);
      assertEnabled(); grants.assertActive(grant.id, required); assertCatalogRunning(database);
      const serialized = JSON.stringify(response);
      if (Buffer.byteLength(serialized) > CATALOG_LIMITS.receiptBytes) throw catalogConflict();
      database.prepare(`INSERT INTO catalog_api_receipts
        (grant_id,operation,idempotency_key,payload_hash,response_json,created_at,expires_at) VALUES (?,?,?,?,?,?,?)`)
        .run(grant.id, operation, receiptKey, digest, serialized, at, at + CATALOG_LIMITS.retentionMs);
      return response;
    });
  }
  const baseKeys = ["type", "key", "nonce"];
  return {
    assertEnabled, authorize,
    inventory({ authorization, type, cursor, limit }) {
      authorize(authorization, scope(type, "read"));
      return listCatalogInventory(database, { type, cursor, limit, at: now() });
    },
    read({ authorization, type, key }) {
      authorize(authorization, scope(type, "read"));
      return publicCatalogEntity(snapshot(type, key, now()));
    },
    claim(input) {
      return write(input, "claim", "propose", ["type", "key", "revision", "valueHash", "identityHash"], (grant, at) => {
        const page = snapshot(input.body.type, input.body.key, at);
        if (input.body.revision !== page.revision || input.body.valueHash !== page.valueHash
          || input.body.identityHash !== page.identityHash) throw catalogConflict();
        return claimCatalogWork(database, { snapshot: page, worker: "assistant", grantId: grant.id,
          actorLabel: grant.actorLabel, authorizationHash: payloadDigest(grant), at });
      });
    },
    renew(input) {
      return write(input, "renew", "propose", baseKeys, (grant, at) => {
        const { row } = claim(input.body, grant, at);
        const leaseUntil = Math.min(at + CATALOG_LIMITS.leaseMs, row.claimed_at + CATALOG_LIMITS.maxLeaseMs);
        if (leaseUntil <= row.lease_until) throw catalogConflict();
        database.prepare("UPDATE catalog_work_items SET lease_until=?,updated_at=? WHERE entity_type=? AND entity_key=? AND nonce=?")
          .run(leaseUntil, at, input.body.type, input.body.key, input.body.nonce);
        audit(grant, "renewed", input.body, at);
        return { ...input.body, leaseUntil };
      });
    },
    propose(input) {
      return write(input, "propose", "propose", [...baseKeys, "patch", "evidence"], (grant, at) => {
        const { page, row } = claim(input.body, grant, at);
        if (row.status !== "leased") throw catalogConflict();
        const checked = validateCatalogProposal({ patch: input.body.patch, evidence: input.body.evidence }, page, at);
        database.prepare(`DELETE FROM catalog_proposals WHERE rowid IN
          (SELECT rowid FROM catalog_proposals WHERE updated_at<? LIMIT 100)`).run(at - CATALOG_LIMITS.retentionMs);
        if (database.prepare("SELECT COUNT(*) n FROM catalog_proposals").get().n >= CATALOG_LIMITS.proposalRows) {
          throw new ApiError(429, "Catalog proposals need review.", "RATE_LIMITED");
        }
        const id = randomUUID(), hash = payloadDigest({ patch: checked.patch, evidence: checked.evidence });
        database.prepare(`INSERT INTO catalog_proposals
          (id,entity_type,entity_key,grant_id,claim_nonce,base_revision,base_hash,identity_hash,patch_json,evidence_json,
           payload_hash,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`)
          .run(id, page.type, page.key, grant.id, row.nonce, page.revision, page.valueHash, page.identityHash,
            JSON.stringify(checked.patch), JSON.stringify(checked.evidence), hash, at, at);
        database.prepare("UPDATE catalog_work_items SET status='proposed',updated_at=? WHERE entity_type=? AND entity_key=? AND nonce=?")
          .run(at, page.type, page.key, row.nonce);
        audit(grant, "proposed", input.body, at, { proposalId: id, priorHash: page.valueHash, nextHash: hash });
        return proposalView(getProposal(id, grant.id));
      });
    },
    commit(input) {
      return write(input, "commit", "commit", [...baseKeys, "proposalId", "payloadHash"], (grant, at) => {
        const { page, row } = claim(input.body, grant, at);
        const proposal = getProposal(input.body.proposalId, grant.id);
        if (proposal.status !== "approved" || proposal.entity_type !== page.type || proposal.entity_key !== page.key
          || proposal.claim_nonce !== row.nonce || proposal.payload_hash !== input.body.payloadHash
          || proposal.base_revision !== page.revision || proposal.base_hash !== page.valueHash
          || proposal.identity_hash !== page.identityHash) throw catalogConflict();
        const evidence = JSON.parse(proposal.evidence_json).map(({ verification: _verification, ...source }) => source);
        const checked = validateCatalogProposal({ patch: JSON.parse(proposal.patch_json), evidence }, page, at);
        if (payloadDigest({ patch: checked.patch, evidence: checked.evidence }) !== proposal.payload_hash) throw catalogConflict();
        const record = { ...checked.record, provenance: { actorType: "assistant", actorLabel: grant.actorLabel,
          method: "owner-reviewed-submission", proposalId: proposal.id, evidence: checked.evidence, at } };
        const serialized = JSON.stringify(record);
        if (Buffer.byteLength(serialized) > CATALOG_LIMITS.proposalBytes) throw catalogConflict();
        if (page.type === "event") {
          database.prepare(`INSERT INTO catalog_event_enrichment(event_id,findings,updated_at) VALUES (?,?,?)
            ON CONFLICT(event_id) DO UPDATE SET findings=excluded.findings,updated_at=excluded.updated_at`)
            .run(page.key, serialized, at);
        } else {
          database.prepare(`INSERT INTO catalog_research
            (entity_type,entity_key,identity,status,attempts,next_attempt_at,researched_at,findings)
            VALUES (?,?,?,'found',0,?,?,?) ON CONFLICT(entity_type,entity_key) DO UPDATE SET
            identity=excluded.identity,status='found',next_attempt_at=excluded.next_attempt_at,researched_at=excluded.researched_at,
            findings=excluded.findings,claim_token=NULL,last_reason=NULL,model=NULL`)
            .run(page.type, page.key, JSON.stringify(page.identity), at + 180 * 86_400_000, at, serialized);
        }
        const revision = bumpCatalogRevision(database, page.type, page.key);
        finishCatalogWork(database, { type: page.type, key: page.key, nonce: row.nonce, at });
        database.prepare("UPDATE catalog_proposals SET status='committed',updated_at=? WHERE id=?").run(at, proposal.id);
        audit(grant, "committed", input.body, at, { proposalId: proposal.id, priorHash: page.valueHash,
          nextHash: snapshot(page.type, page.key, at).valueHash });
        return { proposal: proposalView(getProposal(proposal.id, grant.id)), revision };
      });
    },
    finish(input) {
      return write(input, "finish", "propose", [...baseKeys, "outcome"], (grant, at) => {
        claim(input.body, grant, at);
        if (!["failed", "quarantined"].includes(input.body.outcome)) throw new ApiError(400, "Choose a work outcome.", "VALIDATION_FAILED");
        finishCatalogWork(database, { type: input.body.type, key: input.body.key, nonce: input.body.nonce,
          status: input.body.outcome, at, nextAttemptAt: at + 60 * 60_000 });
        audit(grant, input.body.outcome, input.body, at);
        return { type: input.body.type, key: input.body.key, status: input.body.outcome };
      });
    },
    status({ authorization, type, after = "", limit = 25 }) {
      const grant = authorize(authorization, scope(type, "read"));
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > CATALOG_LIMITS.page) {
        throw new ApiError(400, "Choose a status page size from 1 to 50.", "VALIDATION_FAILED");
      }
      if (after !== "") catalogKey(after);
      const rows = database.prepare(`SELECT entity_key key,status,nonce,lease_until leaseUntil,attempts,updated_at updatedAt
        FROM catalog_work_items WHERE grant_id=? AND entity_type=? AND entity_key>? ORDER BY entity_key LIMIT ?`)
        .all(grant.id, type, after, limit + 1);
      const control = catalogControl(database);
      const counts = database.prepare(`SELECT status,COUNT(*) count FROM catalog_work_items
        WHERE grant_id=? AND entity_type=? GROUP BY status`).all(grant.id, type);
      const today = new Date(now()).toISOString().slice(0, 10);
      return { items: rows.slice(0, limit), nextAfter: rows.length > limit ? rows[limit - 1].key : null, counts,
        control: { paused: control.paused, revision: control.revision, utcDay: control.utc_day,
          claims: control.utc_day < today ? 0 : control.claims, commits: control.utc_day < today ? 0 : control.commits },
        limits: { active: CATALOG_LIMITS.active, dailyClaims: CATALOG_LIMITS.dailyClaims, dailyCommits: CATALOG_LIMITS.dailyCommits } };
    },
    proposal({ authorization, type, id }) {
      const grant = authorize(authorization, scope(type, "read"));
      const row = getProposal(id, grant.id);
      if (row.entity_type !== type) throw new ApiError(404, "This proposal is unavailable.", "NOT_FOUND");
      return proposalView(row);
    },
    review({ ownerId, proposalId, payloadHash, approved }) {
      assertOwner(ownerId);
      return withImmediateWrite(database, () => {
        assertOwner(ownerId); assertCatalogRunning(database);
        const proposal = database.prepare("SELECT * FROM catalog_proposals WHERE id=?").get(catalogKey(proposalId));
        if (!proposal || proposal.status !== "pending" || proposal.payload_hash !== payloadHash || typeof approved !== "boolean") throw catalogConflict();
        const grant = grants.assertActive(proposal.grant_id, scope(proposal.entity_type, "propose"));
        claim({ type: proposal.entity_type, key: proposal.entity_key, nonce: proposal.claim_nonce }, grant, now());
        database.prepare("UPDATE catalog_proposals SET status=?,reviewed_by=?,reviewed_at=?,updated_at=? WHERE id=?")
          .run(approved ? "approved" : "rejected", ownerId, now(), now(), proposalId);
        if (!approved) finishCatalogWork(database, { type: proposal.entity_type, key: proposal.entity_key,
          nonce: proposal.claim_nonce, status: "failed", at: now(), nextAttemptAt: now() + 60 * 60_000 });
        catalogAudit(database, { actorType: "owner", actorLabel: "owner", action: approved ? "approved" : "rejected",
          type: proposal.entity_type, key: proposal.entity_key, proposalId, nextHash: payloadHash, at: now() });
        return proposalView(getProposal(proposalId, grant.id));
      });
    },
    reviewDetail({ ownerId, proposalId }) {
      assertOwner(ownerId);
      const row = database.prepare("SELECT * FROM catalog_proposals WHERE id=?").get(catalogKey(proposalId));
      if (!row) throw new ApiError(404, "This proposal is unavailable.", "NOT_FOUND");
      return { ...proposalView(row), patch: JSON.parse(row.patch_json), evidence: JSON.parse(row.evidence_json) };
    },
    control({ ownerId, paused, expectedRevision }) {
      assertOwner(ownerId);
      return withImmediateWrite(database, () => { assertOwner(ownerId);
        return pauseCatalogWork(database, { paused, expectedRevision, actorId: ownerId, at: now() }); });
    },
    revoke({ ownerId, grantId }) {
      assertOwner(ownerId);
      return withImmediateWrite(database, () => {
        assertOwner(ownerId);
        const row = database.prepare("SELECT id FROM api_grants WHERE id=? AND owner_id=?").get(catalogKey(grantId), ownerId);
        if (!row) throw new ApiError(404, "This grant is unavailable.", "NOT_FOUND");
        database.prepare("UPDATE api_grants SET status='revoked',revoked_at=? WHERE id=?").run(now(), grantId);
        database.prepare(`UPDATE catalog_work_items SET status='failed',lease_until=0,updated_at=?
          WHERE grant_id=? AND status IN ('leased','proposed')`).run(now(), grantId);
        catalogAudit(database, { actorType: "owner", actorLabel: "owner", grantId, action: "revoked", at: now() });
        return { id: grantId, status: "revoked" };
      });
    },
  };
}
