import { createHash, randomUUID } from "node:crypto";
import { db } from "./db.js";
import { ANALYTICS_BATCH_LIMIT, sanitizeAnalyticsEvent } from "../src/domain/analyticsPolicy.mjs";

// Raw rows are intentionally short lived. At 100k events/day, 180 days would be
// 18 million SQLite rows and can exhaust a small hosted disk before the product
// benefits from that granularity. Thirty days preserves funnel debugging while
// aggregate product counters remain available from authoritative domain tables.
export const ANALYTICS_RETENTION_DAYS = Math.max(7, Math.min(90, Number(process.env.ANALYTICS_RETENTION_DAYS) || 30));
const RETENTION_MS = ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000;
export const ANALYTICS_MAX_RAW_ROWS = Math.max(10_000, Math.min(100_000, Number(process.env.ANALYTICS_MAX_RAW_ROWS) || 40_000));
export const ANALYTICS_MAX_ROWS_PER_ACCOUNT = Math.max(1_000, Math.min(10_000, Number(process.env.ANALYTICS_MAX_ROWS_PER_ACCOUNT) || 5_000));
const ANALYTICS_PRUNE_CHUNK = 5_000;
let lastPruneAt = 0;

function profileExtras(user) {
  try {
    const parsed = JSON.parse(user?.extras || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function analyticsEnabledFor(user) {
  const extras = profileExtras(user);
  // Terms acceptance and optional analytics consent are separate records. The
  // legacy timestamp remains a compatibility bridge for existing accounts.
  return !!user?.id && !!(extras.analyticsConsentAt || extras.consentAt) && !extras.analyticsOptOut;
}

function durableEventId(userId, clientId) {
  const digest = createHash("sha256").update(String(userId)).update("\0").update(String(clientId)).digest("hex");
  return `e_${digest.slice(0, 40)}`;
}

export function ingestAnalyticsBatch({ user, events, requireIds = false, at = Date.now() }) {
  if (!analyticsEnabledFor(user)) return { ok: true, received: 0, accepted: 0, stored: 0, duplicates: 0, rejected: 0 };
  const incoming = Array.isArray(events) ? events.slice(0, ANALYTICS_BATCH_LIMIT) : [];
  if (!incoming.length) return { ok: true, received: 0, accepted: 0, stored: 0, duplicates: 0, rejected: 0 };

  if (at - lastPruneAt >= 60 * 60 * 1000) {
    db.prepare("DELETE FROM events WHERE created_at < ?").run(at - RETENTION_MS);
    let count = db.prepare("SELECT COUNT(*) count FROM events").get().count;
    while (count > ANALYTICS_MAX_RAW_ROWS) {
      const remove = Math.min(ANALYTICS_PRUNE_CHUNK, count - ANALYTICS_MAX_RAW_ROWS);
      db.prepare(`DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY created_at,id LIMIT ?)` ).run(remove);
      count -= remove;
    }
    lastPruneAt = at;
  }

  const accepted = [];
  for (const input of incoming) {
    const event = sanitizeAnalyticsEvent(input, { requireId: requireIds });
    if (!event) continue;
    const clientId = event.id || `legacy_${randomUUID()}`;
    accepted.push({ ...event, storageId: durableEventId(user.id, clientId) });
  }
  // Regex-shaped ids are not proof of canonical content. Resolve the bounded
  // batch once and reject events referencing unknown posts so a modified client
  // cannot smuggle authored text through a fake `p_*` identifier.
  const referencedPostIds = [...new Set(accepted.map((event) => event.props.postId).filter(Boolean))];
  const knownPostIds = new Set();
  if (referencedPostIds.length) {
    const placeholders = referencedPostIds.map(() => "?").join(",");
    for (const row of db.prepare(`SELECT id FROM posts WHERE id IN (${placeholders})`).all(...referencedPostIds)) knownPostIds.add(row.id);
  }
  const canonical = accepted.filter((event) => !event.props.postId || knownPostIds.has(event.props.postId));
  if (!canonical.length) {
    return { ok: true, received: incoming.length, accepted: 0, stored: 0, duplicates: 0, rejected: incoming.length };
  }

  const insert = db.prepare("INSERT OR IGNORE INTO events (id,user_id,name,props,ip,created_at) VALUES (?,?,?,?,NULL,?)");
  let stored = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const event of canonical) {
      stored += Number(insert.run(event.storageId, user.id, event.name, JSON.stringify(event.props), at).changes) || 0;
    }
    const accountCount = db.prepare("SELECT COUNT(*) count FROM events WHERE user_id=?").get(user.id).count;
    const accountOverflow = Math.max(0, accountCount - ANALYTICS_MAX_ROWS_PER_ACCOUNT);
    if (accountOverflow) {
      db.prepare(`DELETE FROM events WHERE id IN (
        SELECT id FROM events WHERE user_id=? ORDER BY created_at,id LIMIT ?
      )`).run(user.id, accountOverflow);
    }
    const currentCount = db.prepare("SELECT COUNT(*) count FROM events").get().count;
    const overflow = Math.max(0, currentCount - ANALYTICS_MAX_RAW_ROWS);
    if (overflow) {
      db.prepare(`DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY created_at,id LIMIT ?)` ).run(overflow);
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }

  return {
    ok: true,
    received: incoming.length,
    accepted: canonical.length,
    stored,
    duplicates: canonical.length - stored,
    rejected: incoming.length - canonical.length,
  };
}

export function resetAnalyticsServiceForTests() {
  lastPruneAt = 0;
}
