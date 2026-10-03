export function mediaApiRoutes({ service, requireOwner, rateLimit, ApiError }) {
  if (!service) throw new TypeError("Media API service is required.");
  const body = (ctx) => (ctx.body && typeof ctx.body === "object" && !Array.isArray(ctx.body)) ? ctx.body : {};
  const idempotency = (ctx) => ctx.mediaApiIdempotencyKey || body(ctx).idempotencyKey || "";
  const authorization = (ctx) => ctx.mediaApiAuthorization || "";
  const ensureEnabled = () => service.assertEnabled?.();
  const grantLimit = (ctx, scope, name) => {
    // Cookie identity is unrelated to this bearer grant. Bound failed auth by
    // IP, then charge the authenticated grant and its issuing owner together.
    rateLimit(ctx, "media-api-auth", 120, 60_000);
    const grant = service.authorize(authorization(ctx), scope);
    rateLimit(ctx, name, 20, 60 * 60 * 1000, { grantId: grant.id, ownerId: grant.owner_id });
  };

  return {
    "POST /api/media/v1/grants/pairing": (ctx) => {
      ensureEnabled();
      const owner = requireOwner(ctx);
      rateLimit(ctx, "media-api-pairing", 5, 15 * 60 * 1000, { ownerId: owner.id });
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
      rateLimit(ctx, "media-api-revoke", 20, 60 * 60 * 1000, { ownerId: owner.id });
      return service.revokeGrant({ ownerId: owner.id, grantId: ctx.params.id, requestId: ctx.requestId });
    },
    "POST /api/media/v1/news/drafts": (ctx) => {
      ensureEnabled();
      grantLimit(ctx, "news:write", "media-api-news-create");
      return service.createNewsDraft({ authorization: authorization(ctx), body: body(ctx),
        idempotencyKey: idempotency(ctx), requestId: ctx.requestId });
    },
    "POST /api/media/v1/news/drafts/:id/publish": (ctx) => {
      ensureEnabled();
      grantLimit(ctx, "news:write", "media-api-news-publish");
      return service.publishNewsDraft({ authorization: authorization(ctx), draftId: ctx.params.id,
        expectedRevision: body(ctx).expectedRevision,
        idempotencyKey: idempotency(ctx), requestId: ctx.requestId });
    },
    "POST /api/media/v1/media/assets": (ctx) => {
      ensureEnabled();
      grantLimit(ctx, "media:write", "media-api-media-create");
      return service.createMedia({ authorization: authorization(ctx), body: body(ctx),
        idempotencyKey: idempotency(ctx), requestId: ctx.requestId });
    },
    "POST /api/media/v1/media/assets/:id/finalize": async (ctx) => {
      ensureEnabled();
      grantLimit(ctx, "media:write", "media-api-media-finalize");
      return service.finalizeMedia({ authorization: authorization(ctx), assetId: ctx.params.id,
        body: body(ctx), idempotencyKey: idempotency(ctx), requestId: ctx.requestId, signal: ctx.signal });
    },
  };
}
