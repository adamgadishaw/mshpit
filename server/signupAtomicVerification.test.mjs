import assert from "node:assert/strict";
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

test("verification, session, and linked-grant write failures roll back every new signup row", async () => {
  for (const phase of ["verification", "session", "grant"]) {
    await flush();
    const ctx = signupContext(phase === "grant" ? { createAdditional: true } : {});
    const existing = phase === "grant" ? addExisting(ctx.body.email) : null;
    const existingSession = existing ? createSession(existing.id) : null;
    const existingBefore = existing ? q.userById.get(existing.id) : null;
    const beforeUsers = db.prepare("SELECT COUNT(*) n FROM users").get().n;
    const beforeSessions = db.prepare("SELECT COUNT(*) n FROM sessions").get().n;
    const beforeMail = db.prepare("SELECT COUNT(*) n FROM email_log").get().n;
    const trigger = phase === "verification"
      ? `BEFORE UPDATE OF email_verify_hash ON users WHEN NEW.email='${ctx.body.email}' AND NEW.email_verify_hash IS NOT NULL`
      : phase === "session"
        ? `BEFORE INSERT ON sessions WHEN NEW.user_id IN (SELECT id FROM users WHERE email='${ctx.body.email}')`
        : "BEFORE INSERT ON linked_account_session_grants";
    db.exec(`CREATE TRIGGER atomic_signup_injected_failure ${trigger}
      BEGIN SELECT RAISE(ABORT, 'injected atomic signup failure'); END`);
    try {
      await assert.rejects(routes["POST /api/signup"](ctx), /injected atomic signup failure/);
    } finally { db.exec("DROP TRIGGER atomic_signup_injected_failure"); }
    await flush();
    assert.equal(ctx.session, undefined, phase);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM users").get().n, beforeUsers, phase);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions").get().n, beforeSessions, phase);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM email_log").get().n, beforeMail, "rollback cannot queue mail");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM linked_account_pairs WHERE user_a_id=? OR user_b_id=?")
      .get(existing?.id || "absent", existing?.id || "absent").n, 0);
    if (existing) {
      assert.deepEqual(q.userById.get(existing.id), existingBefore);
      assert.ok(getSession(existingSession.token));
    }
    assert.equal(db.isTransaction, false);
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
    const user = q.userByEmail.get(ctx.body.email);
    assert.ok(user?.email_verify_hash);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id=?").get(user.id).n, 1);
    return new Response(null, { status: 503 });
  };
  try {
    const result = await routes["POST /api/signup"](ctx);
    await flush();
    assert.equal(result.created, true);
    assert.equal(result.verificationRequired, true);
    assert.equal(result.user.emailVerified, false);
    assert.ok(getSession(ctx.session.token));
    assert.equal(q.userById.get(result.user.id).email_verified_at, 0);
    assert.equal(calls, 1);
    assert.equal(db.prepare("SELECT status FROM email_log WHERE user_id=? AND template_key='verify_email'")
      .get(result.user.id).status, "failed");
  } finally {
    globalThis.fetch = fetchBefore;
    for (const [key, value] of Object.entries(envBefore)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("local verification-off signup claims its handle and session in the same transaction", async () => {
  process.env.EMAIL_VERIFICATION_ENABLED = "false";
  const ctx = signupContext({ handle: "atomic_local_handle" });
  const result = await routes["POST /api/signup"](ctx);
  assert.equal(result.user.emailVerified, true);
  assert.equal(result.user.handle, "atomic_local_handle");
  assert.ok(getSession(ctx.session.token));
  assert.equal(q.userById.get(result.user.id).email_verify_hash, null);
  await flush();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM email_log WHERE user_id=? AND template_key='welcome'").get(result.user.id).n, 1);
});
