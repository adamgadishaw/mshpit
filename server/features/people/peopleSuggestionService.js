import { activeAccountSql } from "../../accountVisibility.js";
import { rankPeopleSuggestions } from "../../../src/domain/peopleSuggestions.mjs";
import { inPersonReviewSql } from "../../onlineReviews.js";

const candidateLimit = (limit) => Math.max(50, Math.min(200, Number(limit) * 40 || 200));
const finite = (value) => (value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));

function safeArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function createPeopleSuggestionService(database, { projectUser } = {}) {
  if (!database?.prepare) throw new TypeError("A database is required.");
  if (typeof projectUser !== "function") throw new TypeError("A public user projector is required.");

  // Preselect only the bounded public/ranking columns. In particular, never
  // bring email, password hashes, tokens, or raw profile extras into this path.
  const baseSql = `
    SELECT candidate.id,candidate.name,candidate.handle,candidate.initials,
      candidate.avatar_uri,candidate.avatar_color,candidate.verified,candidate.role,
      candidate.home_city,candidate.home_lat,candidate.home_lng,candidate.genres,
      candidate.favorite_artists,candidate.profile_updated_at
    FROM users candidate
    WHERE candidate.id<>? AND ${activeAccountSql("candidate")} AND candidate.profile_audience<>'only_me'
      AND NOT EXISTS (SELECT 1 FROM follows followed
        WHERE followed.follower_id=? AND followed.followee_id=candidate.id)
      AND NOT EXISTS (SELECT 1 FROM blocks mine
        WHERE mine.blocker_id=? AND mine.blocked_id=candidate.id)
      AND NOT EXISTS (SELECT 1 FROM blocks theirs
        WHERE theirs.blocker_id=candidate.id AND theirs.blocked_id=?)
      AND NOT EXISTS (SELECT 1 FROM account_mutes muted
        WHERE muted.muter_id=? AND muted.muted_id=candidate.id)`;

  function candidatesFor(viewer, limit) {
    const lat = finite(viewer?.home_lat);
    const lng = finite(viewer?.home_lng);
    const city = String(viewer?.home_city || "").trim();
    const args = [viewer.id, viewer.id, viewer.id, viewer.id, viewer.id];
    let ordering;
    if (lat != null && lng != null) {
      ordering = `ORDER BY
        CASE WHEN candidate.home_lat IS NOT NULL AND candidate.home_lng IS NOT NULL THEN 0
          WHEN ?<>'' AND lower(trim(candidate.home_city))=lower(?) THEN 1 ELSE 2 END,
        CASE WHEN candidate.home_lat IS NOT NULL AND candidate.home_lng IS NOT NULL
          THEN ((candidate.home_lat-?)*(candidate.home_lat-?))+((candidate.home_lng-?)*(candidate.home_lng-?))
          ELSE 999999 END,
        candidate.profile_updated_at DESC,candidate.name COLLATE NOCASE,candidate.id`;
      args.push(city, city, lat, lat, lng, lng);
    } else if (city) {
      ordering = `ORDER BY (lower(trim(candidate.home_city))=lower(?)) DESC,
        candidate.profile_updated_at DESC,candidate.name COLLATE NOCASE,candidate.id`;
      args.push(city);
    } else {
      ordering = "ORDER BY candidate.profile_updated_at DESC,candidate.name COLLATE NOCASE,candidate.id";
    }
    args.push(candidateLimit(limit));
    return database.prepare(`${baseSql} ${ordering} LIMIT ?`).all(...args);
  }

  function showCountsFor(rows) {
    if (!rows.length) return new Map();
    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => "?").join(",");
    // Posts are not yet directly linked to canonical shows. Count distinct
    // artist/venue/date identities so duplicate memories from one night do not
    // inflate either ranking or the user-facing "shows logged" copy.
    const counts = database.prepare(`SELECT history.user_id,
      COUNT(DISTINCT lower(trim(history.artist)) || char(31) || lower(trim(history.venue)) || char(31) || trim(history.date)) AS show_count
      FROM posts history
      WHERE history.removed=0 AND ${inPersonReviewSql("history")} AND history.user_id IN (${placeholders})
      GROUP BY history.user_id`).all(...ids);
    return new Map(counts.map((row) => [row.user_id, Number(row.show_count) || 0]));
  }

  return Object.freeze({
    list(viewer, { limit = 5 } = {}) {
      const requested = Math.max(0, Math.min(5, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 5));
      if (!viewer?.id || !requested) return [];
      const viewerCandidate = {
        id: viewer.id,
        home: { city: viewer.home_city || "", lat: finite(viewer.home_lat), lng: finite(viewer.home_lng) },
        genres: safeArray(viewer.genres),
        favoriteArtists: safeArray(viewer.favorite_artists),
      };
      const candidateRows = candidatesFor(viewer, requested);
      const showCounts = showCountsFor(candidateRows);
      const candidates = candidateRows.map((row) => ({
        id: row.id,
        name: row.name,
        home: { city: row.home_city || "", lat: finite(row.home_lat), lng: finite(row.home_lng) },
        genres: safeArray(row.genres),
        favoriteArtists: safeArray(row.favorite_artists),
        showCount: showCounts.get(row.id) || 0,
        row,
      }));
      return rankPeopleSuggestions({ viewer: viewerCandidate, candidates, limit: requested }).map((suggestion) => {
        const publicUser = projectUser(suggestion.row);
        return {
          user: {
            id: publicUser.id,
            name: publicUser.name,
            handle: publicUser.handle,
            initials: publicUser.initials,
            avatarUri: publicUser.avatarUri || null,
            avatarColor: publicUser.avatarColor || null,
            verified: !!publicUser.verified,
            role: publicUser.role || "fan",
            home: publicUser.home?.city ? { city: publicUser.home.city } : null,
            profileUpdatedAt: Number(publicUser.profileUpdatedAt) || 0,
          },
          reason: suggestion.reason,
          showCount: suggestion.showCount,
          sharedArtists: suggestion.sharedArtists.length,
          sharedGenres: suggestion.sharedGenres.length,
        };
      });
    },
  });
}
