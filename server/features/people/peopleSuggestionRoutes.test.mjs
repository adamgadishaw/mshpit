import test from "node:test";
import assert from "node:assert/strict";
import { peopleSuggestionRoutes } from "./peopleSuggestionRoutes.js";

test("people suggestion route authenticates, rate limits, and delegates a bounded request", () => {
  const calls = [];
  const route = peopleSuggestionRoutes({
    service: { list: (viewer, options) => { calls.push({ viewer, options }); return [{ user: { id: "friend" } }]; } },
    requireUser: (ctx) => {
      if (!ctx.user) throw new Error("AUTH");
      return ctx.user;
    },
    rateLimit: (...args) => calls.push({ rate: args.slice(1) }),
  })["GET /api/people/suggestions"];
  assert.throws(() => route({ query: {} }), /AUTH/);
  const headers = {};
  const response = route({
    user: { id: "me" },
    query: { limit: "5" },
    setHeader: (name, value) => { headers[name] = value; },
  });
  assert.deepEqual(response, { suggestions: [{ user: { id: "friend" } }] });
  assert.deepEqual(calls[0].rate, ["people-suggestions", 60, 600000]);
  assert.deepEqual(calls[1], { viewer: { id: "me" }, options: { limit: "5" } });
  assert.equal(headers["Cache-Control"], "private, no-store");
});
