// One bounded boundary for the staff moderation queue and its state changes.
// api.js owns HTTP authentication/validation; this module owns the database
// reads, transactions, desired-state semantics, and append-only audit history.
import { randomUUID } from "node:crypto";

import { db } from "./db.js";
import { ApiError } from "./errors.js";
import { clean, LIMITS } from "./validate.js";

export const MODERATABLE_CONTENT = Object.freeze({
  post: "posts",
  comment: "comments",
  fan_message: "fan_club_messages",
  lounge_message: "lounge_messages",
  venue_review: "venue_reviews",
});

const RECENT_ACTION_LIMIT = 20;
const LEGACY_QUEUE_LIMIT = 200;
const RECENT_REPORT_DAYS = 30;
const RECENT_REPORT_MS = RECENT_REPORT_DAYS * 24 * 60 * 60 * 1000;

const reportById = db.prepare("SELECT * FROM reports WHERE id=?");
const updateOpenReport = db.prepare("UPDATE reports SET status=? WHERE id=? AND status='open'");
const insertAudit = db.prepare(`INSERT INTO moderation_actions
  (id,actor_id,action,target_type,target_id,reason,prior_state,next_state,request_id,created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);

function boundedText(value, max = 280) {
  return clean(value, { max, newlines: true });
}

function publicPerson(row, prefix = "author") {
  const id = row?.[`${prefix}_id`];
  if (!id) return null;
  return {
    id,
    name: row[`${prefix}_name`] || "",
    handle: row[`${prefix}_handle`] || "",
    initials: row[`${prefix}_initials`] || null,
    avatarUri: row[`${prefix}_avatar_uri`] || null,
    avatarColor: row[`${prefix}_avatar_color`] || null,
    role: row[`${prefix}_role`] || "fan",
    isBanned: !!row[`${prefix}_is_banned`],
    suspendedUntil: row[`${prefix}_suspended_until`] || null,
  };
}

function placeholders(values) {
  return values.map(() => "?").join(",");
}

function uniqueTargetIds(reports, targetType) {
  return [...new Set(reports.filter((report) => report.target_type === targetType).map((report) => report.target_id))];
}

function contentMapKey(type, id) {
  return `${type}\u0000${id}`;
}

function parseArrayLength(value, max) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? Math.min(max, parsed.length) : 0;
  } catch {
    return 0;
  }
}

function trackDetails(report) {
  let parsed = {};
  try {
    const candidate = JSON.parse(report.reason || "{}");
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) parsed = candidate;
  } catch {}
  const category = ["wrong_video", "wont_play", "preview_only", "missing", "other"].includes(parsed.category)
    ? parsed.category
    : "other";
  return {
    type: "track",
    exists: true,
    title: boundedText(parsed.title, 200),
    artist: boundedText(parsed.artist, 120),
    category,
    suggestedVideoId: /^[A-Za-z0-9_-]{11}$/.test(parsed.suggestedVideoId || "") ? parsed.suggestedVideoId : null,
    note: boundedText(parsed.note, LIMITS.note),
  };
}

// At most one query per content type, never one query per queue row. Besides
// keeping a 200-report queue cheap, these projections deliberately exclude
// emails, private profile fields, media URLs, and direct-message bodies.
function contextsFor(reports) {
  const contexts = new Map();
  const queries = {
    post: (ids) => db.prepare(`SELECT p.id,p.kind,p.artist,p.venue,p.review,p.photos,p.removed,p.created_at,
        u.id author_id,u.name author_name,u.handle author_handle,u.initials author_initials,
        u.avatar_uri author_avatar_uri,u.avatar_color author_avatar_color,u.role author_role,
        u.is_banned author_is_banned,u.suspended_until author_suspended_until
      FROM posts p LEFT JOIN users u ON u.id=p.user_id WHERE p.id IN (${placeholders(ids)})`).all(...ids),
    comment: (ids) => db.prepare(`SELECT c.id,c.post_id,c.text,c.removed,c.created_at,
        u.id author_id,u.name author_name,u.handle author_handle,u.initials author_initials,
        u.avatar_uri author_avatar_uri,u.avatar_color author_avatar_color,u.role author_role,
        u.is_banned author_is_banned,u.suspended_until author_suspended_until
      FROM comments c LEFT JOIN users u ON u.id=c.user_id WHERE c.id IN (${placeholders(ids)})`).all(...ids),
    fan_message: (ids) => db.prepare(`SELECT m.id,m.artist,m.text,m.removed,m.created_at,
        u.id author_id,u.name author_name,u.handle author_handle,u.initials author_initials,
        u.avatar_uri author_avatar_uri,u.avatar_color author_avatar_color,u.role author_role,
        u.is_banned author_is_banned,u.suspended_until author_suspended_until
      FROM fan_club_messages m LEFT JOIN users u ON u.id=m.user_id WHERE m.id IN (${placeholders(ids)})`).all(...ids),
    lounge_message: (ids) => db.prepare(`SELECT m.id,m.lounge_id,m.text,m.removed,m.created_at,
        u.id author_id,u.name author_name,u.handle author_handle,u.initials author_initials,
        u.avatar_uri author_avatar_uri,u.avatar_color author_avatar_color,u.role author_role,
        u.is_banned author_is_banned,u.suspended_until author_suspended_until
      FROM lounge_messages m LEFT JOIN users u ON u.id=m.user_id WHERE m.id IN (${placeholders(ids)})`).all(...ids),
    venue_review: (ids) => db.prepare(`SELECT v.id,v.venue_key,v.rating,v.text,v.photos,v.removed,v.created_at,
        u.id author_id,u.name author_name,u.handle author_handle,u.initials author_initials,
        u.avatar_uri author_avatar_uri,u.avatar_color author_avatar_color,u.role author_role,
        u.is_banned author_is_banned,u.suspended_until author_suspended_until
      FROM venue_reviews v LEFT JOIN users u ON u.id=v.user_id WHERE v.id IN (${placeholders(ids)})`).all(...ids),
    user: (ids) => db.prepare(`SELECT id,name,handle,initials,avatar_uri,avatar_color,role,is_banned,suspended_until
      FROM users WHERE id IN (${placeholders(ids)})`).all(...ids),
    // A DM report may confirm that the target still exists and identify its
    // author to staff. Its recipient and body stay out of every queue payload.
    message: (ids) => db.prepare(`SELECT d.id,d.created_at,
        u.id author_id,u.name author_name,u.handle author_handle,u.initials author_initials,
        u.avatar_uri author_avatar_uri,u.avatar_color author_avatar_color,u.role author_role,
        u.is_banned author_is_banned,u.suspended_until author_suspended_until
      FROM dms d LEFT JOIN users u ON u.id=d.from_id WHERE d.id IN (${placeholders(ids)})`).all(...ids),
  };

  for (const [type, query] of Object.entries(queries)) {
    const ids = uniqueTargetIds(reports, type);
    if (!ids.length) continue;
    for (const row of query(ids)) {
      let context;
      if (type === "post") context = {
        type, exists: true, removed: !!row.removed, postKind: row.kind || "review",
        author: publicPerson(row), artist: boundedText(row.artist, LIMITS.artist), venue: boundedText(row.venue, LIMITS.venue),
        excerpt: boundedText(row.review), mediaCount: parseArrayLength(row.photos, 8), createdAt: row.created_at,
      };
      else if (type === "comment") context = {
        type, exists: true, removed: !!row.removed, author: publicPerson(row), postId: row.post_id,
        excerpt: boundedText(row.text), createdAt: row.created_at,
      };
      else if (type === "fan_message") context = {
        type, exists: true, removed: !!row.removed, author: publicPerson(row), artist: boundedText(row.artist, LIMITS.artist),
        excerpt: boundedText(row.text), createdAt: row.created_at,
      };
      else if (type === "lounge_message") context = {
        type, exists: true, removed: !!row.removed, author: publicPerson(row), loungeId: boundedText(row.lounge_id, 240),
        excerpt: boundedText(row.text), createdAt: row.created_at,
      };
      else if (type === "venue_review") context = {
        type, exists: true, removed: !!row.removed, author: publicPerson(row), venueKey: boundedText(row.venue_key, 200),
        rating: Number(row.rating) || 0, excerpt: boundedText(row.text), mediaCount: parseArrayLength(row.photos, 8), createdAt: row.created_at,
      };
      else if (type === "user") context = {
        type, exists: true,
        user: {
          id: row.id, name: row.name || "", handle: row.handle || "", initials: row.initials || null,
          avatarUri: row.avatar_uri || null, avatarColor: row.avatar_color || null, role: row.role || "fan",
          isBanned: !!row.is_banned, suspendedUntil: row.suspended_until || null,
        },
        restricted: !!row.is_banned || Number(row.suspended_until || 0) > Date.now(),
      };
      else context = {
        type, exists: true, private: true, author: publicPerson(row), createdAt: row.created_at,
      };
      contexts.set(contentMapKey(type, row.id), context);
    }
  }

  for (const report of reports) {
    if (report.target_type === "track") contexts.set(contentMapKey("track", report.target_id), trackDetails(report));
  }
  return contexts;
}

function normalizedReport(report, context) {
  const track = report.target_type === "track" ? trackDetails(report) : null;
  return {
    id: report.id,
    targetType: report.target_type,
    targetId: report.target_id,
    reason: track ? (track.note || track.category) : boundedText(report.reason, LIMITS.note),
    reporterId: report.reporter_id || null,
    reporter: publicPerson(report, "reporter"),
    status: report.status,
    createdAt: report.created_at,
    content: context || { type: report.target_type, exists: false },
  };
}

export function openModerationReports() {
  return db.prepare("SELECT * FROM reports WHERE status='open' ORDER BY created_at DESC,id DESC LIMIT ?").all(LEGACY_QUEUE_LIMIT);
}

export function moderationOverview({ at = Date.now(), cursor = null, limit = 50, encodeCursor = null } = {}) {
  const pageLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const cursorSql = cursor ? "AND (r.created_at < ? OR (r.created_at = ? AND r.id < ?))" : "";
  const params = cursor
    ? [cursor.createdAt, cursor.createdAt, cursor.id, pageLimit + 1]
    : [pageLimit + 1];
  const reports = db.prepare(`SELECT r.*,
      u.id reporter_id_joined,u.name reporter_name,u.handle reporter_handle,u.initials reporter_initials,
      u.avatar_uri reporter_avatar_uri,u.avatar_color reporter_avatar_color,u.role reporter_role,
      u.is_banned reporter_is_banned,u.suspended_until reporter_suspended_until
    FROM reports r LEFT JOIN users u ON u.id=r.reporter_id
    WHERE r.status='open' ${cursorSql} ORDER BY r.created_at DESC,r.id DESC LIMIT ?`).all(...params)
    .map((row) => ({ ...row, reporter_id: row.reporter_id, reporter_id_joined: undefined }));
  const hasMore = reports.length > pageLimit;
  if (hasMore) reports.length = pageLimit;
  // publicPerson expects reporter_id. Preserve the report's SET NULL identity,
  // while a deleted reporter naturally projects as null because name is absent.
  for (const report of reports) {
    if (!report.reporter_name) report.reporter_id = null;
  }
  const contexts = contextsFor(reports);
  const statuses = Object.fromEntries(db.prepare("SELECT status,COUNT(*) count FROM reports GROUP BY status").all()
    .map((row) => [row.status, row.count]));
  const byType = Object.fromEntries(db.prepare("SELECT target_type,COUNT(*) count FROM reports WHERE status='open' GROUP BY target_type ORDER BY target_type").all()
    .map((row) => [row.target_type, row.count]));
  const totalRecent = db.prepare("SELECT COUNT(*) count FROM reports WHERE created_at>=?").get(at - RECENT_REPORT_MS).count;
  const recentActions = db.prepare(`SELECT a.id,a.action,a.target_type,a.target_id,a.reason,a.created_at,
      u.id actor_id,u.name actor_name,u.handle actor_handle,u.initials actor_initials,
      u.avatar_uri actor_avatar_uri,u.avatar_color actor_avatar_color,u.role actor_role,
      u.is_banned actor_is_banned,u.suspended_until actor_suspended_until
    FROM moderation_actions a LEFT JOIN users u ON u.id=a.actor_id
    ORDER BY a.created_at DESC,a.id DESC LIMIT ?`).all(RECENT_ACTION_LIMIT).map((row) => ({
      id: row.id,
      actor: publicPerson(row, "actor"),
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      reason: boundedText(row.reason, LIMITS.note),
      createdAt: row.created_at,
    }));
  return {
    summary: {
      open: statuses.open || 0,
      actioned: statuses.actioned || 0,
      dismissed: statuses.dismissed || 0,
      totalRecent,
      recentWindowDays: RECENT_REPORT_DAYS,
      byType,
      queueTruncated: (statuses.open || 0) > reports.length,
    },
    reports: reports.map((report) => normalizedReport(report, contexts.get(contentMapKey(report.target_type, report.target_id)))),
    recentActions,
    nextCursor: hasMore && reports.length && typeof encodeCursor === "function" ? encodeCursor(reports.at(-1)) : null,
  };
}

export function recordModerationAction(ctx, action, targetType, targetId, reason = "", prior = {}, next = {}) {
  insertAudit.run(
    `ma_${randomUUID().slice(0, 12)}`,
    ctx.user?.id || null,
    action,
    targetType,
    targetId,
    clean(reason, { max: LIMITS.note }) || "",
    JSON.stringify(prior),
    JSON.stringify(next),
    ctx.requestId || null,
    Date.now(),
  );
}

function transaction(work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

function contentRemovedState(targetType, targetId) {
  const table = MODERATABLE_CONTENT[targetType];
  if (!table) throw new ApiError(400, "That content type cannot be moderated here.", "VALIDATION_FAILED");
  const row = db.prepare(`SELECT removed FROM ${table} WHERE id=?`).get(targetId);
  return row ? !!row.removed : null;
}

function setContentRemoved(ctx, targetType, targetId, removed, reason) {
  const table = MODERATABLE_CONTENT[targetType];
  if (!table) throw new ApiError(400, "That content type cannot be moderated here.", "VALIDATION_FAILED");
  const current = db.prepare(`SELECT removed FROM ${table} WHERE id=?`).get(targetId);
  if (!current) throw new ApiError(404, "That content is no longer available.", "NOT_FOUND");
  const desired = removed ? 1 : 0;
  if (Number(current.removed) === desired) return { changed: false, removed: !!desired };
  const updated = db.prepare(`UPDATE ${table} SET removed=? WHERE id=? AND removed=?`).run(desired, targetId, current.removed);
  if (updated.changes !== 1) throw new ApiError(409, "That content changed while you were reviewing it. Refresh the moderation queue.", "CONFLICT");
  recordModerationAction(ctx, removed ? "remove" : "restore", targetType, targetId, reason,
    { removed: !!current.removed }, { removed: !!desired });
  return { changed: true, removed: !!desired };
}

function staleReport() {
  throw new ApiError(409, "That report was already handled differently. Refresh the moderation queue.", "CONFLICT");
}

function moderateReport(ctx, reportId, action, reason) {
  return transaction(() => {
    const report = reportById.get(reportId);
    if (!report) throw new ApiError(404, "No such report.", "NOT_FOUND");

    if (report.status !== "open") {
      if (action === "dismiss" && report.status === "dismissed") {
        return { ok: true, action, reportId, status: report.status, duplicate: true };
      }
      if (action === "remove" && report.status === "actioned" && MODERATABLE_CONTENT[report.target_type]) {
        const removed = contentRemovedState(report.target_type, report.target_id);
        if (removed === true) return {
          ok: true, action, reportId, status: report.status, targetType: report.target_type,
          targetId: report.target_id, removed: true, duplicate: true,
        };
      }
      return staleReport();
    }

    if (action === "dismiss") {
      const updated = updateOpenReport.run("dismissed", report.id);
      if (updated.changes !== 1) return staleReport();
      recordModerationAction(ctx, "dismiss_report", "report", report.id, reason || report.reason,
        { status: "open" }, { status: "dismissed" });
      return { ok: true, action, reportId, status: "dismissed", duplicate: false };
    }

    if (action !== "remove") throw new ApiError(400, "A report can only be removed or dismissed.", "VALIDATION_FAILED");
    if (!MODERATABLE_CONTENT[report.target_type]) {
      throw new ApiError(422, "This report needs manual review before it can be closed.", "VALIDATION_FAILED");
    }
    const content = setContentRemoved(ctx, report.target_type, report.target_id, true, reason || report.reason);
    const updated = updateOpenReport.run("actioned", report.id);
    if (updated.changes !== 1) return staleReport();
    // If another report already removed the target, the report disposition still
    // needs its own audit row; otherwise the content audit is the durable record.
    if (!content.changed) recordModerationAction(ctx, "action_report", "report", report.id, reason || report.reason,
      { status: "open" }, { status: "actioned", targetAlreadyRemoved: true });
    return {
      ok: true, action, reportId, status: "actioned", targetType: report.target_type,
      targetId: report.target_id, removed: true, changed: content.changed, duplicate: false,
    };
  });
}

function moderateContent(ctx, targetType, targetId, action, reason) {
  if (action !== "remove" && action !== "restore") {
    throw new ApiError(400, "Content actions must be remove or restore.", "VALIDATION_FAILED");
  }
  return transaction(() => {
    const result = setContentRemoved(ctx, targetType, targetId, action === "remove", reason);
    return {
      ok: true,
      action,
      targetType,
      targetId,
      removed: result.removed,
      changed: result.changed,
      duplicate: !result.changed,
    };
  });
}

export function applyModerationAction(ctx, { action, reportId = "", targetType = "", targetId = "", reason = "" } = {}) {
  if (reportId) return moderateReport(ctx, reportId, action, reason);
  if (!targetType || !targetId) throw new ApiError(400, "Choose a report or content target.", "VALIDATION_FAILED");
  return moderateContent(ctx, targetType, targetId, action, reason);
}
