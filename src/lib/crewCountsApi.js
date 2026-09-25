import { api } from "./api";

// Public, identity-free Crew counts for one show. Kept apart from crewApi.js so
// the show page does not pull the whole Crew client into a shared chunk.
export function fetchCrewCounts(tourDateId, { signal } = {}) {
  return api(`/api/crew/shows/${encodeURIComponent(tourDateId)}/counts`, {
    silent: true,
    signal,
    context: "Loading who's looking for a crew",
  });
}
