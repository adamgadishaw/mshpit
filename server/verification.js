// Email verification.
//
// Non-blocking by design: an unverified account works normally and only sees a
// prompt. Verification is a signal, not a gate, so a mail outage degrades into
// "nobody sees the badge" rather than "nobody can use the site".
//
// The ordering the owner asked for: signup sends the VERIFY mail, and the WELCOME
// mail is held until the address is actually confirmed. Welcoming an address
// nobody has proven they own is how a typo becomes mail to a stranger.
import { createHash, randomBytes } from "node:crypto";
import { db, emailStmts, q } from "./db.js";
import { publicOrigin, sendTemplate, sendTemplateInBackground } from "./emailService.js";

const TTL_MS = 24 * 60 * 60 * 1000;

// Kill switch. Email is a single external dependency; when it breaks, signup must
// not start producing accounts stuck in a permanently unverified state. Setting
// this treats every new account as verified and sends the welcome mail directly.
// Default is ON, so forgetting the variable cannot silently disable verification.
export function verificationEnabled(env = process.env) {
  const raw = String(env?.EMAIL_VERIFICATION_ENABLED ?? "").trim().toLowerCase();
  if (!raw) return true;
  return !["0", "false", "no", "off"].includes(raw);
}

export function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

// Stores only the hash. A token is shown to its owner once, in their inbox.
export function mintVerifyToken(userId, now = Date.now()) {
  const token = randomBytes(32).toString("base64url");
  emailStmts.setVerifyToken.run(hashToken(token), now + TTL_MS, userId);
  return token;
}

export function verifyLink(token) {
  return `${publicOrigin()}/api/verify-email?token=${encodeURIComponent(token)}`;
}

/**
 * Send the welcome mail exactly once per account. Verifying twice, an admin
 * marking an already-verified account, and a re-verification after an email
 * change all route through here, so the guard lives in one place.
 */
export async function sendWelcomeOnce(user, { background = false } = {}) {
  const fresh = q.userById.get(user.id);
  if (!fresh || fresh.welcome_sent_at) return { sent: false, reason: "already-sent" };
  // Claim it BEFORE sending. A duplicate welcome is worse than a missing one,
  // and two concurrent verifies would otherwise both see zero and both send.
  if (!emailStmts.markWelcomeSent.run(Date.now(), user.id).changes) {
    return { sent: false, reason: "already-sent" };
  }
  const options = { user: fresh, vars: { name: fresh.name } };
  if (background) { sendTemplateInBackground("welcome", options); return { sent: true, reason: null }; }
  return sendTemplate("welcome", options);
}

/**
 * Called at signup. Either starts verification, or (kill switch off) marks the
 * account verified and welcomes it immediately.
 */
export function beginVerification(user, { background = true } = {}) {
  if (!verificationEnabled()) {
    emailStmts.markEmailVerified.run(Date.now(), user.id);
    sendWelcomeOnce(user, { background });
    return { verificationSent: false, autoVerified: true };
  }
  const token = mintVerifyToken(user.id);
  const options = {
    user,
    vars: { name: user.name, link: verifyLink(token) },
    idempotencyKey: `verify-${hashToken(token).slice(0, 32)}`,
  };
  if (background) sendTemplateInBackground("verify_email", options);
  else sendTemplate("verify_email", options);
  return { verificationSent: true, autoVerified: false };
}

/**
 * Complete verification from a token. A short-lived hashed receipt makes the
 * operation idempotent when the write commits but its response is lost. Returns
 * null when neither a live token nor a valid receipt exists.
 */
export function completeVerification(token, now = Date.now()) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  let completion = null;
  db.exec("BEGIN IMMEDIATE");
  try {
    emailStmts.pruneVerificationReceipts.run(now);
    const user = emailStmts.userByVerifyHash.get(tokenHash, now);
    if (user) {
      emailStmts.recordVerificationReceipt.run(tokenHash, user.id, hashToken(user.email), now, user.email_verify_expires);
      emailStmts.markEmailVerified.run(now, user.id);
      completion = { user: q.userById.get(user.id), replayed: false };
    } else {
      const receipt = emailStmts.verificationReceiptByHash.get(tokenHash, now);
      const replayUser = receipt ? q.userById.get(receipt.user_id) : null;
      // If a future email-change flow replaces the address or clears its private
      // confirmation flag, an old receipt must stop matching immediately.
      if (receipt
        && replayUser
        && hashToken(replayUser.email) === receipt.email_hash
        && replayUser.email_verified_at >= receipt.verified_at) {
        completion = { user: replayUser, replayed: true };
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
  if (!completion) return null;
  // Also run for a replay: if the process stopped after committing verification
  // but before claiming the welcome, the retry finishes that one-time side effect.
  sendWelcomeOnce(completion.user, { background: true });
  return completion;
}

/** Admin action: confirm an address without the round trip. */
export function forceVerify(userId) {
  const user = q.userById.get(userId);
  if (!user) return null;
  if (!user.email_verified_at) emailStmts.markEmailVerified.run(Date.now(), userId);
  sendWelcomeOnce(user, { background: true });
  return q.userById.get(userId);
}

/** Re-send the verification mail. No-op on an already-verified account. */
export function resendVerification(user) {
  if (!user || user.email_verified_at) return { sent: false, reason: "already-verified" };
  if (!verificationEnabled()) return { sent: false, reason: "verification-disabled" };
  const token = mintVerifyToken(user.id);
  sendTemplateInBackground("verify_email", {
    user,
    vars: { name: user.name, link: verifyLink(token) },
    idempotencyKey: `verify-${hashToken(token).slice(0, 32)}`,
  });
  return { sent: true, reason: null };
}

// NOTE: there is deliberately no "email changed" path here, because the API has
// no route that changes an address. Whoever adds one must clear
// email_verified_at and re-issue a token in the same write, or an account keeps
// a confirmed flag for an address nobody has proven they own.
