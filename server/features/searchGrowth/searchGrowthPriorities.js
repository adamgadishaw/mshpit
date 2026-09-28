import { readSearchGrowthPriorityState } from "./searchGrowthService.js";
import { tourDateArtistBindingAllowedSql } from "../../providerArtistBinding.js";

const tableExists = (db) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='search_growth_priority_pages'").get();
const pathAllowed = (path) => typeof path === "string" && path.length <= 512
  && /^\/(?:artist|venue|event)\/[A-Za-z0-9_-]+$/.test(path);

export function ensureSearchGrowthPrioritySchema(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS search_growth_priority_pages (
    path TEXT PRIMARY KEY CHECK(length(path) BETWEEN 3 AND 512),
    score REAL NOT NULL CHECK(score>=0), queued_at INTEGER NOT NULL CHECK(queued_at>=0)
  )`);
}

// Local, synchronous callback only. No scraping, provider requests, user rows or
// paid work: existing workers still enforce their own eligibility and budgets.
export function rememberSearchGrowthPriorities(database, { pages = [], at = Date.now() } = {}, env = process.env) {
  if (!Number.isSafeInteger(at) || at < 0 || !Array.isArray(pages)) return;
  if (!readSearchGrowthPriorityState({ database, env, at }).enabled) return;
  const unique = new Map();
  for (const row of pages.slice(0, 10)) {
    if (pathAllowed(row?.path) && Number.isFinite(row.score) && row.score >= 0) unique.set(row.path, Math.min(row.score, 1_000_000));
  }
  database.exec("SAVEPOINT search_growth_priority_replace");
  try {
    database.prepare("DELETE FROM search_growth_priority_pages").run();
    const put = database.prepare("INSERT INTO search_growth_priority_pages(path,score,queued_at) VALUES (?,?,?)");
    for (const [path, score] of unique) put.run(path, score, at);
    database.exec("RELEASE search_growth_priority_replace");
  } catch (error) {
    database.exec("ROLLBACK TO search_growth_priority_replace; RELEASE search_growth_priority_replace");
    throw error;
  }
}

function priorityPaths(database, { env = process.env, at = Date.now() } = {}) {
  if (!tableExists(database) || !readSearchGrowthPriorityState({ database, env, at }).enabled) return [];
  return database.prepare(`SELECT path FROM search_growth_priority_pages
    WHERE queued_at<=? AND queued_at>? ORDER BY score DESC,path LIMIT 10`)
    .all(at, at - 48 * 60 * 60 * 1000).map(row => row.path).filter(pathAllowed);
}

const publicEvent = `td.owner_id IS NULL AND td.release_at<=? AND td.music_qualified=1
  AND COALESCE(td.provider_active,1)=1 AND ${tourDateArtistBindingAllowedSql("td")}`;

export function searchGrowthArtistPriorityKeys(database, options = {}) {
  const paths = priorityPaths(database, options), at = options.at ?? Date.now();
  if (!paths.length) return [];
  const keys = new Set();
  for (const path of paths) {
    const [, kind, value] = path.split("/");
    let rows = [];
    if (kind === "artist") {
      rows = database.prepare(`SELECT norm FROM artists WHERE public_slug=?
        AND COALESCE(source,'')<>'artist-created' LIMIT 2`).all(value);
    } else if (kind === "event") {
      rows = database.prepare(`SELECT a.norm FROM tour_dates td JOIN artists a ON a.norm=td.artist_key
        WHERE td.id=? AND ${publicEvent} AND COALESCE(a.source,'')<>'artist-created' LIMIT 2`).all(value, at);
    }
    // Never guess a name/slug binding. Claimed/staff fields are rechecked by
    // the existing enrichment worker before and after its provider request.
    if (rows.length === 1) keys.add(rows[0].norm);
  }
  return [...keys];
}

export function searchGrowthVenuePriorityRows(database, options = {}) {
  const paths = priorityPaths(database, options), at = options.at ?? Date.now();
  if (!paths.length) return [];
  const subjects = new Map();
  for (const path of paths) {
    const [, kind, value] = path.split("/");
    if (!["venue", "event"].includes(kind)) continue;
    const matches = kind === "event" ? "td.id=?"
      : "(pit_venue_public_slug(td.source,td.venue_provider_id)=? OR pit_public_slug(td.venue)=?)";
    const rows = database.prepare(`SELECT MIN(td.venue) venue,MIN(td.venue_city) city,
        MIN(td.venue_region) region,MIN(td.venue_country_code) country,MAX(td.venue_address_line1) address
      FROM tour_dates td WHERE ${matches} AND ${publicEvent} AND td.venue IS NOT NULL
        AND trim(td.venue)<>'' AND trim(COALESCE(td.venue_city,''))<>''
        AND trim(COALESCE(td.venue_country_code,''))<>''
      GROUP BY lower(trim(td.venue)),lower(trim(td.venue_city)),lower(trim(td.venue_country_code)) LIMIT 2`)
      .all(...(kind === "event" ? [value, at] : [value, value, at]));
    if (rows.length !== 1) continue; // Same-named rooms in different places need human identity review.
    const row = rows[0];
    subjects.set(JSON.stringify([row.venue.toLowerCase(),row.city.toLowerCase(),row.country.toLowerCase()]), row);
  }
  return [...subjects.values()];
}
