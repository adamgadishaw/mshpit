import {
  CREW_PURPOSES,
  CrewError,
  crewCountsForTourDate,
  crewPeopleDeck,
  crewShowDeck,
  listCrewMatches,
  listMyCrewShows,
  passCrewShow,
  setCrewSeeking,
  stopCrewSeeking,
  swipeCrewPerson,
} from "./crewService.js";

// Crew API. Browsing the shows deck needs an account; everything that shows
// you to other people also needs a confirmed email and an adult age group.
export function crewRoutes({
  database,
  ApiError,
  rateLimit,
  requireUser,
  requireVerifiedUser,
  visibleTourDates,
  projectShow,
  projectUser,
  blockedEitherWay,
  isAvailable = () => true,
  notifyMatch = () => {},
  now = Date.now,
}) {
  const noStore = (ctx) => ctx.setHeader?.("Cache-Control", "private, no-store");
  const run = (work) => {
    try {
      return work();
    } catch (error) {
      if (!(error instanceof CrewError)) throw error;
      if (error.status === 404) throw new ApiError(404, error.message, "NOT_FOUND");
      if (error.status === 400) throw new ApiError(400, error.message, "VALIDATION_FAILED");
      if (error.status === 409) throw new ApiError(409, error.message, "CONFLICT");
      throw new ApiError(403, error.message, "FORBIDDEN");
    }
  };
  const tourDateParam = (ctx) => (typeof ctx.params?.tourDateId === "string" ? decodeURIComponent(ctx.params.tourDateId) : "");
  return {
    "GET /api/crew/purposes": (ctx) => {
      ctx.setHeader?.("Cache-Control", "public, max-age=3600");
      return { purposes: Object.entries(CREW_PURPOSES).map(([id, label]) => ({ id, label })) };
    },
    "GET /api/crew/shows": (ctx) => {
      const user = requireUser(ctx);
      rateLimit(ctx, "crew-deck", 120, 10 * 60_000);
      noStore(ctx);
      return run(() => crewShowDeck(database, {
        user,
        city: typeof ctx.query?.city === "string" ? ctx.query.city : null,
        visibleTourDates,
        projectShow,
        at: now(),
      }));
    },
    "POST /api/crew/shows/:tourDateId/pass": (ctx) => {
      const user = requireUser(ctx);
      rateLimit(ctx, "crew-pass", 600, 60 * 60_000);
      noStore(ctx);
      return run(() => passCrewShow(database, { user, tourDateId: tourDateParam(ctx), at: now() }));
    },
    "GET /api/crew/shows/:tourDateId/counts": (ctx) => {
      rateLimit(ctx, "crew-counts", 240, 60_000);
      ctx.setHeader?.("Cache-Control", "public, max-age=60");
      return { counts: crewCountsForTourDate(database, tourDateParam(ctx)) };
    },
    "PUT /api/crew/shows/:tourDateId/seeking": (ctx) => {
      const user = requireVerifiedUser(ctx);
      rateLimit(ctx, "crew-seeking", 60, 60 * 60_000);
      noStore(ctx);
      const body = ctx.body && typeof ctx.body === "object" ? ctx.body : {};
      return run(() => setCrewSeeking(database, {
        user, tourDateId: tourDateParam(ctx), purposes: body.purposes, note: body.note, at: now(),
      }));
    },
    "DELETE /api/crew/shows/:tourDateId/seeking": (ctx) => {
      const user = requireUser(ctx);
      noStore(ctx);
      return run(() => stopCrewSeeking(database, { user, tourDateId: tourDateParam(ctx) }));
    },
    "GET /api/crew/shows/:tourDateId/people": (ctx) => {
      const user = requireVerifiedUser(ctx);
      rateLimit(ctx, "crew-people", 120, 10 * 60_000);
      noStore(ctx);
      return run(() => crewPeopleDeck(database, {
        user, tourDateId: tourDateParam(ctx), projectUser, blockedEitherWay, isAvailable,
      }));
    },
    "POST /api/crew/shows/:tourDateId/people/:userId": (ctx) => {
      const user = requireVerifiedUser(ctx);
      rateLimit(ctx, "crew-swipe", 300, 24 * 60 * 60_000);
      noStore(ctx);
      const decision = ctx.body?.decision;
      const result = run(() => swipeCrewPerson(database, {
        user, tourDateId: tourDateParam(ctx), targetId: ctx.params?.userId, decision, blockedEitherWay, at: now(),
      }));
      if (result.matched && result.created) notifyMatch({ user, targetId: ctx.params.userId, tourDateId: tourDateParam(ctx) });
      return { matched: result.matched, person: result.matched ? projectUser(ctx.params.userId) : null };
    },
    "GET /api/crew/me": (ctx) => {
      const user = requireUser(ctx);
      noStore(ctx);
      return {
        eligible: user.age_band === "18_plus",
        ageBand: user.age_band || "unknown",
        emailConfirmed: !!user.email_verified_at,
        shows: listMyCrewShows(database, { user }),
        matches: listCrewMatches(database, { user, projectUser, blockedEitherWay }),
      };
    },
  };
}
