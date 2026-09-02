import { activeAccountSql } from "../../accountVisibility.js";
import { ARTIST_GENRE_SQL_COLUMNS, projectArtistGenreColumns } from "../../artistGenreProjection.js";
import { tourDateHasNoPublishedMemorialSql } from "../../artistMemorialTourDateVisibility.js";
import { inPersonReviewSql } from "../../onlineReviews.js";
import { currentOrUpcomingTourDateSql } from "../../tourDateLifecycle.js";

const MAX_RESULTS = 8;
const CANDIDATE_LIMIT = 360;
const MAX_SIGNAL_ROWS = 200;

const cleanText = (value, max = 160) => {
  const text = typeof value === "string" || typeof value === "number"
    ? String(value).replace(/\s+/g, " ").trim()
    : "";
  return text ? text.slice(0, max) : null;
};

const artistKey = (value) => cleanText(value, 200)?.toLocaleLowerCase("en-US") || null;

function safeStringArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed)
      ? parsed.map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 100)
      : [];
  } catch {
    return [];
  }
}

function boundedLimit(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.max(0, Math.min(MAX_RESULTS, parsed)) : 6;
}

function safeHttpsUrl(value) {
  const raw = cleanText(value, 1_000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function placeholders(values) {
  return values.map(() => "?").join(",");
}

const postArtistKeySql = (alias = "p") => `COALESCE(NULLIF(${alias}.artist_key,''),lower(trim(${alias}.artist)))`;
const postArtistMatchSql = (alias, keys) => `(${alias}.artist_key IN (${placeholders(keys)}) OR
  (( ${alias}.artist_key IS NULL OR ${alias}.artist_key='' ) AND lower(trim(${alias}.artist)) IN (${placeholders(keys)})))`;

function addSignal(target, rawArtist, signal) {
  const key = artistKey(rawArtist);
  if (!key || !signal?.reason || !Number.isFinite(signal.weight)) return;
  const previous = target.get(key);
  if (!previous || signal.weight > previous.weight) target.set(key, { ...signal, key });
}

function ratingQuality(row) {
  const count = Number(row?.review_count) || 0;
  const average = Number(row?.average_rating) || 0;
  if (!count || !average) return 0;
  return Math.max(0, average - 3.25) * Math.min(4, Math.log2(count + 1));
}

function compactPublicUser(row) {
  if (!row?.id) return null;
  return {
    id: row.id,
    name: cleanText(row.name, 100),
    handle: cleanText(row.handle, 40),
    initials: cleanText(row.initials, 8),
    avatarUri: safeHttpsUrl(row.safe_avatar_uri),
    avatarColor: cleanText(row.avatar_color, 40),
    verified: !!row.verified,
    profileUpdatedAt: Number(row.profile_updated_at) || 0,
  };
}

const safeProfileImageSql = (user = "followed") => `CASE WHEN ${user}.avatar_uri IS NOT NULL AND EXISTS (
  SELECT 1 FROM media_assets profile_asset
  JOIN media_objects profile_source
    ON profile_source.owner_id=profile_asset.owner_id AND profile_source.object_key=profile_asset.source_key
  JOIN media_variants profile_variant
    ON profile_variant.id=profile_asset.render_variant_id AND profile_variant.asset_id=profile_asset.id
      AND profile_variant.role='render' AND profile_variant.status='verified'
      AND profile_variant.verification_origin='private_derivative_v1'
  JOIN media_objects profile_render
    ON profile_render.owner_id=profile_asset.owner_id AND profile_render.object_key=profile_variant.object_key
      AND profile_render.storage_scope='public' AND profile_render.status IN ('issued','associated')
  WHERE profile_asset.owner_id=${user}.id AND profile_asset.kind='image' AND profile_asset.status='ready'
    AND profile_asset.source_verified_at IS NOT NULL AND profile_asset.metadata_status='declared'
    AND profile_asset.codec_status='not_applicable' AND profile_asset.render_state='ready'
    AND profile_source.status IN ('issued','associated') AND profile_variant.public_url=${user}.avatar_uri
) THEN ${user}.avatar_uri END`;

export function createArtistRecommendationService(database) {
  if (!database?.prepare) throw new TypeError("Artist recommendations require a database");

  const candidateArtists = database.prepare(`SELECT a.norm,a.name,a.public_slug,a.photo,a.country,
      a.popularity,a.rank_score,${ARTIST_GENRE_SQL_COLUMNS}
    FROM artists a
    WHERE NOT EXISTS (SELECT 1 FROM artist_memorials memorial
      WHERE memorial.artist_key=a.norm AND memorial.status='published')
    ORDER BY a.rank_score DESC,a.popularity DESC,a.name COLLATE NOCASE,a.norm
    LIMIT ?`);
  const fanClubSignals = database.prepare(`SELECT artist FROM fan_club_members
    WHERE user_id=? ORDER BY artist COLLATE NOCASE LIMIT ?`);
  const reviewSignals = database.prepare(`SELECT COALESCE(NULLIF(artist_key,''),lower(trim(artist))) artist_key,
      artist,overall FROM posts
    WHERE user_id=? AND removed=0 AND ${inPersonReviewSql("posts")} AND length(trim(artist))>0
    ORDER BY created_at DESC,id DESC LIMIT ?`);
  const attendanceSignals = database.prepare(`SELECT COALESCE(NULLIF(a.legacy_artist_key,''),NULLIF(s.artist_key,''),
      lower(trim(COALESCE(NULLIF(a.legacy_artist,''),s.artist)))) artist_key,
      COALESCE(NULLIF(a.legacy_artist,''),s.artist) artist,a.state
    FROM show_attendance a INDEXED BY idx_show_attendance_user_updated
    JOIN shows s ON s.id=a.show_id
    WHERE a.user_id=? AND length(trim(COALESCE(NULLIF(a.legacy_artist,''),s.artist)))>0
    ORDER BY a.updated_at DESC LIMIT ?`);
  const likedSignals = database.prepare(`SELECT COALESCE(NULLIF(p.artist_key,''),lower(trim(p.artist))) artist_key,p.artist
    FROM likes l INDEXED BY idx_likes_user_post JOIN posts p ON p.id=l.post_id
    WHERE l.user_id=? AND p.removed=0 AND length(trim(p.artist))>0
    ORDER BY p.created_at DESC LIMIT ?`);
  const commentSignals = database.prepare(`SELECT COALESCE(NULLIF(p.artist_key,''),lower(trim(p.artist))) artist_key,p.artist
    FROM comments c INDEXED BY idx_comments_user_recent JOIN posts p ON p.id=c.post_id
    WHERE c.user_id=? AND c.removed=0 AND p.removed=0 AND length(trim(p.artist))>0
    ORDER BY c.created_at DESC LIMIT ?`);
  const followedArtistSignals = database.prepare(`SELECT ${postArtistKeySql("p")} artist_key,MAX(p.artist) artist,
      MAX(p.created_at) recent_at
    FROM follows mine JOIN users followed ON followed.id=mine.followee_id
    JOIN posts p ON p.user_id=followed.id
    WHERE mine.follower_id=? AND p.removed=0 AND ${inPersonReviewSql("p")}
      AND length(trim(p.artist))>0 AND ${activeAccountSql("followed")}
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=followed.id) OR (b.blocker_id=followed.id AND b.blocked_id=?))
    GROUP BY ${postArtistKeySql("p")} ORDER BY recent_at DESC LIMIT ?`);

  function collectSignals(viewer) {
    const signals = new Map();
    const exclude = new Set();
    const genres = new Set(safeStringArray(viewer.genres).map((genre) => genre.toLocaleLowerCase("en-US")));

    for (const name of safeStringArray(viewer.favorite_artists)) {
      const key = artistKey(name);
      if (key) exclude.add(key);
      addSignal(signals, key, {
        weight: 9,
        type: "favorite",
        artist: name,
        reason: `Because ${name} is one of your favourite artists`,
      });
    }
    for (const row of fanClubSignals.all(viewer.id, MAX_SIGNAL_ROWS)) {
      const key = artistKey(row.artist);
      if (key) exclude.add(key);
      addSignal(signals, key, { weight: 8, type: "fan_club", artist: row.artist, reason: `Because you joined ${row.artist}'s fan club` });
    }
    for (const row of reviewSignals.all(viewer.id, MAX_SIGNAL_ROWS)) {
      const key = artistKey(row.artist_key || row.artist);
      if (key) exclude.add(key);
      const score = Number(row.overall) || 0;
      if (score < 3.75) continue;
      addSignal(signals, key, {
        weight: score >= 4.5 ? 10 : 8,
        type: "rated",
        artist: row.artist,
        reason: `Because you rated ${row.artist} ${score.toFixed(1)}★`,
      });
    }
    for (const row of attendanceSignals.all(viewer.id, MAX_SIGNAL_ROWS)) {
      const key = artistKey(row.artist_key || row.artist);
      if (key) exclude.add(key);
      const completed = row.state === "went" || row.state === "here";
      addSignal(signals, key, {
        weight: completed ? 8 : row.state === "going" ? 5 : 2,
        type: completed ? "attended" : row.state,
        artist: row.artist,
        reason: completed
          ? `Because you saw ${row.artist} live`
          : row.state === "going"
            ? `Because you're going to see ${row.artist}`
            : `Because you're interested in ${row.artist}`,
      });
    }
    for (const row of likedSignals.all(viewer.id, MAX_SIGNAL_ROWS)) {
      addSignal(signals, row.artist_key || row.artist, {
        weight: 6,
        type: "liked_post",
        artist: row.artist,
        reason: `Because you liked a live post about ${row.artist}`,
      });
    }
    for (const row of commentSignals.all(viewer.id, MAX_SIGNAL_ROWS)) {
      addSignal(signals, row.artist_key || row.artist, {
        weight: 4,
        type: "conversation",
        artist: row.artist,
        reason: `Because you joined a ${row.artist} conversation`,
      });
    }
    for (const row of followedArtistSignals.all(viewer.id, viewer.id, viewer.id, MAX_SIGNAL_ROWS)) {
      addSignal(signals, row.artist_key || row.artist, {
        weight: 5,
        type: "following",
        artist: row.artist,
        reason: "Popular with people you follow",
      });
    }
    return { signals, exclude, genres };
  }

  function aggregateRatings(viewer, keys) {
    if (!keys.length) return new Map();
    const rows = database.prepare(`SELECT ${postArtistKeySql("p")} artist_key,AVG(p.overall) average_rating,COUNT(*) review_count
      FROM posts p JOIN users author ON author.id=p.user_id
      WHERE ${postArtistMatchSql("p", keys)} AND p.removed=0 AND ${inPersonReviewSql("p")}
        AND ${activeAccountSql("author")}
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
      GROUP BY ${postArtistKeySql("p")}`).all(...keys, ...keys, viewer.id, viewer.id);
    return new Map(rows.map((row) => [row.artist_key, row]));
  }

  function followingSignals(viewer, keys) {
    if (!keys.length) return new Map();
    const rows = database.prepare(`SELECT ${postArtistKeySql("p")} artist_key,COUNT(DISTINCT p.user_id) seen_count
      FROM follows mine JOIN users followed ON followed.id=mine.followee_id
      JOIN posts p ON p.user_id=followed.id
      WHERE mine.follower_id=? AND ${postArtistMatchSql("p", keys)}
        AND p.removed=0 AND ${inPersonReviewSql("p")} AND ${activeAccountSql("followed")}
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=? AND b.blocked_id=followed.id) OR (b.blocker_id=followed.id AND b.blocked_id=?))
      GROUP BY ${postArtistKeySql("p")}`).all(viewer.id, ...keys, ...keys, viewer.id, viewer.id);
    return new Map(rows.map((row) => [row.artist_key, Number(row.seen_count) || 0]));
  }

  function nextDates(viewer, keys, at, today) {
    if (!keys.length) return new Map();
    const rows = database.prepare(`SELECT * FROM (
      SELECT td.artist_key,td.id,td.date,td.start_date_time,td.start_local_time,
        td.event_name,td.tour_name,td.venue,td.venue_city,td.place,td.venue_country,
        ROW_NUMBER() OVER (PARTITION BY td.artist_key ORDER BY td.date,COALESCE(td.start_local_time,''),td.id) position
      FROM tour_dates td LEFT JOIN users owner ON owner.id=td.owner_id
      WHERE td.artist_key IN (${placeholders(keys)}) AND td.release_at<=?
        AND COALESCE(td.music_qualified,1)=1
        AND (td.owner_id IS NULL OR ${activeAccountSql("owner")})
        AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1)
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE td.owner_id IS NOT NULL AND
          ((b.blocker_id=? AND b.blocked_id=td.owner_id) OR (b.blocker_id=td.owner_id AND b.blocked_id=?)))
        AND td.date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        AND date(td.date)=td.date AND ${currentOrUpcomingTourDateSql("td")}
        AND ${tourDateHasNoPublishedMemorialSql("td")}
        AND lower(trim(COALESCE(td.event_status,''))) NOT IN ('cancelled','canceled')
    ) ranked WHERE position=1`).all(...keys, at, viewer.id, viewer.id, today);
    return new Map(rows.map((row) => [row.artist_key, {
      id: row.id,
      date: row.date,
      startDateTime: cleanText(row.start_date_time, 80),
      startLocalTime: cleanText(row.start_local_time, 40),
      eventName: cleanText(row.event_name),
      tourName: cleanText(row.tour_name),
      venue: cleanText(row.venue),
      city: cleanText(row.venue_city || row.place),
      country: cleanText(row.venue_country),
    }]));
  }

  function socialProof(viewer, keys) {
    if (!keys.length) return new Map();
    const rows = database.prepare(`SELECT ${postArtistKeySql("p")} artist_key,followed.id,followed.name,
        followed.handle,followed.initials,followed.avatar_color,followed.verified,followed.profile_updated_at,
        ${safeProfileImageSql("followed")} safe_avatar_uri,
        CASE WHEN mutual.follower_id IS NULL THEN 0 ELSE 1 END is_friend,
        MAX(p.created_at) last_review_at
      FROM follows mine JOIN users followed ON followed.id=mine.followee_id
      JOIN posts p ON p.user_id=followed.id
      LEFT JOIN follows mutual ON mutual.follower_id=followed.id AND mutual.followee_id=mine.follower_id
      WHERE mine.follower_id=? AND ${postArtistMatchSql("p", keys)}
        AND p.removed=0 AND ${inPersonReviewSql("p")} AND ${activeAccountSql("followed")}
        AND NOT EXISTS (SELECT 1 FROM blocks b WHERE
          (b.blocker_id=? AND b.blocked_id=followed.id) OR (b.blocker_id=followed.id AND b.blocked_id=?))
      GROUP BY ${postArtistKeySql("p")},followed.id
      ORDER BY is_friend DESC,last_review_at DESC,followed.id
      LIMIT 200`).all(viewer.id, ...keys, ...keys, viewer.id, viewer.id);
    const grouped = new Map();
    for (const row of rows) {
      const entry = grouped.get(row.artist_key) || { total: 0, friends: 0, people: [] };
      entry.total += 1;
      if (row.is_friend) entry.friends += 1;
      if (entry.people.length < 3) {
        const person = compactPublicUser(row);
        if (person) entry.people.push(person);
      }
      grouped.set(row.artist_key, entry);
    }
    return grouped;
  }

  return Object.freeze({
    list(viewer, { limit = 6, at = Date.now() } = {}) {
      const take = boundedLimit(limit);
      if (!viewer?.id || !take) return { recommendations: [], personalized: false, signalCount: 0 };
      const { signals, exclude, genres } = collectSignals(viewer);
      if (!signals.size && !genres.size) return { recommendations: [], personalized: false, signalCount: 0 };

      const catalog = candidateArtists.all(CANDIDATE_LIMIT).map((row) => ({
        ...row,
        genre: projectArtistGenreColumns(row),
      }));
      const catalogByKey = new Map(catalog.map((row) => [row.norm, row]));

      // Pull any lower-ranked signal artists once so a real past show can still
      // explain a recommendation without loading a catalog blob or querying per card.
      const missingSignalKeys = [...signals.keys()].filter((key) => !catalogByKey.has(key)).slice(0, MAX_SIGNAL_ROWS);
      if (missingSignalKeys.length) {
        const anchors = database.prepare(`SELECT a.norm,a.name,a.public_slug,a.photo,a.country,
            a.popularity,a.rank_score,${ARTIST_GENRE_SQL_COLUMNS}
          FROM artists a WHERE a.norm IN (${placeholders(missingSignalKeys)})
            AND NOT EXISTS (SELECT 1 FROM artist_memorials memorial
              WHERE memorial.artist_key=a.norm AND memorial.status='published')`).all(...missingSignalKeys);
        for (const row of anchors) {
          const projected = { ...row, genre: projectArtistGenreColumns(row) };
          catalogByKey.set(row.norm, projected);
          catalog.push(projected);
        }
      }

      const keys = catalog.map((row) => row.norm);
      const ratings = aggregateRatings(viewer, keys);
      const followed = followingSignals(viewer, keys);
      const timestamp = Number.isFinite(Number(at)) ? Number(at) : Date.now();
      const today = new Date(timestamp).toISOString().slice(0, 10);
      const upcoming = nextDates(viewer, keys, timestamp, today);

      const ranked = [];
      for (const candidate of catalog) {
        if (exclude.has(candidate.norm)) continue;
        let basis = signals.get(candidate.norm) || null;
        let personalScore = basis ? basis.weight * 2.5 : 0;
        if (candidate.genre) {
          const genreKey = candidate.genre.toLocaleLowerCase("en-US");
          if (genres.has(genreKey)) {
            const genreBasis = { type: "saved_genre", artist: null, genre: candidate.genre, weight: 7, reason: `Because you chose ${candidate.genre}` };
            if (!basis || genreBasis.weight > basis.weight) basis = genreBasis;
            personalScore += 8;
          }
          for (const signal of signals.values()) {
            const anchor = catalogByKey.get(signal.key);
            if (!anchor?.genre || anchor.genre.toLocaleLowerCase("en-US") !== genreKey) continue;
            personalScore += signal.weight;
            if (!basis || signal.weight > basis.weight) basis = signal;
            break;
          }
        }
        const followingSeen = followed.get(candidate.norm) || 0;
        if (followingSeen) {
          personalScore += Math.min(9, followingSeen * 3);
          if (!basis) basis = { type: "following", artist: null, weight: 5, reason: "Popular with people you follow" };
        }
        if (!basis) continue;
        const rating = ratings.get(candidate.norm);
        const score = personalScore
          + ratingQuality(rating)
          + Math.min(2.5, Math.max(0, Number(candidate.rank_score) || 0) / 400)
          + (upcoming.has(candidate.norm) ? 1.5 : 0);
        ranked.push({ candidate, basis, score, rating, nextDate: upcoming.get(candidate.norm) || null });
      }

      ranked.sort((a, b) => b.score - a.score
        || (Number(b.rating?.review_count) || 0) - (Number(a.rating?.review_count) || 0)
        || a.candidate.name.localeCompare(b.candidate.name)
        || a.candidate.norm.localeCompare(b.candidate.norm));
      const selected = ranked.slice(0, take);
      const proofs = socialProof(viewer, selected.map((entry) => entry.candidate.norm));

      return {
        personalized: true,
        signalCount: signals.size + genres.size,
        recommendations: selected.map(({ candidate, basis, rating, nextDate }) => {
          const proof = proofs.get(candidate.norm) || { total: 0, friends: 0, people: [] };
          const total = proof.total;
          const friendCount = proof.friends;
          const socialLabel = total
            ? friendCount === total
              ? `${friendCount} ${friendCount === 1 ? "friend has" : "friends have"} seen ${candidate.name}`
              : `${total} ${total === 1 ? "person you follow has" : "people you follow have"} seen ${candidate.name}`
            : null;
          return {
            artist: {
              key: candidate.norm,
              name: candidate.name,
              publicSlug: cleanText(candidate.public_slug, 200),
              photo: safeHttpsUrl(candidate.photo),
              genre: candidate.genre || null,
              country: cleanText(candidate.country, 80),
            },
            reason: { code: basis.type, label: basis.reason, anchorArtist: basis.artist || null, genre: basis.genre || candidate.genre || null },
            liveRating: Number(rating?.average_rating) || null,
            reviewCount: Number(rating?.review_count) || 0,
            nextDate,
            socialProof: {
              count: total,
              friendCount,
              label: socialLabel,
              people: proof.people,
              basis: "Public in-person reviews from people you follow",
            },
          };
        }),
      };
    },
  });
}
