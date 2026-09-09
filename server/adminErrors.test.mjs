import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "pit-admin-errors-"));
process.env.PIT_DATA_DIR = directory;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { recordError } = await import("./errorLog.js");

q.insertUser.run("errors_admin", "errors-admin@example.com", "Error Admin", "errorsadmin", "test-hash", "admin", "Toronto", 43.65, -79.38, "EA", "#123456", Date.now());
const admin = q.userById.get("errors_admin");
const readErrors = (ctx = { user: admin }) => routes["GET /api/admin/errors"](ctx);
beforeEach(() => db.exec("DELETE FROM error_events"));
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

test("admin diagnostics project the latest request and occurrence alongside retained counts", () => {
  const requestId = "123e4567-e89b-42d3-a456-426614174001";
  const firstSeen = Date.now() - 10 * 24 * 3_600_000;
  const lastSeen = Date.now();
  const common = { code: "PROVIDER_UNAVAILABLE", status: 502, method: "GET", route: "/api/artists/resolve", cause: "ProviderError/http_error" };
  const fingerprint = recordError({ ...common, at: firstSeen });
  recordError({ ...common, at: lastSeen, requestId });
  const response = readErrors();
  assert.deepEqual(response.errors, [{
    fingerprint, level: "error", code: common.code, status: common.status,
    method: common.method, route: common.route, cause: common.cause, count: 2,
    firstSeen, lastSeen, lastRequestId: requestId,
  }]);
  assert.equal(response.last24h.occurrences, 1);
  assert.equal(response.last7Days.occurrences, 1);
});

test("admin diagnostics do not invent request IDs or disclose the ledger without admin access", () => {
  recordError({ code: "UNKNOWN", status: 500, requestId: "token=secret" });
  assert.equal(readErrors().errors[0].lastRequestId, null);
  assert.throws(() => readErrors({}), { status: 401 });
  assert.throws(() => readErrors({ user: { id: "fan", role: "fan" } }), { status: 403 });
});
