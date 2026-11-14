import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { buildModerationReportRows, filterModerationReports } from "../src/domain/moderationConsole.mjs";

const directory = mkdtempSync(join(tmpdir(), "pit-report-context-"));
process.env.PIT_DATA_DIR = directory;
const { db, q } = await import("./db.js");
const { routes, ApiError } = await import("./api.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

function member(id, role = "fan") {
  q.insertUser.run(id, `${id}@example.invalid`, id, id, "synthetic-hash", role, "Toronto", 43.65, -79.38, "SY", "#123456", Date.now());
  db.prepare("UPDATE users SET age_band='18_plus' WHERE id=?").run(id);
  return q.userById.get(id);
}
const author = member("context_author"), reporter = member("context_reporter");
const moderator = member("context_moderator", "moderator"), admin = member("context_admin", "admin");
const editor = member("context_editor", "editor");
function post(id) {
  db.prepare("INSERT INTO posts(id,user_id,artist,venue,overall,review,photos,created_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(id, author.id, "Synthetic Artist", "Synthetic Venue", 4, "Synthetic review", "[]", Date.now());
}
const context = (user) => ({ user, query: {}, body: {}, params: {}, setHeader() {} });
const overview = (user = moderator) => routes["GET /api/admin/moderation"](context(user));

test("submitted reporter context survives SQLite, staff projection, and console search as plain multiline text", () => {
  post("context_post");
  const details = 'First attachment: SYNTHETIC_CONTEXT_MARKER\nSecond line: <img src=x onerror="alert(1)"> & "quoted" 🎵';
  const receipt = routes["POST /api/reports"]({ user: reporter, ip: "synthetic-report-context", body: {
    targetType: "post", targetId: "context_post", category: "intimate_image", reason: "Non-consensual intimate image", details,
  } });
  const stored = db.prepare("SELECT category,details FROM reports WHERE id=?").get(receipt.id);
  assert.equal(stored.category, "intimate_image");
  assert.equal(stored.details, details);
  for (const staff of [moderator, admin]) {
    const headers = {};
    const snapshot = routes["GET /api/admin/moderation"]({ ...context(staff), setHeader: (key, value) => { headers[key] = value; } });
    assert.equal(headers["Cache-Control"], "no-store");
    const projected = snapshot.reports.find(row => row.id === receipt.id);
    assert.equal(projected.category, stored.category);
    assert.equal(projected.details, details);
    assert.equal(projected.reason, "Non-consensual intimate image");
    assert.equal(JSON.stringify(snapshot).includes(reporter.email), false);
    const rows = buildModerationReportRows([projected]);
    assert.equal(rows[0].details, details);
    assert.equal(rows[0].categoryLabel, "intimate image");
    for (const query of ["synthetic_context_marker", "intimate_image", "intimate image", "Second line", "quoted"])
      assert.equal(filterModerationReports(rows, { query }).length, 1, query);
    assert.equal(filterModerationReports(rows, { query: "not in this report" }).length, 0);
  }
  assert.equal(JSON.stringify(receipt).includes(details), false, "submission receipt does not echo staff context");
});

test("report context stays behind existing staff authorization, including role revocation", () => {
  for (const user of [null, reporter, author, editor]) {
    for (const route of ["GET /api/admin/moderation", "GET /api/admin/reports"])
      assert.throws(() => routes[route](context(user)), error => error instanceof ApiError && [401, 403].includes(error.status));
  }
  const revoked = member("context_revoked", "moderator");
  db.prepare("UPDATE users SET role='fan' WHERE id=?").run(revoked.id);
  // The HTTP authentication layer supplies the current database user on each
  // request; do not inject the old synthetic role snapshot into the route.
  assert.throws(() => overview(q.userById.get(revoked.id)), error => error instanceof ApiError && error.status === 403);
});

test("legacy absent context and bounded stored context remain safe without rewriting report history", () => {
  for (const [id, category, details] of [["legacy", null, null], ["bounded", "x".repeat(100), "d".repeat(600)]]) {
    db.prepare("INSERT INTO reports(id,target_type,target_id,reason,category,details,reporter_id,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(id, "post", "unavailable", "Historical reason", category, details, reporter.id, Date.now());
    const projected = overview().reports.find(row => row.id === id);
    assert.equal(projected.category, category?.slice(0, 64) || null);
    assert.equal(projected.details, details?.slice(0, 500) || null);
    const row = buildModerationReportRows([projected])[0];
    assert.equal(row.details, details?.slice(0, 500) || "");
    assert.equal(row.target.missing, true);
    assert.equal(db.prepare("SELECT details FROM reports WHERE id=?").get(id).details, details);
  }
});
