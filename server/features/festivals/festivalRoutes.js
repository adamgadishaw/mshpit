import { createFestivalReader, FESTIVAL_PLAN_LIMITS } from "./festivalStore.js";
import { editionDays } from "./festivalEditions.js";

const TEN_MINUTES = 10 * 60 * 1000;
const SLUG = /^[a-z0-9-]{1,80}$/u;

// Festivals: the Discover list, one festival's page, and a member's plan for
// an edition (the days they are going, the sets they don't want to miss).
export function festivalRoutes({ database, ApiError, requireVerifiedUser, rateLimit, clean, decodedPathParam, now = Date.now }) {
  const reader = createFestivalReader(database, { now });
  const slugParam = (ctx) => {
    const slug = decodedPathParam(ctx, "slug", { max: 80, label: "festival link" }).toLowerCase();
    if (!SLUG.test(slug)) throw new ApiError(404, "That festival is not on Mshpit yet.", "NOT_FOUND");
    return slug;
  };
  const savePlan = database.prepare(`INSERT INTO festival_plans (user_id,edition_id,days,must_see,created_at,updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(user_id,edition_id) DO UPDATE SET days=excluded.days, must_see=excluded.must_see, updated_at=excluded.updated_at`);
  const removePlan = database.prepare("DELETE FROM festival_plans WHERE user_id=? AND edition_id=?");

  const editionFor = (ctx, slug, editionId) => {
    const edition = reader.edition(clean(editionId, { max: 160 }) || "");
    if (!edition || edition.festivalSlug !== slug) throw new ApiError(404, "That festival date is no longer listed.", "NOT_FOUND");
    return edition;
  };

  return {
    "GET /api/festivals": (ctx) => {
      rateLimit(ctx, "festivals", 240, TEN_MINUTES);
      const country = (clean(ctx.query?.country, { max: 2 }) || "").toUpperCase();
      if (country && !/^[A-Z]{2}$/u.test(country)) throw new ApiError(400, "Choose a country by its two-letter code.", "VALIDATION_FAILED");
      ctx.setHeader?.("Cache-Control", "public, max-age=60");
      return { upcoming: reader.upcoming({ country }), festivals: reader.festivals() };
    },

    "GET /api/festivals/:slug": (ctx) => {
      rateLimit(ctx, "festival", 240, TEN_MINUTES);
      const page = reader.festival(slugParam(ctx), { viewerId: ctx.user?.id || null });
      if (!page) throw new ApiError(404, "That festival is not on Mshpit yet.", "NOT_FOUND");
      ctx.setHeader?.("Cache-Control", ctx.user ? "private, no-store" : "public, max-age=60");
      return page;
    },

    // Going to an edition: which days, and the acts they don't want to miss.
    "PUT /api/festivals/:slug/plan": (ctx) => {
      const user = requireVerifiedUser(ctx);
      rateLimit(ctx, "festival-plan", 60, TEN_MINUTES);
      const slug = slugParam(ctx);
      const body = ctx.body && typeof ctx.body === "object" && !Array.isArray(ctx.body) ? ctx.body : {};
      const edition = editionFor(ctx, slug, body.editionId);
      const allowedDays = new Set(editionDays(edition.startDate, edition.endDate));
      if (!Array.isArray(body.days) || body.days.some((day) => typeof day !== "string")) {
        throw new ApiError(400, "Pick the days you're going.", "VALIDATION_FAILED");
      }
      const days = [...new Set(body.days)].filter((day) => allowedDays.has(day)).sort();
      if (!days.length) throw new ApiError(400, "Pick at least one day of the festival.", "VALIDATION_FAILED");
      const lineup = new Map(edition.lineup.map((act) => [act.name.toLowerCase(), act.name]));
      const requested = Array.isArray(body.mustSee) ? body.mustSee : [];
      if (requested.some((name) => typeof name !== "string")) throw new ApiError(400, "Must-see acts must be names from the lineup.", "VALIDATION_FAILED");
      const mustSee = [...new Set(requested.map((name) => lineup.get(name.trim().toLowerCase())).filter(Boolean))].slice(0, FESTIVAL_PLAN_LIMITS.mustSee);
      const at = now();
      savePlan.run(user.id, edition.id, JSON.stringify(days), JSON.stringify(mustSee), at, at);
      return { plan: { editionId: edition.id, days, mustSee, updatedAt: at } };
    },

    "DELETE /api/festivals/:slug/plan": (ctx) => {
      const user = requireVerifiedUser(ctx);
      rateLimit(ctx, "festival-plan", 60, TEN_MINUTES);
      const slug = slugParam(ctx);
      const edition = editionFor(ctx, slug, ctx.query?.editionId);
      removePlan.run(user.id, edition.id);
      return { plan: null };
    },
  };
}
