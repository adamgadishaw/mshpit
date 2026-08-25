import { ApiError } from "./errors.js";
import {
  createLegacyMediaUpload,
  finalizeLegacyMediaUpload,
} from "./mediaLegacyFinalize.js";

// Legacy profile/review pickers stage camera bytes in private object storage.
// A second owner-bound call decodes and re-encodes them server-side; only that
// sanitized public result may be associated with an account-visible field.
export function mediaLegacyFinalizeRoutes({ database, requireUser, now }) {
  return {
    "POST /api/media/presign": (ctx) => {
      const user = requireUser(ctx);
      // Upload volume is governed by the durable per-owner ledger and global
      // storage circuit breakers, not a member-facing request count bucket.
      const legacyPurpose = String(ctx.body?.purpose || "").trim().toLowerCase();
      const legacyType = String(ctx.body?.contentType || "").split(";", 1)[0].trim().toLowerCase();
      if (legacyPurpose === "post") {
        throw new ApiError(400, "New post media must use PIT's verified media asset flow.", "VALIDATION_FAILED");
      }
      if (legacyType.startsWith("video/")) {
        throw new ApiError(415, "New video must use PIT's verified clip and cover-frame flow.", "MEDIA_TYPE_UNSUPPORTED");
      }
      const prepared = createLegacyMediaUpload(database, {
        ownerId: user.id,
        body: ctx.body,
        at: now(),
      });
      return {
        ...prepared.upload,
        descriptorId: prepared.descriptorId,
        finalizeToken: prepared.finalizeToken,
        finalizeExpiresAt: prepared.finalizeExpiresAt,
      };
    },
    "POST /api/media/finalize": async (ctx) => {
      const user = requireUser(ctx);
      const finalizeToken = typeof ctx.body?.finalizeToken === "string" ? ctx.body.finalizeToken : "";
      if (!finalizeToken) {
        throw new ApiError(400, "Photo finalization is missing.", "VALIDATION_FAILED");
      }
      return finalizeLegacyMediaUpload(database, {
        ownerId: user.id,
        finalizeToken,
        at: now(),
        signal: ctx.signal,
      });
    },
  };
}
