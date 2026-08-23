import { cancelMediaAsset } from "./mediaAssets.js";

// New media handlers live outside the legacy API monolith. Dependencies that
// carry authentication, request limits, the database, and the clock are passed
// explicitly so this module cannot silently create a second API/runtime shell.
export function mediaAssetRoutes({ database, requireUser, limit, now }) {
  return {
    "DELETE /api/media/assets/:id": (ctx) => {
      const user = requireUser(ctx);
      limit(ctx, "media-asset-cancel", 60, 10 * 60 * 1000);
      return cancelMediaAsset(database, {
        ownerId: user.id,
        assetId: ctx.params.id,
        at: now(),
      });
    },
  };
}
