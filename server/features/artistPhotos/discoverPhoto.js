// Deezer's image CDN. Only these images may be cropped into Discover's cards
// and slideshow on behalf of an artist; Spotify artwork may not.
export function deezerImageUrl(value) {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && /(^|\.)dzcdn\.net$/u.test(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

// The Discover-only image the Deezer photo filler stores for an artist whose
// page shows a Spotify photo (`data.discoverPhoto`).
export function artistDiscoverPhotoUri(data) {
  const photo = data && typeof data === "object" ? data.discoverPhoto : null;
  return photo && photo.credit === "Deezer" ? deezerImageUrl(photo.uri) : null;
}
