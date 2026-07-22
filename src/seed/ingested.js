// Loads whatever the live scraper (scripts/ingest.mjs) produced. Guarded so the
// app still builds if the file hasn't been generated yet.
let data = { artists: {}, venues: {}, shows: [], tourDates: [] };
try {
  // eslint-disable-next-line
  data = require("./catalog.core.json");
} catch {}

export const ingestedArtists = data.artists || {};
export const ingestedVenues = data.venues || {};
export const ingestedShows = data.shows || [];
export const ingestedTourDates = data.tourDates || [];

const norm = (s) => (s || "").trim().toLowerCase();

// Real artist metadata (genre + Wikimedia Commons photo) by name, with a
// flexible match so "King Gizzard" finds "King Gizzard & the Lizard Wizard".
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

// Venue photo pools are 2.1 MB across 1008 venues and only a venue page reads
// them. Unlike artist discographies there is no server endpoint serving them,
// so they stay in the bundle but are required on first use: Metro only runs a
// module's factory when it is required, which keeps the allocation out of app
// startup. Function is unchanged, the cost just moves to the screen that needs it.
let venuePhotoData = null;
export function venuePhotoPool(key) {
  if (venuePhotoData === null) {
    try {
      // eslint-disable-next-line
      venuePhotoData = require("./catalog.venue-photos.json") || {};
    } catch {
      venuePhotoData = {};
    }
  }
  return venuePhotoData[key] || null;
}
