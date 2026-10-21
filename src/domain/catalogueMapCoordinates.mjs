import { mapCoordinate } from "./mapCoordinates.mjs";
import { independentMapPoint, independentProviderCoordinateIssue } from "./independentMapCoordinates.mjs";
import { VENUE_IDENTITY_ALIASES, normalizeVenueKey } from "./venueIdentity.mjs";
import { providerCoordinateContextIssue } from "./providerCoordinateContext.mjs";

const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" ? value.trim() : "";
const normalized = (value) => text(value).normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/gu, " ");
const identity = (name, place) => `${normalized(name)}\u0000${normalized(place).replace(/\s*,\s*/gu, ",")}`;
const point = (value) => {
  const coord = mapCoordinate(value);
  return coord && Math.abs(coord.lat) <= 85 && !(coord.lat === 0 && coord.lng === 0) ? coord : null;
};
const googleEvidence = (row) => [row, row.coord, row.coordinateProvenance].filter(object).some((value) => {
  if ([value.source, value.coordinateSource, value.provider].some((source) => normalized(source).replace(/[\s_-]/gu, "").startsWith("google"))) return true;
  try { return /(^|\.)(google\.[a-z.]+|googleapis\.com)$/iu.test(new URL(value.sourceUrl).hostname); } catch { return false; }
});
const venuePrecision = (row) => [row, row.coord, row.coordinateProvenance].filter(object)
  .flatMap((value) => [value.locationPrecision, value.coordinatePrecision]).filter((value) => value != null)
  .every((value) => ["venue", "building"].includes(normalized(value)));
const countryCodes = { canada: ["ca", "can"], "united states": ["us", "usa", "united states of america"], "united kingdom": ["gb", "gbr", "uk", "great britain"],
  portugal: ["pt", "prt"], spain: ["es", "esp"], ireland: ["ie", "irl"], france: ["fr", "fra"], germany: ["de", "deu"],
  italy: ["it", "ita"], netherlands: ["nl", "nld"], belgium: ["be", "bel"], switzerland: ["ch", "che"], austria: ["at", "aut"],
  denmark: ["dk", "dnk"], sweden: ["se", "swe"], norway: ["no", "nor"], finland: ["fi", "fin"], poland: ["pl", "pol"],
  czechia: ["cz", "cze", "czech republic"], australia: ["au", "aus"], "new zealand": ["nz", "nzl"], greece: ["gr", "grc"],
  hungary: ["hu", "hun"], romania: ["ro", "rou"], mexico: ["mx", "mex"], turkey: ["tr", "tur", "türkiye"],
  singapore: ["sg", "sgp"], brazil: ["br", "bra"], argentina: ["ar", "arg"], japan: ["jp", "jpn"],
  "south korea": ["kr", "kor", "korea, republic of"], "south africa": ["za", "zaf"], israel: ["il", "isr"],
  "united arab emirates": ["ae", "are"], thailand: ["th", "tha"], malaysia: ["my", "mys"],
  "hong kong": ["hk", "hkg"], taiwan: ["tw", "twn"], indonesia: ["id", "idn"], philippines: ["ph", "phl"],
  india: ["in", "ind"], chile: ["cl", "chl"], colombia: ["co", "col"], peru: ["pe", "per"],
  luxembourg: ["lu", "lux"], iceland: ["is", "isl"], croatia: ["hr", "hrv"], slovenia: ["si", "svn"],
  slovakia: ["sk", "svk"], serbia: ["rs", "srb"], bulgaria: ["bg", "bgr"], latvia: ["lv", "lva"],
  lithuania: ["lt", "ltu"], estonia: ["ee", "est"], cyprus: ["cy", "cyp"], malta: ["mt", "mlt"] };
const countryAliases = Object.fromEntries(Object.entries(countryCodes).flatMap(([name, aliases]) => [name, ...aliases].map((alias) => [alias, name])));
const country = (value) => countryAliases[normalized(value)] || normalized(value);
const regionAliases = Object.fromEntries("AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|DC:District of Columbia|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming|ON:Ontario|QC:Quebec|BC:British Columbia|AB:Alberta|SK:Saskatchewan|MB:Manitoba|NS:Nova Scotia|NB:New Brunswick|NL:Newfoundland and Labrador|PE:Prince Edward Island|YT:Yukon|NT:Northwest Territories|NU:Nunavut".split("|").map((pair) => pair.split(":").map(normalized)));
const region = (value) => regionAliases[normalized(value).replace(/\.$/u, "")] || normalized(value);
const canadianRegionCodes = new Set(["on", "qc", "bc", "ab", "sk", "mb", "ns", "nb", "nl", "pe", "yt", "nt", "nu"]);
const canadianRegions = Object.fromEntries(Object.entries(regionAliases).filter(([code]) => canadianRegionCodes.has(code)));
const americanRegions = Object.fromEntries(Object.entries(regionAliases).filter(([code]) => !canadianRegionCodes.has(code)));
const providerRegionAliases = (row) => {
  const code = country(row.venueCountryCode || row.venueCountry || row.country || text(row.place).split(",").at(-1));
  return code === "canada" ? canadianRegions : code === "united states" ? americanRegions : {};
};
const providerRegion = (value, row) => providerRegionAliases(row)[normalized(value).replace(/\.$/u, "")] || normalized(value);
const conflictingLocality = (row, registered) => {
  const places = (registered.coordinateIdentityPlaces || [registered.place]).map((place) => place.split(",").map(normalized));
  const cities = new Set(places.map((parts) => parts[0]));
  const regions = new Set(places.filter((parts) => parts.length > 2).map((parts) => region(parts.slice(1, -1).join(", "))));
  const countries = new Set(places.map((parts) => country(parts.at(-1))));
  return [row.city, row.venueCity].some((value) => value != null && !cities.has(normalized(value)))
    || [row.region, row.venueRegion].some((value) => value != null && !regions.has(region(value)))
    || [row.country, row.venueCountry, row.countryCode, row.venueCountryCode].some((value) => value != null && !countries.has(country(value)));
};

// This is a conservative session freshness policy, not a provider contract term.
export const TICKETMASTER_WITNESS_MAX_AGE_MS = 60 * 60 * 1000;
const instant = (value) => typeof value === "number" ? value : (typeof value === "string" ? Date.parse(value) : NaN);
const clock = (value) => instant(typeof value === "function" ? value() : (value ?? Date.now()));
const providerKey = (row) => normalized(row.source) === "ticketmaster" && text(row.providerVenueId)
  ? `ticketmaster:${text(row.providerVenueId)}` : null;
const ticketmasterHosts = ["com", "ca", "co.uk", "ie", "de", "fr", "es", "nl", "be", "se", "dk", "no", "fi", "at", "ch", "it", "pl", "cz", "com.au", "co.nz", "co.za", "ae", "sg", "com.mx", "co.il", "cl"].map((suffix) => `ticketmaster.${suffix}`);
const safeTicketmasterUrl = (value) => {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password && !url.port
      && ticketmasterHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return url.href;
  } catch { /* A source action must not promote an arbitrary provider URL. */ }
  return "https://www.ticketmaster.com/";
};
const providerIdentity = (row) => {
  const parts = text(row.place).split(",").map(normalized).filter(Boolean);
  return identity(row.name || row.venue, [parts[0], ...parts.slice(1, -1).map((value) => providerRegion(value, row)), country(parts.at(-1))].join(", "));
};
const providerPlaceParts = (event) => {
  const place = normalized(event.place).replace(/\s*,\s*/gu, ",");
  const prefix = `${normalized(event.venueCity).replace(/\s*,\s*/gu, ",")},`;
  const suffix = `,${normalized(event.venueCountry)}`;
  return place.startsWith(prefix) && place.endsWith(suffix)
    ? { middle: place.slice(prefix.length, place.length - suffix.length).replace(/^,+|,+$/gu, "") } : null;
};
const validProviderLocality = (event) => {
  const context = providerPlaceParts(event);
  if (!context || !/^[A-Z]{2}$/iu.test(text(event.venueCountryCode))) return false;
  const code = countryAliases[normalized(event.venueCountryCode)], name = countryAliases[normalized(event.venueCountry)];
  if (code && name && code !== name) return false;
  if (!text(event.venueRegion)) return true;
  const rawRegion = normalized(event.venueRegion);
  return providerRegion(rawRegion, event) === providerRegion(context.middle, event)
    || (!providerRegionAliases(event)[rawRegion] && /^[a-z0-9-]{1,5}$/iu.test(rawRegion));
};
const matchesProviderLocality = (row, event) => {
  const context = providerPlaceParts(event);
  const cities = new Set([normalized(event.venueCity)]);
  const regions = new Set([providerRegion(event.venueRegion, event), providerRegion(context?.middle, event)]);
  const countries = new Set([country(event.venueCountry), country(event.venueCountryCode)]);
  return ![row.city, row.venueCity].some((value) => value != null && !cities.has(normalized(value)))
    && ![row.region, row.venueRegion].some((value) => value != null && !regions.has(providerRegion(value, event)))
    && ![row.country, row.venueCountry, row.countryCode, row.venueCountryCode].some((value) => value != null && !countries.has(country(value)));
};
const matchesProviderIdentity = (row, event) => {
  if (normalized(row.name || row.venue) !== normalized(event.venue)) return false;
  const target = providerIdentity(row);
  if (target === providerIdentity(event)) return true;
  const context = providerPlaceParts(event);
  if (!context) return false;
  // The display catalogue may use the exact code/name pair carried by this
  // source snapshot. It cannot introduce an arbitrary region or country alias.
  for (const regionLabel of new Set([text(event.venueRegion), context.middle])) {
    for (const countryLabel of new Set([text(event.venueCountry), text(event.venueCountryCode)])) {
      const place = [text(event.venueCity), regionLabel, countryLabel].filter(Boolean).join(", ");
      if (target === providerIdentity({ ...event, place })) return true;
    }
  }
  return false;
};
const providerIdentityVariants = (event) => {
  const variants = new Set([providerIdentity(event)]), context = providerPlaceParts(event);
  if (!context) return variants;
  for (const regionLabel of new Set([text(event.venueRegion), context.middle])) {
    for (const countryLabel of new Set([text(event.venueCountry), text(event.venueCountryCode)])) {
      const place = [text(event.venueCity), regionLabel, countryLabel].filter(Boolean).join(", ");
      variants.add(providerIdentity({ ...event, place }));
    }
  }
  return variants;
};
const absent = (value) => value == null || (typeof value === "string" && !value.trim());
const conflictingTicketmasterIds = (row) => normalized(row.source) === "ticketmaster"
  && !absent(row.providerVenueId) && !absent(row.venue_provider_id) && text(row.providerVenueId) !== text(row.venue_provider_id);
const reviewedProviderCoordinateIssue = (row) => independentProviderCoordinateIssue(row)
  || independentProviderCoordinateIssue({ ...row, coord: undefined });
const noProviderIdentity = (row) => [row.providerVenueId, row.venue_provider_id].every(absent)
  && (row.providerIdentities == null || (Array.isArray(row.providerIdentities) && row.providerIdentities.length === 0));
const canadianProvinceNames = new Set(Object.values(canadianRegions));
// The static McPherson batch tuple (48.428834,-123.366627) and the published
// KovZpaCJje tuple (48.4230937,-123.3611373) disagree. Do not newly transfer the
// batch point to its zero-point provider card without resolving that evidence.
const canadianAliasPointConflicts = new Set(["mcpherson playhouse"]);
const canadianEligibleIdentity = (name, place) => {
  const parts = text(place).split(",").map(normalized);
  return parts.length === 3 && parts[0] && country(parts[2]) === "canada" && canadianProvinceNames.has(region(parts[1]))
    ? identity(normalizeVenueKey(name), `${parts[0]}, ${region(parts[1])}, canada`) : null;
};
const catalogueNames = (name) => {
  const group = VENUE_IDENTITY_ALIASES.find((entry) => [entry.canonical, ...entry.aliases].some((alias) => normalized(alias) === normalized(name)));
  return [...new Set([name, ...(group?.aliases || [])])];
};
function providerIdentityIndex(events) {
  const index = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    const key = object(event) && providerKey(event);
    // Invalid/missing/conflicting points still occupy their qualified source
    // identities. A different provider ID cannot disappear to create a donor.
    if (!key || !validProviderWitnessIdentity(event)) continue;
    for (const variant of providerIdentityVariants(event)) {
      if (!index.has(variant)) index.set(variant, new Set());
      index.get(variant).add(key);
    }
  }
  return index;
}
function uniqueProviderWitness(row, names, index, providerRegistry) {
  const keys = new Set(names.flatMap((name) => [...(index.get(providerIdentity({ ...row, name })) || [])]));
  const witness = keys.size === 1 ? providerRegistry.get(keys.values().next().value) : null;
  if (!witness) return null;
  for (const name of names) {
    const event = witness.eventsByName.get(normalized(name));
    if (event && matchesProviderIdentity({ ...row, name: event.venue }, event) && matchesProviderLocality(row, event)
      && (row.providerEventId == null || witness.eventIds.has(text(row.providerEventId)))) return { witness, event };
  }
  return null;
}
function pendingCatalogueIndex(rows) {
  const index = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!object(row) || !["uncertain", "missing"].includes(row.coordinateEligibility)
      || !text(row.id) || !text(row.name) || !text(row.place).includes(",") || googleEvidence(row) || !venuePrecision(row)) continue;
    const key = identity(row.name, row.place);
    if (index.has(key) && index.get(key)?.id !== row.id) index.set(key, null);
    else if (!index.has(key)) index.set(key, row);
  }
  return index;
}
function matchesPendingCatalogueRow(row, registered) {
  return registered && row.id === registered.id && row.key === registered.key
    && row.coordinateEligibility === registered.coordinateEligibility
    && (row.mapCoordinateInput == null || row.mapCoordinateInput === "catalogue")
    && noProviderIdentity(row) && absent(row.providerEventId) && absent(row.source)
    && absent(row.coordinateSource) && absent(row.provider)
    && absent(row.sourceId) && absent(row.sourceUrl) && absent(row.musicbrainzPlaceId) && absent(row.wikidataId)
    && row.coordinateProvenance == null && !conflictingLocality(row, registered);
}
function projectProviderWitness(row, match, resolveDirect, requirePointAgreement = false) {
  if (!match) return null;
  const trusted = resolveDirect(match.event), existing = point(row);
  if (trusted?.coordinateProvenance.basis !== "provider-event-witness"
    || (requirePointAgreement && (!existing || existing.lat !== trusted.coord.lat || existing.lng !== trusted.coord.lng))) return null;
  return { ...row, ...trusted.coord, coord: trusted.coord, locationPrecision: "venue", coordinateProvenance: trusted.coordinateProvenance };
}

const validProviderWitnessIdentity = (event) => object(event) && providerKey(event) && event.createdBy === "import" && text(event.providerEventId)
  && event.id === `tm_${text(event.providerEventId)}` && text(event.venue)
  && text(event.venueCity) && text(event.venueCountry) && text(event.venueCountryCode)
  && text(event.place).includes(",") && venuePrecision(event) && !googleEvidence(event)
  && !conflictingTicketmasterIds(event) && validProviderLocality(event);

function ticketmasterWitnessRegistry({ providerEvents = [], providerFetchedAt, now } = {}) {
  const registry = new Map(), fetchedAt = instant(providerFetchedAt), at = clock(now);
  if (!Number.isFinite(fetchedAt) || !Number.isFinite(at) || fetchedAt > at || at - fetchedAt > TICKETMASTER_WITNESS_MAX_AGE_MS) return registry;
  for (const event of Array.isArray(providerEvents) ? providerEvents : []) {
    const key = object(event) && providerKey(event);
    if (!key || !validProviderWitnessIdentity(event) || !point(event)
      || providerCoordinateContextIssue(event) || reviewedProviderCoordinateIssue(event)) continue;
    const signature = `${providerIdentity({ ...event, name: "", venue: "" })}\u0000${event.lat}\u0000${event.lng}`;
    const prior = registry.get(key);
    // Conflicting witnesses never pick whichever event happened to load first.
    if (registry.has(key) && (!prior || prior.signature !== signature)) { registry.set(key, null); continue; }
    if (!registry.has(key)) registry.set(key, { event, signature, fetchedAt, eventIds: new Set([event.providerEventId]),
      eventsByName: new Map([[normalized(event.venue), event]]) });
    else if (prior) {
      prior.eventIds.add(event.providerEventId);
      if (!prior.eventsByName.has(normalized(event.venue))) prior.eventsByName.set(normalized(event.venue), event);
    }
  }
  return registry;
}
const unverifiedRecordAssertion = (row, registered) => {
  if (row.musicbrainzPlaceId != null || row.wikidataId != null || /^(musicbrainz|wikidata):/iu.test(text(row.id))) return true;
  return [row, row.coordinateProvenance].filter(object).some((value) => {
    if (!["musicbrainz", "wikidata"].includes(normalized(value.source).replace(/[\s_-]/gu, ""))) return false;
    return [value.sourceId, value.providerVenueId, value.venue_provider_id].some((id) => id != null)
      || (value.sourceUrl != null && value.sourceUrl !== registered.coordinateProvenance.sourceUrl);
  });
};

/**
 * trustedCatalogueRows must be the first-party generated projection, never a
 * caller's API/provider assertions. Index once for O(n) catalogue resolution.
 * The projected source point overrides legacy values without relabelling them.
 */
export function createCatalogueMapResolver(trustedCatalogueRows, options = {}) {
  const registry = new Map(), canadianRegistry = new Map();
  const providerRegistry = ticketmasterWitnessRegistry(options);
  const providerIdentityKeys = providerIdentityIndex(options.providerEvents);
  const pendingCatalogue = pendingCatalogueIndex(trustedCatalogueRows);
  for (const row of Array.isArray(trustedCatalogueRows) ? trustedCatalogueRows : []) {
    if (!object(row) || row.coordinateEligibility !== "eligible" || !point(row.mapCoordinate)
      || !object(row.coordinateProvenance) || !["ingestion-batch", "individually-verified"].includes(row.coordinateProvenance.basis)) continue;
    for (const place of row.coordinateIdentityPlaces || [row.place]) {
      if (!text(row.name) || !text(place) || !String(place).includes(",")) continue;
      const key = identity(row.name, place);
      if (registry.has(key) && registry.get(key)?.id !== row.id) registry.set(key, null);
      else if (!registry.has(key)) registry.set(key, row);
      if (row.coordinateProvenance.basis !== "ingestion-batch" || canadianAliasPointConflicts.has(row.id)) continue;
      for (const name of catalogueNames(row.name)) {
        const aliasKey = canadianEligibleIdentity(name, place);
        if (!aliasKey) continue;
        if (canadianRegistry.has(aliasKey) && canadianRegistry.get(aliasKey)?.id !== row.id) canadianRegistry.set(aliasKey, null);
        else if (!canadianRegistry.has(aliasKey)) canadianRegistry.set(aliasKey, row);
      }
    }
  }
  const resolveDirect = (row) => {
    if (!object(row) || googleEvidence(row) || !venuePrecision(row) || conflictingTicketmasterIds(row) || reviewedProviderCoordinateIssue(row)) return null;
    const verified = independentMapPoint(row);
    if (verified) return { ...verified, coordinateProvenance: Object.freeze({ ...verified.coordinateProvenance, basis: "individually-verified", perRecordVerified: true }) };
    const place = text(row.place) || [row.venueCity ?? row.city, row.venueRegion ?? row.region, row.venueCountry ?? row.country].map(text).filter(Boolean).join(", ");
    const key = identity(row.name || row.venue, place);
    // Recover only missing-point Canadian import cards from an already eligible
    // first-party source. This does not copy another provider room's point or
    // replace a valid published provider point through a new alias rule.
    const missingCanadianProviderPoint = normalized(row.source) === "ticketmaster" && row.createdBy === "import"
      && row.mapCoordinateInput === "event" && providerKey(row) && !point(row) && !point(row.coord);
    const registered = registry.has(key) ? registry.get(key)
      : missingCanadianProviderPoint ? canadianRegistry.get(canadianEligibleIdentity(row.name || row.venue, place)) : null;
    if (registered?.coordinateProvenance.basis === "individually-verified") return null;
    if (registered && !conflictingLocality(row, registered) && !unverifiedRecordAssertion(row, registered)) {
      const coord = Object.freeze({ ...registered.mapCoordinate });
      return { ...row, id: row.id ?? row.key ?? registered.id, ...coord, coord,
        locationPrecision: "venue", coordinateProvenance: Object.freeze({ ...registered.coordinateProvenance }) };
    }
    const witness = providerRegistry.get(providerKey(row));
    const sourceEvent = witness?.eventsByName.get(normalized(row.name || row.venue));
    const at = clock(options.now);
    if (!witness || !sourceEvent || !matchesProviderIdentity(row, sourceEvent)
      || !Number.isFinite(at) || at < witness.fetchedAt || at - witness.fetchedAt > TICKETMASTER_WITNESS_MAX_AGE_MS
      || !matchesProviderLocality(row, sourceEvent)
      || (row.providerEventId != null && !witness.eventIds.has(text(row.providerEventId)))) return null;
    const coord = Object.freeze(point(sourceEvent));
    return { ...row, id: row.id ?? row.key ?? providerKey(sourceEvent), ...coord, coord, locationPrecision: "venue",
      coordinateProvenance: Object.freeze({ source: "Ticketmaster", basis: "provider-event-witness", perRecordVerified: false,
        providerVenueId: sourceEvent.providerVenueId, providerEventId: sourceEvent.providerEventId,
        sourceUrl: safeTicketmasterUrl(sourceEvent.ticketUrl), attribution: "Venue location supplied by Ticketmaster",
        catalogueRetrievedAt: new Date(witness.fetchedAt).toISOString(),
        expiresAt: new Date(witness.fetchedAt + TICKETMASTER_WITNESS_MAX_AGE_MS).toISOString(),
        coordinateEncoding: "provider-decimal", locationPrecision: "venue" }) };
  };
  return (row) => {
    const direct = resolveDirect(row);
    if (direct || !object(row) || googleEvidence(row) || !venuePrecision(row) || conflictingTicketmasterIds(row) || reviewedProviderCoordinateIssue(row)) return direct;
    // A legacy import event can have lost its namespaced IDs. Reconcile only
    // its exact qualified identity and already valid, exactly agreeing point.
    // Search-index coordinates/source labels cannot enter through this seam.
    if (normalized(row.source) === "ticketmaster" && row.createdBy === "import" && row.mapCoordinateInput === "event"
      && normalized(row.name || row.venue) === normalized(row.venue || row.name) && noProviderIdentity(row) && point(row)) {
      const match = uniqueProviderWitness(row, [row.name || row.venue], providerIdentityKeys, providerRegistry);
      const projected = projectProviderWitness(row, match, resolveDirect, true);
      if (projected) return projected;
    }
    // Only an exact first-party catalogue registration can use this lookup.
    // The old curated coordinate is ignored; provenance cites the fresh source
    // witness, whose qualified identity still cannot guarantee point accuracy.
    const registered = pendingCatalogue.get(identity(row.name || row.venue, row.place));
    if (matchesPendingCatalogueRow(row, registered)) {
      const match = uniqueProviderWitness(row, catalogueNames(registered.name), providerIdentityKeys, providerRegistry);
      const projected = projectProviderWitness(row, match, resolveDirect);
      if (projected) return projected;
    }
    const identities = new Set(Array.isArray(row.providerIdentities) ? row.providerIdentities : []);
    if (identities.size !== 1 || !Array.isArray(row.mapCoordinateCandidates)) return null;
    const candidates = [];
    for (const candidate of row.mapCoordinateCandidates) {
      const key = object(candidate) && providerKey(candidate);
      const witness = providerRegistry.get(key);
      const sourceEvent = witness?.eventsByName.get(normalized(row.name || row.venue));
      if (!key || !identities.has(`provider:${key}`) || candidate.mapCoordinateInput !== "event"
        || !sourceEvent || !matchesProviderIdentity(row, sourceEvent) || !matchesProviderLocality(row, sourceEvent)) continue;
      const resolved = resolveDirect(candidate);
      if (resolved?.coordinateProvenance.basis === "provider-event-witness") candidates.push(resolved);
    }
    if (!candidates.length || new Set(candidates.map((value) => `${value.coord.lat},${value.coord.lng}`)).size !== 1) return null;
    const trusted = candidates[0];
    return { ...row, ...trusted.coord, coord: trusted.coord, locationPrecision: "venue", coordinateProvenance: trusted.coordinateProvenance };
  };
}

export function catalogueMapPoints(rows, trustedCatalogueRows, options) {
  const resolve = createCatalogueMapResolver(trustedCatalogueRows, options);
  return Array.isArray(rows) ? rows.map(resolve).filter(Boolean) : [];
}
