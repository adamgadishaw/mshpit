import { activeAccountSql } from "../../accountVisibility.js";
import {
  discoverCountryCode,
  discoverCountryIdentity,
  discoverCountryLabel,
} from "../../../src/domain/discoverScene.mjs";

const POST_CANDIDATE_LIMIT = 5_000;
const PROVIDER_LOCATION_LIMIT = 5_000;
const CACHE_TTL_MS = 60_000;
const CACHE_ENTRY_LIMIT = 16;

const clean = (value, maximum = 240) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/gu, "").replace(/\s+/gu, " ").trim().slice(0, maximum)
  : "";
const identityPart = (value) => clean(value, 240).normalize("NFKC").toLocaleLowerCase("en");
const boundedLimit = (value, fallback = 24, maximum = 30) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(maximum, Math.trunc(parsed))) : fallback;
};

function artistIdentity(row) {
  return identityPart(row?.artist_key) || identityPart(row?.artist);
}

function providerShowIdentity(row) {
  return [artistIdentity(row), identityPart(row?.venue), clean(row?.date, 40)].join("\u0000");
}

function providerVenueIdentity(row) {
  const source = identityPart(row?.source);
  const providerVenueId = clean(row?.venue_provider_id, 180);
  return source && providerVenueId ? `provider:${source}:${identityPart(providerVenueId)}` : "";
}

function providerCountry(row) {
  const country = clean(row?.venue_country, 80);
  if (country) return country;
  const code = clean(row?.venue_country_code, 8).toLocaleUpperCase("en");
  return discoverCountryLabel(code) || (code.length === 2 ? code : "");
}

function explicitCountryFromPlace(value) {
  const parts = clean(value, 300).split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return "";
  const last = parts.at(-1);
  if (parts.length >= 3 || discoverCountryCode(last) || /^[A-Z]{2}$/u.test(last)) return last;
  return "";
}

function createProviderLocationIndex(rows) {
  const exact = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const showIdentity = providerShowIdentity(row);
    if (!showIdentity || exact.has(showIdentity)) continue;
    const providerIdentity = providerVenueIdentity(row);
    const country = providerCountry(row) || explicitCountryFromPlace(row?.place);
    exact.set(showIdentity, {
      source: clean(row?.source, 40) || null,
      providerVenueId: clean(row?.venue_provider_id, 180) || null,
      venueIdentity: providerIdentity || null,
      venueCity: clean(row?.venue_city, 120) || clean(row?.place, 240).split(",")[0]?.trim() || null,
      venueRegion: clean(row?.venue_region, 120) || null,
      venueCountryCode: clean(row?.venue_country_code, 8).toLocaleUpperCase("en") || null,
      venueCountry: country || null,
      place: clean(row?.place, 240) || null,
    });
  }
  return exact;
}

function showIdentity(row, providerLocation) {
  const city = identityPart(row?.city);
  const venueIdentity = providerLocation?.venueIdentity
    || `place:${identityPart(row?.venue)}:${city}:${discoverCountryIdentity(providerLocation?.venueCountry || explicitCountryFromPlace(row?.city))}`;
  return [artistIdentity(row), venueIdentity, clean(row?.date, 40)].join("\u0000");
}

function representativeTour(groups) {
  return [...groups.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] || null;
}

function confidenceRank(average, ratingCount) {
  const prior = 3.8;
  const priorWeight = 5;
  const confidenceRating = ((average * ratingCount) + (prior * priorWeight)) / (ratingCount + priorWeight);
  const depth = Math.min(1, Math.log1p(ratingCount) / Math.log(30));
  return ((confidenceRating / 5) * 0.8 + depth * 0.2) * 100;
}

function projectShows(postRows, providerRows, { country = "Worldwide", limit = 24 } = {}) {
  const requestedCountry = discoverCountryIdentity(country);
  const providerLocations = createProviderLocationIndex(providerRows);
  const shows = new Map();
  const latestReviewerShows = new Set();

  // Rows arrive newest first. The first valid rating for an account+show is the
  // one public score that counts, matching the artist archive''s integrity rule.
  for (const row of Array.isArray(postRows) ? postRows : []) {
    const rating = Number(row?.overall);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) continue;
    const providerLocation = providerLocations.get(providerShowIdentity(row)) || null;
    const venueCountry = providerLocation?.venueCountry || explicitCountryFromPlace(row?.city);
    if (requestedCountry && requestedCountry !== "worldwide"
      && discoverCountryIdentity(venueCountry) !== requestedCountry) continue;

    const identity = showIdentity(row, providerLocation);
    const reviewerIdentity = `${identity}\u0000${identityPart(row?.user_id)}`;
    if (!identity || !identityPart(row?.user_id) || latestReviewerShows.has(reviewerIdentity)) continue;
    latestReviewerShows.add(reviewerIdentity);

    const existing = shows.get(identity) || {
      key: identity,
      artist: clean(row?.artist, 160),
      artistKey: clean(row?.artist_key, 180) || null,
      venue: clean(row?.venue, 180),
      venueKey: clean(row?.venue_key, 180) || null,
      city: clean(row?.city, 180) || providerLocation?.place || providerLocation?.venueCity || "",
      place: providerLocation?.place || clean(row?.city, 180),
      date: clean(row?.date, 40),
      source: providerLocation?.source || null,
      providerVenueId: providerLocation?.providerVenueId || null,
      venueIdentity: providerLocation?.venueIdentity || null,
      venueCity: providerLocation?.venueCity || null,
      venueRegion: providerLocation?.venueRegion || null,
      venueCountryCode: providerLocation?.venueCountryCode || null,
      venueCountry: venueCountry || null,
      ratingTotal: 0,
      ratingCount: 0,
      reviewCount: 0,
      tourVotes: new Map(),
      newestAt: 0,
    };
    existing.ratingTotal += rating;
    existing.ratingCount += 1;
    if (clean(row?.review, 4_000)) existing.reviewCount += 1;
    const tour = clean(row?.tour, 180);
    if (tour) existing.tourVotes.set(tour, (existing.tourVotes.get(tour) || 0) + 1);
    existing.newestAt = Math.max(existing.newestAt, Number(row?.updated_at) || Number(row?.created_at) || 0);
    shows.set(identity, existing);
  }

  return [...shows.values()].map((show) => {
    const avgRating = show.ratingTotal / show.ratingCount;
    return {
      key: `show:${show.key.split("\u0000").map(encodeURIComponent).join(":")}`,
      artist: show.artist,
      artistKey: show.artistKey,
      venue: show.venue,
      venueKey: show.venueKey,
      city: show.city,
      place: show.place,
      date: show.date,
      tourName: representativeTour(show.tourVotes),
      avgRating,
      ratingCount: show.ratingCount,
      reviewCount: show.reviewCount,
      source: show.source,
      providerVenueId: show.providerVenueId,
      venueIdentity: show.venueIdentity,
      venueCity: show.venueCity,
      venueRegion: show.venueRegion,
      venueCountryCode: show.venueCountryCode,
      venueCountry: show.venueCountry,
      rankScore: confidenceRank(avgRating, show.ratingCount),
      newestAt: show.newestAt,
    };
  }).filter((show) => show.artist && show.venue && show.date && show.ratingCount > 0)
    .sort((left, right) => right.rankScore - left.rankScore
      || right.ratingCount - left.ratingCount
      || right.avgRating - left.avgRating
      || right.newestAt - left.newestAt
      || left.artist.localeCompare(right.artist))
    .slice(0, boundedLimit(limit))
    .map(({ newestAt, ...show }, index) => ({ ...show, rank: index + 1 }));
}

export function createTopRatedShowService({ database, clock = Date.now } = {}) {
  if (!database?.prepare) throw new TypeError("A database is required");
  const cache = new Map();

  const read = ({ country = "Worldwide", limit = 24 } = {}) => {
    const safeLimit = boundedLimit(limit);
    const cacheKey = `${discoverCountryIdentity(country) || "worldwide"}\u0000${safeLimit}`;
    const current = Number(clock());
    const cached = cache.get(cacheKey);
    if (cached && current - cached.at < CACHE_TTL_MS) return cached.rows;

    const posts = database.prepare(`
      SELECT p.id,p.user_id,p.artist,p.artist_key,p.venue,p.venue_key,p.city,p.date,
        p.overall,p.review,p.tour,p.created_at,p.updated_at
      FROM posts p
      JOIN users author ON author.id=p.user_id
      WHERE p.removed=0 AND COALESCE(p.kind,'review')='review'
        AND TRIM(p.artist)<>'''' AND TRIM(p.venue)<>'''' AND TRIM(p.date)<>''''
        AND p.overall BETWEEN 1 AND 5
        AND ${activeAccountSql("author")}
      ORDER BY p.created_at DESC,p.id DESC
      LIMIT ?
    `).all(POST_CANDIDATE_LIMIT);
    const providerLocations = database.prepare(`
      SELECT td.artist,td.artist_key,td.venue,td.place,td.date,td.source,td.venue_provider_id,
        td.venue_city,td.venue_region,td.venue_country_code,td.venue_country
      FROM tour_dates td
      WHERE td.owner_id IS NULL AND TRIM(COALESCE(td.venue,''))<>''
        AND TRIM(COALESCE(td.date,''))<>''
      ORDER BY td.updated_at DESC,td.id DESC
      LIMIT ?
    `).all(PROVIDER_LOCATION_LIMIT);
    const rows = projectShows(posts, providerLocations, { country, limit: safeLimit });
    cache.delete(cacheKey);
    cache.set(cacheKey, { at: current, rows });
    while (cache.size > CACHE_ENTRY_LIMIT) cache.delete(cache.keys().next().value);
    return rows;
  };

  return Object.freeze({ read });
}

export { projectShows as projectTopRatedShows };
