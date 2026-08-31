import { activeAccountSql } from "./accountVisibility.js";

export const CATALOG_TOTALS_CACHE_MS = 5 * 60 * 1000;

const safeInstant = (value) => {
  const instant = Number(value);
  return Number.isSafeInteger(instant) && instant >= 0 ? instant : Date.now();
};

const safeCount = (value) => {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
};

/**
 * Prepared, cached aggregate reads for the public catalogue counters. Venue
 * identity is name + structured city/country, so repeated tour dates at one
 * room do not inflate the total while same-named rooms in different cities
 * remain distinct. Only released, music-qualified and publicly visible event
 * rows contribute.
 */
export function createCatalogTotalsReader(database, { cacheMs = CATALOG_TOTALS_CACHE_MS } = {}) {
  if (!database?.prepare) throw new TypeError("Catalog totals require a database");
  const ttl = Number.isSafeInteger(Number(cacheMs)) && Number(cacheMs) > 0
    ? Number(cacheMs)
    : CATALOG_TOTALS_CACHE_MS;
  const artistCount = database.prepare("SELECT COUNT(*) AS count FROM artists");
  const venueCount = database.prepare(`
    SELECT COUNT(*) AS count FROM (
      SELECT LOWER(TRIM(td.venue)) AS venue_name,
        LOWER(TRIM(COALESCE(td.venue_city,''))) AS venue_city,
        UPPER(TRIM(COALESCE(NULLIF(td.venue_country_code,''),td.venue_country,''))) AS venue_country
      FROM tour_dates td
      LEFT JOIN users owner ON owner.id=td.owner_id
      WHERE td.release_at<=?
        AND COALESCE(td.music_qualified,1)=1
        AND TRIM(COALESCE(td.venue,''))<>''
        AND (td.owner_id IS NULL OR ${activeAccountSql("owner")})
        AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1)
      GROUP BY 1,2,3
    )
  `);
  let cachedBucket = null;
  let cachedValue = null;

  return ({ at = Date.now() } = {}) => {
    const timestamp = safeInstant(at);
    const bucket = Math.floor(timestamp / ttl);
    if (cachedValue && cachedBucket === bucket) return { ...cachedValue };

    cachedValue = {
      artists: safeCount(artistCount.get()?.count),
      venues: safeCount(venueCount.get(timestamp)?.count),
    };
    cachedBucket = bucket;
    return { ...cachedValue };
  };
}
