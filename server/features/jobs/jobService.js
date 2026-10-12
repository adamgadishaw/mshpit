import { jobPublishable, normalizeJobDraft } from "../../../src/domain/jobs.mjs";
export function createJobService({ repository, ApiError, assertSafeAuthoredText }) {
  function draftFor(input) {
    let draft;
    try { draft = normalizeJobDraft(input); }
    catch { throw new ApiError(400, "Check the job fields and their lengths.", "VALIDATION_FAILED"); }
    for (const field of ["title", "location", "arrangement", "description"]) assertSafeAuthoredText(draft[field], { field: `job ${field}` });
    return draft;
  }
  return {
    create({ id, input, at, accountId }) {
      const draft = draftFor(input);
      const existing = repository.read(id);
      if (existing) {
        if (JSON.stringify(existing.draft) === JSON.stringify(draft) && existing.revision === 1) return existing;
        throw new ApiError(409, "That job creation already completed. Refresh the jobs list.", "CONFLICT");
      }
      repository.insert({ id, draft, at, accountId });
      return repository.read(id);
    },
    update({ id, input, at, accountId }) {
      const current = repository.read(id);
      if (!current) throw new ApiError(404, "Job not found.", "NOT_FOUND");
      if (!Number.isSafeInteger(input?.revision) || input.revision !== current.revision) throw new ApiError(409, "This job changed. Reload it before saving.", "CONFLICT");
      const action = input.action;
      if (!["save", "publish", "close", "archive"].includes(action)) throw new ApiError(400, "Choose a job action.", "VALIDATION_FAILED");
      if (current.state === "archived") throw new ApiError(409, "Archived jobs are read-only.", "CONFLICT");
      const draft = action === "save" || action === "publish" ? draftFor(input.draft) : current.draft;
      if (action === "publish" && !jobPublishable(draft)) throw new ApiError(400, "Complete every field and provide an HTTPS application URL or email before publishing.", "VALIDATION_FAILED");
      const state = action === "publish" ? "published" : action === "close" ? "closed" : action === "archive" ? "archived" : current.state;
      const published = action === "publish" ? draft : current.published;
      const result = repository.update({ id, draft, published, state, revision: current.revision, at, accountId });
      if (result.changes !== 1) throw new ApiError(409, "This job changed. Reload it before saving.", "CONFLICT");
      return repository.read(id);
    },
  };
}
