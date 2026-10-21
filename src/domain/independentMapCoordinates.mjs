import { mapCoordinate } from "./mapCoordinates.mjs";
import { independentMapVenueRegistry } from "./independentMapVenueRegistry.mjs";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" ? value.trim() : "";
const normalized = (value) => text(value).normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/gu, " ");
const sourceName = (value) => normalized(value).replace(/[\s_-]/gu, "");
const countryAliases = {
  canada: ["canada", "ca", "can"],
  "united states": ["united states", "united states of america", "us", "usa"],
};
const regionAliases = {
  "canada:ontario": ["ontario", "on", "on."],
  "united states:california": ["california", "ca"],
  "united states:new york": ["new york", "ny"],
};

function qualifiedRegisteredLocality(row, venue) {
  const [city, region, country] = venue.place.split(",").map(normalized);
  const locality = {
    city: new Set([city]),
    region: new Set(regionAliases[`${country}:${region}`] || [region]),
    country: new Set(countryAliases[country] || [country]),
  };
  const structured = {
    city: [row.venueCity, row.city],
    region: [row.venueRegion, row.region],
    country: [row.venueCountryCode, row.countryCode, row.venueCountry, row.country],
  };
  const parts = text(row.place).split(",").map(normalized);
  const placeMatches = parts.length === 3 && locality.city.has(parts[0])
    && locality.region.has(parts[1]) && locality.country.has(parts[2]);
  if (text(row.place) && !placeMatches) return false;
  for (const [key, values] of Object.entries(structured)) {
    if (values.some((value) => value != null && !locality[key].has(normalized(value)))) return false;
  }
  // A bare city or a same-named room with missing regional context is not proof.
  return placeMatches || Object.values(structured).every((values) => values.some((value) => !!text(value)));
}

function sourceUrlMatches(value, source, id) {
  if (!text(value) || !id) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  if (source === "musicbrainz") {
    return url.hostname === "musicbrainz.org" && url.pathname.replace(/\/$/u, "") === `/place/${id}`
      && !url.search;
  }
  if (source !== "wikidata" || !["www.wikidata.org", "wikidata.org"].includes(url.hostname)) return false;
  if (url.pathname === `/wiki/${id}` || url.pathname === `/entity/${id}`) return !url.search;
  return url.pathname === "/w/index.php" && url.searchParams.get("title") === id
    && url.searchParams.getAll("title").length === 1 && url.searchParams.getAll("oldid").length <= 1
    && [...url.searchParams.keys()].every((key) => ["title", "oldid"].includes(key))
    && (!url.searchParams.has("oldid") || /^\d+$/u.test(url.searchParams.get("oldid")));
}

function googleEvidence(row) {
  const evidence = [row, row.coord, row.coordinateProvenance].filter(object);
  return evidence.some((value) => {
    if ([value.source, value.coordinateSource, value.provider].some((source) => sourceName(source).startsWith("google"))) return true;
    const sourceUrl = text(value.sourceUrl);
    if (!sourceUrl) return false;
    let url;
    try { url = new URL(sourceUrl); } catch { return false; }
    return /(^|\.)(google\.[a-z.]+|googleapis\.com)$/iu.test(url.hostname);
  });
}

function matchingSourceIds(row, venue) {
  const assertions = [];
  for (const value of [row, row.coordinateProvenance].filter(object)) {
    const source = sourceName(value.source);
    if (["musicbrainz", "wikidata"].includes(source)) {
      const expected = source === "musicbrainz" ? venue.musicbrainzId : venue.wikidataId;
      const ids = [value.sourceId, value.providerVenueId, value.venue_provider_id].filter((id) => id != null);
      if (ids.some((id) => text(id) !== expected)) return false;
      if (value.sourceUrl != null && !sourceUrlMatches(value.sourceUrl, source, expected)) return false;
      for (const id of ids) assertions.push([source, text(id)]);
    }
  }
  for (const [field, source] of [["musicbrainzPlaceId", "musicbrainz"], ["wikidataId", "wikidata"]]) {
    if (row[field] != null) assertions.push([source, text(row[field])]);
  }
  const stableId = text(row.id).match(/^(musicbrainz|wikidata):(.+)$/iu);
  if (stableId) assertions.push([stableId[1].toLowerCase(), stableId[2]]);
  return assertions.every(([source, id]) => id === (source === "musicbrainz" ? venue.musicbrainzId : venue.wikidataId));
}

/**
 * Return a renderer point only for independently checked registry identities.
 * Caller-supplied source flags, URLs and checked dates cannot expand this list.
 * Legacy coordinates are replaced from the registry, never reclassified as open
 * data. Non-mapped rows remain untouched and should remain available in lists.
 */
export function independentMapPoint(row, { allowCityPrecision = false } = {}) {
  if (!object(row) || googleEvidence(row)) return null;
  const precisions = [row, row.coord, row.coordinateProvenance].filter(object)
    .flatMap((value) => [value.locationPrecision, value.coordinatePrecision])
    .filter((value) => value != null).map(normalized);
  if (precisions.some((value) => !["venue", "building", "city"].includes(value))) return null;
  const cityPrecision = precisions.includes("city");
  if (cityPrecision && !allowCityPrecision) return null;
  const name = normalized(row.name || row.venue);
  const venue = independentMapVenueRegistry.find((entry) => entry.aliases.some((alias) => normalized(alias) === name)
    && qualifiedRegisteredLocality(row, entry));
  if (!venue || !matchingSourceIds(row, venue)) return null;
  const coord = mapCoordinate(venue);
  if (!coord || Math.abs(coord.lat) > 85 || (coord.lat === 0 && coord.lng === 0)) return null;
  const locationPrecision = cityPrecision ? "city" : "venue";
  const coordinateProvenance = Object.freeze({
    source: venue.source, sourceId: venue.sourceId, sourceUrl: venue.sourceUrl,
    checkedAt: venue.checkedAt, coordinateEncoding: venue.coordinateEncoding,
    locationPrecision,
    ...(venue.publishedCoordinate ? { publishedCoordinate: venue.publishedCoordinate } : {}),
    ...(venue.publishedResolutionArcseconds ? { publishedResolutionArcseconds: venue.publishedResolutionArcseconds } : {}),
    ...(venue.coordinateClaim ? { coordinateClaim: venue.coordinateClaim } : {}),
    ...(venue.coordinateReference ? { coordinateReference: venue.coordinateReference } : {}),
    ...(venue.identitySourceUrl ? { identitySourceUrl: venue.identitySourceUrl } : {}),
    ...(venue.recordUpdatedAt ? { recordUpdatedAt: venue.recordUpdatedAt } : {}),
  });
  return {
    ...row, id: row.id ?? row.key ?? venue.id,
    ...coord, coord: Object.freeze(coord), locationPrecision, coordinateProvenance,
  };
}

export function independentMapPoints(rows, options) {
  return Array.isArray(rows) ? rows.map((row) => independentMapPoint(row, options)).filter(Boolean) : [];
}

/** Exact reviewed provider tuple only. This neither binds its venue identity nor
 * substitutes a registry coordinate; callers retain the affected row in lists. */
export function independentProviderCoordinateIssue(row) {
  if (!object(row)) return null;
  const source = sourceName(row.source);
  const ids = [row.providerVenueId, row.venue_provider_id].filter((value) => value != null).map(text);
  const coord = mapCoordinate(row.coord) || mapCoordinate(row);
  if (!source || !ids.length || !coord) return null;
  for (const venue of independentMapVenueRegistry) {
    for (const issue of venue.providerCoordinateConflicts || []) {
      if (source === issue.source && ids.every((id) => id === issue.providerVenueId)
        && coord.lat === issue.lat && coord.lng === issue.lng) return issue;
    }
  }
  return null;
}
