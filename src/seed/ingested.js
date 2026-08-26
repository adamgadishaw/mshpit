// Mutable demo projections. Production artist/venue metadata is API-owned; the
// generated local catalogue is installed only after StoreProvider's explicit
// development-only dynamic import. This module therefore stays tiny even though
// its lookup helpers are imported by first-load screens.
export const ingestedArtists = {};
export const ingestedVenues = {};
export const ingestedShows = [];
export const ingestedTourDates = [];

const replaceObject = (target, value) => {
  for (const key of Object.keys(target)) delete target[key];
  if (value && typeof value === "object") Object.assign(target, value);
};
const replaceArray = (target, value) => target.splice(0, target.length, ...(Array.isArray(value) ? value : []));

export function installIngestedCatalog({ artists, venues, shows, tourDates } = {}) {
  replaceObject(ingestedArtists, artists);
  replaceObject(ingestedVenues, venues);
  replaceArray(ingestedShows, shows);
  replaceArray(ingestedTourDates, tourDates);
}

const norm = (s) => (s || "").trim().toLowerCase();

// Bundled artist metadata by name, with a flexible match so "King Gizzard"
// finds "King Gizzard & the Lizard Wizard". Do not infer photo rights from this
// lookup: the legacy seed still contains provider artwork and is an explicit
// release-rights gate in APP_STORE_READINESS.md.
export function artistMeta(name) {
  const k = norm(name);
  if (!k) return null;
  if (ingestedArtists[k]) return ingestedArtists[k];
  return Object.values(ingestedArtists).find((a) => {
    const n = norm(a.name);
    return n === k || n.includes(k) || k.includes(n);
  }) || null;
}

// Discographies (3.9 MB across 1633 artists) are deliberately NOT bundled. The
// artist page already prefers the live Deezer discography from
// GET /api/artists/discography, so shipping a second stale copy to every device
// cost every launch a payload that one screen occasionally used. The split file
// scripts/split-catalog.mjs writes stays on disk for tooling; nothing imports it,
// so Metro leaves it out of the bundle.
//
// The trade: offline, on an artist page whose discography has never loaded, the
// RELEASES strip is empty instead of showing stale bundled releases. Everything
// else is unchanged.

// Venue photo pools are also deliberately absent here. They are served one
// venue at a time by GET /api/venues/:key/photos; importing their split JSON from
// any client module would put all 2.1 MB back into Metro's main web entry.
