import { cancelMediaAsset } from "./mediaAssets.js";

// New media handlers live outside the legacy API monolith. Dependencies that
// carry authentication, the database, and the clock are passed explicitly so
// this module cannot silently create a second API/runtime shell.
export function mediaAssetRoutes({ database, requireUser, now }) {
  return {
    "DELETE /api/media/assets/:id": (ctx) => {
      const user = requireUser(ctx);
      return cancelMediaAsset(database, {
        ownerId: user.id,
        assetId: ctx.params.id,
        at: now(),
      });
    },
  };
}
