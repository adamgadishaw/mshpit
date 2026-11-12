export function spotifyArtistPhotoModel(artist) {
  if (artist?.photoSource !== "spotify"
    || artist?.photoCredit !== "Spotify"
    || artist?.photoDisplayPolicy !== "original") return null;
  try {
    const uri = new URL(artist.spotifyPhoto).href;
    const sourceUrl = new URL(artist.spotifyArtistUrl || artist.photoSourceUrl).href;
    // Validate the complete pair together; neither field is useful alone.
    // Canonical URLs exclude credentials, other hosts/ports and query/hash suffixes.
    if (!/^https:\/\/i\.scdn\.co\/image\/[A-Za-z0-9]+$/u.test(uri)
      || !/^https:\/\/open\.spotify\.com\/artist\/[A-Za-z0-9]{22}\/?$/u.test(sourceUrl)) return null;
    return Object.freeze({ uri, sourceUrl, credit: "Spotify" });
  } catch {
    return null;
  }
}
