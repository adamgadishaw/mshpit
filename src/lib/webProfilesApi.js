import { api } from "./api";

// Official links and genre the web profile agents stored for an artist page.
export async function fetchArtistWebProfile(artistKey, { signal } = {}) {
  const result = await api(`/api/artists/${encodeURIComponent(artistKey)}/links`, {
    context: "Loading the artist's links",
    silent: true,
    signal,
  });
  // architecture: allow-ambiguous-result -- many pages have no provider record yet; null is that answer, not a failure
  return result?.profile || null;
}

// Box office, parking, accessibility and entry details for a venue page.
export async function fetchVenueWebProfile(venueName, { providerVenueId = null, city = null, signal } = {}) {
  const query = new URLSearchParams();
  if (providerVenueId) query.set("providerVenueId", String(providerVenueId));
  if (city) query.set("city", String(city));
  const result = await api(`/api/venues/${encodeURIComponent(venueName)}/details?${query}`, {
    context: "Loading the venue's visitor details",
    silent: true,
    signal,
  });
  // architecture: allow-ambiguous-result -- many venues have no provider record yet; null is that answer, not a failure
  return result?.profile || null;
}
