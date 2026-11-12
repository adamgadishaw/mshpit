import { api } from "../../../lib/api";

export function fetchArtistCandidates(name, { signal } = {}) {
  return api(`/api/artists/candidates?name=${encodeURIComponent(name)}`, {
    context: "Finding matching artists", silent: true, signal,
  });
}
