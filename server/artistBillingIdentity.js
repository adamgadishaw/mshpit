import { REVIEWED_ARTIST_IDENTITIES } from "./reviewedArtistIdentities.js";

// Provider billing identities are exact; a keyword in an event title is never
// evidence that the artist performs there (tributes and club nights are common).
export const artistBillingIdentity = (value) => String(value || "").normalize("NFKD")
  .replace(/\p{Mark}+/gu, "").toLocaleLowerCase("en").replace(/&/g, " and ")
  .replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim();

const billingSpelling = (value) => String(value || "").normalize("NFKD")
  .replace(/\p{Mark}+/gu, "").toLocaleLowerCase("en")
  .replace(/[’‘\u0060´]/gu, "'").replace(/[‐‑‒–—−]/gu, "-")
  .replace(/\s+/gu, " ").trim();

const reviewedProviderAliases = new Map();
for (const record of REVIEWED_ARTIST_IDENTITIES) {
  const identity = typeof record?.mbid === "string"
    ? "reviewed:" + record.mbid.toLocaleLowerCase("en")
    : "";
  if (!identity) continue;
  for (const name of [record.name, ...(record.aliases || [])]) {
    const spelling = billingSpelling(name);
    if (spelling) reviewedProviderAliases.set(spelling, identity);
  }
}

// Verified joint attraction, not a general-purpose name splitter. The official
// Live Nation attraction lists both performers:
// https://www.livenation.com/artist/K8vZ917LxIV/usher-raymond-chris-brown-events
const JOINT_ATTRACTIONS = Object.freeze([
  Object.freeze({ id: "K8vZ917LxIV", name: "USHER RAYMOND & CHRIS BROWN", artists: ["Usher", "Chris Brown"] }),
]);

export function canonicalBillingIdentity(value) {
  const identity = artistBillingIdentity(value);
  return identity === "usher raymond" ? "usher" : identity;
}

// Provider spelling is intentionally stricter than search spelling. Common
// Unicode typography stays equivalent and explicitly reviewed aliases share
// one identity, but a terminal mark remains identity-bearing: sports. is not
// the unrelated provider attraction Sports.
export function providerBillingIdentity(value) {
  const spelling = billingSpelling(value);
  if (!spelling) return "";
  const reviewed = reviewedProviderAliases.get(spelling);
  if (reviewed) return reviewed;
  const identity = canonicalBillingIdentity(value);
  const terminalMark = spelling.match(/[.!?]+$/u)?.[0] || "";
  return identity && terminalMark ? identity + "|terminal:" + terminalMark : identity;
}

function jointAttraction(name, id = null) {
  return JOINT_ATTRACTIONS.find((entry) => artistBillingIdentity(entry.name) === artistBillingIdentity(name)
    && (id == null || entry.id === id));
}

export function verifiedJointAttractionIdsForArtist(artist) {
  const identity = canonicalBillingIdentity(artist);
  return JOINT_ATTRACTIONS.filter((entry) => entry.artists.some((name) => canonicalBillingIdentity(name) === identity))
    .map((entry) => entry.id);
}

export function ticketmasterAttractionMatchesArtist(attraction, artist) {
  const expected = providerBillingIdentity(artist);
  if (!expected) return false;
  return providerBillingIdentity(attraction?.name) === expected
    || !!jointAttraction(attraction?.name, attraction?.id || "")?.artists
      .some((name) => providerBillingIdentity(name) === expected);
}

export function ticketmasterBilledArtists(attractions) {
  const names = new Map();
  for (const attraction of (Array.isArray(attractions) ? attractions : []).slice(0, 50)) {
    const name = typeof attraction?.name === "string" ? attraction.name.trim().slice(0, 160) : "";
    if (name) names.set(providerBillingIdentity(name), name);
    for (const individual of jointAttraction(name, attraction?.id || "")?.artists || []) {
      names.set(providerBillingIdentity(individual), individual);
    }
  }
  return [...names.values()].slice(0, 20);
}

export function storedBillingIdentities(source, evidence, billed) {
  if (!evidence || !["ticketmaster", "bandsintown"].includes(source) || typeof billed !== "string" || billed.length > 16_000) return [];
  let names;
  try { names = JSON.parse(billed || "[]"); } catch { return []; }
  if (!Array.isArray(names)) return [];
  const identities = new Set();
  for (const name of names.slice(0, 20)) {
    if (typeof name !== "string" || !name.trim() || name.length > 160) continue;
    identities.add(providerBillingIdentity(name));
    // Retained imports have names, not attraction IDs. Only this exact curated
    // provider billing can be expanded; arbitrary '&' or title matches cannot.
    if (source === "ticketmaster") for (const individual of jointAttraction(name)?.artists || []) {
      identities.add(providerBillingIdentity(individual));
    }
  }
  return [...identities].filter(Boolean);
}

export function storedBillingMatchesArtist(source, evidence, billed, requested) {
  const expected = providerBillingIdentity(requested);
  return !!expected && storedBillingIdentities(source, evidence, billed).includes(expected);
}

// Explicit artist keys predate provider billing evidence. Preserve only the
// missing/blank/empty-array legacy shape; once a supported provider stores a
// lineup, that evidence must affirm the bound artist. Malformed and oversized
// evidence cannot silently regain the legacy exception.
export function storedBillingAllowsArtistBinding(source, evidence, billed, requested) {
  const provider = typeof source === "string" ? source.trim().toLocaleLowerCase("en") : "";
  if (!["ticketmaster", "bandsintown"].includes(provider)) return true;
  if (billed == null || (typeof billed === "string" && !billed.trim())) return true;
  if (typeof billed !== "string" || billed.length > 16_000) return false;
  let names;
  try { names = JSON.parse(billed); } catch { return false; }
  if (!Array.isArray(names)) return false;
  if (!names.length) return true;
  return storedBillingMatchesArtist(provider, evidence, billed, requested);
}
