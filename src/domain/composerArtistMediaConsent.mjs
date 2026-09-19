// UI eligibility only. The server still derives artist ownership and applies
// account privacy, media safety, and moderation checks before gallery delivery.
export function composerArtistMediaConsent({ postType, user, artist, photosPublic = false } = {}) {
  const ownedArtistName = user?.role === "artist" ? String(user?.artistName || "").trim() : "";
  const available = postType === "show" || postType === "memory" || (postType === "status" && !!ownedArtistName);
  const artistName = postType === "status" ? ownedArtistName : String(artist || "").trim();
  return { available, artistName: artistName || "the artist", photosPublic: available && photosPublic === true };
}
