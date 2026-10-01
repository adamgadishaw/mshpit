export function mediaApiRoutes({ service, requireOwner, rateLimit, ApiError }) {
  if (!service) throw new TypeError("Media API service is required.");
  const body = (ctx) => (ctx.body && typeof ctx.body === "object" && !Array.isArray(ctx.body)) ? ctx.body : {};
  const idempotency = (ctx) => ctx.mediaApiIdempotencyKey || body(ctx).idempotencyKey || "";
  const authorization = (ctx) => ctx.mediaApiAuthorization || "";
  const ensureEnabled = () => service.assertEnabled?.();

  return {
    "POST /api/media/v1/grants/pairing": (ctx) => {
      ensureEnabled();
      const owner = requireOwner(ctx);
      rateLimit(ctx, "media-api-pairing", 5, 15 * 60 * 1000);
      const input = body(ctx);
      return service.issuePairing({
        ownerId: owner.id,
        actorType: input.actorType,
        actorLabel: input.actorLabel,
        scopes: input.scopes,
        expiresInSeconds: input.expiresInSeconds,
        requestId: ctx.requestId,
      });
    },
    "POST /api/media/v1/grants/exchange": (ctx) => {
      ensureEnabled();
      rateLimit(ctx, "media-api-exchange", 5, 15 * 60 * 1000);
      const input = body(ctx);
      return service.exchangePairing({ pairingCode: input.pairingCode, requestId: ctx.requestId });
    },
    "DELETE /api/media/v1/grants/:id": (ctx) => {
      ensureEnabled();
      const owner = requireOwner(ctx);
      rateLimit(ctx, "media-api-revoke", 20, 60 * 60 * 1000);
      return service.revokeGrant({ ownerId: owner.id, grantId: ctx.params.id, requestId: ctx.requestId });
    },
    "POST /api/media/v1/news/drafts": (ctx) => {
      ensureEnabled();
      rateLimit(ctx, "media-api-news-create", 20, 60 * 60 * 1000);
      return service.createNewsDraft({ authorization: authorization(ctx), body: body(ctx),
        idempotencyKey: idempotency(ctx), requestId: ctx.requestId });
    },
    "POST /api/media/v1/news/drafts/:id/publish": (ctx) => {
      ensureEnabled();
      rateLimit(ctx, "media-api-news-publish", 20, 60 * 60 * 1000);
      return service.publishNewsDraft({ authorization: authorization(ctx), draftId: ctx.params.id,
        expectedRevision: body(ctx).expectedRevision,
        idempotencyKey: idempotency(ctx), requestId: ctx.requestId });
    },
    "POST /api/media/v1/media/assets": (ctx) => {
      ensureEnabled();
      rateLimit(ctx, "media-api-media-create", 20, 60 * 60 * 1000);
      return service.createMedia({ authorization: authorization(ctx), body: body(ctx),
        idempotencyKey: idempotency(ctx), requestId: ctx.requestId });
    },
    "POST /api/media/v1/media/assets/:id/finalize": async (ctx) => {
      ensureEnabled();
      rateLimit(ctx, "media-api-media-finalize", 20, 60 * 60 * 1000);
      return service.finalizeMedia({ authorization: authorization(ctx), assetId: ctx.params.id,
        body: body(ctx), idempotencyKey: idempotency(ctx), requestId: ctx.requestId, signal: ctx.signal });
    },
  };
}
