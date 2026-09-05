import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { LEGAL_ACCEPTANCE_VERSION } from "../src/domain/privacyDisclosures.mjs";

const dataDir = mkdtempSync(join(tmpdir(), "pit-account-onboarding-"));
process.env.PIT_DATA_DIR = dataDir;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;

const { db, q, publicUser } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

let sequence = 0;
function addUser({ verified = false, onboardingVersion = null } = {}) {
  sequence += 1;
  const id = `onboarding_${sequence}`;
  q.insertUser.run(
    id,
    `${id}@example.test`,
    `Onboarding ${sequence}`,
    id,
    "test-hash",
    "fan",
    "Toronto",
    43.65,
    -79.38,
    "ON",
    "#123456",
    Date.now(),
  );
  if (onboardingVersion !== null) {
    db.prepare("UPDATE users SET onboarding_version=? WHERE id=?").run(onboardingVersion, id);
  }
  if (verified) db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}

function expectApiError(run, { status, code }) {
  assert.throws(run, (error) => error instanceof ApiError
    && error.status === status
    && error.code === code);
}

test("only canonical signup marks a new account as onboarding-incomplete", () => {
  const legacy = addUser();
  assert.equal(legacy.onboarding_version, null);

  const email = `onboarding-signup-${Date.now()}@example.test`;
  let issuedSession = false;
  const response = routes["POST /api/signup"]({
    body: {
      name: "New Onboarding Member",
      email,
      password: "onboarding-password1",
      city: "Toronto",
      genres: ["Rock"],
      ageBand: "18_plus",
      termsVersion: LEGAL_ACCEPTANCE_VERSION,
    },
    ip: "onboarding-signup",
    ua: "test",
    setSession() { issuedSession = true; },
  });

  assert.deepEqual(response, { ok: true, pending: true });
  assert.equal(issuedSession, false);
  assert.equal(q.userByEmail.get(email).onboarding_version, 0);

  db.prepare("UPDATE users SET onboarding_version=1 WHERE email=?").run(email);
  const retry = routes["POST /api/signup"]({
    body: {
      name: "New Onboarding Member",
      email,
      password: "different-password1",
      city: "Toronto",
      genres: ["Rock"],
      ageBand: "18_plus",
      termsVersion: LEGAL_ACCEPTANCE_VERSION,
    },
    ip: "onboarding-signup-existing",
    ua: "test",
    setSession() { issuedSession = true; },
  });
  assert.deepEqual(retry, response, "new and existing emails retain the same public response");
  assert.equal(issuedSession, false, "signup never issues a session");
  assert.equal(q.userByEmail.get(email).onboarding_version, 1, "a duplicate signup cannot reset completion");
});

test("onboarding state is exposed only in self and session projections", () => {
  const user = addUser({ verified: true, onboardingVersion: 0 });
  assert.equal(publicUser(user).onboardingVersion, undefined);
  assert.equal(publicUser(user, { self: true }).onboardingVersion, 0);
  assert.equal(routes["GET /api/me"]({ user }).user.onboardingVersion, 0);

  const publicProfile = routes["GET /api/users/:id"]({
    user: null,
    params: { id: user.id },
  });
  assert.equal(publicProfile.user.onboardingVersion, undefined);

  const legacy = addUser({ verified: true });
  assert.equal(publicUser(legacy, { self: true }).onboardingVersion, undefined);
  assert.equal(routes["GET /api/me"]({ user: legacy }).user.onboardingVersion, undefined);
});

test("completion requires an authenticated verified account and the current version", () => {
  const complete = routes["POST /api/me/onboarding/complete"];
  const unverified = addUser({ onboardingVersion: 0 });

  expectApiError(() => complete({ body: { version: 1 }, ip: "onboarding-anonymous" }), {
    status: 401,
    code: "AUTH_REQUIRED",
  });
  expectApiError(() => complete({ user: unverified, body: { version: 1 }, ip: "onboarding-unverified" }), {
    status: 403,
    code: "EMAIL_VERIFICATION_REQUIRED",
  });

  const verified = addUser({ verified: true, onboardingVersion: 0 });
  for (const [label, body] of [
    ["missing", {}],
    ["old", { version: 0 }],
    ["future", { version: 2 }],
    ["fractional", { version: 1.5 }],
    ["string", { version: "1" }],
  ]) {
    expectApiError(() => complete({
      user: verified,
      body,
      ip: `onboarding-invalid-${label}`,
    }), { status: 400, code: "VALIDATION_FAILED" });
  }
  assert.equal(q.userById.get(verified.id).onboarding_version, 0);
});

test("completion is no-store, idempotent, monotonic, and leaves public profile time alone", () => {
  const complete = routes["POST /api/me/onboarding/complete"];
  const user = addUser({ verified: true, onboardingVersion: 0 });
  db.prepare("UPDATE users SET profile_updated_at=1234 WHERE id=?").run(user.id);
  const headers = new Map();

  const first = complete({
    user: q.userById.get(user.id),
    body: { version: 1 },
    ip: "onboarding-first",
    setHeader(name, value) { headers.set(name, value); },
  });
  assert.equal(headers.get("Cache-Control"), "no-store");
  assert.equal(first.ok, true);
  assert.equal(first.onboardingVersion, 1);
  assert.equal(first.user.onboardingVersion, 1);
  assert.equal(q.userById.get(user.id).profile_updated_at, 1234);

  const retry = complete({
    user: q.userById.get(user.id),
    body: { version: 1 },
    ip: "onboarding-retry",
  });
  assert.equal(retry.onboardingVersion, 1);
  assert.equal(q.userById.get(user.id).onboarding_version, 1);

  db.prepare("UPDATE users SET onboarding_version=2 WHERE id=?").run(user.id);
  const forwardCompatibleRetry = complete({
    user: q.userById.get(user.id),
    body: { version: 1 },
    ip: "onboarding-forward-compatible-retry",
  });
  assert.equal(forwardCompatibleRetry.onboardingVersion, 2);
  assert.equal(q.userById.get(user.id).onboarding_version, 2);
});

test("completion leaves legacy-exempt accounts unversioned", () => {
  const user = addUser({ verified: true });
  const result = routes["POST /api/me/onboarding/complete"]({
    user,
    body: { version: 1 },
    ip: "onboarding-legacy-exempt",
  });
  assert.equal(result.ok, true);
  assert.equal(result.onboardingVersion, null);
  assert.equal(result.user.onboardingVersion, undefined);
  assert.equal(q.userById.get(user.id).onboarding_version, null);
});
