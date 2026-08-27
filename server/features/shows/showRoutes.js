import { createShowRepository } from "./showRepository.js";

const noStore = (ctx) => ctx.setHeader?.("Cache-Control", "private, no-store");

export function showRoutes({ database, showRepository = null, ApiError, decodeShowKey, requireUser }) {
  if (!database?.prepare || typeof ApiError !== "function"
    || typeof decodeShowKey !== "function" || typeof requireUser !== "function") {
    throw new TypeError("Show routes require complete boundary dependencies");
  }
  const repository = showRepository || createShowRepository(database);

  return Object.freeze({
    "GET /api/shows/:key": (ctx) => {
      noStore(ctx);
      let identity = null;
      try {
        identity = decodeShowKey(ctx);
      } catch {
        throw new ApiError(404, "That show is not available.", "NOT_FOUND");
      }
      const viewer = ctx.user ? requireUser(ctx) : null;
      const show = repository.read(identity, viewer?.id || null);
      if (!show) throw new ApiError(404, "That show is not available.", "NOT_FOUND");
      return { show };
    },
  });
}
