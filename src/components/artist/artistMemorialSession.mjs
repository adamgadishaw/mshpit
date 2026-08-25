const spotlightedArtists = new Set();

function sessionArtistKey(value) {
  if (typeof value !== "string") return "";
  return value.trim().normalize("NFKC").toLocaleLowerCase();
}

// This is deliberately process memory, not local/async storage. A respectful
// spotlight may open once in the current app session, while the permanent card
// remains available for deliberate reopening on the artist page.
export function claimArtistMemorialSpotlight(value) {
  const key = sessionArtistKey(value);
  if (!key || spotlightedArtists.has(key)) return false;
  spotlightedArtists.add(key);
  return true;
}

export function resetArtistMemorialSpotlightsForTests() {
  spotlightedArtists.clear();
}
