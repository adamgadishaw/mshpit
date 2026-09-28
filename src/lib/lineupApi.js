import { api } from "./api";

// Acts to offer while writing a lineup (server/features/concertLineup): the
// provider's billing for that show and the openers other fans listed on the
// same run of dates. For a festival, its billing with the day each act plays.
export function fetchLineupSuggestions({ artist = "", artistKey = null, date = "", venue = "", showFormat = "headline", signal } = {}) {
  const params = new URLSearchParams({ artist, showFormat });
  if (artistKey) params.set("artistKey", artistKey);
  if (date) params.set("date", date);
  if (venue) params.set("venue", venue);
  return api(`/api/lineup/suggestions?${params.toString()}`, { silent: true, signal, context: "Suggesting acts for this lineup" });
}

// An artist page's sets on other people's bills: opening, co-headlining and
// festival sets, with fans' ratings and notes.
export function fetchArtistSets({ artistKey = null, name = "", signal } = {}) {
  const params = new URLSearchParams();
  if (artistKey) params.set("artistKey", artistKey);
  if (name) params.set("name", name);
  return api(`/api/artists/sets?${params.toString()}`, { silent: true, signal, context: "Loading this artist's live sets" });
}
