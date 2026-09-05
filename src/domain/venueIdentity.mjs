import { slugify } from "./urls.mjs";

// Venue renames are explicit identity decisions, not fuzzy search results. Add
// an alias only when both names are known to describe the same physical room.
const VENUE_ALIAS_GROUPS = Object.freeze([
  Object.freeze({
    // Keep the original persisted key stable. The public/current display name
    // comes from the curated venue catalogue, while aliases let both names
    // resolve to the same historical posts, reviews, shows, and SEO pages.
    canonical: "budweiser stage",
    aliases: Object.freeze(["budweiser stage", "rbc amphitheatre", "rbc amphitheater"]),
  }),
  Object.freeze({
    canonical: "history",
    aliases: Object.freeze(["history", "history toronto"]),
  }),
  Object.freeze({
    canonical: "meo arena",
    aliases: Object.freeze(["meo arena", "altice arena", "pavilhão atlântico", "pavilhao atlantico"]),
  }),
  Object.freeze({
    canonical: "super bock arena",
    aliases: Object.freeze([
      "super bock arena",
      "super bock arena - pavilhão rosa mota",
      "pavilhão rosa mota",
      "pavilhao rosa mota",
    ]),
  }),
  Object.freeze({
    canonical: "riyadh air metropolitano",
    aliases: Object.freeze([
      "riyadh air metropolitano",
      "cívitas metropolitano",
      "civitas metropolitano",
      "wanda metropolitano",
    ]),
  }),
  Object.freeze({
    canonical: "movistar arena madrid",
    aliases: Object.freeze([
      "movistar arena madrid",
      "wizink center",
      "barclaycard center madrid",
      "palacio de deportes de la comunidad de madrid",
    ]),
  }),
  Object.freeze({
    canonical: "spotify camp nou",
    aliases: Object.freeze(["spotify camp nou", "camp nou", "nou camp"]),
  }),
  Object.freeze({
    canonical: "estadio la cartuja",
    aliases: Object.freeze([
      "estadio la cartuja",
      "estadio olímpico de sevilla",
      "estadio olimpico de sevilla",
      "estadio olímpico de la cartuja",
      "estadio olimpico de la cartuja",
    ]),
  }),
  Object.freeze({
    canonical: "the o2 arena",
    aliases: Object.freeze(["the o2 arena", "the o2 london"]),
  }),
  Object.freeze({
    canonical: "ao arena",
    aliases: Object.freeze([
      "ao arena",
      "manchester arena",
      "men arena",
      "phones 4u arena",
    ]),
  }),
  Object.freeze({
    canonical: "ovo hydro",
    aliases: Object.freeze(["ovo hydro", "the ovo hydro", "sse hydro", "the sse hydro"]),
  }),
  Object.freeze({
    canonical: "3arena dublin",
    aliases: Object.freeze(["3arena dublin", "the o2 dublin"]),
  }),
  Object.freeze({
    canonical: "paris la défense arena",
    aliases: Object.freeze(["paris la défense arena", "paris la defense arena", "u arena"]),
  }),
  Object.freeze({
    canonical: "accor arena",
    aliases: Object.freeze([
      "accor arena",
      "accorhotels arena",
      "palais omnisports de paris-bercy",
      "paris-bercy",
    ]),
  }),
  Object.freeze({
    canonical: "groupama stadium",
    aliases: Object.freeze(["groupama stadium", "parc olympique lyonnais"]),
  }),
  Object.freeze({
    canonical: "uber arena",
    aliases: Object.freeze([
      "uber arena",
      "mercedes-benz arena berlin",
      "o2 world berlin",
    ]),
  }),
  Object.freeze({
    canonical: "barclays arena",
    aliases: Object.freeze([
      "barclays arena",
      "barclaycard arena hamburg",
      "o2 world hamburg",
      "color line arena",
    ]),
  }),
  Object.freeze({
    canonical: "merkur spiel-arena",
    aliases: Object.freeze(["merkur spiel-arena", "esprit arena", "ltu arena"]),
  }),
  Object.freeze({
    canonical: "veltins-arena",
    aliases: Object.freeze(["veltins-arena", "arena aufschalke", "arena auf schalke"]),
  }),
  Object.freeze({
    canonical: "stadio san siro",
    aliases: Object.freeze([
      "stadio san siro",
      "san siro",
      "stadio giuseppe meazza",
      "giuseppe meazza",
    ]),
  }),
  Object.freeze({
    canonical: "unipol forum",
    aliases: Object.freeze(["unipol forum", "mediolanum forum", "forum di assago"]),
  }),
  Object.freeze({
    canonical: "inalpi arena",
    aliases: Object.freeze(["inalpi arena", "pala alpitour", "palaolimpico", "palasport olimpico"]),
  }),
  Object.freeze({
    canonical: "johan cruijff arena",
    aliases: Object.freeze([
      "johan cruijff arena",
      "johan cruyff arena",
      "amsterdam arena",
    ]),
  }),
  Object.freeze({
    canonical: "afas dome",
    aliases: Object.freeze([
      "afas dome",
      "sportpaleis antwerpen",
      "antwerps sportpaleis",
      "antwerp sportpaleis",
    ]),
  }),
  Object.freeze({
    canonical: "ing arena",
    aliases: Object.freeze(["ing arena", "palais 12", "paleis 12"]),
  }),
  Object.freeze({
    canonical: "strawberry arena",
    aliases: Object.freeze(["strawberry arena", "friends arena"]),
  }),
  Object.freeze({
    canonical: "3arena stockholm",
    aliases: Object.freeze(["3arena stockholm", "tele2 arena"]),
  }),
  Object.freeze({
    canonical: "unity arena",
    aliases: Object.freeze(["unity arena", "telenor arena"]),
  }),
  Object.freeze({
    canonical: "pge narodowy",
    aliases: Object.freeze([
      "pge narodowy",
      "stadion narodowy",
      "stadion narodowy w warszawie",
      "national stadium warsaw",
    ]),
  }),
  Object.freeze({
    canonical: "o2 arena prague",
    aliases: Object.freeze(["o2 arena prague", "o2 arena praha", "sazka arena"]),
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
