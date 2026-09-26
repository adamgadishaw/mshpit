import { CrewError, crewShowDeck, passCrewShow } from "./crewService.js";
import {
  closeLoungePlan,
  createLoungePlan,
  joinLoungePlan,
  leaveLoungePlan,
  listLoungePlans,
  listMyPlans,
  listPlanMessages,
  planLoungeKey,
  postPlanMessage,
  removePlanMember,
} from "./showPlansService.js";

// Show swipe and Lounge plans. Swiping needs an account. Plans also need a
// confirmed email, an adult age group, a place on the show's Going list and
// an open Lounge, the same gate as the Lounge's own messages.
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
  loungeKeyParam,
  openLounge,
  loungeIsOpen = () => true,
  isStaff = () => false,
  assertSafeText = () => {},
  notifyPlanJoin = () => {},
  newId,
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
  const planParam = (ctx) => (typeof ctx.params?.planId === "string" ? ctx.params.planId.slice(0, 80) : "");
  // A plan is reachable only while its show's Lounge is open to this member.
  const planGate = (ctx, user) => {
    const key = planLoungeKey(database, planParam(ctx));
    if (!key) throw new ApiError(404, "This plan is no longer open.", "NOT_FOUND");
    openLounge(user, key);
    return key;
  };
  const plansFor = (user, loungeKey) => run(() => listLoungePlans(database, { user, loungeKey, projectUser, blockedEitherWay }));
  const plansAfterChange = (ctx, user, key) => {
    if (!key || user.age_band !== "18_plus" || !loungeIsOpen(key)) return [];
    try {
      requireVerifiedUser(ctx);
      openLounge(user, key);
    } catch (error) {
      // Cleanup is allowed after losing access; its response grants no read access.
      if ([401, 403, 404, 410].includes(error?.status)) return [];
      throw error;
    }
    return plansFor(user, key);
  };

  return {
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

    "GET /api/lounges/:key/plans": (ctx) => {
      const user = requireVerifiedUser(ctx);
      noStore(ctx);
      const key = loungeKeyParam(ctx);
      openLounge(user, key);
      return { plans: plansFor(user, key) };
    },
    "POST /api/lounges/:key/plans": (ctx) => {
      const user = requireVerifiedUser(ctx);
      noStore(ctx);
      const key = loungeKeyParam(ctx);
      const show = openLounge(user, key);
      const body = ctx.body && typeof ctx.body === "object" ? ctx.body : {};
      assertSafeText(body.text, "plan");
      rateLimit(ctx, "plan-create", 10, 24 * 60 * 60_000);
      run(() => createLoungePlan(database, {
        user, loungeKey: key, show, kind: body.kind, text: body.text, spots: body.spots,
        id: newId("plan"), at: now(), projectUser, blockedEitherWay,
      }));
      return { plans: plansFor(user, key) };
    },
    "POST /api/plans/:planId/join": (ctx) => {
      const user = requireVerifiedUser(ctx);
      noStore(ctx);
      const key = planGate(ctx, user);
      rateLimit(ctx, "plan-join", 60, 24 * 60 * 60_000);
      const result = run(() => joinLoungePlan(database, { user, planId: planParam(ctx), blockedEitherWay, at: now() }));
      if (result.created) notifyPlanJoin({ plan: result.plan, user });
      return { plans: plansFor(user, key) };
    },
    "POST /api/plans/:planId/leave": (ctx) => {
      const user = requireUser(ctx);
      noStore(ctx);
      const key = planLoungeKey(database, planParam(ctx));
      run(() => leaveLoungePlan(database, { user, planId: planParam(ctx) }));
      return { plans: plansAfterChange(ctx, user, key) };
    },
    "POST /api/plans/:planId/close": (ctx) => {
      const user = requireUser(ctx);
      noStore(ctx);
      const key = planLoungeKey(database, planParam(ctx));
      run(() => closeLoungePlan(database, { user, planId: planParam(ctx), staff: isStaff(user), at: now() }));
      return { plans: plansAfterChange(ctx, user, key) };
    },
    "DELETE /api/plans/:planId/members/:userId": (ctx) => {
      const user = requireUser(ctx);
      noStore(ctx);
      const key = planLoungeKey(database, planParam(ctx));
      run(() => removePlanMember(database, { user, planId: planParam(ctx), memberId: ctx.params?.userId }));
      return { plans: plansAfterChange(ctx, user, key) };
    },
    "GET /api/plans/:planId/messages": (ctx) => {
      const user = requireVerifiedUser(ctx);
      noStore(ctx);
      planGate(ctx, user);
      rateLimit(ctx, "plan-chat-read", 600, 10 * 60_000);
      return run(() => listPlanMessages(database, {
        user, planId: planParam(ctx), after: ctx.query?.after, blockedEitherWay, projectUser,
      }));
    },
    "POST /api/plans/:planId/messages": (ctx) => {
      const user = requireVerifiedUser(ctx);
      noStore(ctx);
      planGate(ctx, user);
      assertSafeText(ctx.body?.text, "plan message");
      rateLimit(ctx, "plan-chat", 120, 60 * 60_000);
      return run(() => postPlanMessage(database, { user, planId: planParam(ctx), text: ctx.body?.text, id: newId("pm"), at: now() }));
    },
    "GET /api/me/plans": (ctx) => {
      const user = requireUser(ctx);
      noStore(ctx);
      return { plans: listMyPlans(database, { user, projectUser, blockedEitherWay }).filter((plan) => loungeIsOpen(plan.show.loungeKey)) };
    },
  };
}
