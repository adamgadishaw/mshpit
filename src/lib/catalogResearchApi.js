import { api } from "./api";

// Reads the sourced summary the research agent wrote for a page. Resolves to
// the research object, or null when the page has none yet; request failures
// throw like any other API read.
export async function fetchArtistResearch(artistKey, { signal } = {}) {
  const result = await api(`/api/artists/${encodeURIComponent(artistKey)}/research`, {
    context: "Loading the artist summary",
    silent: true,
    signal,
  });
  // architecture: allow-ambiguous-result -- most pages have no research yet; null is that answer, not a failure
  return result?.research || null;
}

export async function fetchVenueResearch(venueName, { city = null, signal } = {}) {
  const query = city ? `?city=${encodeURIComponent(city)}` : "";
  const result = await api(`/api/venues/${encodeURIComponent(venueName)}/research${query}`, {
    context: "Loading the venue summary",
    silent: true,
    signal,
  });
  // architecture: allow-ambiguous-result -- most pages have no research yet; null is that answer, not a failure
  return result?.research || null;
}
