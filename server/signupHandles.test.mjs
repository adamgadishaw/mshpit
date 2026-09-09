import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";
import { LEGAL_ACCEPTANCE_VERSION } from "../src/domain/privacyDisclosures.mjs";

const dataDir = mkdtempSync(join(tmpdir(), "pit-signup-handles-"));
process.env.PIT_DATA_DIR = dataDir;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
const { db, q, publicUser } = await import("./db.js");
const { routes } = await import("./api.js");
const { getSession, resetRateLimitsForTests } = await import("./auth.js");
const { completeVerification, forceVerify, mintVerifyToken } = await import("./verification.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});
beforeEach(() => {
  resetRateLimitsForTests();
  delete process.env.EMAIL_VERIFICATION_ENABLED;
});

let sequence = 0;
function addUser(handle, role = "fan") {
  const id = `signup_handle_${++sequence}`;
  q.insertUser.run(id, `${id}@example.test`, "Handle Member", handle, "test-hash", role,
    null, null, null, "HM", "#123456", Date.now());
  return q.userById.get(id);
}
async function signup(handle, overrides = {}) {
  const email = `chosen-handle-${++sequence}@example.test`;
  const body = { name: "New Member", email, password: "signup-password1", genres: ["Rock"],
    ageBand: "18_plus", termsVersion: LEGAL_ACCEPTANCE_VERSION,
    ...(handle === undefined ? {} : { handle }), ...overrides };
  let session = null;
  const result = (await routes["POST /api/signup"]({ body, ip: `signup-handle-ip-${sequence}`, ua: "test",
    setSession(value) { session = value; } }));
  return { result, session, user: result.user?.id ? q.userById.get(result.user.id) : q.userByEmail.get(body.email), body };
}
function availability(handle, extra = {}) {
  const headers = new Map();
  const result = routes["GET /api/signup/handle-availability"]({ query: { handle },
    ip: `availability-${++sequence}`, setHeader(name, value) { headers.set(name, value); }, ...extra });
  assert.equal(headers.get("Cache-Control"), "no-store");
  return result;
}
function apiError(run, status, code) {
  return assert.rejects(async () => await run(), (error) => error.status === status && error.code === code);
}

test("handle availability uses profile normalization and exposes no member identity", async () => {
  assert.deepEqual(availability(" @Festival_Fan "), { handle: "festival_fan", available: true });
  const member = addUser("claimed_handle");
  assert.deepEqual(availability("CLAIMED_HANDLE"), { handle: member.handle, available: false });
  const long = "abcdefghijklmnopqrst_extra";
  assert.deepEqual(availability(long), { handle: "abcdefghijklmnopqrst", available: true });
  for (const value of [undefined, null, "", "ab", "@@@", "東京", {}, 123]) {
    (await apiError(() => availability(value), 400, "VALIDATION_FAILED"));
    (await apiError(async () => (await signup(value === undefined ? "" : value)), 400, "VALIDATION_FAILED"));
  }
});

test("claimed staff and member handles cannot be chosen regardless of target email", async () => {
  const existing = addUser("existing_email_owner");
  for (const [handle, role] of [["reserved_admin", "admin"], ["reserved_mod", "moderator"], ["reserved_member", "fan"]]) {
    addUser(handle, role);
    assert.deepEqual(availability(handle), { handle, available: false });
    (await apiError(async () => (await signup(handle)), 409, "CONFLICT"));
    (await apiError(async () => (await signup(handle, { email: existing.email })), 409, "CONFLICT"));
  }
  (await apiError(async () => (await signup("ab", { email: existing.email })), 400, "VALIDATION_FAILED"));
});

test("signup keeps preferred handles private and never overwrites a sibling", async () => {
  const existing = addUser("privacy_existing");
  const old = { ...existing };
  const first = (await signup("private_preference"));
  const duplicate = (await signup("private_preference", { email: existing.email }));
  for (const created of [first, duplicate]) {
    assert.equal(created.result.created, true);
    assert.equal(created.result.verificationRequired, true);
    assert.equal(created.result.user.emailVerified, false);
    assert.equal(created.result.user.id, created.user.id);
    assert.match(created.result.cancelToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(getSession(created.session.token).user_id, created.user.id);
  }
  assert.notEqual(duplicate.user.id, existing.id);
  assert.match(first.user.handle, /^pitfan_[a-f0-9]{8}/u);
  assert.equal(JSON.parse(first.user.extras).pendingSignupHandle, "private_preference");
  assert.deepEqual(availability("private_preference"), { handle: "private_preference", available: true });
  assert.equal(q.userById.get(existing.id).extras, old.extras);
  assert.equal(q.userById.get(existing.id).pass_hash, old.pass_hash);
  assert.equal(q.userById.get(existing.id).handle, old.handle);
  assert.equal(JSON.stringify(publicUser(first.user)).includes("private_preference"), false);
  assert.equal(publicUser(first.user, { self: true }).pendingSignupHandle, "private_preference");
  assert.equal(publicUser(first.user).pendingSignupHandle, undefined);
  const repeated = (await signup("another_preference", { email: first.user.email }));
  assert.equal(repeated.result.needsAccountChoice, true);
  assert.equal(repeated.result.accounts[0].id, first.user.id);
  assert.equal(repeated.result.cancelToken, undefined);
  assert.equal(repeated.session, null);
  assert.equal(q.usersByEmail.all(first.user.email).length, 1);
  assert.equal(JSON.parse(repeated.user.extras).pendingSignupHandle, "private_preference");
});

test("signup remains compatible without a handle or city and does not store invented coordinates", async () => {
  const created = (await signup(undefined));
  assert.equal(created.result.created, true);
  assert.equal(created.result.verificationRequired, true);
  assert.equal(created.result.user.emailVerified, false);
  assert.equal(getSession(created.session.token).user_id, created.user.id);
  assert.match(created.user.handle, /^pitfan_[a-f0-9]{8}/u);
  assert.equal(created.user.home_city, null);
  assert.equal(created.user.home_lat, null);
  assert.equal(created.user.home_lng, null);
  assert.equal(JSON.parse(created.user.extras).pendingSignupHandle, undefined);
});

test("verification atomically claims a preference once and keeps initial edit free of cooldown", async () => {
  const created = (await signup(" @My_New_Handle "));
  const token = mintVerifyToken(created.user.id);
  const completed = completeVerification(token);
  assert.equal(completed.user.handle, "my_new_handle");
  assert.equal(completed.user.handle_changed_at, 0);
  assert.ok(completed.user.profile_updated_at > 0);
  assert.equal(JSON.parse(completed.user.extras).pendingSignupHandle, undefined);
  assert.equal(availability("my_new_handle").available, false);
  assert.equal(completeVerification(token).user.handle, "my_new_handle");
  assert.equal(publicUser(completed.user, { self: true }).handleChangeAvailableAt, null);
  assert.equal(publicUser(completed.user, { self: true }).pendingSignupHandle, undefined);
});

test("two concurrent preferences may coexist, but only the first verified account claims the handle", async () => {
  const first = (await signup("shared_preference"));
  const second = (await signup("shared_preference"));
  assert.equal(availability("shared_preference").available, true);
  const firstToken = mintVerifyToken(first.user.id);
  const secondToken = mintVerifyToken(second.user.id);
  assert.equal(completeVerification(firstToken).user.handle, "shared_preference");
  const loser = completeVerification(secondToken);
  assert.equal(loser.user.handle, second.user.handle);
  assert.ok(loser.user.email_verified_at > 0);
  assert.equal(JSON.parse(loser.user.extras).pendingSignupHandle, undefined);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE handle='shared_preference'").get().n, 1);
});

test("an intervening handle claim or manual profile choice never breaks email verification", async () => {
  const taken = (await signup("later_claimed"));
  addUser("later_claimed");
  assert.equal(completeVerification(mintVerifyToken(taken.user.id)).user.handle, taken.user.handle);
  const manual = (await signup("earlier_preference"));
  routes["PATCH /api/me"]({ user: manual.user, body: { handle: "manual_choice" }, ip: "manual-handle" });
  const verified = completeVerification(mintVerifyToken(manual.user.id)).user;
  assert.equal(verified.handle, "manual_choice");
  assert.equal(JSON.parse(verified.extras).pendingSignupHandle, undefined);
});

test("verification write failure rolls back preference, confirmation, token and receipt together", async () => {
  const created = (await signup("rollback_preference"));
  const token = mintVerifyToken(created.user.id);
  const before = q.userById.get(created.user.id);
  db.exec(`CREATE TEMP TRIGGER fail_signup_handle_claim BEFORE UPDATE OF handle ON users
    WHEN NEW.handle='rollback_preference' BEGIN SELECT RAISE(ABORT,'fixture claim failure'); END`);
  try { assert.throws(() => completeVerification(token), /fixture claim failure/u); }
  finally { db.exec("DROP TRIGGER fail_signup_handle_claim"); }
  const failed = q.userById.get(created.user.id);
  assert.equal(failed.handle, before.handle);
  assert.equal(failed.extras, before.extras);
  assert.equal(failed.email_verified_at, 0);
  assert.equal(failed.email_verify_hash, before.email_verify_hash);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM email_verification_receipts WHERE user_id=?").get(created.user.id).n, 0);
  assert.equal(completeVerification(token).user.handle, "rollback_preference");
});

test("private preference survives profile extras edits but cannot be forged through them", async () => {
  const created = (await signup("keep_preference"));
  const saved = routes["PATCH /api/me"]({ user: created.user, body: { extras: { theme: "neon" } }, ip: "pending-extras" });
  assert.equal(JSON.parse(q.userById.get(created.user.id).extras).pendingSignupHandle, "keep_preference");
  assert.equal(saved.user.pendingSignupHandle, "keep_preference");
  assert.equal(JSON.stringify(publicUser(q.userById.get(created.user.id))).includes("keep_preference"), false);
  assert.throws(() => routes["PATCH /api/me"]({ user: q.userById.get(created.user.id),
    body: { extras: { pendingSignupHandle: "forged_preference" } }, ip: "forged-pending-extras" }), (error) => error.status === 400);
  assert.equal(forceVerify(created.user.id).handle, "keep_preference");
});

test("local auto-verification and audited admin verification also claim the private preference", async () => {
  process.env.EMAIL_VERIFICATION_ENABLED = "false";
  try { assert.equal((await signup("local_auto_choice")).user.handle, "local_auto_choice"); }
  finally { delete process.env.EMAIL_VERIFICATION_ENABLED; }
  const created = (await signup("staff_verified_name"));
  const admin = addUser("handle_verifier_admin", "admin");
  routes["POST /api/admin/users/:id/verify-email"]({ user: admin, params: { id: created.user.id },
    body: { reason: "Verified fixture" }, ip: "staff-handle-verify" });
  assert.equal(q.userById.get(created.user.id).handle, "staff_verified_name");
});

test("profile metadata size is rechecked after restoring private signup and consent fields", async () => {
  const created = (await signup("extras_size_guard"));
  const tracks = Array.from({ length: 24 }, () => ({ title: "t".repeat(200), artist: "a".repeat(100) }));
  let extras;
  for (let size = 1; size <= 200; size += 1) {
    const candidate = { playlists: [{ id: "saved", name: "Saved music", tracks: [...tracks, { title: "x".repeat(size), artist: "a" }] }] };
    const bytes = Buffer.byteLength(JSON.stringify(candidate));
    if (bytes <= 8000) extras = candidate;
  }
  assert.ok(Buffer.byteLength(JSON.stringify(extras)) > 7950, "the client envelope itself fits just below the cap");
  (await apiError(() => routes["PATCH /api/me"]({ user: created.user, ip: "merged-extras-limit", body: { extras } }), 400, "VALIDATION_FAILED"));
  const unchanged = q.userById.get(created.user.id);
  assert.equal(unchanged.extras, created.user.extras, "rejection retains preference and consent atomically");
  assert.equal(unchanged.handle, created.user.handle);
});

test("cooldown is self-only and uses the same ten business days enforced by profile changes", async () => {
  const user = addUser("cooldown_projection");
  const changedAt = Date.UTC(2026, 8, 4, 12);
  db.prepare("UPDATE users SET handle_changed_at=? WHERE id=?").run(changedAt, user.id);
  const current = q.userById.get(user.id);
  assert.equal(publicUser(current).handleChangeAvailableAt, undefined);
  assert.equal(publicUser(current, { self: true }).handleChangeAvailableAt, Date.UTC(2026, 8, 18, 12));
  db.prepare("UPDATE users SET handle_changed_at=? WHERE id=?").run(Date.now(), user.id);
  (await apiError(() => routes["PATCH /api/me"]({ user: q.userById.get(user.id), body: { handle: "cooldown_changed" }, ip: "cooldown-fixture" }), 429, "RATE_LIMITED"));
});

test("availability is rate limited by IP even when the caller rotates cookies", async () => {
  const request = { query: { handle: "rate_limited_name" }, ip: "handle-rate-limit" };
  for (let index = 0; index < 60; index += 1) {
    assert.equal(routes["GET /api/signup/handle-availability"]({ ...request, user: { id: `cookie_${index}` } }).available, true);
  }
  (await apiError(() => routes["GET /api/signup/handle-availability"](request), 429, "RATE_LIMITED"));
});

test("setup completion is independent from verification and does not grant media permission", async () => {
  const created = (await signup("still_unverified"));
  (await apiError(() => routes["POST /api/media/assets"]({ user: created.user, body: {}, ip: "unverified-media" }),
    403, "MEDIA_EMAIL_VERIFICATION_REQUIRED"));
  assert.equal(routes["POST /api/me/onboarding/complete"]({ user: created.user, body: { version: 1 }, ip: "unverified-complete" }).onboardingVersion, 1);
  assert.equal(q.userById.get(created.user.id).email_verified_at, 0);
  (await apiError(() => routes["POST /api/media/assets"]({ user: q.userById.get(created.user.id), body: {}, ip: "unverified-media-after-finish" }), 403, "MEDIA_EMAIL_VERIFICATION_REQUIRED"));
});
