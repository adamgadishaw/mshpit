import { verifyPasswordForUser } from "../../auth.js";
import { clean, cleanHandle } from "../../validate.js";
import { isOwnerId } from "../../ownerIdentity.js";
import {
  createOwnerApprovalRequest,
  decideOwnerApproval,
  emailOwnerApprovalReceipt,
  emailOwnerApprovalRequest,
  ownerApprovalOverview,
  ownerApprovalReview,
} from "../../ownerApprovals.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PRIVILEGED_ROLES = new Set(["fan", "artist", "moderator", "admin"]);
const SECURITY_CATEGORIES = new Set(["security_update", "security_audit"]);
const SECURITY_CHECKS = new Set([
  "tests",
  "syntax",
  "architecture",
  "web_build",
  "dependency_audit",
  "runtime_readiness",
]);

export function ownerApprovalRoutes({
  database,
  ApiError,
  applyRoleChange,
  getUser,
  limit,
  now,
  requireAdmin,
  requireOwner,
  roleChangeTouchesHead,
  selectedRoleHandle,
}) {
  if (!database?.prepare || typeof ApiError !== "function" || typeof applyRoleChange !== "function"
    || typeof getUser !== "function" || typeof limit !== "function" || typeof now !== "function"
    || typeof requireAdmin !== "function" || typeof requireOwner !== "function"
    || typeof roleChangeTouchesHead !== "function" || typeof selectedRoleHandle !== "function") {
    throw new TypeError("Owner approval routes require complete security-boundary dependencies");
  }

  return Object.freeze({
    "GET /api/admin/owner-approvals": (ctx) => {
      const actor = requireAdmin(ctx);
      ctx.setHeader?.("Cache-Control", "no-store");
      const overview = ownerApprovalOverview(database, { limit: 50, at: now() });
      return {
        owner: isOwnerId(database, actor.id),
        pending: overview.requests.filter((request) => request.status === "pending").length,
        ...overview,
      };
    },

    // Email scanners cannot approve anything: opening the fragment only permits
    // this private read after the exact Owner is already signed in.
    "POST /api/owner-approvals/review": (ctx) => {
      requireOwner(ctx);
      limit(ctx, "owner-approval-review", 30, HOUR_MS);
      ctx.setHeader?.("Cache-Control", "no-store");
      const token = clean(ctx.body?.token, { max: 200 });
      if (!token) throw new ApiError(400, "The approval link is incomplete.", "VALIDATION_FAILED");
      const review = ownerApprovalReview(database, token, { at: now() });
      if (!review) throw new ApiError(409, "That approval link is invalid, expired, or already used.", "CONFLICT");
      return { review };
    },

    "POST /api/owner-approvals/decide": async (ctx) => {
      const owner = requireOwner(ctx);
      limit(ctx, "owner-approval-decision", 12, HOUR_MS);
      ctx.setHeader?.("Cache-Control", "no-store");
      const token = clean(ctx.body?.token, { max: 200 });
      const password = typeof ctx.body?.password === "string" ? ctx.body.password : "";
      const decision = ctx.body?.decision === "approved" || ctx.body?.decision === "rejected"
        ? ctx.body.decision
        : null;
      if (!token || !password || !decision) {
        throw new ApiError(400, "Token, Owner password, and decision are required.", "VALIDATION_FAILED");
      }
      if (!verifyPasswordForUser(password, owner.pass_hash)) {
        throw new ApiError(401, "That password doesn't match the Owner account.", "AUTH_INVALID");
      }

      const result = decideOwnerApproval(database, {
        token,
        ownerId: owner.id,
        decision,
        at: now(),
        applyApprovedAction: ({ request, payload }) => {
          const requester = getUser(request.requested_by);
          if (!requester || requester.role !== "admin" || requester.is_banned
            || Number(requester.suspended_until || 0) > now()) {
            throw new ApiError(409, "The requesting administrator is no longer authorized. Start a new request.", "CONFLICT");
          }
          if (request.kind === "security_release") return { recorded: true };
          if (request.kind !== "privileged_role_change") {
            throw new ApiError(400, "Unsupported Owner approval type.", "VALIDATION_FAILED");
          }
          const target = getUser(request.target_user_id);
          if (!target || isOwnerId(database, target.id)) {
            throw new ApiError(409, "The requested member is no longer eligible for this change.", "CONFLICT");
          }
          if (target.role !== payload.expectedRole || target.handle !== payload.expectedHandle) {
            throw new ApiError(409, "That member changed while this request was pending. Start a new request.", "CONFLICT");
          }
          const requestedRole = PRIVILEGED_ROLES.has(payload.requestedRole) ? payload.requestedRole : null;
          const requestedHandle = cleanHandle(payload.requestedHandle);
          if (!requestedRole || !requestedHandle || !roleChangeTouchesHead(target.role, requestedRole)) {
            throw new ApiError(400, "The stored role request is invalid.", "VALIDATION_FAILED");
          }
          if (selectedRoleHandle(target, requestedRole, requestedHandle) !== requestedHandle) {
            throw new ApiError(409, "That staff username is no longer available. Start a new request.", "CONFLICT");
          }
          return applyRoleChange(ctx, target, requestedRole, requestedHandle, {
            reason: `Owner approved ${request.id}`,
            requestedBy: request.requested_by,
          });
        },
      });
      if (!result.ok) {
        throw new ApiError(409, "That approval link is invalid, expired, or already used.", "CONFLICT");
      }
      const delivery = await emailOwnerApprovalReceipt(database, result.receipt);
      return {
        ok: true,
        decision,
        receipt: result.receipt,
        applied: result.applied,
        emailSent: Boolean(delivery.sent),
      };
    },

    // Admins can attest only to a fixed vocabulary of checks. The immutable
    // template therefore cannot become an arbitrary founder-mail relay.
    "POST /api/admin/security-approvals": async (ctx) => {
      const actor = requireAdmin(ctx);
      limit(ctx, "security-approval-request", 10, DAY_MS);
      const category = SECURITY_CATEGORIES.has(ctx.body?.category) ? ctx.body.category : null;
      const checks = Array.isArray(ctx.body?.checks)
        ? [...new Set(ctx.body.checks.filter((check) => SECURITY_CHECKS.has(check)))].slice(0, SECURITY_CHECKS.size)
        : [];
      if (!category || !checks.length) {
        throw new ApiError(400, "Choose a security update type and at least one completed check.", "VALIDATION_FAILED");
      }
      const commit = String(process.env.RENDER_GIT_COMMIT || "unreleased").trim().slice(0, 64);
      const created = createOwnerApprovalRequest(database, {
        kind: "security_release",
        requestedBy: actor.id,
        summary: category === "security_audit"
          ? "Security audit verification awaiting Owner review"
          : "Security update verification awaiting Owner review",
        payload: { category, checks, commit },
        requestId: ctx.requestId || null,
        at: now(),
      });
      const delivery = await emailOwnerApprovalRequest(database, created.request, created.token);
      return {
        ok: true,
        pending: true,
        approvalId: created.request.id,
        expiresAt: created.request.expiresAt,
        emailSent: Boolean(delivery.sent),
      };
    },
  });
}
