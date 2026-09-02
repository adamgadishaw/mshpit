import { activeAccountSql } from "./accountVisibility.js";
import { ApiError } from "./errors.js";

export const FEED_IMPRESSION_BATCH_MAX = 50;
export const FEED_IMPRESSION_DEDUPE_MS = 5 * 60_000;
export const FEED_IMPRESSION_RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60_000;
export const FEED_IMPRESSION_RECEIPT_ACCOUNT_MAX = 5_000;

const POST_ID = /^p_[A-Za-z0-9_-]{1,77}$/;
const EVENT_ID = /^[A-Za-z0-9_-]{8,100}$/;
const SURFACES = new Set(["feed", "everyone", "for_you", "following", "local", "clips", "profile", "post", "artist"]);
let lastReceiptPruneAt = 0;

export function cleanFeedImpressionBatch(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > FEED_IMPRESSION_BATCH_MAX) {
    throw new ApiError(400, `Send between 1 and ${FEED_IMPRESSION_BATCH_MAX} post impressions.`, "VALIDATION_FAILED");
  }
  const byEvent = new Map();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new ApiError(400, "Each impression must identify one post view.", "VALIDATION_FAILED");
    }
    const postId = typeof raw.postId === "string" ? raw.postId.trim() : "";
    const eventId = typeof raw.eventId === "string" ? raw.eventId.trim() : "";
    const surface = raw.surface == null ? null : String(raw.surface).trim();
    if (!POST_ID.test(postId) || !EVENT_ID.test(eventId) || (surface && !SURFACES.has(surface))) {
      throw new ApiError(400, "One or more post impressions are invalid.", "VALIDATION_FAILED");
    }
    const prior = byEvent.get(eventId);
    if (prior && prior.postId !== postId) {
      throw new ApiError(400, "An impression id cannot identify two posts.", "VALIDATION_FAILED");
    }
    if (!prior) byEvent.set(eventId, { postId, eventId, surface });
  }
  return { received: value.length, impressions: [...byEvent.values()] };
}

function visiblePostIds(database, userId, postIds) {
  if (!postIds.length) return new Set();
  const placeholders = postIds.map(() => "?").join(",");
  return new Set(database.prepare(`SELECT p.id FROM posts p JOIN users u ON u.id=p.user_id
    WHERE p.id IN (${placeholders}) AND p.removed=0 AND p.user_id<>?
      AND ${activeAccountSql("u")}
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=p.user_id) OR
        (b.blocker_id=p.user_id AND b.blocked_id=?))`)
    .all(...postIds, userId, userId, userId).map((row) => row.id));
}

function pruneReceipts(database, userId, at) {
  const globalPrune = at - lastReceiptPruneAt >= 60 * 60_000;
  if (globalPrune) {
    database.prepare("DELETE FROM post_impression_receipts WHERE created_at<?")
      .run(Math.max(0, at - FEED_IMPRESSION_RECEIPT_RETENTION_MS));
  }
  database.prepare(`DELETE FROM post_impression_receipts WHERE user_id=? AND event_id IN (
    SELECT event_id FROM post_impression_receipts WHERE user_id=?
    ORDER BY created_at DESC,event_id DESC LIMIT -1 OFFSET ?
  )`).run(userId, userId, FEED_IMPRESSION_RECEIPT_ACCOUNT_MAX);
  return globalPrune;
}

export function recordFeedImpressions(database, { userId, impressions, at = Date.now() } = {}) {
  if (!database?.prepare || !userId || !Array.isArray(impressions)) {
    throw new TypeError("Complete impression dependencies are required");
  }
  const instant = Number.isSafeInteger(at) && at >= 0 ? at : Date.now();
  let pruned = false;
  database.exec("BEGIN IMMEDIATE");
  try {
    const visible = visiblePostIds(database, userId, [...new Set(impressions.map((entry) => entry.postId))]);
    const insertReceipt = database.prepare(`INSERT OR IGNORE INTO post_impression_receipts
      (user_id,event_id,post_id,created_at) VALUES (?,?,?,?)`);
    const getViewer = database.prepare(`SELECT seen_count,first_seen_at,last_seen_at FROM post_impressions
      WHERE user_id=? AND post_id=?`);
    const insertViewer = database.prepare(`INSERT INTO post_impressions
      (user_id,post_id,seen_count,first_seen_at,last_seen_at) VALUES (?,?,1,?,?)`);
    const updateViewerCounted = database.prepare(`UPDATE post_impressions
      SET seen_count=MIN(2147483647,seen_count+1),last_seen_at=MAX(last_seen_at,?)
      WHERE user_id=? AND post_id=?`);
    const updateViewerRecent = database.prepare(`UPDATE post_impressions SET last_seen_at=MAX(last_seen_at,?)
      WHERE user_id=? AND post_id=?`);
    const insertTotal = database.prepare(`INSERT INTO post_impression_totals
      (post_id,view_count,first_seen_at,last_seen_at) VALUES (?,1,?,?)
      ON CONFLICT(post_id) DO UPDATE SET
        view_count=MIN(2147483647,post_impression_totals.view_count+1),
        last_seen_at=MAX(post_impression_totals.last_seen_at,excluded.last_seen_at)`);
    const touchTotal = database.prepare(`INSERT INTO post_impression_totals
      (post_id,view_count,first_seen_at,last_seen_at) VALUES (?,1,?,?)
      ON CONFLICT(post_id) DO UPDATE SET
        last_seen_at=MAX(post_impression_totals.last_seen_at,excluded.last_seen_at)`);
    let recorded = 0;
    let counted = 0;
    for (const entry of impressions) {
      if (!visible.has(entry.postId)) continue;
      if (!insertReceipt.run(userId, entry.eventId, entry.postId, instant).changes) continue;
      recorded += 1;
      const current = getViewer.get(userId, entry.postId);
      if (!current) {
        insertViewer.run(userId, entry.postId, instant, instant);
        insertTotal.run(entry.postId, instant, instant);
        counted += 1;
      } else {
        const outsideWindow = instant - Number(current.last_seen_at) >= FEED_IMPRESSION_DEDUPE_MS;
        if (outsideWindow) {
          updateViewerCounted.run(instant, userId, entry.postId);
          counted += 1;
        } else {
          updateViewerRecent.run(instant, userId, entry.postId);
        }
        // This also repairs a missing aggregate with one anonymous viewer, but
        // does not claim another counted return inside the dedupe window.
        touchTotal.run(entry.postId, instant, instant);
      }
    }
    pruned = pruneReceipts(database, userId, instant);
    database.exec("COMMIT");
    if (pruned) lastReceiptPruneAt = instant;
    return { recorded, counted };
  } catch (error) {
    try { database.exec("ROLLBACK"); }
    catch { /* architecture: allow-empty-catch -- preserve the original impression transaction failure if rollback itself fails */ }
    throw error;
  }
}

export function attachPostImpressionStats(database, rows, viewerId = null) {
  if (!Array.isArray(rows) || !rows.length) return rows || [];
  const ids = [...new Set(rows.map((row) => row?.id).filter(Boolean))];
  if (!ids.length) return rows;
  const placeholders = ids.map(() => "?").join(",");
  const totals = new Map(database.prepare(`SELECT post_id,view_count FROM post_impression_totals
    WHERE post_id IN (${placeholders})`).all(...ids).map((row) => [row.post_id, row]));
  const own = viewerId
    ? new Map(database.prepare(`SELECT post_id,seen_count,first_seen_at,last_seen_at FROM post_impressions
      WHERE user_id=? AND post_id IN (${placeholders})`).all(viewerId, ...ids).map((row) => [row.post_id, row]))
    : new Map();
  return rows.map((row) => ({
    ...row,
    impression_view_count: Number(totals.get(row.id)?.view_count) || 0,
    viewer_seen_count: Number(own.get(row.id)?.seen_count) || 0,
    viewer_first_seen_at: own.get(row.id)?.first_seen_at ?? null,
    viewer_last_seen_at: own.get(row.id)?.last_seen_at ?? null,
  }));
}

export function viewerPostImpressionMap(database, userId, postIds) {
  if (!userId || !postIds.length) return new Map();
  const out = new Map();
  for (let offset = 0; offset < postIds.length; offset += 200) {
    const batch = postIds.slice(offset, offset + 200);
    const placeholders = batch.map(() => "?").join(",");
    for (const row of database.prepare(`SELECT post_id,seen_count,first_seen_at,last_seen_at
      FROM post_impressions WHERE user_id=? AND post_id IN (${placeholders})`).all(userId, ...batch)) {
      out.set(row.post_id, row);
    }
  }
  return out;
}

export function resetFeedImpressionPruneClockForTests() {
  lastReceiptPruneAt = 0;
}
