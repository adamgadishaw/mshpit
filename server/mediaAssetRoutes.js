import { cancelMediaAsset } from "./mediaAssets.js";

// New media handlers live outside the legacy API monolith. Dependencies that
// carry authentication, the database, and the clock are passed explicitly so
// this module cannot silently create a second API/runtime shell.
export function mediaAssetRoutes({ database, requireUser, now, cancelFinalizeJob = null }) {
  return {
    "DELETE /api/media/assets/:id": (ctx) => {
      const user = requireUser(ctx);
      const result = cancelMediaAsset(database, {
        ownerId: user.id,
        assetId: ctx.params.id,
        at: now(),
      });
      // Delete/ownership validation wins first. Only a successfully removed
      // owner draft may stop its exact detached verifier job; foreign, missing,
      // and already-published assets cannot cancel somebody else's work.
      if (result.removed && typeof cancelFinalizeJob === "function") {
        cancelFinalizeJob({ ownerId: user.id, assetId: ctx.params.id, at: now() });
      }
      return result;
    },
  };
}
