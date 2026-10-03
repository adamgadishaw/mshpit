import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";
import { LEGAL_ACCEPTANCE_VERSION } from "../src/domain/privacyDisclosures.mjs";

const directory = mkdtempSync(join(tmpdir(), "pit-atomic-signup-"));
process.env.PIT_DATA_DIR = directory;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { createSession, getSession, hashPassword } = await import("./auth.js");
const { prepareVerification } = await import("./verification.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
beforeEach(() => { delete process.env.EMAIL_VERIFICATION_ENABLED; });
const flush = () => new Promise((resolve) => setImmediate(resolve));
const password = "Atomic-signup-password1";
let sequence = 0;
function signupContext(extra = {}) {
  const number = ++sequence;
  return { body: { name: "Signup Fixture", email: `signup-atomic-${number}@example.test`, password,
    genres: ["Rock"], ageBand: "18_plus", termsVersion: LEGAL_ACCEPTANCE_VERSION, ...extra },
    ip: `signup-atomic-${number}`, setHeader() {}, setSession(session) { this.session = session; } };
}
function addExisting(email) {
  const id = `existing_atomic_${++sequence}`;
  q.insertUser.run(id, email, "Existing Fixture", id, hashPassword(password), "fan", null, null, null,
    "EA", "#123456", Date.now());
  return q.userById.get(id);
}

test("reservation insertion failure leaves accounts, sessions and mail untouched", async () => {
  const ctx = signupContext();
  const beforeUsers = db.prepare("SELECT COUNT(*) n FROM users").get().n;
  const beforeMail = db.prepare("SELECT COUNT(*) n FROM email_log").get().n;
  db.exec(`CREATE TRIGGER atomic_signup_injected_failure BEFORE INSERT ON signup_reservations
    BEGIN SELECT RAISE(ABORT, 'injected atomic signup failure'); END`);
  try { await assert.rejects(routes["POST /api/signup"](ctx), /injected atomic signup failure/); }
  finally { db.exec("DROP TRIGGER atomic_signup_injected_failure"); }
  await flush();
  assert.equal(ctx.session, undefined);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM users").get().n, beforeUsers);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM email_log").get().n, beforeMail);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM signup_reservations WHERE email=?").get(ctx.body.email).n, 0);
});

test("verification account and receipt write failures roll back creation and preserve the original capability for retry", async () => {
  for (const phase of ["account", "receipt"]) {
    const ctx = signupContext();
    assert.equal((await routes["POST /api/signup"](ctx)).pending, true);
    const token = `synthetic-${++sequence}`;
    db.prepare("UPDATE signup_reservations SET token_hash=? WHERE email=?")
      .run(createHash("sha256").update(token).digest("hex"), ctx.body.email);
    const table = phase === "account" ? "users" : "email_verification_receipts";
    db.exec(`CREATE TRIGGER atomic_signup_injected_failure BEFORE INSERT ON ${table}
      BEGIN SELECT RAISE(ABORT, 'injected atomic signup failure'); END`);
    try { assert.throws(() => routes["POST /api/verify-email"]({ body: { token }, ip: `verify-${sequence}`, setHeader() {} }), /injected atomic signup failure/); }
    finally { db.exec("DROP TRIGGER atomic_signup_injected_failure"); }
    assert.equal(q.usersByEmail.all(ctx.body.email).length, 0);
    assert.equal(db.prepare("SELECT status FROM signup_reservations WHERE email=?").get(ctx.body.email).status, "pending");
    assert.equal(db.isTransaction, false);
    assert.equal(routes["POST /api/verify-email"]({ body: { token }, ip: `retry-${sequence}`, setHeader() {} }).verified, true);
    assert.equal(q.usersByEmail.all(ctx.body.email).length, 1);
    assert.equal(ctx.session, undefined);
  }
});
test("verification preparation cannot send before commit or after its token was rolled back", async () => {
  const user = addExisting(`prepare-${++sequence}@example.test`);
  assert.throws(() => prepareVerification(user), /requires a transaction/);
  const mailBefore = db.prepare("SELECT COUNT(*) n FROM email_log").get().n;
  db.exec("BEGIN IMMEDIATE");
  const prepared = prepareVerification(user);
  assert.throws(() => prepared.sendAfterCommit(), /must follow commit/);
  assert.deepEqual(JSON.parse(JSON.stringify(prepared)), { autoVerified: false }, "the prepared value cannot serialize a raw token");
  db.exec("ROLLBACK");
  assert.deepEqual(await prepared.sendAfterCommit({ background: false }), { sent: false, reason: "verification-changed" });
  assert.equal(q.userById.get(user.id).email_verify_hash, null);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM email_log").get().n, mailBefore);
});

test("mail starts only after signup is committed and provider failure never auto-verifies", async () => {
  const fetchBefore = globalThis.fetch;
  const envBefore = { RESEND_API_KEY: process.env.RESEND_API_KEY, MAIL_FROM: process.env.MAIL_FROM,
    NODE_ENV: process.env.NODE_ENV, EMAIL_VERIFICATION_ENABLED: process.env.EMAIL_VERIFICATION_ENABLED };
  process.env.RESEND_API_KEY = "fixture-key-never-sent";
  process.env.MAIL_FROM = "Fixture <noreply@example.test>";
  process.env.NODE_ENV = "production";
  process.env.EMAIL_VERIFICATION_ENABLED = "false";
  const ctx = signupContext();
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    assert.equal(String(url), "https://api.resend.com/emails");
    assert.equal(db.isTransaction, false);
    assert.equal(q.userByEmail.get(ctx.body.email), undefined);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM signup_reservations WHERE email=?").get(ctx.body.email).n, 1);
    return new Response(null, { status: 503 });
  };
  try {
    const result = await routes["POST /api/signup"](ctx);
    await flush();
    assert.equal(result.pending, true);
    assert.equal(result.verificationRequired, true);
    assert.equal(result.user, undefined);
    assert.equal(ctx.session, undefined);
    assert.equal(calls, 1);
    assert.equal(db.prepare("SELECT status FROM email_log WHERE to_email=? AND template_key='signup_verify'")
      .get(ctx.body.email).status, "failed");
  } finally {
    globalThis.fetch = fetchBefore;
    for (const [key, value] of Object.entries(envBefore)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("mailbox-first signup stays pending even when the legacy local verification switch is off", async () => {
  process.env.EMAIL_VERIFICATION_ENABLED = "false";
  const ctx = signupContext({ handle: "atomic_local_handle" });
  const result = await routes["POST /api/signup"](ctx);
  assert.equal(result.pending, true);
  assert.equal(ctx.session, undefined);
  assert.equal(q.userByEmail.get(ctx.body.email), undefined);
  await flush();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM email_log WHERE to_email=? AND template_key='welcome'").get(ctx.body.email).n, 0);
});
