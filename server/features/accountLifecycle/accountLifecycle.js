import { createHash } from "node:crypto";
import { readOwnerIdentity } from "../../ownerIdentity.js";
import {
  ACCOUNT_INACTIVITY_DAY_MS, ACCOUNT_DORMANCY_MS, ACCOUNT_DELETION_MS,
  ACCOUNT_DELETION_WARNING_MS,
} from "./accountLifecycleSchema.js";

export {
  ACCOUNT_INACTIVITY_DAY_MS, ACCOUNT_DORMANCY_MS, ACCOUNT_DELETION_MS,
  ACCOUNT_DELETION_WARNING_MS,
} from "./accountLifecycleSchema.js";

const INTERACTIVE_KINDS = new Set(["login", "account-switch", "signup", "foreground", "mutation"]);
const REACTIVATION_KINDS = new Set(["login", "account-switch"]);
const MAX_SWEEP_LIMIT = 500;
const validTimestamp = (at) => Number.isSafeInteger(at) && at > 0;
const ownerId = (database) => {
  const identity = readOwnerIdentity(database);
  return identity?.version === 2 && identity.userId ? identity.userId : null;
};

function transaction(database, action) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Lifecycle transaction and rollback failed");
    }
    throw error;
  }
}

// UTC-duration policy, deliberately independent of email verification, profile
// completion, account role, account creation time, and marketing preferences.
export function accountLifecycleDecision(user, { at = Date.now(), ownerId: durableOwnerId } = {}) {
  if (!validTimestamp(at)) throw new TypeError("Invalid lifecycle timestamp");
  if (!user || !durableOwnerId || user.id === durableOwnerId) return { state: "protected" };
  if (!validTimestamp(user.last_active_at) || user.last_active_at > at) return { state: "untracked" };
  const dormantAfter = user.last_active_at + ACCOUNT_DORMANCY_MS;
  const warningAfter = user.last_active_at + ACCOUNT_DELETION_MS - ACCOUNT_DELETION_WARNING_MS;
  const deletionAfter = user.last_active_at + ACCOUNT_DELETION_MS;
  const acknowledgedWarning = validTimestamp(user.inactivity_warning_sent_at)
    && user.inactivity_warning_sent_at >= warningAfter
    && user.inactivity_warning_sent_at <= at
    && user.inactivity_warning_activity_at === user.last_active_at
    && typeof user.inactivity_warning_receipt === "string"
    && user.inactivity_warning_receipt.trim().length > 0;
  const deleteAfter = acknowledgedWarning
    ? Math.max(deletionAfter, user.inactivity_warning_sent_at + ACCOUNT_DELETION_WARNING_MS)
    : null;
  return {
    state: at < dormantAfter ? "active" : "dormant",
    suspend: at >= dormantAfter && !user.dormant_at,
    warn: at >= warningAfter && !acknowledgedWarning,
    delete: deleteAfter !== null && at >= deleteAfter,
    dormantAfter, warningAfter, deletionAfter, deleteAfter,
  };
}

// Call only after a server-authenticated, successful, explicit interaction.
// A passive session lookup, polling GET, impression, or failed request is not
// evidence of activity. No email-wide update: shared inboxes remain independent.
export function recordInteractiveAccountActivity(database, {
  userId, at = Date.now(), kind, reactivate = false,
} = {}) {
  if (!INTERACTIVE_KINDS.has(kind)) return false;
  if (!validTimestamp(at) || !userId) return false;
  if (reactivate && !REACTIVATION_KINDS.has(kind)) {
    throw new TypeError("Only successful login or account switching may reactivate dormancy");
  }
  // The permanent Owner has no inactivity lifecycle. Avoid even incidental
  // lifecycle writes, including during an operator's authority-repair flow.
  if (ownerId(database) === userId) return false;
  // A single SQLite statement acquires the same writer lock as the erasure
  // transaction. The monotonic increment also fences same-millisecond races.
  const result = database.prepare(`UPDATE users SET
    last_active_at=MAX(COALESCE(last_active_at,0)+1,?),
    inactivity_next_check_at=MAX(COALESCE(last_active_at,0)+1,?)+?,
    dormant_at=CASE WHEN ? THEN NULL ELSE dormant_at END,
    inactivity_warning_sent_at=NULL,inactivity_warning_activity_at=NULL,
    inactivity_warning_receipt=NULL,inactivity_warning_attempted_at=NULL
    WHERE id=?`).run(at, at, ACCOUNT_DORMANCY_MS, reactivate ? 1 : 0, userId);
  return Number(result.changes) === 1;
}

export function accountInactivityWarningKey(user) {
  return `account-inactivity-${createHash("sha256")
    .update(`${user.id}\0${user.last_active_at}`).digest("hex")}`;
}

// Caller-supplied candidate data is never sufficient authorization. Erasure
// must use the existing complete account/media cleanup, synchronously, on this
// same connection and WITHOUT its own BEGIN/COMMIT or asynchronous side effects.
export function eraseInactiveAccount(database, {
  userId, expectedLastActiveAt, at = Date.now(), eraseAccount,
} = {}) {
  if (typeof eraseAccount !== "function" || eraseAccount.constructor?.name === "AsyncFunction") {
    throw new TypeError("Inactivity erasure requires a synchronous complete-erasure callback");
  }
  return transaction(database, () => {
    const durableOwnerId = ownerId(database);
    const user = database.prepare("SELECT * FROM users WHERE id=?").get(userId);
    if (!durableOwnerId || !user || user.id === durableOwnerId
      || user.last_active_at !== expectedLastActiveAt
      || !accountLifecycleDecision(user, { at, ownerId: durableOwnerId }).delete) return false;
    const result = eraseAccount(user, { at, reason: "inactivity" });
    if (result && typeof result.then === "function") {
      throw new TypeError("Inactivity erasure must complete inside the synchronous transaction");
    }
    if (database.prepare("SELECT 1 FROM users WHERE id=?").get(user.id)) {
      throw new Error("Inactivity erasure callback did not erase the account");
    }
    return true;
  });
}

function claimCandidate(database, candidate, at) {
  return transaction(database, () => {
    const durableOwnerId = ownerId(database);
    const user = database.prepare("SELECT * FROM users WHERE id=?").get(candidate.id);
    if (!durableOwnerId || !user || user.id === durableOwnerId
      || user.inactivity_next_check_at > at || user.last_active_at !== candidate.last_active_at) return null;
    const decision = accountLifecycleDecision(user, { at, ownerId: durableOwnerId });
    if (["protected", "untracked"].includes(decision.state)) return null;
    const nextCheck = decision.state === "active" ? decision.dormantAfter
      : decision.warn || decision.delete ? at + ACCOUNT_INACTIVITY_DAY_MS
        : decision.deleteAfter ?? decision.warningAfter;
    database.prepare(`UPDATE users SET
      dormant_at=CASE WHEN ? THEN ? ELSE dormant_at END,
      inactivity_warning_attempted_at=CASE WHEN ? THEN ? ELSE inactivity_warning_attempted_at END,
      inactivity_next_check_at=? WHERE id=?`)
      .run(decision.suspend ? 1 : 0, at, decision.warn ? 1 : 0, at, nextCheck, user.id);
    return { user, decision };
  });
}

function acknowledgeWarning(database, user, acknowledgement, at) {
  // A queued email, console/dev transport, error, or ambiguous receipt cannot
  // start the irreversible-deletion countdown. Persist only a confirmed receipt.
  if (acknowledgement?.delivered !== true || typeof acknowledgement.receiptId !== "string"
    || !acknowledgement.receiptId.trim() || acknowledgement.receiptId.length > 500) return false;
  return transaction(database, () => {
    const durableOwnerId = ownerId(database);
    const current = database.prepare("SELECT * FROM users WHERE id=?").get(user.id);
    if (!durableOwnerId || !current || current.id === durableOwnerId
      || current.last_active_at !== user.last_active_at
      || !accountLifecycleDecision(current, { at, ownerId: durableOwnerId }).warn) return false;
    database.prepare(`UPDATE users SET inactivity_warning_sent_at=?,
      inactivity_warning_activity_at=?,inactivity_warning_receipt=?,inactivity_next_check_at=?
      WHERE id=?`).run(at, current.last_active_at, acknowledgement.receiptId.trim(),
      Math.max(current.last_active_at + ACCOUNT_DELETION_MS, at + ACCOUNT_DELETION_WARNING_MS), current.id);
    return true;
  });
}

// Invoke at most daily from the maintenance scheduler. Work is strictly bounded,
// ordered by its indexed next-check time, and checkpointed before network I/O.
// The function imports no live database and does nothing until explicitly called.
export async function runAccountLifecycleSweep({
  database, at = Date.now(), limit = 100, sendWarning, eraseAccount, signal,
} = {}) {
  if (!database?.prepare || !database?.exec || !validTimestamp(at)) {
    throw new TypeError("Account lifecycle sweep requires a database and valid timestamp");
  }
  const count = Math.min(MAX_SWEEP_LIMIT, Math.max(1, Math.floor(Number(limit) || 100)));
  const result = { checked: 0, dormant: 0, warned: 0, deleted: 0, failed: 0, skipped: 0, pending: 0 };
  const durableOwnerId = ownerId(database);
  if (!durableOwnerId) return { ...result, disabledReason: "durable-owner-unavailable" };
  const candidates = database.prepare(`SELECT id,last_active_at FROM users
    WHERE inactivity_next_check_at<=? AND id<>?
    ORDER BY inactivity_next_check_at,id LIMIT ?`).all(at, durableOwnerId, count);
  for (const candidate of candidates) {
    if (signal?.aborted) break;
    result.checked++;
    try {
      const plan = claimCandidate(database, candidate, at);
      if (!plan) { result.skipped++; continue; }
      if (plan.decision.suspend) result.dormant++;
      if (plan.decision.delete) {
        if (eraseInactiveAccount(database, {
          userId: plan.user.id, expectedLastActiveAt: plan.user.last_active_at, at, eraseAccount,
        })) result.deleted++;
        else result.skipped++;
      } else if (plan.decision.warn) {
        if (typeof sendWarning !== "function") { result.failed++; continue; }
        const acknowledgement = await sendWarning({
          user: plan.user, at, signal, idempotencyKey: accountInactivityWarningKey(plan.user),
          deleteAfter: Math.max(plan.decision.deletionAfter, at + ACCOUNT_DELETION_WARNING_MS),
        });
        if (acknowledgeWarning(database, plan.user, acknowledgement, at)) result.warned++;
        else if (acknowledgement?.pending) result.pending++;
        else result.failed++;
      }
    } catch {
      // The due-time claim remains durable while an unsuccessful erasure rolls
      // back as a unit. Do not log email addresses or opaque delivery receipts.
      result.failed++;
    }
  }
  return result;
}
