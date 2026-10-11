import { createJobRepository } from "./jobRepository.js";
import { createJobService } from "./jobService.js";
export const isJobId = value => typeof value === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(value);
export function jobRoutes({ database, ApiError, assertSafeAuthoredText, requireAdmin, rateLimit, now }) {
  const repository = createJobRepository(database);
  const service = createJobService({ repository, ApiError, assertSafeAuthoredText });
  const idFor = value => {
    if (!isJobId(value)) throw new ApiError(400, "Invalid job link.", "VALIDATION_FAILED");
    return value;
  };
  const cursorFor = ctx => ctx.query?.cursor ? idFor(ctx.query.cursor) : "";
  const noStore = ctx => ctx.setHeader?.("Cache-Control", "no-store");
  const mutationActor = ctx => {
    const actor = requireAdmin(ctx);
    rateLimit(ctx, "admin-jobs", 60, 60000);
    noStore(ctx);
    return actor;
  };
  return {
    "GET /api/jobs": ctx => { noStore(ctx); return repository.publicList(cursorFor(ctx)); },
    "GET /api/jobs/:id": ctx => {
      noStore(ctx);
      const job = repository.publicRead(idFor(ctx.params.id));
      if (!job) throw new ApiError(404, "This opening is no longer available.", "NOT_FOUND");
      return { job };
    },
    "GET /api/admin/jobs": ctx => { requireAdmin(ctx); noStore(ctx); return repository.list(cursorFor(ctx)); },
    "POST /api/admin/jobs": ctx => {
      const actor = mutationActor(ctx);
      return { job: service.create({ id: idFor(ctx.body?.id), input: ctx.body?.draft, at: now(), accountId: actor.id }) };
    },
    "POST /api/admin/jobs/:id": ctx => {
      const actor = mutationActor(ctx);
      return { job: service.update({ id: idFor(ctx.params.id), input: ctx.body, at: now(), accountId: actor.id }) };
    },
  };
}
