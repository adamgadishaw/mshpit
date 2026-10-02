import { catalogType } from "./catalogApiPolicy.js";

export function catalogApiRoutes({ service, requireOwner, rateLimit, decodedPathParam }) {
  const type = ctx => catalogType(ctx.params.type);
  const key = ctx => decodedPathParam(ctx, "key", { max: 600, label: "catalog key" });
  const id = ctx => decodedPathParam(ctx, "id", { max: 100, label: "catalog identifier" });
  const authorization = ctx => ctx.catalogApiAuthorization || "";
  const size = ctx => ctx.query?.limit == null ? undefined : Number(ctx.query.limit);
  const prepare = (ctx, action) => {
    service.assertEnabled();
    ctx.setHeader?.("Cache-Control", "private, no-store");
    rateLimit(ctx, "catalog-api-auth", 120, 60_000);
    const grant = service.authorize(authorization(ctx), `catalog:${type(ctx)}:${action}`);
    rateLimit(ctx, `catalog-api-${action === "read" ? "read" : "write"}`, action === "read" ? 120 : 60,
      action === "read" ? 60_000 : 60 * 60_000, { grantId: grant.id, ownerId: grant.ownerId });
  };
  const write = (ctx, method, action = "propose") => {
    prepare(ctx, action);
    return service[method]({ authorization: authorization(ctx),
      body: { ...ctx.body, type: type(ctx), key: key(ctx) }, idempotencyKey: ctx.catalogApiIdempotencyKey || "" });
  };
  const owner = ctx => {
    service.assertEnabled();
    ctx.setHeader?.("Cache-Control", "private, no-store");
    const actor = requireOwner(ctx);
    rateLimit(ctx, "catalog-api-owner", 60, 60 * 60_000, { ownerId: actor.id });
    return actor.id;
  };
  return {
    "GET /api/catalog/v1/:type/inventory": ctx => {
      prepare(ctx, "read");
      return service.inventory({ authorization: authorization(ctx), type: type(ctx), cursor: ctx.query?.cursor, limit: size(ctx) });
    },
    "GET /api/catalog/v1/:type/entities/:key": ctx => {
      prepare(ctx, "read");
      return service.read({ authorization: authorization(ctx), type: type(ctx), key: key(ctx) });
    },
    "GET /api/catalog/v1/:type/status": ctx => {
      prepare(ctx, "read");
      return service.status({ authorization: authorization(ctx), type: type(ctx), after: ctx.query?.after, limit: size(ctx) });
    },
    "GET /api/catalog/v1/:type/proposals/:id": ctx => {
      prepare(ctx, "read");
      return service.proposal({ authorization: authorization(ctx), type: type(ctx), id: id(ctx) });
    },
    "POST /api/catalog/v1/:type/entities/:key/claim": ctx => write(ctx, "claim"),
    "POST /api/catalog/v1/:type/entities/:key/renew": ctx => write(ctx, "renew"),
    "POST /api/catalog/v1/:type/entities/:key/propose": ctx => write(ctx, "propose"),
    "POST /api/catalog/v1/:type/entities/:key/commit": ctx => write(ctx, "commit", "commit"),
    "POST /api/catalog/v1/:type/entities/:key/finish": ctx => write(ctx, "finish"),
    "GET /api/moderation/catalog-proposals/:id": ctx => service.reviewDetail({ ownerId: owner(ctx), proposalId: id(ctx) }),
    "POST /api/moderation/catalog-proposals/:id/review": ctx => service.review({ ownerId: owner(ctx),
      proposalId: id(ctx), payloadHash: ctx.body?.payloadHash, approved: ctx.body?.approved }),
    "POST /api/moderation/catalog-work/control": ctx => service.control({ ownerId: owner(ctx),
      paused: ctx.body?.paused, expectedRevision: ctx.body?.expectedRevision }),
    "DELETE /api/moderation/catalog-grants/:id": ctx => service.revoke({ ownerId: owner(ctx), grantId: id(ctx) }),
  };
}
