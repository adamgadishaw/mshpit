import { compareCurrentAndUpcomingLiveEvents } from "../src/domain/eventLifecycle.mjs";

const text = value => typeof value === "string" ? value.trim() : "";
const norm = value => text(value).normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
const FIELDS = Object.freeze(["id", "source", "providerEventId", "providerVenueId", "createdBy", "providerActive", "venue", "place",
  "venueCity", "venueRegion", "venueCountry", "venueCountryCode", "lat", "lng", "date", "releaseAt", "eventStatus", "eventEndDate", "eventTimezone",
  "artist", "artistKey", "eventName", "ticketUrl", "locationPrecision", "coordinatePrecision", "coordinateSource", "sourceUrl", "coordinateProvenance", "coord"]);
const COORDINATE_FIELDS = Object.freeze(["lat", "lng", "source", "coordinateSource", "provider", "sourceUrl", "sourceId", "basis", "locationPrecision", "coordinatePrecision"]);
const pick = (value, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));

export function venueMapPreviewEnabled(env = process.env) {
  return env?.NODE_ENV === "development" && env?.MSHPIT_WEB_MAPLIBRE_PREVIEW === "1";
}

function venueKey(row) {
  const source = norm(row.source), provider = text(row.providerVenueId);
  if (source && provider) return `provider:${source}:${provider}`;
  const country = norm(row.venueCountry || row.venueCountryCode), city = norm(row.venueCity);
  const place = norm(row.place);
  return norm(row.venue) && ((city && country) || place.includes(","))
    ? `place:${norm(row.venue)}|${place}|${city}|${norm(row.venueRegion)}|${country}`
    : `event:${text(row.id)}`;
}

/** Allowlisted public fields retained by the map cache, excluding full metadata. */
export function projectVenueMapEvent(row) {
  const projected = pick(row, FIELDS);
  for (const key of ["coord", "coordinateProvenance"]) {
    if (projected[key] && typeof projected[key] === "object" && !Array.isArray(projected[key])) projected[key] = pick(projected[key], COORDINATE_FIELDS);
  }
  return projected;
}

/** Exact existing duplicate-witness identity; caller supplies a projected row. */
export function venueMapPublicEventSignature(row) {
  return `${venueKey(row)}|${witnessKey(row)}`;
}

function witnessKey(row) {
  // Different event ids/dates do not make different coordinate witnesses.
  // Invalid or contradictory origin/locality assertions must still survive.
  return JSON.stringify([row.venue, row.place, row.venueCity, row.venueRegion, row.venueCountry, row.venueCountryCode,
    row.lat, row.lng, row.coord, row.coordinateProvenance, row.locationPrecision, row.coordinatePrecision, row.coordinateSource, row.sourceUrl,
    row.createdBy, row.providerActive, Boolean(text(row.providerEventId)), row.id === `tm_${text(row.providerEventId)}`]);
}

/** Caller supplies a completed public event scan; no private/raw DB rows. */
export function compactVenueMapEvents(publicEvents, { fetchedAt = Date.now(), pages = 1 } = {}) {
  if (!Array.isArray(publicEvents) || publicEvents.some(row => !row || typeof row !== "object" || Array.isArray(row) || !text(row.id))) throw new TypeError("A completed public event array with stable ids is required.");
  const at = typeof fetchedAt === "number" ? fetchedAt : Date.parse(fetchedAt);
  if (!Number.isFinite(at) || !Number.isSafeInteger(pages) || pages < 1) throw new TypeError("A valid public projection timestamp and page count are required.");
  const groups = new Map();
  for (const raw of publicEvents) {
    const row = projectVenueMapEvent(raw), key = venueKey(row);
    if (!groups.has(key)) groups.set(key, { events: 0, witnesses: new Map() });
    const group = groups.get(key), witness = witnessKey(row), prior = group.witnesses.get(witness);
    group.events += 1;
    if (!prior || compareCurrentAndUpcomingLiveEvents(row, prior, at) < 0 || (row.date === prior.date && text(row.id) < text(prior.id))) group.witnesses.set(witness, row);
  }
  const tourDates = [...groups.values()].flatMap(group => [...group.witnesses.values()].map(row => ({ ...row, venueUpcomingCount: group.events })));
  return { tourDates, venueMapCatalogue: true, complete: true, nextCursor: null, eventCount: publicEvents.length, venueCount: groups.size, pages,
    fetchedAt: new Date(at).toISOString(), pipeline: "public-tourdates-venue-map-v1" };
}

/** Sync adapter over the server's already-public cursor projection. No DB IO here. */
export function readCompactVenueMapCatalogue({ readPage, fetchedAt = Date.now() }) {
  if (typeof readPage !== "function") throw new TypeError("A public page reader is required.");
  const events = [], ids = new Map(), cursors = new Set();
  let after = null, pages = 0;
  while (true) {
    const page = readPage({ after });
    if (!page || !Array.isArray(page.rows) || !Object.hasOwn(page, "nextCursor")
      || (page.nextCursor !== null && (typeof page.nextCursor !== "string" || !page.nextCursor))) throw new TypeError("The public venue scan returned an invalid page.");
    pages += 1;
    let added = 0;
    for (const row of page.rows) {
      if (!row || typeof row !== "object" || !text(row.id)) throw new TypeError("The public venue scan returned an event without a stable id.");
      const signature = venueMapPublicEventSignature(projectVenueMapEvent(row));
      if (ids.has(row.id)) {
        if (ids.get(row.id) !== signature) throw new Error("The public venue scan changed an event coordinate witness.");
        continue;
      }
      ids.set(row.id, signature); events.push(row); added += 1;
    }
    if (page.nextCursor === null) return compactVenueMapEvents(events, { fetchedAt, pages });
    if (page.nextCursor === after || cursors.has(page.nextCursor)) throw new Error("The public venue scan repeated a cursor.");
    // tourDateRangePage can consume a filtered raw-scan window and return an
    // empty page whose cursor still advances. That is legitimate progress.
    if (!added && page.rows.length) throw new Error("The public venue scan made no progress.");
    cursors.add(page.nextCursor); after = page.nextCursor;
  }
}
