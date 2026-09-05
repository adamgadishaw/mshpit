import { isUpcomingEventDate } from "./dataPolicy.mjs";
import { discoverRowCountryLabel } from "./discoverScene.mjs";
import { canonicalVenueKey, venueLookupKeys } from "./venueIdentity.mjs";

export const UNIFIED_EVENT_SEARCH_INDEX_LIMIT = 5000;
export const UNIFIED_VENUE_SEARCH_INDEX_LIMIT = 7500;
export const UNIFIED_LOCATION_SEARCH_RESULT_LIMIT = 50;
const EMPTY_ROWS = Object.freeze([]);

const clean = (value, maximum = 240) => typeof value === "string" || typeof value === "number"
  ? String(value).replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, maximum)
  : "";

const normalized = (value) => clean(value, 1000)
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("en")
  .replace(/\s+/g, " ")
  .trim();

const boundedInteger = (value, fallback, maximum) => {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.min(maximum, Math.floor(number)))
    : fallback;
};

const rowsFrom = (value) => Array.isArray(value)
  ? value
  : value && typeof value === "object"
    ? Object.values(value)
    : [];

const rowLocation = (row) => {
  const place = clean(row?.place || row?.city, 240);
  const placeParts = place.split(",").map((part) => part.trim()).filter(Boolean);
  const city = clean(row?.venueCity ?? row?.venue_city ?? placeParts[0], 120);
  const region = clean(row?.venueRegion ?? row?.venue_region, 120);
  const country = discoverRowCountryLabel(row);
  return {
    city,
    region,
    country,
    place: place || [city, region, country].filter(Boolean).join(", "),
  };
};

const billedArtistText = (row) => (Array.isArray(row?.billedArtists)
  ? row.billedArtists.slice(0, 20).map((value) => clean(value, 120)).filter(Boolean).join(" ")
  : "");

const eventSearchText = (row) => {
  const location = rowLocation(row);
  return normalized([
    clean(row?.artist, 160),
    clean(row?.eventName, 200),
    clean(row?.tourName, 200),
    billedArtistText(row),
    clean(row?.venue, 180),
    location.place,
    location.city,
    location.region,
    location.country,
    clean(row?.venueCountry ?? row?.venue_country, 80),
  ].filter(Boolean).join(" "));
};

// Build the expensive text projection only when the canonical event snapshot
// changes. Individual queries then inspect compact strings and stop as soon as
// the already-bounded Search section is full.
export function createUnifiedEventSearchIndex(rows, {
  limit = UNIFIED_EVENT_SEARCH_INDEX_LIMIT,
} = {}) {
  const maximum = boundedInteger(limit, UNIFIED_EVENT_SEARCH_INDEX_LIMIT, UNIFIED_EVENT_SEARCH_INDEX_LIMIT);
  if (!maximum) return [];
  const index = [];
  let inspected = 0;
  for (const row of rowsFrom(rows)) {
    if (inspected >= maximum) break;
    inspected += 1;
    if (!row || typeof row !== "object") continue;
    const searchText = eventSearchText(row);
    if (searchText) index.push({ row, searchText });
  }
  return index;
}

export function searchUnifiedEventIndex(index, query, {
  limit = 24,
} = {}) {
  const needle = normalized(query);
  const maximum = boundedInteger(limit, 24, UNIFIED_LOCATION_SEARCH_RESULT_LIMIT);
  if (!needle || !maximum) return [];
  const matches = [];
  for (const entry of Array.isArray(index) ? index : []) {
    if (!entry?.searchText?.includes(needle) || !entry.row) continue;
    matches.push(entry.row);
    if (matches.length >= maximum) break;
  }
  return matches;
}

const coordinate = (row) => {
  const lat = Number(row?.coord?.lat ?? row?.lat);
  const lng = Number(row?.coord?.lng ?? row?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

const venueSourceIdentity = (row, name, location) => {
  const source = clean(row?.source, 40).toLocaleLowerCase("en");
  const providerVenueId = clean(row?.providerVenueId ?? row?.venue_provider_id, 180);
  if (source && providerVenueId) return `provider:${source}:${normalized(providerVenueId)}`;
  return `venue:${normalized(name)}:${normalized(location.city)}:${normalized(location.country || location.place)}`;
};

const venueMergeIdentity = (name, location) => (
  `venue:${normalized(canonicalVenueKey(name) || name)}:${normalized(location.city)}:${normalized(location.country || location.place)}`
);

const visibleUpcoming = (row, at) => {
  const releaseAt = Number(row?.releaseAt);
  return (!Number.isFinite(releaseAt) || releaseAt <= at) && isUpcomingEventDate(row, at);
};

export function createUnifiedVenueSearchIndex({
  tourDates = EMPTY_ROWS,
  curatedVenues = EMPTY_ROWS,
  catalogVenues = EMPTY_ROWS,
  ratedShows = EMPTY_ROWS,
  now = Date.now(),
  limit = UNIFIED_VENUE_SEARCH_INDEX_LIMIT,
} = {}) {
  const maximum = boundedInteger(limit, UNIFIED_VENUE_SEARCH_INDEX_LIMIT, UNIFIED_VENUE_SEARCH_INDEX_LIMIT);
  if (!maximum) return [];
  const at = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const venues = new Map();
  const anchorTargets = new Map();

  const add = (row, { event = false } = {}) => {
    if (!row || typeof row !== "object" || venues.size >= maximum) return;
    const name = clean(row.name ?? row.venue, 180);
    if (!name) return;
    const location = rowLocation(row);
    const identity = venueSourceIdentity(row, name, location);
    // A curated anchor and a live provider row can describe the same physical
    // room. Provider ids remain distinct; a later static anchor may enrich the
    // first matching provider room but can never collapse two provider venues.
    const mergeIdentity = venueMergeIdentity(name, location);
    const source = clean(row.source, 40) || null;
    const providerVenueId = clean(row.providerVenueId ?? row.venue_provider_id, 180) || null;
    const providerScoped = !!(source && providerVenueId);
    const storageIdentity = providerScoped
      ? identity
      : anchorTargets.get(mergeIdentity) || mergeIdentity;
    const existing = venues.get(storageIdentity);
    // A renamed room keeps its current display name while both current and
    // historical names remain searchable.
    const searchParts = [name, ...venueLookupKeys(name), location.place, location.city, location.region, location.country];
    if (existing) {
      searchParts.forEach((part) => part && existing.searchParts.add(part));
      if (event && visibleUpcoming(row, at)) existing.row.upcoming += 1;
      if (!existing.row.coord) existing.row.coord = coordinate(row);
      if (!existing.row.place && location.place) existing.row.place = location.place;
      if (!existing.row.capacity && Number(row?.capacity) > 0) existing.row.capacity = Number(row.capacity);
      return;
    }
    venues.set(storageIdentity, {
      row: {
        identity,
        name,
        place: location.place,
        coord: coordinate(row),
        source,
        providerVenueId: source && providerVenueId ? providerVenueId : null,
        venueCity: location.city || null,
        venueRegion: location.region || null,
        venueCountryCode: clean(row.venueCountryCode ?? row.venue_country_code, 8).toLocaleUpperCase("en") || null,
        venueCountry: location.country || clean(row.venueCountry ?? row.venue_country, 80) || null,
        capacity: Number(row?.capacity) > 0 ? Number(row.capacity) : null,
        upcoming: event && visibleUpcoming(row, at) ? 1 : 0,
      },
      searchParts: new Set(searchParts.filter(Boolean)),
    });
    if (!anchorTargets.has(mergeIdentity)) anchorTargets.set(mergeIdentity, storageIdentity);
  };

  // Live rows are authoritative and carry the structured provider location.
  // Static catalog rows then fill rooms without dates; rated history fills the
  // final legacy gaps. Every source and the final unique list are bounded.
  for (const row of rowsFrom(tourDates).slice(0, UNIFIED_EVENT_SEARCH_INDEX_LIMIT)) add(row, { event: true });
  for (const row of rowsFrom(curatedVenues).slice(0, maximum)) add(row);
  for (const row of rowsFrom(catalogVenues).slice(0, maximum)) add(row);
  for (const row of rowsFrom(ratedShows).slice(0, maximum)) add(row);

  return [...venues.values()]
    .map(({ row, searchParts }) => ({ row, searchText: normalized([...searchParts].join(" ")) }))
    .sort((left, right) => right.row.upcoming - left.row.upcoming
      || left.row.name.localeCompare(right.row.name)
      || left.row.identity.localeCompare(right.row.identity));
}

const venueIndexByTourDateSnapshot = new WeakMap();

// Store is a legacy monolith with a deliberate hook ceiling. Keep its venue
// index referentially cached here instead: a new canonical tour-date array gets
// one index, while old snapshots can still be garbage-collected.
export function memoizedUnifiedVenueSearchIndex({
  tourDates = EMPTY_ROWS,
  curatedVenues = EMPTY_ROWS,
  catalogVenues = EMPTY_ROWS,
  ratedShows = EMPTY_ROWS,
} = {}) {
  if (!Array.isArray(tourDates)) {
    return createUnifiedVenueSearchIndex({ tourDates, curatedVenues, catalogVenues, ratedShows });
  }
  const cached = venueIndexByTourDateSnapshot.get(tourDates);
  if (cached
    && cached.curatedVenues === curatedVenues
    && cached.catalogVenues === catalogVenues
    && cached.ratedShows === ratedShows) return cached.index;
  const index = createUnifiedVenueSearchIndex({ tourDates, curatedVenues, catalogVenues, ratedShows });
  venueIndexByTourDateSnapshot.set(tourDates, { curatedVenues, catalogVenues, ratedShows, index });
  return index;
}

export function searchUnifiedVenueIndex(index, query, {
  limit = UNIFIED_LOCATION_SEARCH_RESULT_LIMIT,
} = {}) {
  const needle = normalized(query);
  const maximum = boundedInteger(limit, UNIFIED_LOCATION_SEARCH_RESULT_LIMIT, UNIFIED_LOCATION_SEARCH_RESULT_LIMIT);
  if (!needle || !maximum) return [];
  const matches = [];
  for (const entry of Array.isArray(index) ? index : []) {
    if (!entry?.searchText?.includes(needle) || !entry.row) continue;
    matches.push({ ...entry.row });
    if (matches.length >= maximum) break;
  }
  return matches;
}
