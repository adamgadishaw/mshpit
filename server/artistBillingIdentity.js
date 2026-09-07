// Provider billing identities are exact; a keyword in an event title is never
// evidence that the artist performs there (tributes and club nights are common).
export const artistBillingIdentity = (value) => String(value || "").normalize("NFKD")
  .replace(/\p{Mark}+/gu, "").toLocaleLowerCase("en").replace(/&/g, " and ")
  .replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim();

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
  const expected = canonicalBillingIdentity(artist);
  if (!expected) return false;
  return canonicalBillingIdentity(attraction?.name) === expected
    || !!jointAttraction(attraction?.name, attraction?.id || "")?.artists
      .some((name) => canonicalBillingIdentity(name) === expected);
}

export function ticketmasterBilledArtists(attractions) {
  const names = new Map();
  for (const attraction of (Array.isArray(attractions) ? attractions : []).slice(0, 50)) {
    const name = typeof attraction?.name === "string" ? attraction.name.trim().slice(0, 160) : "";
    if (name) names.set(artistBillingIdentity(name), name);
    for (const individual of jointAttraction(name, attraction?.id || "")?.artists || []) {
      names.set(canonicalBillingIdentity(individual), individual);
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
    identities.add(canonicalBillingIdentity(name));
    // Retained imports have names, not attraction IDs. Only this exact curated
    // provider billing can be expanded; arbitrary '&' or title matches cannot.
    if (source === "ticketmaster") for (const individual of jointAttraction(name)?.artists || []) {
      identities.add(canonicalBillingIdentity(individual));
    }
  }
  return [...identities].filter(Boolean);
}

export function storedBillingMatchesArtist(source, evidence, billed, requested) {
  const expected = canonicalBillingIdentity(requested);
  return !!expected && storedBillingIdentities(source, evidence, billed).includes(expected);
}
