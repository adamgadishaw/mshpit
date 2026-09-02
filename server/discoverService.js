import { db, normName } from "./db.js";
import { projectArtistGenre } from "../src/domain/genre.mjs";
import { createTopRatedShowService } from "./features/discovery/topRatedShowService.js";
import { activeAccountSql } from "./accountVisibility.js";
import { inPersonReviewSql } from "./onlineReviews.js";

const ARTIST_RATING_CANDIDATE_LIMIT = 5_000;

const GENRE_ALIAS = {
  "hip hop": "Hip-Hop", hiphop: "Hip-Hop", "hip-hop": "Hip-Hop", rap: "Hip-Hop", trap: "Hip-Hop", "conscious hip hop": "Hip-Hop",
  "r&b": "R&B", rnb: "R&B", "r & b": "R&B", "contemporary r&b": "R&B", "rhythm and blues": "R&B", "rhythm & blues": "R&B",
  "drum and bass": "Drum & Bass", "drum & bass": "Drum & Bass", dnb: "Drum & Bass", "d&b": "Drum & Bass",
  "k-pop": "K-Pop", "k pop": "K-Pop", kpop: "K-Pop", "j-pop": "J-Pop", "j pop": "J-Pop", jpop: "J-Pop",
  edm: "EDM", idm: "Electronic", electronica: "Electronic", dance: "Electronic",
  "singer-songwriter": "Singer-Songwriter", "singer songwriter": "Singer-Songwriter",
  afrobeats: "Afrobeat", "alt rock": "Alternative Rock", "alt-rock": "Alternative Rock",
  indie: "Indie", "indie rock": "Indie", "indie pop": "Indie",
  "rap/hip hop": "Hip-Hop", "soul & funk": "Soul", "latin music": "Latin", electro: "Electronic",
};

const text = (value, max = 60) => typeof value === "string" ? value.trim().slice(0, max) : "";
const limitBetween = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
};

export function canonicalGenre(value) {
  const normalized = text(value).toLowerCase();
  if (!normalized) return null;
  if (GENRE_ALIAS[normalized]) return GENRE_ALIAS[normalized];
  return normalized.replace(/\band\b/g, "&").replace(/\b\w/g, (character) => character.toUpperCase());
}

function artistData(row) {
  if (!row?.data) return {};
  try {
    const parsed = JSON.parse(row.data);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Discover must apply the same provenance boundary as db.publicArtist. The
// typed genre column can contain a legacy MusicBrainz crawl bucket, while the
// data blob carries newer provider/staff claims. Only evidence-backed claims
// may become a public genre; crawl labels remain useful internally as hints.
function projectedGenre(artist, data = artistData(artist)) {
  const projected = projectArtistGenre(data, artist?.genre);
  return canonicalGenre(projected.genre);
}

function chartRow(name, artist, rank, extra = {}) {
  const data = artistData(artist);
  const firstTrack = Array.isArray(data.topTracks) ? data.topTracks[0] : null;
  return {
    rank,
    name: artist?.name || name,
    genre: projectedGenre(artist, data),
    popularity: artist?.popularity ?? null,
    followers: data.followers ?? null,
    photo: artist?.photo || null,
    topTrack: firstTrack?.title ? { title: firstTrack.title, url: firstTrack.url || null } : null,
    ...extra,
  };
}

/**
 * DB-backed Discover queries. Keeping these outside api.js makes the HTTP routes
 * thin and gives the overview endpoint one consistent source of truth.
 */
export function createDiscoverService({ database = db, clock = Date.now } = {}) {
  const PROJECTION_TTL_MS = 60 * 1000;
  const PUBLIC_PLAY_DELAY_MS = 6 * 60 * 60 * 1000;
  const PUBLIC_PLAY_MIN_LISTENERS = 3;
  let projectionCache = { version: null, at: 0, rows: [] };
  const topRatedShows = createTopRatedShowService({ database, clock });

  function projectionVersion() {
    return Number(database.prepare("SELECT revision FROM artist_projection_revision WHERE singleton = 1").get()?.revision) || 0;
  }

  function projectedArtists() {
    const version = projectionVersion();
    const current = clock();
    if (projectionCache.version === version && current - projectionCache.at < PROJECTION_TTL_MS) return projectionCache.rows;
    const rows = database.prepare("SELECT norm, country, genre, data FROM artists").all()
      .map((row) => ({ norm: row.norm, country: row.country || null, genre: projectedGenre(row) }));
    projectionCache = { version, at: current, rows };
    return rows;
  }

  function artistNormsForGenre(value, country = "") {
    const genre = canonicalGenre(value);
    if (!genre) return [];
    const countryFilter = text(country);
    return projectedArtists()
      .filter((row) => (!countryFilter || countryFilter === "Worldwide" || row.country?.toLowerCase() === countryFilter.toLowerCase()) && row.genre === genre)
      .map((row) => row.norm);
  }

  function topReviewedArtistsForGenre(artistNorms, limit = 6) {
    const eligible = new Set((Array.isArray(artistNorms) ? artistNorms : []).map(normName).filter(Boolean));
    if (!eligible.size) return [];
    const identities = JSON.stringify([...eligible]);
    const posts = database.prepare(`
      SELECT p.id,p.user_id,p.artist,p.artist_key,p.venue,p.venue_key,p.date,
        p.overall,p.review,p.created_at,p.updated_at
      FROM posts p
      JOIN users author ON author.id=p.user_id
      WHERE p.removed=0 AND ${inPersonReviewSql("p")}
        AND p.overall BETWEEN 1 AND 5
        AND TRIM(COALESCE(p.venue,''))<>'' AND TRIM(COALESCE(p.date,''))<>''
        AND ${activeAccountSql("author")}
        AND (
          p.artist_key IN (SELECT value FROM json_each(?))
          OR (p.artist_key IS NULL AND LOWER(TRIM(p.artist)) IN (SELECT value FROM json_each(?)))
        )
      ORDER BY p.created_at DESC,p.id DESC
      LIMIT ?
    `).all(identities, identities, ARTIST_RATING_CANDIDATE_LIMIT);

    const latestReviewerShow = new Set();
    const totals = new Map();
    for (const post of posts) {
      const artistNorm = normName(post.artist_key || post.artist);
      if (!eligible.has(artistNorm)) continue;
      const venueIdentity = normName(post.venue_key || post.venue);
      const reviewerShow = `${post.user_id}\u0000${artistNorm}\u0000${venueIdentity}\u0000${post.date}`;
      if (!post.user_id || !venueIdentity || latestReviewerShow.has(reviewerShow)) continue;
      latestReviewerShow.add(reviewerShow);
      const current = totals.get(artistNorm) || {
        artistNorm,
        ratingTotal: 0,
        ratingCount: 0,
        reviewCount: 0,
        newestAt: 0,
      };
      current.ratingTotal += Number(post.overall);
      current.ratingCount += 1;
      if (text(post.review, 4_000)) current.reviewCount += 1;
      current.newestAt = Math.max(current.newestAt, Number(post.updated_at) || Number(post.created_at) || 0);
      totals.set(artistNorm, current);
    }

    const ranked = [...totals.values()].map((row) => {
      const avgRating = row.ratingTotal / row.ratingCount;
      const priorRating = 3.8;
      const priorWeight = 5;
      const confidenceRating = ((avgRating * row.ratingCount) + (priorRating * priorWeight)) / (row.ratingCount + priorWeight);
      const sampleDepth = Math.min(1, Math.log1p(row.ratingCount) / Math.log(30));
      return { ...row, avgRating, rankScore: ((confidenceRating / 5) * 0.8 + sampleDepth * 0.2) * 100 };
    }).sort((left, right) => right.rankScore - left.rankScore
      || right.ratingCount - left.ratingCount
      || right.avgRating - left.avgRating
      || right.newestAt - left.newestAt
      || left.artistNorm.localeCompare(right.artistNorm))
      .slice(0, limitBetween(limit, 6, 1, 12));
    if (!ranked.length) return [];

    const byNorm = new Map(database.prepare("SELECT * FROM artists WHERE norm IN (SELECT value FROM json_each(?))")
      .all(JSON.stringify(ranked.map((row) => row.artistNorm)))
      .map((artist) => [artist.norm, artist]));
    return ranked.map((row, index) => {
      const artist = byNorm.get(row.artistNorm);
      if (!artist) return null;
      return chartRow(artist.name, artist, index + 1, {
        rankingGroup: "top-reviewed",
        avgRating: Number(row.avgRating.toFixed(2)),
        ratingCount: row.ratingCount,
        reviewCount: row.reviewCount,
      });
    }).filter(Boolean);
  }

  function chart({ by = "popularity", country = "", genre = "", limit = 24 } = {}) {
    const source = by === "plays" ? "plays" : "popularity";
    const rowLimit = limitBetween(limit, 24, 3, 60);
    const countryFilter = text(country);
    const genreFilter = canonicalGenre(genre);
    const artistNorms = genreFilter ? artistNormsForGenre(genreFilter, countryFilter) : [];
    const label = source === "plays" ? "Most played on Pit" : "By popularity";

    if (genreFilter && artistNorms.length === 0) return { source, label, live: true, rows: [] };

    if (source === "plays") {
      let sql = `
        SELECT MIN(p.artist) AS play_name, COUNT(*) AS play_count,
          COUNT(DISTINCT p.user_id) AS listener_count, a.*
        FROM plays p
        LEFT JOIN artists a ON a.norm = LOWER(TRIM(p.artist))
        WHERE p.artist IS NOT NULL AND TRIM(p.artist) <> '' AND p.created_at <= ?`;
      const params = [clock() - PUBLIC_PLAY_DELAY_MS];
      if (countryFilter && countryFilter !== "Worldwide") {
        sql += " AND a.country = ? COLLATE NOCASE";
        params.push(countryFilter);
      }
      if (genreFilter) {
        sql += " AND a.norm IN (SELECT value FROM json_each(?))";
        params.push(JSON.stringify(artistNorms));
      }
      sql += " GROUP BY LOWER(TRIM(p.artist)) HAVING COUNT(DISTINCT p.user_id) >= ? ORDER BY play_count DESC, play_name LIMIT 240";
      params.push(PUBLIC_PLAY_MIN_LISTENERS);
      const rows = database.prepare(sql).all(...params);
      const coarseCount = (value) => {
        const count = Math.max(PUBLIC_PLAY_MIN_LISTENERS, Number(value) || 0);
        const bands = [3, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000];
        return bands.filter((band) => band <= count).at(-1) || PUBLIC_PLAY_MIN_LISTENERS;
      };
      const publicRows = rows.map((row) => ({ row, plays: coarseCount(row.play_count) }))
        .sort((left, right) => right.plays - left.plays || left.row.play_name.localeCompare(right.row.play_name))
        .slice(0, rowLimit);
      return {
        source,
        label: "Community listening · delayed and grouped",
        live: false,
        privacy: { minimumListeners: PUBLIC_PLAY_MIN_LISTENERS, delayedHours: PUBLIC_PLAY_DELAY_MS / 3_600_000, counts: "lower-bound" },
        rows: publicRows.map(({ row, plays }, index) => chartRow(row.play_name, row, index + 1, { plays, playsApproximate: true })),
      };
    }

    let sql = "SELECT * FROM artists WHERE popularity IS NOT NULL";
    const params = [];
    if (countryFilter && countryFilter !== "Worldwide") {
      sql += " AND country = ? COLLATE NOCASE";
      params.push(countryFilter);
    }
    if (genreFilter) {
      sql += " AND norm IN (SELECT value FROM json_each(?))";
      params.push(JSON.stringify(artistNorms));
    }
    sql += " ORDER BY popularity DESC, rank_score DESC, name LIMIT ?";
    params.push(genreFilter ? Math.min(60, rowLimit * 2) : rowLimit);
    const rows = database.prepare(sql).all(...params);
    const popularRows = rows.map((row, index) => chartRow(row.name, row, index + 1, {
      ...(genreFilter ? { rankingGroup: "popular" } : {}),
    }));
    if (!genreFilter) return { source, label, live: true, rows: popularRows };

    const ratedRows = topReviewedArtistsForGenre(artistNorms, Math.min(6, rowLimit));
    const ratedNames = new Set(ratedRows.map((row) => normName(row.name)));
    const distinctPopular = popularRows
      .filter((row) => !ratedNames.has(normName(row.name)))
      .slice(0, Math.min(6, rowLimit));

    return {
      source,
      label: `Top reviewed live and popular in ${genreFilter}`,
      live: true,
      rows: [...ratedRows, ...distinctPopular].slice(0, rowLimit),
      ratedRows,
      popularRows: distinctPopular,
    };
  }

  function genres({ country = "", limit = 8 } = {}) {
    const countryFilter = text(country);
    const rowLimit = limitBetween(limit, 8, 4, 12);
    const rows = projectedArtists().filter((row) => !countryFilter || countryFilter === "Worldwide" || row.country?.toLowerCase() === countryFilter.toLowerCase());
    const counts = new Map();
    let total = 0;
    for (const row of rows) {
      const genre = row.genre;
      if (!genre) continue;
      total += 1;
      counts.set(genre, (counts.get(genre) || 0) + 1);
    }
    const sorted = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    const result = sorted.slice(0, rowLimit).map(([genre, count]) => ({ genre, count, pct: total ? count / total : 0 }));
    const other = sorted.slice(rowLimit).reduce((sum, [, count]) => sum + count, 0);
    if (other > 0) result.push({ genre: "Other", count: other, pct: total ? other / total : 0 });
    const catalogTotal = Number(database.prepare("SELECT COUNT(*) AS count FROM artists").get()?.count) || 0;
    return { total, distinctGenres: sorted.length, catalogTotal, genres: result };
  }

  function countries({ min = 5 } = {}) {
    const minimum = limitBetween(min, 5, 1, 1000000);
    const rows = database.prepare(`
      SELECT country, COUNT(*) AS count
      FROM artists
      WHERE country IS NOT NULL AND TRIM(country) <> ''
      GROUP BY country
      HAVING count >= ?
      ORDER BY count DESC, country
      LIMIT 40
    `).all(minimum);
    return { countries: rows.map((row) => ({ country: row.country, count: Number(row.count) || 0 })) };
  }

  function overview({ by = "popularity", country = "Worldwide" } = {}) {
    const chartResult = chart({ by, country, limit: 24 });
    const genreResult = genres({ country, limit: 8 });
    return {
      chart: chartResult,
      genres: genreResult.genres,
      genreTotal: genreResult.total,
      distinctGenres: genreResult.distinctGenres,
      catalogTotal: genreResult.catalogTotal,
      countries: countries({ min: 5 }).countries,
      topRatedShows: topRatedShows.read({ country, limit: 24 }),
      generatedAt: new Date(clock()).toISOString(),
    };
  }

  return { chart, genres, countries, overview };
}

const discoverService = createDiscoverService();
export const discoverChart = (options) => discoverService.chart(options);
export const discoverGenres = (options) => discoverService.genres(options);
export const discoverCountries = (options) => discoverService.countries(options);
export const discoverOverview = (options) => discoverService.overview(options);
