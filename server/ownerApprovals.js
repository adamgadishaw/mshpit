import { createHash, randomBytes } from "node:crypto";
import { opaqueId } from "./ids.js";

import { sendTemplate } from "./emailService.js";
import { publicOrigin } from "./emailService.js";
import { ownerAccount, ownerRecipient } from "./ownerIdentity.js";

const APPROVAL_TTL_MS = 45 * 60 * 1000;
const RECEIPT_ZERO = "0".repeat(64);
const ALLOWED_KINDS = new Set(["privileged_role_change", "security_release"]);
const ALLOWED_DECISIONS = new Set(["approved", "rejected"]);

function hash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

// Delivery dedupe belongs to the database Owner identity, not an address. A
// legacy v1 identity and the locked v2 Founder therefore receive independent
// commit/day claims even if a migration reuses the same user row. The opaque
// digest keeps email and other account attributes out of durable keys.
export function ownerIdentityDeliveryScope(identity) {
  const version = Number(identity?.version);
  const userId = String(identity?.userId || "");
  if (![1, 2].includes(version) || !userId) return null;
  return `v${version}-${hash(`owner-delivery\0${userId}`)}`;
}

function safeSummary(value) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 180);
}

function payloadJson(value) {
  const encoded = JSON.stringify(value && typeof value === "object" && !Array.isArray(value) ? value : {});
  if (Buffer.byteLength(encoded, "utf8") > 8_000) throw new TypeError("Owner approval payload is too large");
  return encoded;
}

function approvalToken() {
  return randomBytes(32).toString("base64url");
}

function transaction(database, work) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try { database.exec("ROLLBACK"); }
    catch { /* architecture: allow-empty-catch -- preserve the approval failure */ }
    throw error;
  }
}

function projectedRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    requestedBy: row.requested_by || null,
    targetUserId: row.target_user_id || null,
    summary: row.safe_summary,
    requestedAt: row.requested_at,
    expiresAt: row.expires_at,
    decidedAt: row.decided_at || null,
    decidedBy: row.decided_by || null,
    receiptId: row.receipt_id || null,
  };
}

function projectedReceipt(row) {
  if (!row) return null;
  return {
    id: row.id,
    requestId: row.request_id || null,
    kind: row.kind,
    decision: row.decision,
    requestedBy: row.requested_by || null,
    decidedBy: row.decided_by || null,
    targetUserId: row.target_user_id || null,
    summary: row.safe_summary,
    stamp: row.stamp,
    previousStamp: row.previous_stamp,
    releaseCommit: row.release_commit || null,
    requestedAt: row.requested_at,
    createdAt: row.created_at,
  };
}

export function expireOwnerApprovalRequests(database, at = Date.now()) {
  return database.prepare(`UPDATE owner_approval_requests
    SET status='expired',token_hash=NULL,decided_at=?
    WHERE status='pending' AND expires_at<=?`).run(at, at).changes;
}

export function createOwnerApprovalRequest(database, {
  kind,
  requestedBy,
  targetUserId = null,
  summary,
  payload,
  requestId = null,
  at = Date.now(),
} = {}) {
  if (!ALLOWED_KINDS.has(kind)) throw new TypeError("Unsupported Owner approval kind");
  const normalizedSummary = safeSummary(summary);
  if (!normalizedSummary) throw new TypeError("Owner approval summary is required");
  const encodedPayload = payloadJson(payload);
  const payloadHash = hash(encodedPayload);
  const rawToken = approvalToken();
  const tokenHash = hash(rawToken);
  const expiresAt = at + APPROVAL_TTL_MS;

  const row = transaction(database, () => {
    expireOwnerApprovalRequests(database, at);
    const existing = database.prepare(`SELECT * FROM owner_approval_requests
      WHERE kind=? AND status='pending' AND requested_by=?
        AND COALESCE(target_user_id,'')=COALESCE(?, '') AND payload_hash=?
      ORDER BY requested_at DESC LIMIT 1`).get(kind, requestedBy, targetUserId, payloadHash);
    if (existing) {
      database.prepare(`UPDATE owner_approval_requests SET token_hash=?,expires_at=?,request_id=?
        WHERE id=? AND status='pending'`).run(tokenHash, expiresAt, requestId, existing.id);
      return database.prepare("SELECT * FROM owner_approval_requests WHERE id=?").get(existing.id);
    }
    // One live decision per target and change class. A newer, different request
    // invalidates the old bearer hash so an earlier email can never approve a
    // now-obsolete role transition.
    database.prepare(`UPDATE owner_approval_requests
      SET status='superseded',token_hash=NULL,decided_at=?
      WHERE kind=? AND status='pending' AND COALESCE(target_user_id,'')=COALESCE(?, '')`)
      .run(at, kind, targetUserId);
    const id = opaqueId("oa");
    database.prepare(`INSERT INTO owner_approval_requests
      (id,kind,status,requested_by,target_user_id,safe_summary,payload,payload_hash,token_hash,
       requested_at,expires_at,request_id)
      VALUES (?,?,'pending',?,?,?,?,?,?,?,?,?)`)
      .run(id, kind, requestedBy, targetUserId, normalizedSummary, encodedPayload, payloadHash,
        tokenHash, at, expiresAt, requestId);
    return database.prepare("SELECT * FROM owner_approval_requests WHERE id=?").get(id);
  });
  return { request: projectedRequest(row), token: rawToken, payloadHash };
}

export async function emailOwnerApprovalRequest(database, request, token, { env = process.env } = {}) {
  const recipient = ownerRecipient(database, env);
  if (!recipient) return { sent: false, reason: "no-owner-email" };
  const link = `${publicOrigin()}/#ownerApproval=${encodeURIComponent(token)}`;
  const expires = new Date(request.expiresAt).toISOString();
  return sendTemplate("owner_approval_requested", {
    to: recipient,
    vars: {
      name: "Mshpit Founder",
      summary: request.summary,
      detail: `Approval ${request.id}\nType: ${request.kind}\nExpires: ${expires}`,
      link,
    },
    idempotencyKey: `owner-approval-${request.id}-${hash(token).slice(0, 16)}`,
  });
}

function receiptStamp(row) {
  return hash([
    "pit-owner-receipt-v1",
    row.id,
    row.request_id || "",
    row.kind,
    row.decision,
    row.requested_by || "",
    row.decided_by || "",
    row.target_user_id || "",
    row.safe_summary,
    row.payload_hash,
    row.previous_stamp,
    row.release_commit || "",
    row.requested_at,
    row.created_at,
  ].join("\n"));
}

function insertReceipt(database, input) {
  const previous = database.prepare(`SELECT stamp FROM owner_approval_receipts
    ORDER BY created_at DESC,id DESC LIMIT 1`).get()?.stamp || RECEIPT_ZERO;
  const row = {
    id: input.id || opaqueId("or"),
    request_id: input.requestId || null,
    kind: input.kind,
    decision: input.decision,
    requested_by: input.requestedBy || null,
    decided_by: input.decidedBy || null,
    target_user_id: input.targetUserId || null,
    safe_summary: safeSummary(input.summary),
    payload_hash: input.payloadHash,
    previous_stamp: previous,
    release_commit: String(input.releaseCommit || "").slice(0, 64) || null,
    requested_at: input.requestedAt,
    created_at: input.createdAt,
  };
  row.stamp = receiptStamp(row);
  database.prepare(`INSERT INTO owner_approval_receipts
    (id,request_id,kind,decision,requested_by,decided_by,target_user_id,safe_summary,payload_hash,
     previous_stamp,stamp,release_commit,requested_at,created_at)
    VALUES (@id,@request_id,@kind,@decision,@requested_by,@decided_by,@target_user_id,@safe_summary,
      @payload_hash,@previous_stamp,@stamp,@release_commit,@requested_at,@created_at)`).run(row);
  return projectedReceipt(row);
}

export function decideOwnerApproval(database, {
  token,
  ownerId,
  decision,
  at = Date.now(),
  applyApprovedAction = () => {},
} = {}) {
  if (!ALLOWED_DECISIONS.has(decision)) return { ok: false, reason: "bad-decision" };
  const tokenHash = hash(token);
  return transaction(database, () => {
    expireOwnerApprovalRequests(database, at);
    const request = database.prepare("SELECT * FROM owner_approval_requests WHERE token_hash=?").get(tokenHash);
    if (!request || request.status !== "pending" || request.expires_at <= at) {
      return { ok: false, reason: "invalid-or-expired" };
    }
    let payload;
    try { payload = JSON.parse(request.payload); }
    catch { return { ok: false, reason: "invalid-payload" }; }
    if (hash(request.payload) !== request.payload_hash) return { ok: false, reason: "payload-mismatch" };

    let applied = null;
    if (decision === "approved") applied = applyApprovedAction({ request, payload });
    const receipt = insertReceipt(database, {
      requestId: request.id,
      kind: request.kind,
      decision,
      requestedBy: request.requested_by,
      decidedBy: ownerId,
      targetUserId: request.target_user_id,
      summary: request.safe_summary,
      payloadHash: request.payload_hash,
      releaseCommit: process.env.RENDER_GIT_COMMIT,
      requestedAt: request.requested_at,
      createdAt: at,
    });
    const updated = database.prepare(`UPDATE owner_approval_requests
      SET status=?,token_hash=NULL,decided_at=?,decided_by=?,receipt_id=?
      WHERE id=? AND status='pending'`).run(decision, at, ownerId, receipt.id, request.id);
    if (updated.changes !== 1) throw new Error("Owner approval changed while it was being decided");
    return { ok: true, request: projectedRequest({ ...request, status: decision, decided_at: at, decided_by: ownerId, receipt_id: receipt.id }), receipt, applied };
  });
}

export async function emailOwnerApprovalReceipt(database, receipt, {
  env = process.env,
  sendTemplateImpl = sendTemplate,
} = {}) {
  const recipient = ownerRecipient(database, env);
  if (!recipient) return { sent: false, reason: "no-owner-email" };
  return sendTemplateImpl("owner_approval_receipt", {
    to: recipient,
    vars: {
      name: "Mshpit Founder",
      summary: `${receipt.decision.toUpperCase()}: ${receipt.summary}`,
      detail: `Receipt ${receipt.id}\nStamp ${receipt.stamp}\nRecorded ${new Date(receipt.createdAt).toISOString()}${receipt.releaseCommit ? `\nRelease ${receipt.releaseCommit}` : ""}`,
    },
    idempotencyKey: `owner-receipt-${receipt.id}`,
  });
}

export function ownerApprovalOverview(database, { limit = 30, at = Date.now() } = {}) {
  expireOwnerApprovalRequests(database, at);
  const bounded = Math.min(100, Math.max(1, Number(limit) || 30));
  const requests = database.prepare(`SELECT * FROM owner_approval_requests
    ORDER BY requested_at DESC,id DESC LIMIT ?`).all(bounded).map(projectedRequest);
  const receipts = database.prepare(`SELECT * FROM owner_approval_receipts
    ORDER BY created_at DESC,id DESC LIMIT ?`).all(bounded).map(projectedReceipt);
  return { requests, receipts };
}

export function ownerApprovalReview(database, token, { at = Date.now() } = {}) {
  expireOwnerApprovalRequests(database, at);
  const row = database.prepare("SELECT * FROM owner_approval_requests WHERE token_hash=?").get(hash(token));
  if (!row || row.status !== "pending" || row.expires_at <= at) return null;
  let payload;
  try { payload = JSON.parse(row.payload); }
  catch { return null; }
  if (hash(row.payload) !== row.payload_hash) return null;
  return { request: projectedRequest(row), payload };
}

export function recordDeploymentStamp(database, {
  commit = process.env.RENDER_GIT_COMMIT,
  summary = "Mshpit production release recorded",
  at = Date.now(),
} = {}) {
  const normalizedCommit = String(commit || "").trim().slice(0, 64);
  if (!normalizedCommit) return { created: false, reason: "no-commit" };
  const owner = ownerAccount(database);
  if (!owner) return { created: false, reason: "no-owner" };
  const ownerScope = ownerIdentityDeliveryScope(owner.identity);
  if (!ownerScope) return { created: false, reason: "no-owner" };
  const requestId = `deployment:${normalizedCommit}:owner:${ownerScope}`;
  const encoded = payloadJson({ commit: normalizedCommit, type: "production_deployment", ownerScope });
  return transaction(database, () => {
    // Keep the uniqueness check under the same write lock as insertion. Two
    // rolling processes may stamp simultaneously; the loser should observe the
    // existing receipt instead of surfacing a UNIQUE constraint failure.
    const existing = database.prepare("SELECT * FROM owner_approval_receipts WHERE request_id=?").get(requestId);
    if (existing) return { created: false, receipt: projectedReceipt(existing) };
    const receipt = insertReceipt(database, {
      requestId,
      kind: "security_release",
      decision: "recorded",
      requestedBy: owner.user.id,
      decidedBy: owner.user.id,
      targetUserId: null,
      summary,
      payloadHash: hash(encoded),
      releaseCommit: normalizedCommit,
      requestedAt: at,
      createdAt: at,
    });
    return { created: true, receipt };
  });
}

export async function recordAndEmailDeploymentStamp(database, options = {}) {
  const result = recordDeploymentStamp(database, options);
  if (!result.created) return result;
  const delivery = await emailOwnerApprovalReceipt(database, result.receipt, options);
  return { ...result, delivery };
}

export const OWNER_APPROVAL_TTL_MS = APPROVAL_TTL_MS;
