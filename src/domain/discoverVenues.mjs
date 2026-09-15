import { discoverRowMatchesRegion, discoverVenueIdentity } from "./discoverScene.mjs";
import { isVenuePlaceActionable, venuePlaceIdentity } from "./venueDiscovery.mjs";
import { isCurrentOrUpcomingLiveEvent, compareCurrentAndUpcomingLiveEvents } from "./eventLifecycle.mjs";
import { mapCoordinate } from "./mapCoordinates.mjs";

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
  const coord = mapCoordinate({ lat, lng });
  return coord && Math.abs(coord.lat) <= 85 ? coord : null;
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
  // cx is a normalized world coordinate, not a longitude. Wrap its world
  // copies before converting to degrees; adding 540 here requests a basemap
  // on the opposite side of Earth while leaving the local pin overlay intact.
  const centerLng = ((cx % 1 + 1) % 1) * 360 - 180;
  return { width, height, zoom, center: { lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * cy))) * 180 / Math.PI, lng: centerLng },
    project: point => ({ x: .5 + (unwrap(point.lng) - cx) * scale / width, y: .5 + (y(point.lat) - cy) * scale / height }) };
}

// Group overlapping hit targets at the rendered size, not the static image's
// source dimensions. A group stays at the mean of its real venue positions;
// buttons are never spread into invented geographic locations.
export function clusterDiscoverVenuePins(points, projection, { width = projection?.width, height = projection?.height, diameter = 48 } = {}) {
  if (!Array.isArray(points) || typeof projection?.project !== "function"
    || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0
    || !Number.isFinite(diameter) || diameter <= 0) return [];
  const clusters = [];
  for (const [index, venue] of points.entries()) {
    const coord = discoverVenueCoordinate(venue);
    if (!coord) continue;
    const position = projection.project(coord);
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)
      || position.x < 0 || position.x > 1 || position.y < 0 || position.y > 1) continue;
    clusters.push({ members: [{ index, venue }], sumX: position.x, sumY: position.y });
  }
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < clusters.length && !merged; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        const first = clusters[i], second = clusters[j];
        const dx = Math.abs(first.sumX / first.members.length - second.sumX / second.members.length) * width;
        const dy = Math.abs(first.sumY / first.members.length - second.sumY / second.members.length) * height;
        if (dx >= diameter || dy >= diameter) continue;
        first.members.push(...second.members);
        first.sumX += second.sumX;
        first.sumY += second.sumY;
        clusters.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  return clusters.map(cluster => ({
    venues: cluster.members.sort((a, b) => a.index - b.index).map(member => member.venue),
    position: { x: cluster.sumX / cluster.members.length, y: cluster.sumY / cluster.members.length },
  }));
}
