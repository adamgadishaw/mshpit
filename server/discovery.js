import { artistStmts, db, publicArtist } from "./db.js";
import { activeAccountSql } from "./accountVisibility.js";
import { visibleTourDateRows } from "./tourDateVisibility.js";
import { projectedTourDateTicketUrl } from "../src/domain/ticketLinks.mjs";
import { projectPopularLounges } from "../src/domain/liveDiscovery.mjs";

const norm = (value) => String(value || "").trim().toLowerCase();
const radians = (degrees) => degrees * Math.PI / 180;
const finite = (value) => value == null || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
const POPULAR_LOUNGE_CACHE_MS = 60_000;
const POPULAR_LOUNGE_ACTIVITY_MS = 90 * 24 * 60 * 60 * 1000;
const POPULAR_LOUNGE_MAX = 12;
const POPULAR_LOUNGE_CANDIDATE_MAX = 48;
let popularLoungeCache = { expiresAt: 0, rows: [] };

function distanceKm(a, b) {
  if (![a?.lat, a?.lng, b?.lat, b?.lng].every(Number.isFinite)) return null;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function placeParts(row) {
  if (String(row?.venue_city || "").trim() && String(row?.venue_country_code || row?.venue_country || "").trim()) {
    return {
      city: String(row.venue_city).trim(),
      region: String(row.venue_region || "").trim(),
      country: String(row.venue_country_code || row.venue_country).trim(),
    };
  }
  const parts = String(row?.place || "").split(",").map((part) => part.trim()).filter(Boolean);
  return { city: parts[0] || "", region: parts[1] || "", country: parts.at(-1) || "" };
}

function evidenceBackedEventFields(row) {
  if (!row?.music_evidence) return {};
  let billedArtists = [];
  try {
    const parsed = JSON.parse(row.billed_artists || "[]");
    if (Array.isArray(parsed)) billedArtists = parsed.slice(0, 20).filter((name) => typeof name === "string" && name.trim());
  } catch { /* architecture: allow-empty-catch -- malformed provider evidence degrades to the legacy event card */ }
  return {
    eventName: row.event_name || null,
    eventKind: row.event_kind || "concert",
    eventEndDate: row.event_end_date || null,
    billedArtists,
  };
}

function publicEvent(row) {
  return {
    id: row.id,
    artist: row.artist,
    venue: row.venue,
    place: row.place,
    lat: row.lat,
    lng: row.lng,
    date: row.date,
    ticketUrl: projectedTourDateTicketUrl(row),
    soldOut: !!row.sold_out,
    source: row.source,
    releaseAt: Number(row.release_at) || 0,
    createdBy: row.owner_id || "import",
    ...evidenceBackedEventFields(row),
  };
}

function popularLounges({ limit = 6, at = Date.now() } = {}) {
  const requested = Number.isFinite(Number(limit))
    ? Math.max(0, Math.min(POPULAR_LOUNGE_MAX, Math.floor(Number(limit))))
    : 6;
  if (requested <= 0) return [];
  const timestamp = Number.isFinite(Number(at)) ? Number(at) : Date.now();
  if (popularLoungeCache.expiresAt > timestamp) return popularLoungeCache.rows.slice(0, requested);

  // The directory is intentionally aggregate-only. It uses public show identity
  // plus counts from active accounts; no member id, authored message, profile, or
  // home location enters the projection. A short cache keeps this bounded rollup
  // off the hot path on every landing/sidebar request.
  const rows = db.prepare(`
    WITH recent_lounges AS (
      SELECT LOWER(m.lounge_id) AS lounge_key,
        COUNT(*) AS message_count,
        MAX(m.created_at) AS last_activity_at
      FROM lounge_messages m
      JOIN users author ON author.id=m.user_id
      WHERE m.removed=0
        AND m.created_at>=?
        AND ${activeAccountSql("author")}
      GROUP BY LOWER(m.lounge_id)
      ORDER BY message_count DESC,last_activity_at DESC,lounge_key
      LIMIT ?
    ), attendee_activity AS (
      SELECT LOWER(g.concert_key) AS lounge_key,
        MAX(NULLIF(g.artist,'')) AS artist,
        MAX(NULLIF(g.venue,'')) AS venue,
        MAX(NULLIF(g.city,'')) AS city,
        MAX(NULLIF(g.date,'')) AS date,
        COUNT(DISTINCT g.user_id) AS attendee_count
      FROM going g
      JOIN recent_lounges candidate ON candidate.lounge_key=LOWER(g.concert_key)
      JOIN users attendee ON attendee.id=g.user_id
      WHERE ${activeAccountSql("attendee")}
      GROUP BY LOWER(g.concert_key)
    )
    SELECT attendance.lounge_key AS key,
      attendance.artist,
      attendance.venue,
      attendance.city,
      attendance.date,
      attendance.attendee_count,
      messages.message_count,
      messages.last_activity_at
    FROM recent_lounges messages
    JOIN attendee_activity attendance ON attendance.lounge_key=messages.lounge_key
    WHERE attendance.attendee_count>0 AND messages.message_count>0
    ORDER BY messages.message_count DESC,
      attendance.attendee_count DESC,
      messages.last_activity_at DESC,
      attendance.artist COLLATE NOCASE
    LIMIT ?
  `).all(timestamp - POPULAR_LOUNGE_ACTIVITY_MS, POPULAR_LOUNGE_CANDIDATE_MAX, POPULAR_LOUNGE_MAX);
  const projected = projectPopularLounges(rows, { limit: POPULAR_LOUNGE_MAX });
  popularLoungeCache = { expiresAt: timestamp + POPULAR_LOUNGE_CACHE_MS, rows: projected };
  return projected.slice(0, requested);
}

// Build one consistent discovery payload for the desktop rail. Location is read
// from the signed-in account on the server, so a stale browser cache cannot rank
// the wrong city. When a city has no dates, results widen to nearby/region/global
// instead of presenting three blank cards.
export function discoverySidebar(viewer, { artistLimit = 8, eventLimit = 8, venueLimit = 8, loungeLimit = 6, at = Date.now() } = {}) {
  const timestamp = Number.isFinite(Number(at)) ? Number(at) : Date.now();
  const today = new Date(timestamp).toISOString().slice(0, 10);
  // Visibility is enforced inside the service before ranking or aggregation.
  // Callers cannot inject a preselected row set and accidentally disclose an
  // unreleased, blocked, or restricted owner's date through venue metadata.
  const rows = visibleTourDateRows(viewer, { today });
  const home = viewer?.home_city
    ? { city: viewer.home_city, lat: finite(viewer.home_lat), lng: finite(viewer.home_lng) }
    : null;
  const homeCity = norm(home?.city);

  const exactCityRow = homeCity ? rows.find((row) => norm(placeParts(row).city) === homeCity) : null;
  const inferred = placeParts(exactCityRow);
  const homeRegion = norm(inferred.region);
  const homeCountry = norm(inferred.country);

  const ranked = rows.map((row) => {
    const place = placeParts(row);
    const distance = distanceKm(home, { lat: finite(row.lat), lng: finite(row.lng) });
    let locality = 0;
    if (homeCity && norm(place.city) === homeCity) locality = 6;
    else if (distance != null && distance <= 75) locality = 5;
    else if (homeRegion && norm(place.region) === homeRegion) locality = 4;
    else if (distance != null && distance <= 250) locality = 3;
    else if (homeCountry && norm(place.country) === homeCountry) locality = 2;
    else if (!home) locality = 1;
    return { row, place, distance, locality };
  }).sort((a, b) =>
    b.locality - a.locality
    || (a.distance ?? Number.POSITIVE_INFINITY) - (b.distance ?? Number.POSITIVE_INFINITY)
    || String(a.row.date).localeCompare(String(b.row.date))
    || String(a.row.artist).localeCompare(String(b.row.artist))
  );

  const events = ranked.slice(0, eventLimit).map(({ row, distance, locality }) => ({
    ...publicEvent(row),
    distanceKm: distance == null ? null : Math.round(distance),
    local: locality >= 4,
  }));

  const venues = new Map();
  for (const item of ranked) {
    if (!item.row.venue) continue;
    const key = `${norm(item.row.venue)}|${norm(item.row.place)}`;
    const existing = venues.get(key) || {
      name: item.row.venue,
      place: item.row.place || "",
      upcoming: 0,
      locality: item.locality,
      distanceKm: item.distance == null ? null : Math.round(item.distance),
      nextDate: item.row.date,
    };
    existing.upcoming += 1;
    existing.locality = Math.max(existing.locality, item.locality);
    if (item.distance != null && (existing.distanceKm == null || item.distance < existing.distanceKm)) existing.distanceKm = Math.round(item.distance);
    if (String(item.row.date).localeCompare(String(existing.nextDate)) < 0) existing.nextDate = item.row.date;
    venues.set(key, existing);
  }

  const trendingVenues = [...venues.values()]
    .sort((a, b) => b.locality - a.locality || b.upcoming - a.upcoming || String(a.nextDate).localeCompare(String(b.nextDate)) || a.name.localeCompare(b.name))
    .slice(0, venueLimit)
    .map(({ locality, ...venue }) => ({ ...venue, local: locality >= 4 }));

  const topArtists = artistStmts.top.all(Math.max(1, Math.min(40, artistLimit))).map((row) => {
    const artist = publicArtist(row);
    return { name: artist.name, genre: artist.genre || null, photo: artist.photo || null, popularity: artist.popularity ?? null, avg: 0 };
  });

  return {
    topArtists,
    upcomingEvents: events,
    trendingVenues,
    popularLounges: viewer ? popularLounges({ limit: loungeLimit, at: timestamp }) : [],
    location: home ? { city: home.city, lat: Number.isFinite(home.lat) ? home.lat : null, lng: Number.isFinite(home.lng) ? home.lng : null } : null,
    source: {
      tourDates: rows.length,
      providerConfigured: !!(process.env.TICKETMASTER_KEY || process.env.BANDSINTOWN_APP_ID),
    },
  };
}
