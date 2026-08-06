// The single path every outbound message takes. Nothing else in the server may
// call sendEmail directly: routing all of it through deliver() is what makes the
// admin log a complete record instead of a partial one. A message that was never
// sent is still written here, with the reason, because the failures are the
// entries worth having.
import { randomBytes } from "node:crypto";
import { db, emailStmts, q } from "./db.js";
import { isProduction } from "./environment.js";
import { mailConfigured, mailDiagnostics, sendEmail } from "./mailer.js";
import { DEFAULT_TEMPLATES, renderEmail } from "./emails.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Staging carries real Resend credentials on purpose, because an environment
 * that cannot send is not a rehearsal of one that can. That also means a
 * broadcast composed on staging would reach real people, and a restored
 * production snapshot on staging holds every real address.
 *
 * So outside production, delivery is restricted to an explicit allowlist.
 * This fails CLOSED: an unset allowlist sends nothing at all. Blocked messages
 * are written to the log as skipped, so staging still exercises the full
 * compose/queue/log path and you can see exactly who would have been mailed.
 *
 * Returns a skip reason, or null when the message may proceed.
 */
export function nonProductionBlock(to, env = process.env) {
  if (isProduction(env)) return null;
  const allowed = String(env?.EMAIL_ALLOWED_RECIPIENTS || "")
    .split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (allowed.includes(String(to || "").trim().toLowerCase())) return null;
  return "non-production-recipient";
}

export function publicOrigin() {
  const configured = String(process.env.PUBLIC_ORIGIN || "").replace(/\/+$/, "");
  return configured || (process.env.NODE_ENV === "production" ? "https://www.mshpit.com" : "http://localhost:8081");
}

// Resend's free tier allows 100/day. Keeping the ceiling configurable means the
// cap moves with the plan instead of being a number buried in the queue.
export function dailySendLimit() {
  const raw = Number(process.env.EMAIL_DAILY_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 100;
}

export function sentToday() {
  return emailStmts.countSentSince.get(Date.now() - DAY_MS)?.c ?? 0;
}

export function remainingToday() {
  return Math.max(0, dailySendLimit() - sentToday());
}

// Minted on first use rather than at signup so existing accounts get one without
// a backfill migration.
export function unsubscribeToken(userId) {
  const existing = emailStmts.userUnsubToken.get(userId)?.unsub_token;
  if (existing) return existing;
  const token = randomBytes(24).toString("base64url");
  emailStmts.setUnsubToken.run(token, userId);
  return token;
}

export function unsubscribeUrl(userId) {
  return `${publicOrigin()}/api/unsubscribe?token=${unsubscribeToken(userId)}`;
}

export function templateFor(key) {
  const stored = emailStmts.templateByKey.get(key);
  const fallback = DEFAULT_TEMPLATES[key];
  if (!stored && !fallback) return null;
  return {
    key,
    subject: stored?.subject ?? fallback.subject,
    body: stored?.body ?? fallback.body,
    cta_label: stored ? stored.cta_label : fallback.cta_label,
    cta_url: stored ? stored.cta_url : fallback.cta_url,
    customized: !!stored,
    updated_at: stored?.updated_at ?? null,
    updated_by: stored?.updated_by ?? null,
  };
}

function writeLog(entry) {
  try {
    emailStmts.insertLog.run({
      created_at: Date.now(),
      kind: entry.kind,
      template_key: entry.templateKey ?? null,
      campaign_id: entry.campaignId ?? null,
      user_id: entry.userId ?? null,
      to_email: entry.to,
      subject: entry.subject,
      status: entry.status,
      reason: entry.reason ?? null,
    });
  } catch (e) {
    // Logging must never take down a send. Losing one audit row is bad; failing
    // the password reset that produced it is worse.
    console.warn("[mail] could not write email_log:", e?.message);
  }
}

/**
 * Send one message and record the attempt. Never throws.
 * `kind` is 'transactional' (account mail, ignores marketing opt-out) or
 * 'campaign' (announcements, always honours opt-out and carries an unsubscribe).
 */
export async function deliver({ to, userId = null, kind = "transactional", templateKey = null, campaignId = null, subject, html, text, idempotencyKey, force = false }) {
  const base = { kind, templateKey, campaignId, userId, to, subject };

  if (!to) { writeLog({ ...base, to: "(none)", status: "skipped", reason: "no-address" }); return { sent: false, reason: "no-address" }; }

  if (kind === "campaign" && userId && !force) {
    const user = q.userById.get(userId);
    if (!user) { writeLog({ ...base, status: "skipped", reason: "no-such-user" }); return { sent: false, reason: "no-such-user" }; }
    if (user.marketing_opt_out) { writeLog({ ...base, status: "skipped", reason: "opted-out" }); return { sent: false, reason: "opted-out" }; }
    if (user.is_banned) { writeLog({ ...base, status: "skipped", reason: "banned" }); return { sent: false, reason: "banned" }; }
  }

  // Checked before configuration: "this deployment may not mail this person" is
  // a stronger reason than "this deployment is missing a key", and `force` must
  // not be able to punch through it the way it bypasses opt-out for transactional.
  const blocked = nonProductionBlock(to);
  if (blocked) { writeLog({ ...base, status: "skipped", reason: blocked }); return { sent: false, reason: blocked }; }

  if (!mailConfigured()) {
    const reason = mailDiagnostics().reason || "not-configured";
    writeLog({ ...base, status: "skipped", reason });
    return { sent: false, reason };
  }

  const result = await sendEmail({ to, subject, html, text, idempotencyKey });
  writeLog({ ...base, status: result.sent ? "sent" : "failed", reason: result.sent ? null : result.reason });
  return { sent: result.sent, reason: result.reason ?? null };
}

/**
 * Render a named template for a user and deliver it. Used by signup and password
 * reset; the admin test-send path uses it too so a preview exercises the same
 * code the real send does.
 */
export async function sendTemplate(key, { user, to = null, vars = {}, kind = "transactional", campaignId = null, idempotencyKey, force = false } = {}) {
  const template = templateFor(key);
  const address = to || user?.email;
  if (!template) {
    writeLog({ kind, templateKey: key, campaignId, userId: user?.id ?? null, to: address || "(none)", subject: "(unknown template)", status: "skipped", reason: "no-such-template" });
    return { sent: false, reason: "no-such-template" };
  }

  const rendered = renderEmail({
    subject: template.subject,
    body: template.body,
    ctaLabel: template.cta_label,
    ctaUrl: template.cta_url,
    kind,
    vars: {
      name: user?.name || "there",
      handle: user?.handle || "",
      origin: publicOrigin(),
      ...(kind === "campaign" && user?.id ? { unsubscribeUrl: unsubscribeUrl(user.id) } : {}),
      ...vars,
    },
  });

  return deliver({
    to: address, userId: user?.id ?? null, kind, templateKey: key, campaignId,
    subject: rendered.subject, html: rendered.html, text: rendered.text, idempotencyKey, force,
  });
}

// Fire a transactional template without making the caller wait on the network.
// Signup must not hang for up to ten seconds on an unreachable mail provider,
// and the user is never told an email was sent, so a silent failure here is
// honest rather than a lie on screen. The attempt still lands in email_log.
export function sendTemplateInBackground(key, options) {
  Promise.resolve()
    .then(() => sendTemplate(key, options))
    .catch((e) => console.warn(`[mail] background ${key} failed:`, e?.message));
}

export function logStatsSince(sinceMs) {
  const rows = emailStmts.logStats.all(sinceMs);
  const out = { sent: 0, failed: 0, skipped: 0 };
  for (const row of rows) if (row.status in out) out[row.status] = row.c;
  return out;
}

export function recentLog({ limit = 50, status = null, campaignId = null, kind = null } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push("status = ?"); params.push(status); }
  if (campaignId) { where.push("campaign_id = ?"); params.push(campaignId); }
  if (kind) { where.push("kind = ?"); params.push(kind); }
  const sql = `SELECT * FROM email_log ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT ?`;
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
  return db.prepare(sql).all(...params);
}
