import { readOwnerIdentity } from "../../ownerIdentity.js";
import { renderEmail } from "../../emails.js";
import { accountLifecycleDecision } from "./accountLifecycle.js";

function stageWarning(database, { user, at, deleteAfter, idempotencyKey }) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const owner = readOwnerIdentity(database);
    const current = database.prepare("SELECT * FROM users WHERE id=?").get(user.id);
    let warning = null;
    if (owner?.version === 2 && owner.userId && current
      && current.last_active_at === user.last_active_at
      && accountLifecycleDecision(current, { at, ownerId: owner.userId }).warn) {
      database.prepare(`INSERT OR IGNORE INTO account_inactivity_warnings
        (user_id,activity_at,recipient_email,requested_at,delete_after,idempotency_key)
        VALUES (?,?,?,?,?,?)`).run(current.id, current.last_active_at, current.email, at, deleteAfter, idempotencyKey);
      warning = database.prepare("SELECT * FROM account_inactivity_warnings WHERE user_id=?").get(current.id);
      if (warning.activity_at !== current.last_active_at || warning.recipient_email !== current.email) warning = null;
    }
    database.exec("COMMIT");
    return warning;
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Warning staging and rollback failed");
    }
    throw error;
  }
}

// Code-owned transactional copy. Provider acceptance is persisted first, then
// verified on a later bounded daily pass. No webhook or externally supplied
// receipt can set the deletion countdown. All dependencies are injected so tests
// never load a live database or mail credential.
export function createAccountInactivityWarningSender({
  database, deliver, getDeliveryReceipt, origin, canSend = () => true,
} = {}) {
  if (!database?.prepare || typeof deliver !== "function" || typeof getDeliveryReceipt !== "function") {
    throw new TypeError("Account warnings require persistence, mail delivery and receipt lookup");
  }
  const parsedOrigin = new URL(origin);
  if (!["https:", "http:"].includes(parsedOrigin.protocol)) throw new TypeError("Invalid account warning origin");
  return async (request) => {
    if (request.signal?.aborted) return { delivered: false, pending: true };
    const warning = stageWarning(database, request);
    if (!warning || warning.receipt_unavailable) return { delivered: false };
    if (warning.provider_id) {
      const receipt = await getDeliveryReceipt({ providerId: warning.provider_id, to: warning.recipient_email, signal: request.signal });
      return receipt?.delivered === true ? receipt : { delivered: false, pending: true };
    }
    if (!canSend()) return { delivered: false, pending: true };
    const date = new Date(warning.delete_after).toISOString().slice(0, 10);
    const rendered = renderEmail({
      subject: "Mshpit account inactivity: sign in to keep your account",
      body: `Your Mshpit account @${request.user.handle || request.user.id} has been inactive and is dormant.\n\nThis specific account is eligible for permanent account and content deletion no earlier than ${date} (UTC), and only after at least 30 days following confirmed delivery of this warning.\n\nSign in to this account to reactivate inactivity dormancy and cancel deletion. Using a different account that shares this email does not reactivate this one. Inactivity reactivation does not remove a moderation ban or suspension.\n\nIf you want your data before leaving, sign in and use Download my data in Settings. If you need help, open Support from Settings.`,
      ctaLabel: "Sign in to Mshpit", ctaUrl: parsedOrigin.origin, kind: "transactional",
    });
    const result = await deliver({
      to: warning.recipient_email, userId: request.user.id, kind: "transactional",
      templateKey: "account_inactivity_warning", idempotencyKey: warning.idempotency_key,
      subject: rendered.subject, html: rendered.html, text: rendered.text,
    });
    if (!result?.sent) return { delivered: false };
    if (!result.providerId) {
      // Accepted but no usable provider receipt: do not repeatedly send an
      // unknowable warning or fabricate proof from the operational mail log.
      database.prepare(`UPDATE account_inactivity_warnings SET receipt_unavailable=1
        WHERE user_id=? AND activity_at=?`).run(request.user.id, warning.activity_at);
      return { delivered: false };
    }
    database.prepare(`UPDATE account_inactivity_warnings SET provider_id=?,accepted_at=?
      WHERE user_id=? AND activity_at=?`).run(result.providerId, request.at, request.user.id, warning.activity_at);
    return { delivered: false, pending: true };
  };
}
