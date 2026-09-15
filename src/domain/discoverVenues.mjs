import { discoverRowMatchesRegion, discoverVenueIdentity } from "./discoverScene.mjs";
import { isVenuePlaceActionable, venuePlaceIdentity } from "./venueDiscovery.mjs";
import { isCurrentOrUpcomingLiveEvent, compareCurrentAndUpcomingLiveEvents } from "./eventLifecycle.mjs";

const text = (value) => String(value ?? "").trim();
const norm = (value) => text(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const placeOf = (row) => text(row.place) || [row.venueCity || row.city, row.venueRegion, row.venueCountry || row.venueCountryCode].filter(Boolean).join(", ");
const placeKey = (row) => venuePlaceIdentity(placeOf(row)).id;
const roomKey = (row) => `${norm(row.name || row.venue)}|${placeKey(row)}`;
const providerKey = (row) => row.source && (row.providerVenueId || row.venue_provider_id) ? discoverVenueIdentity(row) : null;

export function discoverVenueCoordinate(row) {
  const point = row?.coord || row;
  const lat = point?.lat ?? point?.venueLat;
  const lng = point?.lng ?? point?.venueLng;
  if (lat == null || lng == null || text(lat) === "" || text(lng) === "" || typeof lat === "boolean" || typeof lng === "boolean") return null;
  const coord = { lat: Number(lat), lng: Number(lng) };
  return Number.isFinite(coord.lat) && Number.isFinite(coord.lng) && Math.abs(coord.lat) <= 85 && Math.abs(coord.lng) <= 180 ? coord : null;
}

// One bounded pass over the existing local index + dates. Never one request (or
// full date scan) per venue. Provider identities win; name-only matches must be
// unique within the complete city/region/country, not merely "Toronto".
export function buildDiscoverVenueCities(index, events, { region = "Worldwide", countryForCity, now = Date.now() } = {}) {
  const rooms = new Map(), byProvider = new Map(), byPlace = new Map();
  for (const entry of (Array.isArray(index) ? index : []).slice(0, 7500)) {
    const row = entry?.row || entry;
    if (!row?.name || !isVenuePlaceActionable(placeOf(row)) || !discoverRowMatchesRegion(row, region, { countryForCity })) continue;
    const id = providerKey(row) || row.identity || roomKey(row);
    if (rooms.has(id)) continue;
    const room = { ...row, id, place: placeOf(row), coord: discoverVenueCoordinate(row), shows: [] };
    rooms.set(id, room);
    if (providerKey(row)) byProvider.set(providerKey(row), room);
    const key = roomKey(row);
    byPlace.set(key, [...(byPlace.get(key) || []), room]);
  }
  const seenEvents = new Set();
  for (const event of (Array.isArray(events) ? events : []).slice(0, 5000)) {
    if (!event?.venue || !isCurrentOrUpcomingLiveEvent(event, now) || Number(event.releaseAt || 0) > now
      || !discoverRowMatchesRegion(event, region, { countryForCity })) continue;
    const identity = providerKey(event);
    const candidates = byPlace.get(roomKey(event)) || [];
    let room = identity ? byProvider.get(identity) : candidates.length === 1 ? candidates[0] : null;
    if (!room && identity) {
      const place = placeOf(event);
      if (!isVenuePlaceActionable(place)) continue;
      room = { ...event, id: identity, name: event.venue, place, coord: discoverVenueCoordinate(event), shows: [] };
      rooms.set(identity, room); byProvider.set(identity, room);
    }
    if (!room) continue;
    const eventId = event.id || `${discoverVenueIdentity(event, { countryForCity })}|${event.artist}|${event.date}`;
    if (seenEvents.has(eventId)) continue;
    seenEvents.add(eventId);
    room.shows.push(event);
  }
  const cities = new Map();
  for (const room of rooms.values()) {
    const place = venuePlaceIdentity(room.place);
    if (!cities.has(place.id)) cities.set(place.id, { ...place, venues: [], shows: [] });
    room.shows.sort((a, b) => compareCurrentAndUpcomingLiveEvents(a, b, now));
    const city = cities.get(place.id);
    city.venues.push(room); city.shows.push(...room.shows);
  }
  for (const city of cities.values()) {
    city.venues.sort((a, b) => b.shows.length - a.shows.length || a.name.localeCompare(b.name));
    city.shows.sort((a, b) => compareCurrentAndUpcomingLiveEvents(a, b, now));
    city.mapped = city.venues.filter(row => row.coord).length;
  }
  return [...cities.values()].sort((a, b) => b.shows.length - a.shows.length || b.venues.length - a.venues.length || a.id.localeCompare(b.id));
}

export function filterDiscoverVenueCities(cities, query) {
  const q = norm(query).slice(0, 100);
  return q ? cities.filter(city => norm(`${city.city} ${city.region}`).includes(q)
    || city.venues.some(venue => norm(venue.name).includes(q))) : cities;
}

export function findDiscoverVenueMatch(venues, query) {
  const q = norm(query).slice(0, 100);
  return q ? venues.find(venue => norm(venue.name).includes(q)) || null : null;
}

// Identical Web Mercator projection for the static basemap and client buttons.
// Circular longitude fit handles cities crossing the antimeridian. Returned
// image dimensions stay fixed so responsive scaling cannot move pins off roads.
export function discoverVenueMap(points, width = 640, height = 420) {
  const coords = points.map(discoverVenueCoordinate).filter(Boolean);
  if (!coords.length) return null;
  const x = lng => (lng + 180) / 360;
  const y = lat => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
  const base = x(coords[0].lng);
  const unwrap = lng => base + ((x(lng) - base + 1.5) % 1 - 0.5);
  const xs = coords.map(p => unwrap(p.lng)), ys = coords.map(p => y(p.lat));
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const zoom = Math.max(0, Math.min(14, Math.floor(Math.min(
    Math.log2((width - 100) / (256 * Math.max(.0001, Math.max(...xs) - Math.min(...xs)))),
    Math.log2((height - 100) / (256 * Math.max(.0001, Math.max(...ys) - Math.min(...ys))))))));
  const scale = 256 * 2 ** zoom;
  return { width, height, zoom, center: { lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * cy))) * 180 / Math.PI, lng: ((cx * 360 + 540) % 360) - 180 },
    project: point => ({ x: .5 + (unwrap(point.lng) - cx) * scale / width, y: .5 + (y(point.lat) - cy) * scale / height }) };
}
