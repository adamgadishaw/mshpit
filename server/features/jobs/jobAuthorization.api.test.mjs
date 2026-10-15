import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const directory = mkdtempSync(join(tmpdir(), "pit-job-authority-"));
process.env.PIT_DATA_DIR = directory;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => assert.fail("Job authorization tests must not call external services");
const { db } = await import("../../db.js");
const { routes } = await import("../../api.js");
after(() => { globalThis.fetch = originalFetch; db.close(); rmSync(directory, { recursive: true, force: true }); });
const draft = { title: "Synthetic role boundary", location: "Fixture", arrangement: "Remote", description: "Test-only opening", application: "fixture@example.test" };
const context = (role, fresh = role, restrictions = {}) => ({
  user: role ? { id: "fixture-admin", role } : null,
  assertCurrentSession: role ? () => ({ id: "fixture-admin", role: fresh, ...restrictions }) : undefined,
  body: { id: "job_actual_auth_fixture", draft }, params: { id: "job_actual_auth_fixture" }, query: {}, ip: "127.0.0.1", setHeader() {},
});
test("registered job routes enforce existing server authority, including role loss and restrictions", () => {
  for (const role of [null, "fan", "artist", "editor", "moderator"]) {
    for (const path of ["GET /api/admin/jobs", "POST /api/admin/jobs", "POST /api/admin/jobs/:id"]) assert.throws(() => routes[path](context(role)), error => error.status === (role ? 403 : 401));
  }
  assert.throws(() => routes["POST /api/admin/jobs"](context("admin", "moderator")), error => error.status === 403);
  assert.throws(() => routes["POST /api/admin/jobs"](context("admin", "admin", { is_banned: 1 })), error => error.status === 403);
  assert.throws(() => routes["POST /api/admin/jobs"](context("admin", "admin", { suspended_until: Date.now()+60000 })), error => error.status === 403);
  const result = routes["POST /api/admin/jobs"](context("admin"));
  assert.equal(result.job.state, "draft");
  assert.equal(routes["GET /api/jobs"](context(null)).jobs.length, 0);
});
