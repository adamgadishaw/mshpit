import { mapCoordinate } from "./mapCoordinates.mjs";
import { discoverRowCountryLabel, discoverRowMatchesRegion } from "./discoverScene.mjs";
import { venuePlaceIdentity } from "./venueDiscovery.mjs";
import { canonicalVenueKey } from "./venueIdentity.mjs";
import { createLiveEventEvaluator, compareCurrentAndUpcomingLiveEvents } from "./eventLifecycle.mjs";

const text = value => typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
const normalized = value => text(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
const asRows = value => Array.isArray(value)
  ? value.map(row => ({ row: row?.row || row, catalogueKey: row?.catalogueKey || row?.row?.catalogueKey || "" }))
  : value && typeof value === "object"
    ? Object.entries(value).map(([catalogueKey, row]) => ({ row: row?.row || row, catalogueKey }))
    : [];

function locality(row) {
  const originalPlace = text(row?.place);
  const parts = originalPlace.split(",").map(text).filter(Boolean);
  const city = text(row?.venueCity || row?.venue_city || row?.city || parts[0]);
  const cityParts = city.split(",").map(text).filter(Boolean);
  // Some provider city labels already include a postal/street component. Only
  // an exact source-backed prefix can consume it; never infer a new city name.
  const qualifiedCityPrefix = cityParts.length > 1 && parts.length > cityParts.length
    && cityParts.every((part, index) => normalized(part) === normalized(parts[index]));
  const country = discoverRowCountryLabel(row);
  const explicitRegion = text(row?.venueRegion || row?.venue_region || row?.region);
  const regionStart = qualifiedCityPrefix ? cityParts.length : 1;
  const region = explicitRegion || (parts.length > regionStart + 1 ? parts.slice(regionStart, -1).join(", ") : "");
  const place = qualifiedCityPrefix && discoverRowCountryLabel({ place: originalPlace }) ? originalPlace
    : city && country ? [city, region, country].filter(Boolean).join(", ") : originalPlace || city;
  return { city, region, country, place, id: venuePlaceIdentity(place).id };
}

function providerIdentity(row) {
  const source = text(row?.source).toLowerCase();
  // Provider ids are opaque and case-sensitive, including Ticketmaster's.
  const providerId = text(row?.providerVenueId || row?.venue_provider_id);
  return source && providerId ? `provider:${source}:${providerId}` : null;
}

function roomIdentity(row, place) {
  if (!place.city || !place.country) return null;
  return `${normalized(canonicalVenueKey(row?.name || row?.venue) || row?.name || row?.venue)}|${normalized(place.place)}`;
}

function candidate(row, catalogueKey = "") {
  const name = text(row?.name || row?.venue);
  if (!name) return null;
  const place = locality(row);
  // A normalized coordinate is a validity result, never a source/license claim.
  // Keep each original coordinate witness together with its own provenance.
  return {
    ...row,
    ...(catalogueKey ? { catalogueKey } : {}),
    name,
    place: place.place,
    coord: mapCoordinate(row?.coord || { lat: row?.lat ?? row?.venueLat, lng: row?.lng ?? row?.venueLng }),
    venueCity: text(row?.venueCity || row?.venue_city) || place.city || null,
    venueRegion: text(row?.venueRegion || row?.venue_region) || place.region || null,
    venueCountry: text(row?.venueCountry || row?.venue_country) || place.country || null,
  };
}

/**
 * Complete catalogue projection for the lazy web map. No input/result slicing.
 * Coordinate source eligibility belongs to the separate provenance boundary.
 * Distinct provider rooms never collapse through name/location similarity.
 */
export function buildVenueMapCatalogue({ catalogueVenues = [], venueDirectoryIndex = [], tourDates = [], now = Date.now() } = {}) {
  const rooms = new Map(), byProvider = new Map(), byPlace = new Map();
  const staticRows = [
    ...asRows(catalogueVenues).map(entry => ({ ...entry, inputKind: "catalogue" })),
    ...asRows(venueDirectoryIndex).map(entry => ({ ...entry, inputKind: "index" })),
  ];
  const events = Array.isArray(tourDates) ? tourDates : [];
  const evaluator = createLiveEventEvaluator(now);
  const providerCounts = new Map();
  for (const { row } of [...staticRows, ...events.map(row => ({ row }))]) {
    const provider = providerIdentity(row), key = roomIdentity(row, locality(row));
    if (!provider || !key) continue;
    if (!providerCounts.has(key)) providerCounts.set(key, new Set());
    providerCounts.get(key).add(provider);
  }

  function register(input, { event = false, catalogueKey = "", inputKind = "catalogue" } = {}) {
    const normalizedRow = candidate(input, catalogueKey);
    if (!normalizedRow) return null;
    // This describes the local input path, not the coordinate's upstream origin.
    // In particular the old search index can merge coordinate/source fields.
    const row = { ...normalizedRow, mapCoordinateInput: inputKind };
    const place = locality(row), key = roomIdentity(row, place), provider = providerIdentity(row);
    const explicitId = !event ? text(row.identity || row.id) : "";
    const explicitMatch = explicitId ? rooms.get(explicitId) : null;
    let room = provider ? byProvider.get(provider)
      : explicitMatch && key && roomIdentity(explicitMatch.row, locality(explicitMatch.row)) === key ? explicitMatch : null;
    const placeRooms = key ? [...(byPlace.get(key) || [])] : [];
    // A static source can enrich one unambiguous physical room. It cannot join
    // two provider identities or guess from a city-only/name-only label.
    if (!room && placeRooms.length === 1) {
      const match = placeRooms[0];
      if (!provider || (!match.providers.size && providerCounts.get(key)?.size === 1) || match.providers.has(provider)) room = match;
    }
    if (!room) {
      const fallback = `venue:${normalized(row.name)}|${normalized(row.place)}`;
      const baseId = provider || explicitId || (catalogueKey ? `catalogue:${catalogueKey}` : fallback);
      let id = baseId, suffix = 1;
      // An ID collision is not proof that two differently located rooms agree.
      while (rooms.has(id)) id = `${baseId}:${++suffix}`;
      room = { row: { ...row, id, identity: provider || text(row.identity) || id, cityId: place.id, shows: [] }, providers: new Set(), witnesses: [], catalogueKeys: new Set() };
      rooms.set(id, room);
      if (key) {
        if (!byPlace.has(key)) byPlace.set(key, new Set());
        byPlace.get(key).add(room);
      }
    }
    if (provider) { room.providers.add(provider); byProvider.set(provider, room); }
    const upcoming = Number(row.venueUpcomingCount);
    if (Number.isSafeInteger(upcoming) && upcoming >= 0) room.row.venueUpcomingCount = Math.max(Number(room.row.venueUpcomingCount) || 0, upcoming);
    if (catalogueKey) room.catalogueKeys.add(catalogueKey);
    // Do not rewrite the primary coordinate's source with a merged provider's
    // label. Consumers can evaluate each witness without combining its claims.
    const { shows: ignoredShows, mapCoordinateCandidates: ignoredCandidates, ...witness } = row;
    room.witnesses.push(witness);
    return room;
  }

  for (const entry of staticRows) register(entry.row, { catalogueKey: entry.catalogueKey, inputKind: entry.inputKind });
  const seenEvents = new Set();
  for (const event of events) {
    if (!event?.venue || !evaluator.isCurrentOrUpcoming(event) || Number(event.releaseAt || 0) > now) continue;
    const eventKey = `${normalized(event.source)}|${text(event.id) || `${text(event.artist)}|${text(event.venue)}|${text(event.place)}|${text(event.date)}`}`;
    if (seenEvents.has(eventKey)) continue;
    seenEvents.add(eventKey);
    const room = register(event, { event: true, inputKind: "event" });
    room?.row.shows.push(event);
  }
  const compare = new Intl.Collator().compare;
  return [...rooms.values()].map(room => {
    room.row.shows.sort((a, b) => compareCurrentAndUpcomingLiveEvents(a, b, now));
    return { ...room.row, venueUpcomingCount: Math.max(Number(room.row.venueUpcomingCount) || 0, room.row.shows.length), mapCoordinateCandidates: room.witnesses, providerIdentities: [...room.providers], catalogueKeys: [...room.catalogueKeys] };
  }).sort((a, b) => b.shows.length - a.shows.length || compare(a.name, b.name) || compare(a.place, b.place) || compare(a.id, b.id));
}

export function filterVenueMapCatalogue(rows, { query = "", cityId = null, region = "Worldwide" } = {}) {
  const needle = normalized(query);
  return (Array.isArray(rows) ? rows : []).filter(row => (!cityId || row.cityId === cityId)
    && discoverRowMatchesRegion(row, region)
    && (!needle || normalized(`${row.name} ${row.place}`).includes(needle)));
}

export function venueMapCatalogueCities(rows = []) {
  const cities = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const place = venuePlaceIdentity(row.place);
    if (!cities.has(place.id)) cities.set(place.id, { ...place, venues: [], shows: [] });
    const city = cities.get(place.id);
    city.venues.push(row); city.shows.push(...row.shows);
  }
  return [...cities.values()].sort((a, b) => b.venues.length - a.venues.length || a.id.localeCompare(b.id));
}
