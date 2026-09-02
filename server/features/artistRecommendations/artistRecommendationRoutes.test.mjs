import test from "node:test";
import assert from "node:assert/strict";
import { artistRecommendationRoutes } from "./artistRecommendationRoutes.js";

test("artist recommendation route is authenticated, private, rate limited, and bounded", () => {
  const calls = [];
  const route = artistRecommendationRoutes({
    service: { list: (viewer, options) => { calls.push({ viewer, options }); return { recommendations: [] }; } },
    requireUser: (ctx) => {
      if (!ctx.user) throw new Error("AUTH");
      return ctx.user;
    },
    rateLimit: (...args) => calls.push({ rate: args.slice(1) }),
  })["GET /api/me/artist-recommendations"];
  assert.throws(() => route({ query: {} }), /AUTH/);
  const headers = {};
  const response = route({
    user: { id: "me" },
    query: { limit: "6" },
    setHeader: (name, value) => { headers[name] = value; },
  });
  assert.deepEqual(response, { recommendations: [] });
  assert.deepEqual(calls[0].rate, ["artist-recommendations", 60, 600000]);
  assert.deepEqual(calls[1], { viewer: { id: "me" }, options: { limit: "6" } });
  assert.equal(headers["Cache-Control"], "private, no-store");
});
