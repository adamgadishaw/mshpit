import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createSearchGrowthService } from "./searchGrowthService.js";
import { searchGrowthRoutes } from "./searchGrowthRoutes.js";

class ApiError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
function fixture(t) {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec(`CREATE TABLE moderation_actions(id TEXT PRIMARY KEY,actor_id TEXT,action TEXT,target_type TEXT,target_id TEXT,
    reason TEXT,prior_state TEXT,next_state TEXT,request_id TEXT,created_at INTEGER)`);
  const service = createSearchGrowthService({ database, env: {}, client: { readWindow: () => assert.fail("HTTP must not call Google") } });
  const limits = [];
  const routes = searchGrowthRoutes({ database, service, ApiError,
    requireAdmin: ctx => { if (!ctx.actor?.admin) throw new ApiError(403, "Admin required", "FORBIDDEN"); return ctx.actor; },
    rateLimit: (...args) => limits.push(args.slice(1)), now: () => 1000 });
  const headers = {};
  const ctx = { actor: { id: "admin", admin: true, email_verified_at: 1 }, requestId: "request", setHeader: (key, value) => { headers[key] = value; } };
  return { database, service, routes, ctx, headers, limits };
}
const GET = "GET /api/moderation/search-growth", POST = "POST /api/moderation/search-growth";

test("search growth controls require staff and verified email for writes, and never public-cache status", t => {
  const f = fixture(t);
  assert.throws(() => f.routes[GET]({ ...f.ctx, actor: null }), error => error.status === 403);
  assert.throws(() => f.routes[POST]({ ...f.ctx, actor: { ...f.ctx.actor, email_verified_at: null }, body: { mode: "paused" } }), error => error.code === "EMAIL_VERIFICATION_REQUIRED");
  assert.equal(f.routes[GET](f.ctx).mode, "monitor");
  assert.equal(f.headers["Cache-Control"], "private, no-store");
  assert.deepEqual(f.limits[0], ["search-growth-read", 120, 600_000]);
});

test("mode writes are strict, conflict-aware, audited and cannot enable the master switch", async t => {
  const f = fixture(t);
  for (const body of [null, [], {}, { mode: "paused" }, { mode: "run-now" }, { mode: "prioritize", url: "https://evil.test" }, { mode: "paused", expectedMode: "bad" }]) {
    assert.throws(() => f.routes[POST]({ ...f.ctx, body }), error => error.status === 400);
  }
  const result = f.routes[POST]({ ...f.ctx, body: { mode: "prioritize", expectedMode: "monitor" } });
  assert.equal(result.mode, "prioritize");
  assert.equal(result.enabled, false);
  assert.deepEqual(await f.service.runOnce(), { outcome: "disabled" });
  assert.throws(() => f.routes[POST]({ ...f.ctx, body: { mode: "paused", expectedMode: "monitor" } }), error => error.status === 409);
  f.routes[POST]({ ...f.ctx, body: { mode: "prioritize", expectedMode: "monitor" } });
  assert.equal(f.database.prepare("SELECT COUNT(*) n FROM moderation_actions").get().n, 1, "desired-state retry does not duplicate audit");
  assert.equal(f.headers["Cache-Control"], "private, no-store");
});

test("mode change and lease revocation roll back if the moderation audit fails", t => {
  const f = fixture(t);
  f.database.exec("UPDATE search_growth_state SET lease_token='existing-owner',lease_expires_at=9999999999999; CREATE TRIGGER fail_audit BEFORE INSERT ON moderation_actions BEGIN SELECT RAISE(ABORT,'fixture'); END");
  assert.throws(() => f.routes[POST]({ ...f.ctx, body: { mode: "paused", expectedMode: "monitor" } }), /fixture/u);
  const state = f.database.prepare("SELECT mode,lease_token FROM search_growth_state").get();
  assert.deepEqual({ ...state }, { mode: "monitor", lease_token: "existing-owner" });
});
