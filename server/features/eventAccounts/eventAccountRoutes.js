import { ApiError } from "../../errors.js";
import { accountIsPublic } from "../../accountVisibility.js";
import { withImmediateWrite } from "../../databaseTransaction.js";
import { assertSafeAuthoredText } from "../../contentSafety.js";
import { manualIdentityReviewEvidence, verificationReviewReason } from "../artistAccounts/artistVerification.js";
import { managedCreatorEntity } from "../creatorPosts/creatorPostService.js";
import { setCreatorEntityOwnership } from "../creatorPosts/creatorEntityOwnership.js";
import { createEventAccountTargetReader } from "./eventAccountTargets.js";

export function eventAccountRoutes({ database: db, requireUser, requireAdmin, rateLimit, moderationRecord, uid, pageRequest, finishPage, now = Date.now }) {
  const targetFor = createEventAccountTargetReader(db);
  const current = (ctx, admin = false) => {
    const authenticated = admin ? requireAdmin(ctx) : requireUser(ctx);
    const member = db.prepare("SELECT * FROM users WHERE id=?").get(authenticated.id);
    if (!accountIsPublic(member, now()) || (admin && member.role !== "admin")) throw new ApiError(403, "This account cannot perform that action.", "FORBIDDEN");
    return member;
  };
  const claimant = ctx => {
    const member = current(ctx);
    if (!["fan", "event"].includes(member.role)) throw new ApiError(403, "Use a separate account dedicated to this event or festival.", "FORBIDDEN");
    if (!member.email_verified_at) throw new ApiError(403, "Confirm your email before requesting page access.", "EMAIL_VERIFICATION_REQUIRED");
    return member;
  };
  const registry = key => db.prepare("SELECT * FROM creator_entities WHERE entity_type='event' AND entity_key=?").get(key);
  const claimById = id => db.prepare("SELECT * FROM event_account_claims WHERE id=?").get(id);
  const ownClaim = (accountId, key) => db.prepare(`SELECT id,status,review_reason AS reviewReason FROM event_account_claims
    WHERE account_id=? AND entity_key=? ORDER BY created_at DESC,id DESC LIMIT 1`).get(accountId, key) || null;
  const review = (ctx, action) => {
    current(ctx, true); rateLimit(ctx, "event-claim-review", 60, 60_000);
    return withImmediateWrite(db, () => {
      ctx.assertCurrentSession?.(); const admin = current(ctx, true);
      const claim = claimById(ctx.params.id);
      if (!claim) throw new ApiError(404, "That page request no longer exists.", "NOT_FOUND");
      if (claim.account_id === admin.id) throw new ApiError(403, "Another administrator must review your page request.", "FORBIDDEN");
      const prior = registry(claim.entity_key);
      // A retry after a lost successful response is harmless. A revoked or
      // reassigned page never regains authority through the old approval.
      if (action === "approve" && claim.status === "approved" && managedCreatorEntity(db, claim.account_id, "event", claim.entity_key)) return { status: "approved" };
      if (action === "reject" && claim.status === "rejected") return { status: "rejected" };
      if (action === "revoke" && claim.status === "revoked") return { status: "revoked" };
      if (claim.status !== (action === "revoke" ? "approved" : "pending")) throw new ApiError(409, "This request has already changed. Refresh the review.", "CONFLICT");
      const member = db.prepare("SELECT * FROM users WHERE id=?").get(claim.account_id);
      if (!member) throw new ApiError(404, "The requesting account no longer exists.", "NOT_FOUND");
      let reason, reviewedUrl = null;
      if (action === "approve") {
        const evidence = manualIdentityReviewEvidence(ctx.body || {}); reason = evidence.reason; reviewedUrl = evidence.reviewedUrl;
        const target = targetFor(claim.target_kind, claim.target_id);
        if (target.entityKey !== claim.entity_key) throw new ApiError(409, "This page's identity changed. A new request is needed.", "CONFLICT");
        if (!accountIsPublic(member, now()) || !member.email_verified_at || !["fan", "event"].includes(member.role)) throw new ApiError(409, "The requesting account must be active, email-confirmed and dedicated to this event.", "CONFLICT");
        if (ctx.body.expectedOwnerId !== null || prior?.owner_id || (prior && prior.status !== "active")) throw new ApiError(409, "This page is assigned or restricted. Resolve its existing ownership first.", "CONFLICT");
        db.prepare("UPDATE users SET role='event',verified=1 WHERE id=?").run(member.id);
        setCreatorEntityOwnership(db, { ...target, ownerId: member.id, expectedOwnerId: null, status: "active" });
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(member.id);
      } else {
        reason = verificationReviewReason(ctx.body?.reason);
        if (action === "revoke") {
          if (ctx.body?.confirmed !== true || ctx.body?.expectedOwnerId !== claim.account_id || prior?.owner_id !== claim.account_id) throw new ApiError(409, "Confirm the current page owner before removing access.", "CONFLICT");
          setCreatorEntityOwnership(db, { entityType: "event", entityKey: claim.entity_key, name: prior.name, ownerId: null, expectedOwnerId: claim.account_id, status: prior.status });
          const remaining = db.prepare("SELECT 1 FROM creator_entities WHERE owner_id=? AND entity_type='event' LIMIT 1").get(member.id);
          if (!remaining && member.role === "event") db.prepare("UPDATE users SET role='fan',verified=0 WHERE id=?").run(member.id);
          db.prepare("DELETE FROM sessions WHERE user_id=?").run(member.id);
        }
      }
      const status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "revoked";
      db.prepare("UPDATE event_account_claims SET status=?,reviewed_by=?,reviewed_at=?,review_reason=?,reviewed_url=COALESCE(?,reviewed_url) WHERE id=?")
        .run(status, admin.id, now(), reason, reviewedUrl, claim.id);
      moderationRecord({ ...ctx, user: admin }, `${action}_event_claim`, "user", member.id, reason,
        { claimId: claim.id, role: member.role, ownerId: prior?.owner_id || null, status: claim.status },
        { entityKey: claim.entity_key, status, method: "manual", reviewedUrl });
      return { status };
    });
  };
  return {
    "GET /api/event-accounts/target": ctx => {
      ctx.setHeader?.("Cache-Control", "private, no-store");
      const entity = targetFor(ctx.query?.kind, ctx.query?.id), page = registry(entity.entityKey);
      const member = ctx.user ? current(ctx) : null;
      const following = member && db.prepare("SELECT following,notify_updates FROM creator_follows WHERE account_id=? AND entity_type='event' AND entity_key=?").get(member.id, entity.entityKey);
      return { entity, canFollow: !page || page.status === "active", claimed: !!page?.owner_id && page.status === "active", canManage: !!member && !!managedCreatorEntity(db, member.id, "event", entity.entityKey),
        canRequest: !!member && ["fan", "event"].includes(member.role) && (!page || (!page.owner_id && page.status === "active")),
        following: !!following?.following, notifyUpdates: following?.notify_updates !== 0, claim: member ? ownClaim(member.id, entity.entityKey) : null };
    },
    "POST /api/event-accounts/claims": ctx => {
      claimant(ctx); rateLimit(ctx, "event-claim", 5, 60 * 60_000);
      if (typeof ctx.body?.note !== "string" || ctx.body.note.trim().length < 12 || ctx.body.note.length > 2000) throw new ApiError(400, "Add your role and an official website or contact that staff can use to check your authority.", "VALIDATION_FAILED");
      const note = ctx.body.note.trim(); assertSafeAuthoredText(note, { field: "page access request" });
      return withImmediateWrite(db, () => {
        ctx.assertCurrentSession?.(); const member = claimant(ctx), entity = targetFor(ctx.body?.kind, ctx.body?.id), prior = registry(entity.entityKey);
        if (prior?.owner_id || (prior && prior.status !== "active")) throw new ApiError(409, "This page is already assigned or awaiting a separate review.", "CONFLICT");
        const previous = ownClaim(member.id, entity.entityKey);
        if (previous?.status === "pending") return { id: previous.id, status: "pending" };
        const id = uid("ec");
        db.prepare("INSERT INTO event_account_claims(id,account_id,target_kind,target_id,entity_key,note,created_at) VALUES (?,?,?,?,?,?,?)")
          .run(id, member.id, entity.targetKind, entity.targetId, entity.entityKey, note, now());
        return { id, status: "pending" };
      });
    },
    "GET /api/admin/event-claims": ctx => {
      current(ctx, true); ctx.setHeader?.("Cache-Control", "private, no-store");
      const status = ctx.query?.status || "pending";
      if (!["pending", "approved"].includes(status)) throw new ApiError(400, "Choose pending requests or approved pages.", "VALIDATION_FAILED");
      const { cursor, limit } = pageRequest(ctx, 50, 100);
      const cursorSql = cursor ? "AND (c.created_at<$before OR (c.created_at=$before AND c.id<$id))" : "";
      const found = db.prepare(`SELECT c.*,u.name AS account_name,ce.owner_id AS current_owner_id FROM event_account_claims c
        JOIN users u ON u.id=c.account_id LEFT JOIN creator_entities ce ON ce.entity_type='event' AND ce.entity_key=c.entity_key
        WHERE c.status=$status ${cursorSql} ORDER BY c.created_at DESC,c.id DESC LIMIT $limit`)
        .all({ $status: status, $limit: limit + 1, ...(cursor ? { $before: cursor.createdAt, $id: cursor.id } : {}) });
      const { rows, nextCursor } = finishPage(found, limit);
      return { nextCursor, claims: rows.map(row => ({ id: row.id, accountId: row.account_id, accountName: row.account_name, targetKind: row.target_kind, targetId: row.target_id,
        entityKey: row.entity_key, status: row.status, note: row.note, currentOwnerId: row.current_owner_id || null, reviewedUrl: row.reviewed_url || null })) };
    },
    "POST /api/admin/event-claims/:id/approve": ctx => review(ctx, "approve"),
    "POST /api/admin/event-claims/:id/reject": ctx => review(ctx, "reject"),
    "POST /api/admin/event-claims/:id/revoke": ctx => review(ctx, "revoke"),
  };
}
