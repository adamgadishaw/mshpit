// Loads whatever the live scraper (scripts/ingest.mjs) produced. Guarded so the
// app still builds if the file hasn't been generated yet.
let data = { artists: {}, venues: {}, shows: [], tourDates: [] };
try {
  // eslint-disable-next-line
  data = require("./catalog.generated.json");
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
