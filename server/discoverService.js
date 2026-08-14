import { db } from "./db.js";
import { displayGenre, resolveGenre, storedClaims } from "../src/domain/genre.mjs";

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
  const record = resolveGenre(storedClaims(data, artist?.genre));
  return canonicalGenre(displayGenre(record));
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
  let projectionCache = { version: null, at: 0, rows: [] };

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
          MAX(p.created_at) AS last_played_at, a.*
        FROM plays p
        LEFT JOIN artists a ON a.norm = LOWER(TRIM(p.artist))
        WHERE p.artist IS NOT NULL AND TRIM(p.artist) <> ''`;
      const params = [];
      if (countryFilter && countryFilter !== "Worldwide") {
        sql += " AND a.country = ? COLLATE NOCASE";
        params.push(countryFilter);
      }
      if (genreFilter) {
        sql += " AND a.norm IN (SELECT value FROM json_each(?))";
        params.push(JSON.stringify(artistNorms));
      }
      sql += " GROUP BY LOWER(TRIM(p.artist)) ORDER BY play_count DESC, last_played_at DESC, play_name LIMIT ?";
      params.push(rowLimit);
      const rows = database.prepare(sql).all(...params);
      return {
        source,
        label,
        live: true,
        rows: rows.map((row, index) => chartRow(row.play_name, row, index + 1, { plays: Number(row.play_count) || 0 })),
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
    params.push(rowLimit);
    const rows = database.prepare(sql).all(...params);
    return { source, label, live: true, rows: rows.map((row, index) => chartRow(row.name, row, index + 1)) };
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
    // Match the public People surface: banned accounts are private moderation
    // state and must not inflate the community total shown in Discover.
    const memberTotal = Number(database.prepare("SELECT COUNT(*) AS count FROM users WHERE is_banned=0").get()?.count) || 0;
    return {
      chart: chartResult,
      genres: genreResult.genres,
      genreTotal: genreResult.total,
      distinctGenres: genreResult.distinctGenres,
      catalogTotal: genreResult.catalogTotal,
      memberTotal,
      countries: countries({ min: 5 }).countries,
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
