import { db } from "./db.js";
import { ACHIEVEMENTS } from "../src/lib/badges.js";

const emptyStats = () => ({ shows: 0, reviews: 0, likes: 0, photos: 0, cities: 0, artists: 0, follows: 0, fanClubs: 0 });

export function rewardStats(userId) {
  if (!userId) return emptyStats();
  const posts = db.prepare(`
    SELECT
      COUNT(*) shows,
      SUM(CASE WHEN length(trim(review)) > 0 THEN 1 ELSE 0 END) reviews,
      COALESCE(SUM(json_array_length(photos)), 0) photos,
      COUNT(DISTINCT CASE WHEN trim(city) <> '' THEN lower(trim(city)) END) cities,
      COUNT(DISTINCT lower(trim(artist))) artists
    FROM posts WHERE user_id=? AND removed=0`).get(userId);
  const likes = db.prepare(`SELECT COUNT(*) likes FROM likes l JOIN posts p ON p.id=l.post_id WHERE p.user_id=? AND p.removed=0`).get(userId).likes;
  const follows = db.prepare("SELECT COUNT(*) follows FROM follows WHERE follower_id=?").get(userId).follows;
  const fanClubs = db.prepare("SELECT COUNT(*) fanClubs FROM fan_club_members WHERE user_id=?").get(userId).fanClubs;
  return {
    shows: Number(posts.shows) || 0,
    reviews: Number(posts.reviews) || 0,
    likes: Number(likes) || 0,
    photos: Number(posts.photos) || 0,
    cities: Number(posts.cities) || 0,
    artists: Number(posts.artists) || 0,
    follows: Number(follows) || 0,
    fanClubs: Number(fanClubs) || 0,
  };
}

// Awards are append-only: later moderation/deletion can lower live progress but
// does not take away a badge someone legitimately earned. The UNIQUE primary key
// makes repeated reads and concurrent requests idempotent.
export function userRewards(userId) {
  const stats = rewardStats(userId);
  const now = Date.now();
  const insert = db.prepare(`INSERT OR IGNORE INTO user_achievements
    (user_id,badge_id,definition_version,points,earned_at,progress_snapshot)
    VALUES (?,?,?,?,?,?)`);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const achievement of ACHIEVEMENTS) {
      if (achievement.test(stats)) insert.run(userId, achievement.id, 1, achievement.points, now, JSON.stringify(stats));
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }

  const achievements = db.prepare("SELECT badge_id,points,earned_at FROM user_achievements WHERE user_id=? ORDER BY earned_at,badge_id").all(userId)
    .map((row) => ({ id: row.badge_id, points: row.points, earnedAt: row.earned_at }));
  return {
    stats,
    achievements,
    earnedIds: achievements.map((achievement) => achievement.id),
    points: achievements.reduce((sum, achievement) => sum + achievement.points, 0),
    total: ACHIEVEMENTS.length,
  };
}
