// Resumable broadcast queue. A campaign is expanded into one row per recipient
// up front, then drained a few at a time against the daily provider budget. The
// queue is the source of truth for progress, so a restart, a crash, or hitting
// the daily cap all resume from the same place instead of re-sending to people
// who already got the message.
import { randomUUID } from "node:crypto";
import { db, emailStmts, q } from "./db.js";
import { renderEmail } from "./emails.js";
import { deliver, publicOrigin, remainingToday, unsubscribeUrl } from "./emailService.js";

export const AUDIENCES = {
  all: { label: "Everyone", where: "" },
  fan: { label: "Fans only", where: "AND role = 'fan'" },
  artist: { label: "Artists only", where: "AND role = 'artist'" },
  verified: { label: "Verified accounts", where: "AND verified = 1" },
  staff: { label: "Staff (admin + moderator)", where: "AND role IN ('admin','moderator')" },
};

// Long enough to cover the provider's own request timeout, short enough for a
// crashed worker to resume without operator intervention. A lease token also
// protects against a late response from an expired worker overwriting the new
// owner's result.
export const EMAIL_QUEUE_LEASE_MS = 5 * 60 * 1000;
const activeDrains = new Map();
// The Resend daily allowance is process-wide, not campaign-wide. Serializing
// drains makes the remainingToday() read and the subsequent logged sends one
// local critical section, so two campaigns in this process cannot both spend
// the same final slot. Multi-instance deployments still need a durable shared
// quota reservation; this intentionally makes no distributed claim.
let drainTail = Promise.resolve();

const RECIPIENT_SKIP_REASONS = new Set([
  "opted-out",
  "banned",
  "no-such-user",
  "no-address",
  "non-production-recipient",
]);

// Banned and opted-out accounts are excluded at expansion time rather than at
// send time, so the campaign total the admin sees is the number of people who
// will actually be mailed.
function recipientRows(audience) {
  const clause = AUDIENCES[audience]?.where ?? "";
  return db.prepare(
    `SELECT id, email FROM users
     WHERE email IS NOT NULL AND email <> ''
       AND is_banned = 0 AND marketing_opt_out = 0 ${clause}
     ORDER BY created_at, id`
  ).all();
}

export function audienceSize(audience) {
  return recipientRows(audience).length;
}

/**
 * Expand a draft into per-recipient rows and mark it sending. The public send
 * path requires a current test by default. Both the revision check and status
 * transition live in one write transaction, so a PATCH cannot slip between a
 * stale approval read and the irreversible broadcast transition.
 */
export function startCampaign(campaignId, { requireCurrentTest = true } = {}) {
  const startedAt = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    const campaign = emailStmts.campaignById.get(campaignId);
    if (!campaign) {
      db.exec("COMMIT");
      return { ok: false, reason: "no-such-campaign" };
    }
    if (campaign.status === "sending") {
      db.exec("COMMIT");
      return { ok: true, resumed: true, total: campaign.total };
    }
    if (campaign.status === "sent") {
      db.exec("COMMIT");
      return { ok: false, reason: "already-sent" };
    }
    if (campaign.status !== "draft" && campaign.status !== "paused") {
      db.exec("COMMIT");
      return { ok: false, reason: `status-${campaign.status}` };
    }
    if (requireCurrentTest && (!campaign.test_sent_at || campaign.tested_revision !== campaign.content_revision)) {
      db.exec("COMMIT");
      return { ok: false, reason: "test-required" };
    }

    const rows = recipientRows(campaign.audience);
    // INSERT OR IGNORE against the unique (campaign_id,to_email) index means a
    // re-start after a pause tops up the queue without duplicating anyone.
    for (const row of rows) emailStmts.enqueue.run(campaignId, row.id, row.email, startedAt);
    const total = emailStmts.countQueued.get(campaignId).c;
    const transition = emailStmts.startCampaign.run({
      id: campaignId,
      started_at: startedAt,
      total,
      revision: campaign.content_revision,
      require_current_test: requireCurrentTest ? 1 : 0,
    });
    if (transition.changes !== 1) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "revision-conflict" };
    }
    db.exec("COMMIT");
    return { ok: true, total };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

export function pauseCampaign(campaignId) {
  const campaign = emailStmts.campaignById.get(campaignId);
  if (!campaign) return { ok: false, reason: "no-such-campaign" };
  const paused = emailStmts.pauseCampaign.run(Date.now(), campaignId);
  if (paused.changes !== 1) return { ok: false, reason: "not-sending" };
  return { ok: true };
}

/**
 * Send up to `max` queued messages, stopping early at the daily provider budget.
 * Returns what it did so the caller (admin button or background tick) can report
 * honestly rather than claiming the whole campaign went out.
 */
async function drainCampaignOnce(campaignId, {
  max = 25,
  deliverImpl = deliver,
  clock = Date.now,
} = {}) {
  const campaign = emailStmts.campaignById.get(campaignId);
  if (!campaign) return { ok: false, reason: "no-such-campaign" };
  if (campaign.status !== "sending") return { ok: false, reason: `status-${campaign.status}` };

  // Only an EXPIRED claim may be reclaimed. Resetting every `sending` row here
  // races a second drain against a provider call that is still live and can send
  // the same broadcast twice.
  const staleBefore = clock() - EMAIL_QUEUE_LEASE_MS;
  const reclaimed = db.prepare(`UPDATE email_queue
    SET status='pending',claimed_at=NULL,claim_token=NULL
    WHERE campaign_id=? AND status='sending' AND attempts < 3
      AND (claimed_at IS NULL OR claimed_at<=?)`).run(campaignId, staleBefore);
  if (reclaimed.changes) console.warn(`[mail] reclaimed ${reclaimed.changes} interrupted row(s) for campaign ${campaignId}`);
  db.prepare(`UPDATE email_queue
    SET status='failed',last_error='too-many-attempts',claimed_at=NULL,claim_token=NULL
    WHERE campaign_id=? AND status='sending' AND attempts>=3
      AND (claimed_at IS NULL OR claimed_at<=?)`).run(campaignId, staleBefore);

  const budget = Math.min(max, remainingToday());
  const result = { ok: true, sent: 0, failed: 0, skipped: 0, attempted: 0, stoppedBy: null };
  if (budget <= 0) {
    result.stoppedBy = "daily-limit";
    result.remainingInQueue = emailStmts.countPending.get(campaignId).c;
    return result;
  }

  for (let i = 0; i < budget; i++) {
    const claimToken = randomUUID();
    const row = emailStmts.claimQueueRow.get({
      campaign_id: campaignId,
      claimed_at: clock(),
      claim_token: claimToken,
    });
    if (!row) {
      const status = emailStmts.campaignById.get(campaignId)?.status;
      result.stoppedBy = status === "sending" ? "queue-empty" : `status-${status || "missing"}`;
      break;
    }

    const user = row.user_id ? q.userById.get(row.user_id) : null;
    const rendered = renderEmail({
      subject: campaign.subject,
      body: campaign.body,
      ctaLabel: campaign.cta_label,
      ctaUrl: campaign.cta_url,
      kind: "campaign",
      vars: {
        name: user?.name || "there",
        handle: user?.handle || "",
        origin: publicOrigin(),
        unsubscribeUrl: user ? unsubscribeUrl(user.id) : "",
      },
    });

    const outcome = await deliverImpl({
      to: row.to_email, userId: row.user_id, kind: "campaign", campaignId,
      subject: rendered.subject, html: rendered.html, text: rendered.text,
      idempotencyKey: `campaign-${campaignId}-${row.id}`,
    });

    const recipientSkip = !outcome.sent && RECIPIENT_SKIP_REASONS.has(outcome.reason);
    // Everything that is not a known recipient-specific skip is treated as a
    // provider/deployment outage. Release the token-owned row for retry instead
    // of permanently consuming the address; the claim-time attempt counter
    // bounds a poison/config failure at three tries.
    const providerFailure = !outcome.sent && !recipientSkip;
    const status = outcome.sent
      ? "sent"
      : recipientSkip
        ? "skipped"
        : row.attempts >= 3 ? "failed" : "pending";
    const settled = emailStmts.settleQueueRow.run({
      status,
      last_error: outcome.reason ?? null,
      sent_at: outcome.sent ? clock() : null,
      id: row.id,
      claim_token: claimToken,
    });
    // A response that outlived its lease no longer owns the row. The provider
    // idempotency key protects the retry; never let this stale worker clobber the
    // current owner's durable state.
    if (!settled.changes) {
      result.stoppedBy = "lease-lost";
      break;
    }
    if (status in result) result[status] += 1;
    result.attempted += 1;

    // A provider outage stops after the first address. Pending means it can be
    // retried with the same row-derived idempotency key; failed means the third
    // bounded attempt was exhausted and an operator must inspect the campaign.
    if (providerFailure) {
      result.stoppedBy = "provider-error";
      result.retryable = status === "pending";
      break;
    }
  }

  emailStmts.bumpCampaignCounts.run({ id: campaignId, updated_at: clock() });
  const pending = emailStmts.countPending.get(campaignId).c;
  const open = emailStmts.countOpen.get(campaignId).c;
  result.remainingInQueue = pending;
  if (!result.stoppedBy && open === 0) result.stoppedBy = "queue-empty";
  if (open === 0) {
    const terminalFailures = emailStmts.campaignById.get(campaignId)?.failed_count || 0;
    const finalStatus = terminalFailures > 0 ? "failed" : "sent";
    const finalized = emailStmts.finishCampaign.run(finalStatus, clock(), clock(), campaignId);
    const durableStatus = emailStmts.campaignById.get(campaignId)?.status || null;
    result.finalStatus = durableStatus;
    if (finalized.changes === 1) result.finished = true;
    else if (!result.stoppedBy || result.stoppedBy === "queue-empty") result.stoppedBy = `status-${durableStatus || "missing"}`;
  } else if (result.stoppedBy === "provider-error") {
    emailStmts.pauseCampaign.run(clock(), campaignId);
    result.paused = true;
  }
  return result;
}

/** One in-process drain per campaign; database claim tokens cover other workers. */
export function drainCampaign(campaignId, options = {}) {
  const active = activeDrains.get(campaignId);
  if (active) return active;
  const queued = drainTail.then(
    () => drainCampaignOnce(campaignId, options),
    () => drainCampaignOnce(campaignId, options),
  );
  // Keep the serialization chain fulfilled so one unexpected drain rejection
  // cannot prevent later campaigns from ever starting.
  drainTail = queued.catch(() => {});
  const operation = queued.finally(() => {
    if (activeDrains.get(campaignId) === operation) activeDrains.delete(campaignId);
  });
  activeDrains.set(campaignId, operation);
  return operation;
}

/** Campaigns left mid-flight, e.g. after a restart or a daily-cap stop. */
export function resumableCampaigns(limit = 25) {
  const parsed = Number(limit);
  const bounded = Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 25) : 25;
  return db.prepare(
    "SELECT id FROM email_campaigns WHERE status='sending' ORDER BY started_at,id LIMIT ?",
  ).all(bounded).map((row) => row.id);
}

export function campaignProgress(campaignId) {
  const campaign = emailStmts.campaignById.get(campaignId);
  if (!campaign) return null;
  return {
    ...campaign,
    pending: emailStmts.countPending.get(campaignId).c,
    queued: emailStmts.countQueued.get(campaignId).c,
  };
}
