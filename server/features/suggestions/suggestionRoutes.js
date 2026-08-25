import {
  isSuggestionId,
  normalizeSuggestionCategory,
  normalizeSuggestionStatus,
} from "../../../src/domain/suggestionBox.mjs";
import { createSuggestionRepository } from "./suggestionRepository.js";
import {
  createSuggestionService,
  decodeSuggestionCursor,
} from "./suggestionService.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const noStore = (ctx) => ctx.setHeader?.("Cache-Control", "no-store");

export function suggestionRoutes({
  database,
  ApiError,
  assertSafeAuthoredText,
  createId,
  now,
  rateLimit,
  recordModerationAction,
  requireAdmin,
  requireUser,
}) {
  if (typeof ApiError !== "function" || typeof assertSafeAuthoredText !== "function" || typeof createId !== "function" || typeof now !== "function"
    || typeof rateLimit !== "function" || typeof recordModerationAction !== "function"
    || typeof requireAdmin !== "function" || typeof requireUser !== "function") {
    throw new TypeError("Product suggestion routes require complete boundary dependencies");
  }
  const repository = createSuggestionRepository(database);
  const service = createSuggestionService({ repository, createId });

  return Object.freeze({
    "POST /api/suggestions": (ctx) => {
      // A signed-in caller is still anonymous in storage, but account safety
      // restrictions remain in force. Guests intentionally need no account.
      if (ctx.user) requireUser(ctx);
      rateLimit(ctx, "suggestions-hourly", 5, HOUR_MS);
      rateLimit(ctx, "suggestions-daily", 12, DAY_MS);
      assertSafeAuthoredText(ctx.body?.body, { field: "suggestion" });
      noStore(ctx);
      const result = service.submit(ctx.body, { at: now() });
      if (!result.ok && result.mismatch) {
        throw new ApiError(409, "That suggestion retry no longer matches the original request.", "IDEMPOTENCY_MISMATCH");
      }
      if (!result.ok) {
        throw new ApiError(400, result.message || "Check the suggestion and try again.", "VALIDATION_FAILED");
      }
      return { id: result.id, duplicate: result.duplicate };
    },

    "GET /api/admin/suggestions": (ctx) => {
      requireAdmin(ctx);
      noStore(ctx);
      const rawStatus = typeof ctx.query?.status === "string" ? ctx.query.status.trim() : "";
      const rawCategory = typeof ctx.query?.category === "string" ? ctx.query.category.trim() : "";
      const status = rawStatus ? normalizeSuggestionStatus(rawStatus) : null;
      const category = rawCategory ? normalizeSuggestionCategory(rawCategory) : null;
      if (rawStatus && !status) throw new ApiError(400, "Choose a valid suggestion status.", "VALIDATION_FAILED");
      if (rawCategory && !category) throw new ApiError(400, "Choose a valid suggestion category.", "VALIDATION_FAILED");
      const rawBefore = typeof ctx.query?.before === "string" ? ctx.query.before.trim() : "";
      const before = rawBefore ? decodeSuggestionCursor(rawBefore) : null;
      if (rawBefore && !before) throw new ApiError(400, "That suggestion page expired. Refresh the inbox.", "VALIDATION_FAILED");
      return service.list({ status, category, before, limit: ctx.query?.limit, at: now() });
    },

    "PATCH /api/admin/suggestions/:id": (ctx) => {
      requireAdmin(ctx);
      noStore(ctx);
      const id = typeof ctx.params?.id === "string" ? ctx.params.id.trim() : "";
      const status = normalizeSuggestionStatus(ctx.body?.status);
      if (!isSuggestionId(id)) throw new ApiError(400, "Choose a valid suggestion.", "VALIDATION_FAILED");
      if (!status) throw new ApiError(400, "Choose a valid suggestion status.", "VALIDATION_FAILED");
      const result = service.updateStatus({
        id,
        status,
        at: now(),
        // Audit only the categorical transition. Suggestion text must expire
        // with its row instead of surviving indefinitely in moderation history.
        audit: ({ previousStatus, status: nextStatus }) => recordModerationAction(
          ctx,
          "suggestion_status",
          "product_suggestion",
          id,
          "",
          { status: previousStatus },
          { status: nextStatus },
        ),
      });
      if (!result) throw new ApiError(404, "That suggestion is no longer available.", "NOT_FOUND");
      return result;
    },
  });
}
