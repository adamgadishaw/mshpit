// Resumable broadcast queue. A campaign is expanded into one row per recipient
// up front, then drained a few at a time against the daily provider budget. The
// queue is the source of truth for progress, so a restart, a crash, or hitting
// the daily cap all resume from the same place instead of re-sending to people
// who already got the message.
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

/** Expand a draft into per-recipient rows and mark it sending. Idempotent. */
export function startCampaign(campaignId) {
  const campaign = emailStmts.campaignById.get(campaignId);
  if (!campaign) return { ok: false, reason: "no-such-campaign" };
  if (campaign.status === "sending") return { ok: true, resumed: true, total: campaign.total };
  if (campaign.status === "sent") return { ok: false, reason: "already-sent" };

  const rows = recipientRows(campaign.audience);
  const now = Date.now();
  db.exec("BEGIN");
  try {
    // INSERT OR IGNORE against the unique (campaign_id,to_email) index means a
    // re-start after a pause tops up the queue without duplicating anyone.
    for (const row of rows) emailStmts.enqueue.run(campaignId, row.id, row.email, now);
    emailStmts.startCampaign.run(now, emailStmts.countQueued.get(campaignId).c, now, campaignId);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
  return { ok: true, total: emailStmts.countQueued.get(campaignId).c };
}

export function pauseCampaign(campaignId) {
  const campaign = emailStmts.campaignById.get(campaignId);
  if (!campaign) return { ok: false, reason: "no-such-campaign" };
  if (campaign.status !== "sending") return { ok: false, reason: "not-sending" };
  emailStmts.setCampaignStatus.run("paused", Date.now(), campaignId);
  return { ok: true };
}

/**
 * Send up to `max` queued messages, stopping early at the daily provider budget.
 * Returns what it did so the caller (admin button or background tick) can report
 * honestly rather than claiming the whole campaign went out.
 */
export async function drainCampaign(campaignId, { max = 25 } = {}) {
  const campaign = emailStmts.campaignById.get(campaignId);
  if (!campaign) return { ok: false, reason: "no-such-campaign" };
  if (campaign.status !== "sending") return { ok: false, reason: `status-${campaign.status}` };

  // Rows claimed by a process that died before settling would otherwise sit in
  // 'sending' forever, silently missing those recipients. Reclaim them: the
  // per-row idempotency key means Resend collapses a genuine double-send, and
  // the attempts counter stops a poison row from cycling indefinitely.
  const reclaimed = db.prepare("UPDATE email_queue SET status='pending' WHERE campaign_id=? AND status='sending' AND attempts < 3").run(campaignId);
  if (reclaimed.changes) console.warn(`[mail] reclaimed ${reclaimed.changes} interrupted row(s) for campaign ${campaignId}`);
  db.prepare("UPDATE email_queue SET status='failed', last_error='too-many-attempts' WHERE campaign_id=? AND status='sending' AND attempts >= 3").run(campaignId);

  const budget = Math.min(max, remainingToday());
  const result = { ok: true, sent: 0, failed: 0, skipped: 0, attempted: 0, stoppedBy: null };
  if (budget <= 0) {
    result.stoppedBy = "daily-limit";
    result.remainingInQueue = emailStmts.countPending.get(campaignId).c;
    return result;
  }

  for (let i = 0; i < budget; i++) {
    const row = emailStmts.nextPending.get(campaignId);
    if (!row) { result.stoppedBy = "queue-empty"; break; }

    // Claim before sending. If the process dies mid-send the row is already
    // terminal, so at worst one person misses a message rather than the queue
    // replaying the same address forever.
    const claimed = emailStmts.settleQueueRow.run("sending", null, null, row.id);
    if (!claimed.changes) continue;

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

    const outcome = await deliver({
      to: row.to_email, userId: row.user_id, kind: "campaign", campaignId,
      subject: rendered.subject, html: rendered.html, text: rendered.text,
      idempotencyKey: `campaign-${campaignId}-${row.id}`,
    });

    const status = outcome.sent ? "sent" : (outcome.reason === "opted-out" || outcome.reason === "banned" || outcome.reason === "no-such-user" ? "skipped" : "failed");
    db.prepare("UPDATE email_queue SET status=?, last_error=?, sent_at=? WHERE id=?")
      .run(status, outcome.reason ?? null, outcome.sent ? Date.now() : null, row.id);
    result[status] += 1;
    result.attempted += 1;

    // A provider outage should stop the run rather than burn the whole queue
    // against an endpoint that is currently failing every call.
    if (!outcome.sent && (outcome.reason === "sender-not-verified" || outcome.reason === "send-failed")) {
      result.stoppedBy = "provider-error";
      break;
    }
  }

  emailStmts.bumpCampaignCounts.run({ id: campaignId, updated_at: Date.now() });
  const pending = emailStmts.countPending.get(campaignId).c;
  result.remainingInQueue = pending;
  if (!result.stoppedBy && pending === 0) result.stoppedBy = "queue-empty";
  if (pending === 0) {
    emailStmts.finishCampaign.run("sent", Date.now(), Date.now(), campaignId);
    result.finished = true;
  } else if (result.stoppedBy === "provider-error") {
    emailStmts.setCampaignStatus.run("paused", Date.now(), campaignId);
    result.paused = true;
  }
  return result;
}

/** Campaigns left mid-flight, e.g. after a restart or a daily-cap stop. */
export function resumableCampaigns() {
  return db.prepare("SELECT id FROM email_campaigns WHERE status='sending' ORDER BY started_at").all().map((r) => r.id);
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
