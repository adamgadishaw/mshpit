const SPOTIFY_IMAGE_PATH = /^\/image\/[A-Za-z0-9]+$/u;
const SPOTIFY_ARTIST_PATH = /^\/artist\/[A-Za-z0-9]{22}\/?$/u;

function fixedHttps(value, hostname, pathPattern) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:"
      || url.username
      || url.password
      || url.port
      || url.hostname !== hostname
      || url.search
      || url.hash
      || !pathPattern.test(url.pathname)) return "";
    return url.href;
  } catch {
    return "";
  }
}

export const spotifyArtistImageUrl = (value) => fixedHttps(value, "i.scdn.co", SPOTIFY_IMAGE_PATH);
export const spotifyArtistPageUrl = (value) => fixedHttps(value, "open.spotify.com", SPOTIFY_ARTIST_PATH);

export function spotifyArtistPhotoModel(artist) {
  if (artist?.photoSource !== "spotify"
    || artist?.photoCredit !== "Spotify"
    || artist?.photoDisplayPolicy !== "original") return null;
  const uri = spotifyArtistImageUrl(artist.spotifyPhoto);
  const sourceUrl = spotifyArtistPageUrl(artist.spotifyArtistUrl || artist.photoSourceUrl);
  if (!uri || !sourceUrl) return null;
  return Object.freeze({ uri, sourceUrl, credit: "Spotify" });
}
