import { db, artistStmts, publicArtist } from "./db.js";

const norm = (value) => String(value || "").trim().toLowerCase();
const radians = (degrees) => degrees * Math.PI / 180;
const finite = (value) => value == null || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) : null);

function distanceKm(a, b) {
  if (![a?.lat, a?.lng, b?.lat, b?.lng].every(Number.isFinite)) return null;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function placeParts(place) {
  const parts = String(place || "").split(",").map((part) => part.trim()).filter(Boolean);
  return { city: parts[0] || "", region: parts[1] || "", country: parts.at(-1) || "" };
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
    ticketUrl: row.ticket_url,
    soldOut: !!row.sold_out,
    source: row.source,
    releaseAt: 0,
    createdBy: "import",
  };
}

// Build one consistent discovery payload for the desktop rail. Location is read
// from the signed-in account on the server, so a stale browser cache cannot rank
// the wrong city. When a city has no dates, results widen to nearby/region/global
// instead of presenting three blank cards.
export function discoverySidebar(viewer, { artistLimit = 8, eventLimit = 8, venueLimit = 8 } = {}) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, " · ");
  const rows = db.prepare("SELECT * FROM tour_dates WHERE date >= ? ORDER BY date ASC LIMIT 5000").all(today);
  const home = viewer?.home_city
    ? { city: viewer.home_city, lat: finite(viewer.home_lat), lng: finite(viewer.home_lng) }
    : null;
  const homeCity = norm(home?.city);

  const exactCityRow = homeCity ? rows.find((row) => norm(placeParts(row.place).city) === homeCity) : null;
  const inferred = placeParts(exactCityRow?.place);
  const homeRegion = norm(inferred.region);
  const homeCountry = norm(inferred.country);

  const ranked = rows.map((row) => {
    const place = placeParts(row.place);
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
    location: home ? { city: home.city, lat: Number.isFinite(home.lat) ? home.lat : null, lng: Number.isFinite(home.lng) ? home.lng : null } : null,
    source: {
      tourDates: rows.length,
      providerConfigured: !!(process.env.TICKETMASTER_KEY || process.env.BANDSINTOWN_APP_ID),
    },
  };
}
