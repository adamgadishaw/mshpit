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
const { ownerIdentity, storeOwnerIdentity } = await import("./ownerIdentity.js");
const { recordErrorDetail } = await import("./errorDetails.js");

q.insertUser.run("errors_admin", "errors-admin@example.com", "Error Admin", "errorsadmin", "test-hash", "admin", "Toronto", 43.65, -79.38, "EA", "#123456", Date.now());
const admin = q.userById.get("errors_admin");
q.insertUser.run("errors_owner", "errors-owner@example.com", "Error Owner", "errorsowneradmin", "test-hash", "admin", "Toronto", 43.65, -79.38, "EO", "#123456", Date.now());
const owner = q.userById.get("errors_owner");
storeOwnerIdentity(db, ownerIdentity(owner.email, owner.id));
const readErrors = (ctx = { user: admin }) => routes["GET /api/admin/errors"](ctx);
beforeEach(() => {
  db.exec("DELETE FROM error_events; DELETE FROM error_occurrence_buckets; DELETE FROM error_event_details");
});
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
  assert.equal(response.serious24h.occurrences, 1);
  assert.equal(response.serious24h.patterns[0].occurrences, 1);
  assert.equal(response.serious24h.patterns[0].fingerprint, fingerprint);
  assert.ok(response.serious24h.startedAt <= lastSeen);
  assert.ok(response.serious24h.collectedThrough >= lastSeen);
});

test("admin diagnostics do not invent request IDs or disclose the ledger without admin access", () => {
  recordError({ code: "UNKNOWN", status: 500, requestId: "token=secret" });
  assert.equal(readErrors().errors[0].lastRequestId, null);
  assert.throws(() => readErrors({}), { status: 401 });
  assert.throws(() => readErrors({ user: { id: "fan", role: "fan" } }), { status: 403 });
});

test("only the current locked Owner receives bounded captured details, distinct from latest occurrence", () => {
  const capturedAt = Date.now() - 2 * 3_600_000;
  const lastSeen = Date.now();
  const common = { code: "MEDIA_STORAGE_UNAVAILABLE", status: 503, method: "POST", route: "/api/media/assets/:id/finalize" };
  const fingerprint = recordError({ ...common, at: capturedAt });
  recordErrorDetail(db, {
    fingerprint, release: "1abcf10e1000", location: "server/media.js:123:4 in finalizeMediaAsset",
    reason: "Error: storage refused token=private-key for member@example.com", at: capturedAt,
  });
  recordError({ ...common, at: lastSeen });
  assert.equal(Object.hasOwn(readErrors().errors[0], "detail"), false);
  const row = readErrors({ user: owner }).errors[0];
  assert.deepEqual(row.detail, {
    release: "1abcf10e1000", location: "server/media.js:123:4 in finalizeMediaAsset",
    reason: "Error: storage refused token=<redacted> for <email>", capturedAt,
  });
  assert.equal(row.lastSeen, lastSeen);
  assert.notEqual(row.detail.capturedAt, row.lastSeen);
  assert.equal(Object.hasOwn(readErrors({ user: { ...admin, id: "other-admin" } }).errors[0], "detail"), false);
  assert.equal(Object.hasOwn(readErrors({ user: owner, assertCurrentSession: () => admin }).errors[0], "detail"), false,
    "the current authorized identity, not stale ctx.user, controls private diagnostics");
  assert.throws(() => readErrors({ user: admin, assertCurrentSession: () => ({ ...admin, is_banned: 1 }) }), { status: 403 });
  assert.throws(() => readErrors({ user: admin, assertCurrentSession: () => ({ ...admin, suspended_until: Date.now() + 60_000 }) }), { status: 403 });
  assert.throws(() => readErrors({ user: admin, assertCurrentSession: () => ({ ...admin, role: "fan" }) }), { status: 403 });
});

test("owner diagnostics tolerate missing companion detail without concealing the ledger", () => {
  recordError({ code: "INTERNAL_ERROR", status: 500 });
  db.exec("ALTER TABLE error_event_details RENAME TO test_unavailable_error_details");
  try {
    const result = readErrors({ user: owner });
    assert.equal(result.errors.length, 1);
    assert.equal(result.serious24h.occurrences, 1);
    assert.equal(Object.hasOwn(result.errors[0], "detail"), false);
  } finally {
    db.exec("ALTER TABLE test_unavailable_error_details RENAME TO error_event_details");
  }
});

test("serious diagnostics separate expected readiness and client failures from server fault counts", () => {
  recordError({ code: "MEDIA_STORAGE_UNAVAILABLE", status: 503, method: "GET", route: "/api/readiness" });
  recordError({ code: "AUTH_REQUIRED", status: 401, method: "POST", route: "/api/posts" });
  recordError({ code: "INTERNAL_ERROR", status: 500, method: "POST", route: "/api/posts" });
  const result = readErrors();
  assert.equal(result.last24h.occurrences, 2);
  assert.equal(result.serious24h.occurrences, 1);
  assert.equal(result.serious24h.kinds, 1);
});
