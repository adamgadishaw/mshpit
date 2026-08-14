import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-moderation-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id, role = "fan") {
  q.insertUser.run(id, `${id}@example.com`, id, id, "test-hash", role, "Toronto", 43.65, -79.38, "TU", "#123456", Date.now());
  return q.userById.get(id);
}

const admin = addUser("moderation_admin", "admin");
const moderator = addUser("moderation_mod", "moderator");
const fan = addUser("moderation_fan", "fan");
const author = addUser("moderation_author", "fan");

function insertPost(id, review = "reported review", removed = 0) {
  db.prepare(`INSERT INTO posts (id,user_id,artist,venue,overall,review,photos,removed,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(id, author.id, "J. Cole", "Scotiabank Arena", 4.5, review, '["https://media.example/photo.jpg"]', removed, Date.now());
}

function insertReport(id, targetType, targetId, reason = "spam", reporterId = fan.id, status = "open", createdAt = Date.now()) {
  db.prepare("INSERT INTO reports (id,target_type,target_id,reason,reporter_id,status,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, targetType, targetId, reason, reporterId, status, createdAt);
}

const staffCtx = (user, extra = {}) => ({
  user,
  requestId: `request-${user.id}`,
  params: {},
  body: {},
  query: {},
  ...extra,
});

test("staff overview returns bounded summaries, camelCase queue rows, and privacy-safe content context", () => {
  insertPost("moderation_overview_post", "A public excerpt for the queue");
  insertReport("moderation_overview_report", "post", "moderation_overview_post", "harassment");
  db.prepare("INSERT INTO dms (id,from_id,to_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("moderation_private_dm", author.id, fan.id, "private message must never leave the server", Date.now());
  insertReport("moderation_private_report", "message", "moderation_private_dm", "abuse");

  const responseHeaders = {};
  const result = routes["GET /api/admin/moderation"](staffCtx(moderator, {
    setHeader: (name, value) => { responseHeaders[name] = value; },
  }));
  assert.equal(responseHeaders["Cache-Control"], "no-store");
  assert.equal(result.summary.open >= 2, true);
  assert.equal(result.summary.byType.post >= 1, true);
  assert.equal(result.summary.byType.message >= 1, true);
  assert.equal(result.summary.totalRecent >= 2, true);
  assert.equal(result.reports.length <= 50, true);
  const post = result.reports.find((report) => report.id === "moderation_overview_report");
  assert.deepEqual({
    targetType: post.targetType,
    targetId: post.targetId,
    reporterId: post.reporterId,
    status: post.status,
  }, {
    targetType: "post",
    targetId: "moderation_overview_post",
    reporterId: fan.id,
    status: "open",
  });
  assert.equal(post.target_type, undefined);
  assert.equal(post.content.excerpt, "A public excerpt for the queue");
  assert.equal(post.content.mediaCount, 1);
  assert.equal(post.content.author.handle, author.handle);
  assert.deepEqual({
    role: post.content.author.role,
    isBanned: post.content.author.isBanned,
    suspendedUntil: post.content.author.suspendedUntil,
  }, { role: "fan", isBanned: false, suspendedUntil: null });
  assert.equal(post.reporter.role, "fan");
  const message = result.reports.find((report) => report.id === "moderation_private_report");
  assert.equal(message.content.private, true);
  assert.equal(JSON.stringify(message).includes("private message must never leave"), false);
  assert.equal(JSON.stringify(result).includes(`${author.id}@example.com`), false, "staff queue must not expose account emails");
});

test("the normalized queue keyset reaches older reports and rejects malformed cursors", () => {
  const prefix = `moderation_page_${Date.now()}`;
  for (let index = 0; index < 105; index += 1) {
    insertReport(`${prefix}_${String(index).padStart(3, "0")}`, "track", `track_${index}`, JSON.stringify({ title: `Track ${index}` }), fan.id, "open", 10_000 + index);
  }

  const seen = [];
  let before = null;
  do {
    const page = routes["GET /api/admin/moderation"](staffCtx(moderator, {
      query: { limit: "40", ...(before ? { before } : {}) },
    }));
    assert.equal(page.reports.length <= 40, true);
    seen.push(...page.reports.filter((report) => report.id.startsWith(prefix)).map((report) => report.id));
    before = page.nextCursor;
  } while (before);
  assert.equal(new Set(seen).size, 105, "every older open report remains reachable exactly once");

  assert.throws(
    () => routes["GET /api/admin/moderation"](staffCtx(moderator, { query: { before: "not-a-cursor" } })),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_FAILED",
  );
});

test("dismiss and report removal are atomic, desired-state idempotent, and reject stale opposite actions", () => {
  insertPost("moderation_action_post");
  insertReport("moderation_action_report", "post", "moderation_action_post", "remove me");
  insertPost("moderation_dismiss_post");
  insertReport("moderation_dismiss_report", "post", "moderation_dismiss_post", "false alarm");
  const action = routes["POST /api/admin/moderation/actions"];

  const removed = action(staffCtx(moderator, { body: { action: "remove", reportId: "moderation_action_report" } }));
  assert.equal(removed.removed, true);
  assert.equal(removed.duplicate, false);
  assert.equal(db.prepare("SELECT removed FROM posts WHERE id=?").get("moderation_action_post").removed, 1);
  assert.equal(db.prepare("SELECT status FROM reports WHERE id=?").get("moderation_action_report").status, "actioned");
  const firstAuditCount = db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_id=?").get("moderation_action_post").count;
  const retry = action(staffCtx(moderator, { body: { action: "remove", reportId: "moderation_action_report" } }));
  assert.equal(retry.duplicate, true);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_id=?").get("moderation_action_post").count, firstAuditCount);
  assert.throws(
    () => action(staffCtx(moderator, { body: { action: "dismiss", reportId: "moderation_action_report" } })),
    (error) => error instanceof ApiError && error.status === 409,
  );

  const dismissed = action(staffCtx(moderator, { body: { action: "dismiss", reportId: "moderation_dismiss_report" } }));
  assert.equal(dismissed.status, "dismissed");
  assert.equal(action(staffCtx(moderator, { body: { action: "dismiss", reportId: "moderation_dismiss_report" } })).duplicate, true);
  assert.equal(db.prepare("SELECT removed FROM posts WHERE id=?").get("moderation_dismiss_post").removed, 0);
  assert.throws(
    () => action(staffCtx(moderator, { body: { action: "remove", reportId: "moderation_dismiss_report" } })),
    (error) => error instanceof ApiError && error.status === 409,
  );
});

test("direct remove and restore stay atomic and record only real state changes", () => {
  insertPost("moderation_restore_post");
  const action = routes["POST /api/admin/moderation/actions"];
  const remove = action(staffCtx(admin, { body: {
    action: "remove", targetType: "post", targetId: "moderation_restore_post", reason: "policy violation",
  } }));
  assert.deepEqual({ removed: remove.removed, changed: remove.changed, duplicate: remove.duplicate }, { removed: true, changed: true, duplicate: false });
  const duplicateRemove = action(staffCtx(admin, { body: {
    action: "remove", targetType: "post", targetId: "moderation_restore_post", reason: "retry",
  } }));
  assert.equal(duplicateRemove.duplicate, true);
  const restore = action(staffCtx(moderator, { body: {
    action: "restore", targetType: "post", targetId: "moderation_restore_post", reason: "appeal accepted",
  } }));
  assert.equal(restore.removed, false);
  assert.equal(db.prepare("SELECT removed FROM posts WHERE id=?").get("moderation_restore_post").removed, 0);
  const audits = db.prepare("SELECT action,reason FROM moderation_actions WHERE target_id=?").all("moderation_restore_post");
  assert.equal(audits.length, 2, "the duplicate desired-state call must not append a third audit row");
  assert.deepEqual(Object.fromEntries(audits.map((row) => [row.action, row.reason])), {
    remove: "policy violation",
    restore: "appeal accepted",
  });
});

test("recent actions are bounded and omit internal audit state", () => {
  insertPost("moderation_recent_post");
  const action = routes["POST /api/admin/moderation/actions"];
  action(staffCtx(moderator, { body: { action: "remove", targetType: "post", targetId: "moderation_recent_post", reason: "recent reason" } }));
  const overview = routes["GET /api/admin/moderation"](staffCtx(admin));
  assert.equal(overview.recentActions.length <= 20, true);
  const recent = overview.recentActions.find((row) => row.targetId === "moderation_recent_post");
  assert.equal(recent.actor.handle, moderator.handle);
  assert.equal(recent.actor.role, "moderator");
  assert.equal(recent.reason, "recent reason");
  assert.equal(recent.requestId, undefined);
  assert.equal(recent.priorState, undefined);
  assert.equal(recent.nextState, undefined);
});

test("moderators and admins can moderate while fans and restricted staff cannot", () => {
  assert.doesNotThrow(() => routes["GET /api/admin/moderation"](staffCtx(moderator)));
  assert.doesNotThrow(() => routes["GET /api/admin/moderation"](staffCtx(admin)));
  assert.throws(
    () => routes["GET /api/admin/moderation"](staffCtx(fan)),
    (error) => error instanceof ApiError && error.status === 403,
  );
  db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 60_000, moderator.id);
  const suspended = q.userById.get(moderator.id);
  assert.throws(
    () => routes["GET /api/admin/moderation"](staffCtx(suspended)),
    (error) => error instanceof ApiError && error.status === 403,
  );
  db.prepare("UPDATE users SET suspended_until=NULL WHERE id=?").run(moderator.id);
  assert.throws(
    () => routes["POST /api/admin/users/:id/ban"](staffCtx(q.userById.get(moderator.id), { params: { id: fan.id } })),
    (error) => error instanceof ApiError && error.status === 403,
    "the moderation refactor must not widen admin-only member powers",
  );
});

test("member directory is no-store and withholds private email state from moderators", () => {
  const moderatorHeaders = {};
  const moderatorResult = routes["GET /api/admin/members"](staffCtx(moderator, {
    setHeader: (name, value) => { moderatorHeaders[name] = value; },
  }));
  assert.equal(moderatorHeaders["Cache-Control"], "no-store");
  assert.equal(moderatorResult.users.length > 0, true);
  assert.equal(moderatorResult.users.every((user) => !Object.hasOwn(user, "emailVerified")), true);

  const adminResult = routes["GET /api/admin/members"](staffCtx(admin));
  assert.equal(adminResult.users.every((user) => typeof user.emailVerified === "boolean"), true);
});

test("member search and keyset pagination reach older accounts without exposing email", () => {
  const prefix = "directorymember";
  for (let index = 0; index < 105; index += 1) {
    const id = `${prefix}${String(index).padStart(3, "0")}`;
    addUser(id, index === 3 ? "artist" : "fan");
    db.prepare("UPDATE users SET created_at=? WHERE id=?").run(20_000, id);
  }
  db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(`${prefix}001`);
  db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 60_000, `${prefix}002`);
  q.insertUser.run("email_private_id", "only-secret-address@example.com", "safehandle", "Safe Name", "test-hash", "fan", "Toronto", 43.65, -79.38, "SN", "#123456", 19_000);

  const seen = [];
  let before = null;
  do {
    const page = routes["GET /api/admin/members"](staffCtx(moderator, {
      query: { limit: "40", ...(before ? { before } : {}) },
    }));
    assert.equal(page.users.length <= 40, true);
    assert.equal(page.total >= 105, true, "total remains the global directory total");
    assert.equal(page.matchingTotal, page.total);
    seen.push(...page.users.filter((user) => user.id.startsWith(prefix)).map((user) => user.id));
    before = page.nextCursor;
  } while (before);
  assert.equal(new Set(seen).size, 105, "all older members remain reachable exactly once across equal timestamps");

  const search = routes["GET /api/admin/members"](staffCtx(moderator, { query: { q: `${prefix}003` } }));
  assert.deepEqual(search.users.map((user) => user.id), [`${prefix}003`]);
  assert.equal(search.matchingTotal, 1);
  assert.equal(search.users[0].role, "artist");
  assert.equal(routes["GET /api/admin/members"](staffCtx(moderator, { query: { q: "only-secret-address@example.com" } })).matchingTotal, 0,
    "staff directory search must never search private addresses");

  const bannedPage = routes["GET /api/admin/members"](staffCtx(moderator, { query: { q: prefix, status: "banned" } }));
  assert.deepEqual(bannedPage.users.map((user) => user.id), [`${prefix}001`]);
  const suspendedPage = routes["GET /api/admin/members"](staffCtx(moderator, { query: { q: prefix, status: "suspended" } }));
  assert.deepEqual(suspendedPage.users.map((user) => user.id), [`${prefix}002`]);
  const activeArtistPage = routes["GET /api/admin/members"](staffCtx(moderator, { query: { q: prefix, role: "artist", status: "active" } }));
  assert.deepEqual(activeArtistPage.users.map((user) => user.id), [`${prefix}003`]);

  assert.throws(
    () => routes["GET /api/admin/members"](staffCtx(moderator, { query: { before: "bad-cursor" } })),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_FAILED",
  );
});

test("member desired-state actions are safe to retry after a lost response", () => {
  const target = addUser("member_action_retry", "fan");
  const roleTarget = addUser("member_role_retry", "fan");
  const adminTarget = addUser("member_admin_retry", "fan");
  const call = (route, user, id, body = {}) => routes[route](staffCtx(user, { params: { id }, body }));
  const auditCount = (id, action) => db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_id=? AND action=?").get(id, action).count;

  const firstSuspend = call("POST /api/admin/users/:id/suspend", moderator, target.id, { days: 1, reason: "retry-safe timeout" });
  const retriedSuspend = call("POST /api/admin/users/:id/suspend", moderator, target.id, { days: 1, reason: "retry-safe timeout" });
  assert.equal(retriedSuspend.suspendedUntil, firstSuspend.suspendedUntil, "retry must not extend the timeout deadline");
  assert.equal(auditCount(target.id, "suspend"), 1);
  assert.deepEqual(call("POST /api/admin/users/:id/unsuspend", moderator, target.id), { ok: true });
  assert.deepEqual(call("POST /api/admin/users/:id/unsuspend", moderator, target.id), { ok: true });
  assert.equal(auditCount(target.id, "lift_suspension"), 1);

  assert.deepEqual(call("POST /api/admin/users/:id/ban", admin, target.id), { ok: true });
  assert.deepEqual(call("POST /api/admin/users/:id/ban", admin, target.id), { ok: true });
  assert.equal(auditCount(target.id, "ban"), 1);
  assert.deepEqual(call("POST /api/admin/users/:id/unban", admin, target.id), { ok: true });
  assert.deepEqual(call("POST /api/admin/users/:id/unban", admin, target.id), { ok: true });
  assert.equal(auditCount(target.id, "unban"), 1);

  assert.deepEqual(call("POST /api/admin/users/:id/verified", admin, target.id, { verified: true }), { ok: true, verified: true });
  assert.deepEqual(call("POST /api/admin/users/:id/verified", admin, target.id, { verified: true }), { ok: true, verified: true });
  assert.equal(auditCount(target.id, "grant_verification"), 1);
  assert.deepEqual(call("POST /api/admin/users/:id/sponsor", admin, target.id, { sponsor: true }), { ok: true, sponsor: true });
  assert.deepEqual(call("POST /api/admin/users/:id/sponsor", admin, target.id, { sponsor: true }), { ok: true, sponsor: true });
  assert.equal(auditCount(target.id, "grant_sponsor"), 1);

  const firstEmail = call("POST /api/admin/users/:id/verify-email", admin, target.id);
  const retriedEmail = call("POST /api/admin/users/:id/verify-email", admin, target.id);
  assert.equal(firstEmail.emailVerified, true);
  assert.equal(retriedEmail.emailVerified, true);
  assert.equal(auditCount(target.id, "verify-email"), 1);

  assert.deepEqual(call("POST /api/admin/users/:id/role", admin, roleTarget.id, { role: "artist" }), { ok: true, role: "artist", handle: roleTarget.handle });
  assert.deepEqual(call("POST /api/admin/users/:id/role", admin, roleTarget.id, { role: "artist" }), { ok: true, role: "artist", handle: roleTarget.handle });
  assert.equal(auditCount(roleTarget.id, "change_role"), 1);
  assert.deepEqual(call("POST /api/admin/users/:id/role", admin, adminTarget.id, { role: "admin", handle: "member_admin_retry" }), { ok: true, role: "admin", handle: "member_admin_retry" });
  assert.deepEqual(call("POST /api/admin/users/:id/role", admin, adminTarget.id, { role: "admin", handle: "member_admin_retry" }), { ok: true, role: "admin", handle: "member_admin_retry" },
    "an identical retry after promotion must not be rejected just because the account is now admin");
  assert.equal(auditCount(adminTarget.id, "change_role"), 1);
});

test("staff role changes allocate globally unique tagged handles and retry exactly", () => {
  const moderatorTarget = addUser("tagtarget", "fan");
  const hiddenModeratorCollision = addUser("tagtarget_mod", "fan");
  const adminTarget = addUser("tagtargettwo", "fan");
  const hiddenAdminCollision = addUser("tagtargettwo_admin", "fan");
  const call = (id, role, handle) => routes["POST /api/admin/users/:id/role"](staffCtx(admin, {
    params: { id }, body: { role, handle, reason: "server allocation regression" },
  }));
  const auditCount = (id) => db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_id=? AND action='change_role'").get(id).count;

  const firstModerator = call(moderatorTarget.id, "moderator", hiddenModeratorCollision.handle);
  assert.deepEqual(firstModerator, { ok: true, role: "moderator", handle: "tagtarget_mod1" });
  assert.deepEqual(call(moderatorTarget.id, "moderator", hiddenModeratorCollision.handle), firstModerator,
    "replaying the client candidate must return the same server-selected handle");
  assert.equal(q.userById.get(moderatorTarget.id).handle, firstModerator.handle);
  assert.equal(q.userById.get(hiddenModeratorCollision.id).handle, hiddenModeratorCollision.handle);
  assert.equal(auditCount(moderatorTarget.id), 1);

  const firstAdmin = call(adminTarget.id, "admin", hiddenAdminCollision.handle);
  assert.deepEqual(firstAdmin, { ok: true, role: "admin", handle: "tagtargettwo_admin1" });
  assert.deepEqual(call(adminTarget.id, "admin", hiddenAdminCollision.handle), firstAdmin,
    "an exact retry after admin promotion must retain the allocated handle");
  assert.equal(q.userById.get(adminTarget.id).handle, firstAdmin.handle);
  assert.equal(q.userById.get(hiddenAdminCollision.id).handle, hiddenAdminCollision.handle);
  assert.equal(auditCount(adminTarget.id), 1);
});

test("email verification and its moderation audit commit atomically", () => {
  const target = addUser("verify_email_atomic", "fan");
  db.exec(`CREATE TEMP TRIGGER fail_verify_email_audit
    BEFORE INSERT ON moderation_actions
    WHEN NEW.action='verify-email'
    BEGIN SELECT RAISE(ABORT, 'forced verify-email audit failure'); END`);
  try {
    assert.throws(
      () => routes["POST /api/admin/users/:id/verify-email"](staffCtx(admin, { params: { id: target.id } })),
      /forced verify-email audit failure/,
    );
  } finally {
    db.exec("DROP TRIGGER fail_verify_email_audit");
  }

  const rolledBack = q.userById.get(target.id);
  assert.equal(rolledBack.email_verified_at, 0, "audit failure must roll verification back");
  assert.equal(rolledBack.welcome_sent_at, 0, "welcome delivery must not start before commit");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_id=? AND action='verify-email'").get(target.id).count, 0);

  const completed = routes["POST /api/admin/users/:id/verify-email"](staffCtx(admin, { params: { id: target.id } }));
  assert.equal(completed.emailVerified, true);
  assert.ok(q.userById.get(target.id).welcome_sent_at > 0, "a successful commit releases the guarded welcome");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_id=? AND action='verify-email'").get(target.id).count, 1);
});

test("badge membership actions audit only real desired-state changes", () => {
  const target = addUser("member_badge_retry", "fan");
  const create = routes["POST /api/admin/badges"](staffCtx(admin, { body: {
    slug: "retry-badge", label: "Retry Badge", description: "Idempotency regression", kind: "event", color: "cool", glyph: "check",
  } }));
  const call = (revoke) => routes["POST /api/admin/users/:id/badges"](staffCtx(admin, {
    params: { id: target.id }, body: { slug: create.badge.slug, revoke },
  }));
  assert.equal(call(false).badges.some((badge) => badge.slug === "retry-badge"), true);
  assert.equal(call(false).badges.some((badge) => badge.slug === "retry-badge"), true);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_id=? AND action='badge-grant'").get(target.id).count, 1);
  assert.equal(call(true).badges.some((badge) => badge.slug === "retry-badge"), false);
  assert.equal(call(true).badges.some((badge) => badge.slug === "retry-badge"), false);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_id=? AND action='badge-revoke'").get(target.id).count, 1);
});

test("legacy moderation routes preserve their exact response shapes", () => {
  insertPost("moderation_legacy_action_post");
  insertReport("moderation_legacy_action_report", "post", "moderation_legacy_action_post");
  assert.deepEqual(
    routes["POST /api/admin/reports/:id/action"](staffCtx(moderator, { params: { id: "moderation_legacy_action_report" } })),
    { ok: true, targetType: "post", targetId: "moderation_legacy_action_post" },
  );
  insertPost("moderation_legacy_dismiss_post");
  insertReport("moderation_legacy_dismiss_report", "post", "moderation_legacy_dismiss_post");
  assert.deepEqual(
    routes["POST /api/admin/reports/:id/dismiss"](staffCtx(moderator, { params: { id: "moderation_legacy_dismiss_report" } })),
    { ok: true },
  );
  insertPost("moderation_legacy_content_post");
  assert.deepEqual(
    routes["POST /api/admin/content/:type/:id"](staffCtx(moderator, {
      params: { type: "post", id: "moderation_legacy_content_post" }, body: { removed: true },
    })),
    { ok: true, removed: true },
  );
  const responseHeaders = {};
  const reports = routes["GET /api/admin/reports"](staffCtx(moderator, {
    setHeader: (name, value) => { responseHeaders[name] = value; },
  })).reports;
  assert.equal(responseHeaders["Cache-Control"], "no-store");
  assert.equal(reports.every((report) => report.status === "open"), true);
  assert.equal(reports.length <= 200, true);
  assert.ok(Object.hasOwn(reports[0], "target_type"), "legacy report rows remain snake_case");
});
