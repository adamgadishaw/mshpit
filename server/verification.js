// Email verification.
//
// Unverified accounts may browse and exercise privacy/account rights, but unsafe
// social, media, and artist mutations are gated at the HTTP boundary. A mail
// outage therefore fails closed for publishing without trapping data rights.
//
// The ordering the owner asked for: signup sends the VERIFY mail, and the WELCOME
// mail is held until the address is actually confirmed. Welcoming an address
// nobody has proven they own is how a typo becomes mail to a stranger.
import { createHash, randomBytes } from "node:crypto";
import { db, emailStmts, q } from "./db.js";
import { publicOrigin, sendTemplate, sendTemplateInBackground } from "./emailService.js";
import { claimPendingSignupHandle } from "./features/accountOnboarding/signupHandle.js";
import { privateErrorLabel } from "./errors.js";
import { grantFirstWaveBadge } from "./memberBadges.js";
import { consumeSignupReservation } from "./features/accountOnboarding/signupReservations.js";
import { assertMemberIdentityAllowed } from "./features/artistAccounts/artistIdentityRisk.js";
import { opaqueId } from "./ids.js";
import { sessionTtlForRole } from "./auth.js";

const TTL_MS = 24 * 60 * 60 * 1000;

function verificationWrite(work) {
  if (db.isTransaction) return work();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* Keep the original verification failure. */ }
    throw error;
  }
}

function markVerifiedWithSignupPreference(userId, at = Date.now()) {
  return verificationWrite(() => {
    emailStmts.markEmailVerified.run(at, userId);
    claimPendingSignupHandle(db, q.userById.get(userId), at);
    grantFirstWaveBadge(db, userId, { at });
  });
}

// Local-only compatibility switch. Hosted production must never turn a mail
// outage into an authorization bypass by auto-verifying new accounts.
export function verificationEnabled(env = process.env) {
  if (env?.NODE_ENV === "production" || env?.RENDER === "true") return true;
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
  if (emailStmts.setVerifyToken.run(hashToken(token), now + TTL_MS, userId).changes !== 1) {
    throw new Error("Verification token could not be stored");
  }
  return token;
}

export function verifyLink(token) {
  // Fragments never enter HTTP requests, reverse-proxy logs, or Referer
  // headers. The app retains its explicit confirmation step, so mail scanners
  // still cannot consume the verification capability.
  return `${publicOrigin()}/#verify=${encodeURIComponent(token)}`;
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

// Database-only signup preparation. The secret stays inside a closure: neither
// a response nor a queued diagnostic record receives the raw bearer token.
export function prepareVerification(user) {
  if (!db.isTransaction) throw new Error("Verification preparation requires a transaction");
  const autoVerified = !verificationEnabled();
  if (autoVerified) markVerifiedWithSignupPreference(user.id);
  const token = autoVerified ? null : mintVerifyToken(user.id);
  const tokenHash = token ? hashToken(token) : null;
  const failedDelivery = (error) => {
    console.warn(`[mail] signup verification scheduling failed cause=${privateErrorLabel(error)}`);
    return { sent: false, reason: "delivery-failed" };
  };
  return {
    autoVerified,
    sendAfterCommit({ background = true } = {}) {
      if (db.isTransaction) throw new Error("Verification mail must follow commit");
      try {
        const fresh = q.userById.get(user.id);
        // A rolled-back signup, replaced token, or changed address must not
        // send a stale capability even if a caller retains this closure.
        if (!fresh || fresh.email !== user.email
          || (autoVerified ? !fresh.email_verified_at
            : fresh.email_verify_hash !== tokenHash || fresh.email_verify_expires <= Date.now())) {
          return Promise.resolve({ sent: false, reason: "verification-changed" });
        }
        if (autoVerified) return sendWelcomeOnce(fresh, { background }).catch(failedDelivery);
        const options = { user: fresh,
          vars: { name: fresh.name, link: verifyLink(token) },
          idempotencyKey: `verify-${tokenHash.slice(0, 32)}` };
        const delivery = background ? sendTemplateInBackground("verify_email", options) : sendTemplate("verify_email", options);
        return Promise.resolve(delivery).catch(failedDelivery);
      } catch (error) {
        // The signup is already committed. Delivery trouble must not discard
        // its response/cookie or silently grant email verification.
        return Promise.resolve(failedDelivery(error));
      }
    },
  };
}

/** Existing callers retain the same result and post-commit mail behavior. */
export function beginVerification(user, { background = true } = {}) {
  const prepared = verificationWrite(() => prepareVerification(user));
  void prepared.sendAfterCommit({ background });
  return { verificationSent: !prepared.autoVerified, autoVerified: prepared.autoVerified };
}

// A reservation has no user id, session or public profile. The mail still uses
// the shared transactional delivery policy and keeps the token in its fragment.
export function sendSignupReservation(reservation, { background = true } = {}) {
  if (!reservation) return Promise.resolve({ sent: false, reason: "signup-pending" });
  if (db.isTransaction) throw new Error("Signup reservation mail must follow commit");
  const failedDelivery = (error) => {
    console.warn(`[mail] signup verification scheduling failed cause=${privateErrorLabel(error)}`);
    return { sent: false, reason: "delivery-failed" };
  };
  try {
    const current = db.prepare("SELECT 1 FROM signup_reservations WHERE token_hash=? AND status='pending' AND expires_at>?")
      .get(reservation.tokenHash, Date.now());
    if (!current) return Promise.resolve({ sent: false, reason: "verification-changed" });
    const options = { to: reservation.email, vars: { name: "there", link: verifyLink(reservation.token) },
      idempotencyKey: `signup-verify-${reservation.tokenHash.slice(0, 32)}` };
    if (background) { sendTemplateInBackground("signup_verify", options); return Promise.resolve({ queued: true }); }
    return sendTemplate("signup_verify", options).catch(failedDelivery);
  } catch (error) { return Promise.resolve(failedDelivery(error)); }
}

function createVerifiedSignupAccount(payload, at) {
  // Protected names may have changed since this submission was staged.
  assertMemberIdentityAllowed(db, { name: payload.name });
  const id = opaqueId("u");
  let handle;
  do { handle = `pitfan_${randomBytes(4).toString("hex")}`; } while (q.userByHandle.get(handle));
  const initials = (payload.name.match(/\p{L}|\p{N}/gu) || ["?"]).slice(0, 2).join("").toUpperCase();
  const colors = ["#F2A65A", "#E0457B", "#5B8DEF", "#6FCF97", "#B98AE0", "#E8B65A"];
  q.insertUser.run(id, payload.email, payload.name, handle, payload.passwordHash, "fan",
    payload.city ?? null, payload.lat ?? null, payload.lng ?? null, initials, colors[Math.floor(Math.random() * colors.length)], at);
  db.prepare(`UPDATE users SET extras=?,genres=?,age_band=?,dm_policy='mutuals',onboarding_version=0,
    email_verified_at=? WHERE id=?`).run(JSON.stringify(payload.extras), JSON.stringify(payload.genres), payload.ageBand, at, id);
  claimPendingSignupHandle(db, q.userById.get(id), at);
  grantFirstWaveBadge(db, id, { at });
  return q.userById.get(id);
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
    const signup = consumeSignupReservation(db, { tokenHash, at: now, sessionTtlForRole, createAccount: createVerifiedSignupAccount });
    const user = emailStmts.userByVerifyHash.get(tokenHash, now);
    if (signup?.blocked) {
      completion = signup;
    } else if (signup?.user) {
      emailStmts.recordVerificationReceipt.run(tokenHash, signup.user.id, hashToken(signup.user.email), now, signup.expiresAt);
      completion = { user: signup.user, replayed: false };
    } else if (user) {
      emailStmts.recordVerificationReceipt.run(tokenHash, user.id, hashToken(user.email), now, user.email_verify_expires);
      emailStmts.markEmailVerified.run(now, user.id);
      claimPendingSignupHandle(db, q.userById.get(user.id), now);
      grantFirstWaveBadge(db, user.id, { at: now });
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
  if (completion.user) sendWelcomeOnce(completion.user, { background: true });
  return completion;
}

/** Admin action: confirm an address without the round trip. */
export function forceVerify(userId) {
  const user = q.userById.get(userId);
  if (!user) return null;
  if (!user.email_verified_at) markVerifiedWithSignupPreference(userId);
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
