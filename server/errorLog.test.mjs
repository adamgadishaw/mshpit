import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-errorlog-"));
process.env.PIT_DATA_DIR = dataDir;
process.env.ADMIN_EMAIL = "owner@example.com";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;

const { db, errorStmts } = await import("./db.js");
const {
  alertCooldownMs, alertsEnabled, errorStats, fingerprintOf,
  maybeAlert, pruneErrors, recentErrors, recordError, resetAlertStateForTests,
} = await import("./errorLog.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec("DELETE FROM error_events");
  db.exec("DELETE FROM email_log");
  delete process.env.ERROR_ALERTS_ENABLED;
  delete process.env.ERROR_ALERT_COOLDOWN_MIN;
  resetAlertStateForTests();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const alertCount = () => db.prepare("SELECT COUNT(*) c FROM email_log WHERE template_key='error_alert'").get().c;

test("repeat occurrences collapse into one row with a count", () => {
  // The point of the whole design: a 500 in a loop must not write a row per hit.
  for (let i = 0; i < 50; i += 1) {
    recordError({ code: "DB", status: 500, method: "GET", route: "/api/feed", cause: "SqliteError" });
  }
  const rows = recentErrors();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 50);
  assert.ok(rows[0].first_seen <= rows[0].last_seen);
});

test("the durable ledger keeps the latest safe request id without splitting a problem", () => {
  const first = "123e4567-e89b-42d3-a456-426614174000";
  const latest = "123e4567-e89b-42d3-a456-426614174001";
  const shared = { code: "DB", status: 500, method: "GET", route: "/api/feed", cause: "SqliteError" };
  recordError({ ...shared, requestId: first });
  recordError({ ...shared, requestId: latest });
  const rows = recentErrors();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].last_request_id, latest);
});

test("request-id correlation accepts only generated UUID shapes", () => {
  recordError({ code: "DB", status: 500, route: "/api/feed", requestId: "token=user-secret" });
  assert.equal(recentErrors()[0].last_request_id, null);
});

test("different problems stay separate", () => {
  recordError({ code: "DB", status: 500, method: "GET", route: "/api/feed", cause: "SqliteError" });
  recordError({ code: "DB", status: 500, method: "POST", route: "/api/feed", cause: "SqliteError" });
  recordError({ code: "TIMEOUT", status: 504, method: "GET", route: "/api/feed", cause: "AbortError" });
  assert.equal(recentErrors().length, 3);
});

test("grouping is by route pattern, so ids cannot fragment it", () => {
  // The caller passes the matched PATTERN. Two users hitting the same broken
  // endpoint are one problem, not two.
  const a = fingerprintOf({ level: "error", code: "X", status: 500, method: "GET", route: "/api/users/:id/badges", cause: "E" });
  const b = fingerprintOf({ level: "error", code: "X", status: 500, method: "GET", route: "/api/users/:id/badges", cause: "E" });
  assert.equal(a, b);
});

test("anything that is not a known shape is discarded whole, not filtered", () => {
  // Filtering characters is not enough: stripping punctuation from
  // "password=hunter2" leaves "passwordhunter2". A value that does not match its
  // expected shape must be replaced entirely.
  recordError({
    code: "<script>alert(1)</script>",
    status: 500,
    method: "GET",
    route: "/api/search?q=my+secret+term&token=abc123",
    cause: "Error: /home/user/app/server/db.js:44 password=hunter2",
  });
  const blob = JSON.stringify(recentErrors()[0]);
  for (const leak of ["script", "hunter2", "password", "abc123", "secret", "home/user", "db.js"]) {
    assert.ok(!blob.includes(leak), `"${leak}" must not survive into storage`);
  }
  const row = recentErrors()[0];
  assert.equal(row.code, "UNKNOWN");
  assert.equal(row.route, "");
  assert.equal(row.cause, "unclassified");
  assert.equal(row.method, "GET", "a well-formed field is kept as-is");
});

test("well-formed diagnostic values are preserved", () => {
  recordError({ code: "DATABASE_UNAVAILABLE", status: 503, method: "POST", route: "/api/users/:id/badges", cause: "SqliteError/SQLITE_BUSY" });
  const row = recentErrors()[0];
  assert.equal(row.code, "DATABASE_UNAVAILABLE");
  assert.equal(row.route, "/api/users/:id/badges");
  assert.equal(row.cause, "SqliteError/SQLITE_BUSY");
  assert.equal(row.status, 503);
});

test("recording never throws, whatever it is handed", () => {
  assert.doesNotThrow(() => recordError());
  assert.doesNotThrow(() => recordError({ status: "not-a-number", code: null, route: undefined }));
  assert.doesNotThrow(() => recordError({ cause: { toString() { throw new Error("hostile"); } } }));
});

test("stats count occurrences and distinct kinds", () => {
  recordError({ code: "A", status: 500, route: "/api/a" });
  recordError({ code: "A", status: 500, route: "/api/a" });
  recordError({ code: "B", status: 500, route: "/api/b" });
  const stats = errorStats(Date.now() - 60_000);
  assert.equal(stats.occurrences, 3);
  assert.equal(stats.kinds, 2);
  assert.deepEqual(errorStats(Date.now() + 60_000), { occurrences: 0, kinds: 0 });
});

test("pruning ages out rows that stopped happening", () => {
  recordError({ code: "OLD", status: 500, route: "/api/old" });
  db.exec(`UPDATE error_events SET last_seen = ${Date.now() - 40 * 24 * 60 * 60 * 1000}`);
  recordError({ code: "NEW", status: 500, route: "/api/new" });
  pruneErrors();
  const codes = recentErrors().map((r) => r.code);
  assert.deepEqual(codes, ["NEW"]);
});

test("an outage sends ONE digest, not one mail per error", async () => {
  for (let i = 0; i < 30; i += 1) {
    recordError({ code: `E${i}`, status: 500, method: "GET", route: `/api/r${i}`, cause: "Boom" });
  }
  const first = await maybeAlert();
  await flush();
  assert.equal(first.sent !== undefined, true);
  assert.equal(alertCount(), 1, "the burst must produce a single digest");

  // Everything inside the cooldown is suppressed, which is what keeps the alert
  // usable during the incident it exists for.
  for (let i = 0; i < 30; i += 1) recordError({ code: "MORE", status: 500, route: "/api/x" });
  const second = await maybeAlert();
  assert.equal(second.sent, false);
  assert.equal(second.reason, "cooling-down");
  await flush();
  assert.equal(alertCount(), 1);
});

test("only server faults alert; a 404 storm is not news", async () => {
  for (let i = 0; i < 100; i += 1) recordError({ code: "NOT_FOUND", status: 404, route: "/api/nope" });
  const result = await maybeAlert();
  assert.equal(result.sent, false);
  assert.equal(result.reason, "nothing-serious");
  await flush();
  assert.equal(alertCount(), 0);
});

test("a fatal process error is serious even with no status", async () => {
  recordError({ level: "fatal", code: "PROCESS", status: 0, route: "uncaughtException", cause: "TypeError" });
  const result = await maybeAlert();
  assert.notEqual(result.reason, "nothing-serious");
  await flush();
  assert.equal(alertCount(), 1);
});

test("alerting can be switched off, and the switch defaults on", async () => {
  assert.equal(alertsEnabled({}), true);
  for (const off of ["0", "false", "no", "off", "OFF"]) {
    assert.equal(alertsEnabled({ ERROR_ALERTS_ENABLED: off }), false);
  }
  process.env.ERROR_ALERTS_ENABLED = "false";
  recordError({ code: "X", status: 500, route: "/api/x" });
  const result = await maybeAlert();
  assert.equal(result.reason, "disabled");
  await flush();
  assert.equal(alertCount(), 0);
});

test("the cooldown is configurable in minutes", () => {
  assert.equal(alertCooldownMs({}), 30 * 60 * 1000);
  assert.equal(alertCooldownMs({ ERROR_ALERT_COOLDOWN_MIN: "5" }), 5 * 60 * 1000);
  // Nonsense falls back rather than producing a zero cooldown, which would be a
  // mail storm the first time somebody typos the variable.
  assert.equal(alertCooldownMs({ ERROR_ALERT_COOLDOWN_MIN: "abc" }), 30 * 60 * 1000);
  assert.equal(alertCooldownMs({ ERROR_ALERT_COOLDOWN_MIN: "0" }), 30 * 60 * 1000);
  assert.equal(alertCooldownMs({ ERROR_ALERT_COOLDOWN_MIN: "-5" }), 30 * 60 * 1000);
});

test("a failing alert cannot feed itself a new error to alert about", async () => {
  recordError({ level: "fatal", code: "PROCESS", status: 0, route: "x", cause: "E" });
  const before = errorStmts.countRows.get().c;
  await maybeAlert({ force: true });
  await flush();
  assert.equal(errorStmts.countRows.get().c, before, "alerting must not record new error rows");
});
