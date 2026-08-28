import { slugify } from "./urls.mjs";

// Venue renames are explicit identity decisions, not fuzzy search results. Add
// an alias only when both names are known to describe the same physical room.
const VENUE_ALIAS_GROUPS = Object.freeze([
  Object.freeze({
    canonical: "budweiser stage",
    aliases: Object.freeze(["budweiser stage", "rbc amphitheatre", "rbc amphitheater"]),
  }),
  Object.freeze({
    canonical: "history",
    aliases: Object.freeze(["history", "history toronto"]),
  }),
]);

export function normalizeVenueKey(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u02bc]/gu, "'")
    .replace(/[\u2010-\u2015]/gu, "-")
    .trim()
    .toLocaleLowerCase("en")
    .replace(/\s+/gu, " ");
}

// Equality fingerprint only: this fixes typography without guessing that two
// merely similar venue names refer to the same room.
export function venueIdentityFingerprint(value) {
  return normalizeVenueKey(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/&/gu, " and ")
    .replace(/['\u2019]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

const aliasGroupByFingerprint = new Map();
for (const group of VENUE_ALIAS_GROUPS) {
  for (const alias of group.aliases) {
    aliasGroupByFingerprint.set(venueIdentityFingerprint(alias), group);
  }
}

export function canonicalVenueKey(value) {
  const normalized = normalizeVenueKey(value);
  if (!normalized) return null;
  return aliasGroupByFingerprint.get(venueIdentityFingerprint(normalized))?.canonical || normalized;
}

function apostropheVariants(value) {
  return value.includes("'") ? [value, value.replace(/'/gu, "\u2019")] : [value];
}

export function venueLookupKeys(value) {
  const canonical = canonicalVenueKey(value);
  if (!canonical) return [];
  const group = aliasGroupByFingerprint.get(venueIdentityFingerprint(canonical));
  const values = [canonical, normalizeVenueKey(value), ...(group?.aliases || [])];
  const out = [];
  const seen = new Set();
  for (const candidate of values.flatMap((entry) => apostropheVariants(normalizeVenueKey(entry)))) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}

export function venueLookupSlugs(value) {
  return [...new Set(venueLookupKeys(value).map(slugify).filter(Boolean))];
}

// Exact canonical matches win. A normalized fallback is accepted only when it
// identifies one catalogue key; punctuation collisions fail closed.
export function resolveVenueCatalogKey(value, catalogKeys) {
  const canonical = canonicalVenueKey(value);
  if (!canonical) return null;
  const keys = Array.isArray(catalogKeys) ? catalogKeys : [];
  const exact = keys.filter((key) => normalizeVenueKey(key) === canonical);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  const target = venueIdentityFingerprint(canonical);
  const matches = keys.filter((key) => venueIdentityFingerprint(canonicalVenueKey(key)) === target);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return null;

  // Historical catalogues inconsistently included a leading "The". Preserve
  // that harmless fallback only when the concrete catalogue proves uniqueness.
  const withoutLeadingThe = (fingerprint) => fingerprint.replace(/^the\s+/u, "");
  const shortTarget = withoutLeadingThe(target);
  const articleMatches = keys.filter((key) =>
    withoutLeadingThe(venueIdentityFingerprint(canonicalVenueKey(key))) === shortTarget);
  return articleMatches.length === 1 ? articleMatches[0] : null;
}

export const VENUE_IDENTITY_ALIASES = VENUE_ALIAS_GROUPS;
