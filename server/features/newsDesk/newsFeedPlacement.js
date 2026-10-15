import { activeAccountSql } from "../../accountVisibility.js";
import { newsStoryVisibleIn, viewerNewsRegion } from "./newsRegions.js";

const RECENT_MS = 3 * 24 * 60 * 60_000;
const key = (value) => { const raw = String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim(); return raw.replace(/[^\p{L}\p{N}]+/gu, " ").trim() || raw; };
const json = (value) => { try { const result = JSON.parse(value || "[]"); return Array.isArray(result) ? result : []; } catch { return []; } };
export const isNewsPostId = (id) => String(id || "").startsWith("news_");

export function ensureNewsFeedSchema(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS news_feed_introductions (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,post_id), UNIQUE(user_id,request_id)
  );
  CREATE INDEX IF NOT EXISTS idx_news_feed_introductions_age ON news_feed_introductions(created_at);`);
}

// Explicit artist follows only: listening, likes and following the news bot
// are not consent to mix unrelated headlines into For You.
export function eligibleNewsPosts(database, viewer, at = Date.now()) {
  if (!viewer?.id) return [];
  const followed = new Set(json(viewer.favorite_artists).map(key).filter(Boolean));
  for (const row of database.prepare("SELECT artist FROM fan_club_members WHERE user_id=? LIMIT 200").all(viewer.id)) followed.add(key(row.artist));
  if (!followed.size || !database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='news_stories'").get()) return [];
  const rows = database.prepare(`SELECT s.post_id,s.created_at,s.artist_keys,s.headline,s.summary,s.body,s.category FROM news_stories s
    JOIN posts p ON p.id=s.post_id JOIN users u ON u.id=p.user_id
    WHERE s.status='published' AND p.removed=0 AND ${activeAccountSql("u")}
      AND s.created_at>=? AND s.created_at<=?
      AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
      AND NOT EXISTS(SELECT 1 FROM account_mutes m WHERE m.muter_id=? AND m.muted_id=p.user_id)
      AND NOT EXISTS(SELECT 1 FROM recommendation_preferences r WHERE r.user_id=? AND r.post_id=p.id)
    ORDER BY s.created_at DESC,s.id DESC LIMIT 200`).all(at - RECENT_MS, at, viewer.id, viewer.id, viewer.id, viewer.id);
  const artist = database.prepare("SELECT name FROM artists WHERE norm=?");
  // Pushed into the feed, so it follows the reader's region like News does.
  const { region } = viewerNewsRegion(database, viewer);
  return rows.filter((row) => newsStoryVisibleIn(row, region) && json(row.artist_keys).some((id) => followed.has(key(artist.get(id)?.name))));
}

// A user command, never an impression or a side effect of prefetching. The
// receipt survives restarts; retrying the same command cannot take a new story.
export function introduceNewsPost(database, { viewer, requestId, at = Date.now(), project }) {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("DELETE FROM news_feed_introductions WHERE created_at<?").run(at - 7 * 24 * 60 * 60_000);
    const eligible = eligibleNewsPosts(database, viewer, at);
    const prior = database.prepare("SELECT post_id FROM news_feed_introductions WHERE user_id=? AND request_id=?").get(viewer.id, requestId);
    const seen = database.prepare("SELECT 1 FROM news_feed_introductions WHERE user_id=? AND post_id=?");
    const viewed = database.prepare("SELECT 1 FROM post_impressions WHERE user_id=? AND post_id=? AND seen_count>0");
    const choice = prior ? eligible.find((row) => row.post_id === prior.post_id)
      : eligible.find((row) => !seen.get(viewer.id, row.post_id) && !viewed.get(viewer.id, row.post_id));
    const post = choice ? project(choice.post_id, viewer.id) : null;
    if (post && !prior) database.prepare("INSERT INTO news_feed_introductions(user_id,post_id,request_id,created_at) VALUES(?,?,?,?)").run(viewer.id, choice.post_id, requestId, at);
    database.exec("COMMIT");
    return post || null;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function newsFeedRoutes({ database, requireUser, rateLimit, ApiError, project, now = Date.now }) {
  ensureNewsFeedSchema(database);
  return {
    "POST /api/feed/news-introduction": (ctx) => {
      const user = requireUser(ctx);
      ctx.setHeader?.("Cache-Control", "private, no-store");
      rateLimit(ctx, "news-introduction", 30, 10 * 60_000);
      const requestId = ctx.body?.requestId;
      if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/u.test(requestId)) throw new ApiError(400, "Reopen your feed to try again.", "VALIDATION_FAILED");
      return { post: introduceNewsPost(database, { viewer: user, requestId, project, at: now() }) };
    },
  };
}
