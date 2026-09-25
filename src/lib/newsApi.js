import { api } from "./api";

// Artist news: new releases and new tour dates. Reads only; each view shows
// its own empty and error states, so these calls stay silent.
export function fetchNews({ scope = "all", cursor = null, limit = 20, signal } = {}) {
  const params = new URLSearchParams();
  if (scope === "following") params.set("scope", "following");
  if (cursor) params.set("cursor", cursor);
  if (limit !== 20) params.set("limit", String(limit));
  const query = params.toString();
  return api(`/api/news${query ? `?${query}` : ""}`, { silent: true, signal, context: "Loading music news" });
}

export function fetchArtistNews(artist, { limit = 6, signal } = {}) {
  return api(`/api/artists/${encodeURIComponent(artist)}/news?limit=${limit}`, { silent: true, signal, context: "Loading artist news" });
}
