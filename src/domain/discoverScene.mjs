import {
  compareCurrentAndUpcomingLiveEvents,
  isCurrentOrUpcomingLiveEvent,
} from "./eventLifecycle.mjs";

const text = (value, max = 180) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max)
  : "";

const COUNTRY_ALIASES = new Map([
  ["ca", "canada"],
  ["can", "canada"],
  ["us", "united states"],
  ["usa", "united states"],
  ["united states of america", "united states"],
  ["gb", "united kingdom"],
  ["gbr", "united kingdom"],
  ["uk", "united kingdom"],
  ["great britain", "united kingdom"],
  ["ie", "ireland"],
  ["irl", "ireland"],
  ["au", "australia"],
  ["aus", "australia"],
  ["nz", "new zealand"],
  ["nzl", "new zealand"],
]);

export function discoverCountryIdentity(value) {
  const normalized = text(value, 80)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  return COUNTRY_ALIASES.get(normalized) || normalized;
}

export function discoverRowCountry(row, { countryForCity } = {}) {
  if (!row || typeof row !== "object") return "";
  const explicit = row.venueCountry
    ?? row.venue_country
    ?? row.venueCountryCode
    ?? row.venue_country_code
    ?? row.country
    ?? row.countryCode
    ?? row.country_code;
  if (text(explicit, 80)) return discoverCountryIdentity(explicit);

  const place = text(row.place, 240);
  const parts = place.split(",").map((part) => part.trim()).filter(Boolean);
  const city = text(row.city || row.venueCity || row.venue_city || parts[0], 120);
  const inferred = typeof countryForCity === "function" ? countryForCity(city) : null;
  if (text(inferred, 80)) return discoverCountryIdentity(inferred);
  return parts.length > 1 ? discoverCountryIdentity(parts.at(-1)) : "";
}

export function discoverRowMatchesRegion(row, region, options = {}) {
  const target = discoverCountryIdentity(region);
  if (!target || target === "worldwide") return true;
  return discoverRowCountry(row, options) === target;
}

export function filterDiscoverSceneRows(rows, { region = "Worldwide", countryForCity, limit = 30 } = {}) {
  const maximum = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : 30;
  if (!maximum) return [];
  const selected = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!discoverRowMatchesRegion(row, region, { countryForCity })) continue;
    selected.push(row);
    if (selected.length >= maximum) break;
  }
  return selected;
}

const eventIdentity = (event) => text(event?.id, 240)
  || [event?.artist, event?.venue, event?.date].map((value) => text(value).toLocaleLowerCase()).join("|");

export function discoverVenueIdentity(event, { countryForCity } = {}) {
  const source = text(event?.source, 40).toLocaleLowerCase();
  const providerVenueId = text(event?.providerVenueId ?? event?.venue_provider_id, 180).toLocaleLowerCase();
  if (source && providerVenueId) return `provider:${source}:${providerVenueId}`;
  const place = text(event?.place, 240);
  const placeParts = place.split(",").map((part) => part.trim()).filter(Boolean);
  const name = text(event?.venue, 160).toLocaleLowerCase();
  const city = text(event?.venueCity ?? event?.venue_city ?? event?.city ?? placeParts[0], 120).toLocaleLowerCase();
  const country = discoverRowCountry(event, { countryForCity });
  return name ? `place:${name}:${city}:${country || place.toLocaleLowerCase()}` : "";
}

const insertBounded = (rows, candidate, compare, maximum) => {
  const index = rows.findIndex((row) => compare(candidate, row) < 0);
  if (index < 0) {
    if (rows.length < maximum) rows.push(candidate);
    return;
  }
  rows.splice(index, 0, candidate);
  if (rows.length > maximum) rows.pop();
};

export function projectDiscoverScene(rows, {
  region = "Worldwide",
  now = Date.now(),
  eventLimit = 12,
  venueLimit = 8,
  countryForCity,
} = {}) {
  const at = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const maxEvents = Number.isFinite(Number(eventLimit)) ? Math.max(0, Math.floor(Number(eventLimit))) : 12;
  const maxVenues = Number.isFinite(Number(venueLimit)) ? Math.max(0, Math.floor(Number(venueLimit))) : 8;
  const events = [];
  const seenEvents = new Set();
  const venues = new Map();
  let eventCount = 0;

  for (const event of Array.isArray(rows) ? rows : []) {
    if (!event || typeof event !== "object" || !discoverRowMatchesRegion(event, region, { countryForCity })) continue;
    const releaseAt = Number(event.releaseAt);
    if (Number.isFinite(releaseAt) && releaseAt > at) continue;
    if (!isCurrentOrUpcomingLiveEvent(event, at)) continue;

    const identity = eventIdentity(event);
    if (!identity || seenEvents.has(identity)) continue;
    seenEvents.add(identity);
    eventCount += 1;
    if (maxEvents) insertBounded(events, event, (left, right) => (
      compareCurrentAndUpcomingLiveEvents(left, right, at)
      || eventIdentity(left).localeCompare(eventIdentity(right))
    ), maxEvents);

    const venueName = text(event.venue, 160);
    if (!venueName) continue;
    const place = text(event.place, 240);
    const venueKey = discoverVenueIdentity(event, { countryForCity });
    if (!venueKey) continue;
    const existing = venues.get(venueKey) || {
      identity: venueKey,
      name: venueName,
      place,
      source: text(event.source, 40) || null,
      providerVenueId: text(event.providerVenueId ?? event.venue_provider_id, 180) || null,
      venueCity: text(event.venueCity ?? event.venue_city, 120) || null,
      venueRegion: text(event.venueRegion ?? event.venue_region, 120) || null,
      venueCountryCode: text(event.venueCountryCode ?? event.venue_country_code, 8).toLocaleUpperCase() || null,
      venueCountry: text(event.venueCountry ?? event.venue_country, 80) || null,
      upcoming: 0,
      nextDate: text(event.date, 40),
    };
    existing.upcoming += 1;
    if (place.length > existing.place.length) existing.place = place;
    if (text(event.date, 40).localeCompare(existing.nextDate) < 0) existing.nextDate = text(event.date, 40);
    venues.set(venueKey, existing);
  }

  const rankedVenues = [];
  if (maxVenues) {
    for (const venue of venues.values()) {
      insertBounded(rankedVenues, venue, (left, right) => (
        right.upcoming - left.upcoming
        || left.nextDate.localeCompare(right.nextDate)
        || left.name.localeCompare(right.name)
      ), maxVenues);
    }
  }

  return {
    events,
    eventCount,
    venues: rankedVenues,
    venueCount: venues.size,
  };
}
