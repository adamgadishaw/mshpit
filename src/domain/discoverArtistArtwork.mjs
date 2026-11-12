import { spotifyArtistPhotoModel } from './spotifyArtistPhoto.mjs';

// Generic catalogue photos retain their existing crop/preview path. Provider
// artwork needs the same complete, validated attribution as the artist page.
export function discoverArtistArtwork(artist) {
  const photo = typeof artist?.photo === 'string' ? artist.photo.trim() : '';
  if (photo && !/^https?:\/\/i\.scdn\.co(?:[/:?#]|$)/iu.test(photo)) {
    return { uri: photo, original: false };
  }
  const spotify = spotifyArtistPhotoModel(artist);
  return spotify ? { ...spotify, original: true } : null;
}
