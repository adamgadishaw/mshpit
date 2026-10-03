import { api } from "./api";

async function read(kind, key, { signal, city } = {}) {
  const query = city ? `?city=${encodeURIComponent(city)}` : "";
  const result = await api(`/api/${kind}/${encodeURIComponent(key)}/research${query}`, {
    context: "Loading researched context", silent: true, signal,
  });
  // architecture: allow-ambiguous-result -- absent optional research is a valid public result.
  return result?.research || null;
}
export const fetchArtistResearch = (key, options) => read("artists", key, options);
export const fetchVenueResearch = (key, options) => read("venues", key, options);
export const fetchEventResearch = (key, options) => read("events", key, options);
