import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-verification-"));
process.env.PIT_DATA_DIR = dataDir;
// Deliver nothing during tests; every path still writes to email_log.
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;

const { db, q, publicUser } = await import("./db.js");
const {
  beginVerification, completeVerification, forceVerify, hashToken,
  mintVerifyToken, resendVerification, sendWelcomeOnce, verificationEnabled,
} = await import("./verification.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

let seq = 0;
function addUser() {
  const id = `u_verify_${++seq}`;
  q.insertUser.run(id, `${id}@example.com`, `User ${seq}`, `user${seq}`, "hash", "fan", null, null, null, "U1", "#123456", Date.now());
  return q.userById.get(id);
}

function welcomeCount(userId) {
  return db.prepare("SELECT COUNT(*) c FROM email_log WHERE user_id=? AND template_key='welcome'").get(userId).c;
}

// The welcome is sent through sendTemplateInBackground, which defers by a
// microtask so signup never waits on the mail provider. Let that settle before
// asserting on the log, or the row has not been written yet.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => { delete process.env.EMAIL_VERIFICATION_ENABLED; });

test("verification defaults ON, so a missing variable cannot silently disable it", () => {
  assert.equal(verificationEnabled({}), true);
  assert.equal(verificationEnabled({ EMAIL_VERIFICATION_ENABLED: "" }), true);
  for (const off of ["0", "false", "no", "off", "OFF", " False "]) {
    assert.equal(verificationEnabled({ EMAIL_VERIFICATION_ENABLED: off }), false, `${off} should disable`);
  }
  assert.equal(verificationEnabled({ EMAIL_VERIFICATION_ENABLED: "true" }), true);
});

test("signup sends the verify mail and holds the welcome until confirmed", async () => {
  const user = addUser();
  const result = beginVerification(user, { background: false });
  assert.equal(result.verificationSent, true);
  assert.equal(result.autoVerified, false);

  const fresh = q.userById.get(user.id);
  assert.equal(fresh.email_verified_at, 0);
  assert.ok(fresh.email_verify_hash, "a token hash should be stored");
  assert.equal(welcomeCount(user.id), 0, "the welcome must wait for confirmation");

  const verifyLogged = db.prepare("SELECT COUNT(*) c FROM email_log WHERE user_id=? AND template_key='verify_email'").get(user.id).c;
  assert.equal(verifyLogged, 1);
});

test("the raw token is never stored, only its hash", () => {
  const user = addUser();
  const token = mintVerifyToken(user.id);
  const stored = q.userById.get(user.id).email_verify_hash;
  assert.notEqual(stored, token);
  assert.equal(stored, hashToken(token));
});

test("confirming marks the account and releases the welcome exactly once", async () => {
  const user = addUser();
  const token = mintVerifyToken(user.id);

  const verified = completeVerification(token);
  assert.ok(verified, "a live token should verify");
  assert.ok(verified.email_verified_at > 0);
  assert.equal(verified.email_verify_hash, null, "the token must be spent");
  await flush();
  assert.equal(welcomeCount(user.id), 1);

  // Replaying the same token must not verify again or re-send the welcome.
  assert.equal(completeVerification(token), null);
  await flush();
  assert.equal(welcomeCount(user.id), 1);
});

test("an unknown or expired token is refused, and reveals nothing either way", () => {
  assert.equal(completeVerification("not-a-real-token"), null);
  assert.equal(completeVerification(""), null);
  assert.equal(completeVerification(null), null);

  const user = addUser();
  const token = mintVerifyToken(user.id);
  // Expire it by hand rather than waiting 24 hours.
  db.prepare("UPDATE users SET email_verify_expires=? WHERE id=?").run(Date.now() - 1000, user.id);
  assert.equal(completeVerification(token), null, "an expired token must not verify");
  assert.equal(q.userById.get(user.id).email_verified_at, 0);
});

test("one user's token cannot verify another account", () => {
  const a = addUser();
  const b = addUser();
  mintVerifyToken(a.id);
  const tokenB = mintVerifyToken(b.id);
  const verified = completeVerification(tokenB);
  assert.equal(verified.id, b.id);
  assert.equal(q.userById.get(a.id).email_verified_at, 0, "A must be untouched");
});

test("the kill switch verifies immediately and welcomes without a round trip", async () => {
  process.env.EMAIL_VERIFICATION_ENABLED = "false";
  const user = addUser();
  const result = beginVerification(user, { background: false });
  assert.equal(result.autoVerified, true);
  assert.equal(result.verificationSent, false);
  assert.ok(q.userById.get(user.id).email_verified_at > 0);
  await flush();
  assert.equal(welcomeCount(user.id), 1);
});

test("an admin can confirm an address, and that also releases the welcome once", async () => {
  const user = addUser();
  mintVerifyToken(user.id);
  const forced = forceVerify(user.id);
  assert.ok(forced.email_verified_at > 0);
  await flush();
  assert.equal(welcomeCount(user.id), 1);
  // Forcing an already-verified account must not send a second welcome.
  forceVerify(user.id);
  await flush();
  assert.equal(welcomeCount(user.id), 1);
  assert.equal(forceVerify("u_does_not_exist"), null);
});

test("resend issues a fresh token and retires the old one", () => {
  const user = addUser();
  const first = mintVerifyToken(user.id);
  const result = resendVerification(q.userById.get(user.id));
  assert.equal(result.sent, true);
  assert.equal(completeVerification(first), null, "the superseded token must be dead");
});

test("resend is a no-op once verified, and while the kill switch is off", () => {
  const user = addUser();
  forceVerify(user.id);
  assert.deepEqual(resendVerification(q.userById.get(user.id)), { sent: false, reason: "already-verified" });

  process.env.EMAIL_VERIFICATION_ENABLED = "off";
  const other = addUser();
  assert.deepEqual(resendVerification(other), { sent: false, reason: "verification-disabled" });
});

test("sendWelcomeOnce is the single guard against a duplicate welcome", async () => {
  const user = addUser();
  const first = await sendWelcomeOnce(user);
  assert.notEqual(first.reason, "already-sent");
  const second = await sendWelcomeOnce(user);
  assert.equal(second.sent, false);
  assert.equal(second.reason, "already-sent");
  assert.equal(welcomeCount(user.id), 1);
});

test("email verification never appears as the public verified check", () => {
  const user = addUser();
  forceVerify(user.id);
  const fresh = q.userById.get(user.id);

  const publicView = publicUser(fresh);
  assert.equal(publicView.verified, false, "confirming an address must not grant the public check");
  assert.equal(publicView.emailVerified, undefined, "private state must not leak to other users");

  const selfView = publicUser(fresh, { self: true });
  assert.equal(selfView.emailVerified, true);
  assert.equal(selfView.verified, false);
});
