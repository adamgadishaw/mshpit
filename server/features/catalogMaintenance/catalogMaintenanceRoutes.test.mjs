import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ApiError } from "../../errors.js";
import { catalogMaintenanceRoutes } from "./catalogMaintenanceRoutes.js";

function fixture(t) {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec(`CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT);
    INSERT INTO app_meta VALUES ('mode','maintenance'),('requests','100');
    CREATE TABLE moderation_actions(id TEXT,actor_id TEXT,action TEXT,target_type TEXT,target_id TEXT,
      reason TEXT,prior_state TEXT,next_state TEXT,request_id TEXT,created_at INTEGER);`);
  let inspections = 0;
  const inspectControl = () => ({ mode: database.prepare("SELECT value FROM app_meta WHERE key='mode'").get().value });
  const routes = catalogMaintenanceRoutes({ database, ApiError,
    requireAdmin(ctx) {
      if (!ctx.user) throw new ApiError(401, "Sign in.", "AUTH_REQUIRED");
      if (ctx.user.role !== "admin" || ctx.user.is_banned) throw new ApiError(403, "Admins only.", "FORBIDDEN");
      return ctx.user;
    }, rateLimit() {}, inspectControl,
    setControl(mode) { database.prepare("UPDATE app_meta SET value=? WHERE key='mode'").run(mode); },
    collectStatus() { inspections++; return { catalog: inspectControl() }; }, now: () => 123456,
  });
  const context = (body) => ({ body, user: { id: "admin", role: "admin", email_verified_at: 1 },
    requestId: "req-1", headers: {}, setHeader(key, value) { this.headers[key] = value; } });
  return { database, context, inspectControl, inspections: () => inspections,
    read: routes["GET /api/moderation/catalog-maintenance"], write: routes["POST /api/moderation/catalog-maintenance"] };
}

test("catalog controls reject guests, ordinary members, moderators and restricted admins before inspection", (t) => {
  const f = fixture(t);
  for (const user of [null, { role: "user" }, { role: "moderator" }, { role: "admin", is_banned: true }]) {
    for (const handler of [f.read, f.write]) assert.throws(() => handler({ user, body: { mode: "catch_up" } }), ApiError);
  }
  assert.equal(f.inspections(), 0);
  assert.equal(f.inspectControl().mode, "maintenance");
});

test("catalog status is private and read-only; a verified admin changes mode with an audit", (t) => {
  const f = fixture(t), ctx = f.context({ mode: "catch_up", expectedMode: "maintenance" });
  assert.equal(f.read(ctx).catalog.mode, "maintenance");
  assert.equal(ctx.headers["Cache-Control"], "private, no-store");
  assert.equal(f.write(ctx).catalog.mode, "catch_up");
  const audit = f.database.prepare("SELECT * FROM moderation_actions").get();
  assert.equal(audit.actor_id, "admin");
  assert.deepEqual(JSON.parse(audit.prior_state), { mode: "maintenance" });
  assert.deepEqual(JSON.parse(audit.next_state), { mode: "catch_up" });
  assert.equal(f.database.prepare("SELECT value FROM app_meta WHERE key='requests'").get().value, "100");
});

test("catalog desired-state replay is idempotent even with an old expected mode", (t) => {
  const f = fixture(t), ctx = f.context({ mode: "paused", expectedMode: "maintenance" });
  f.write(ctx); f.write(ctx);
  assert.equal(f.database.prepare("SELECT COUNT(*) n FROM moderation_actions").get().n, 1);
});

test("catalog controls reject stale changes, invalid input, and attempts to change limits or provider URLs", (t) => {
  const f = fixture(t);
  assert.throws(() => f.write(f.context({ mode: "catch_up", expectedMode: "paused" })), (e) => e.code === "CONFLICT");
  for (const body of [null, [], {}, { mode: "run_now" }, { mode: "catch_up", requests: 99999 },
    { mode: "catch_up", url: "http://localhost/private" }, { mode: "catch_up", expectedMode: 7 }]) {
    assert.throws(() => f.write(f.context(body)), (e) => e.code === "VALIDATION_FAILED");
  }
  assert.equal(f.inspectControl().mode, "maintenance");
});

test("unverified admins cannot change catalog upkeep", (t) => {
  const f = fixture(t), ctx = f.context({ mode: "catch_up" }); ctx.user.email_verified_at = 0;
  assert.throws(() => f.write(ctx), (e) => e.code === "EMAIL_VERIFICATION_REQUIRED");
  assert.equal(f.inspectControl().mode, "maintenance");
});

test("an audit failure rolls back the mode change", (t) => {
  const f = fixture(t);
  f.database.exec("CREATE TRIGGER audit_failure BEFORE INSERT ON moderation_actions BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
  assert.throws(() => f.write(f.context({ mode: "catch_up" })), /audit unavailable/);
  assert.equal(f.inspectControl().mode, "maintenance");
});
