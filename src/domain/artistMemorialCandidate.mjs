import { clean } from "./validation.mjs";

const ARTIST_KEY_LIMIT = 180;
const ARTIST_NAME_LIMIT = 120;
const MUSICBRAINZ_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function boundedText(value, max) {
  const normalized = clean(value, { max: max + 1 });
  return normalized.length <= max ? normalized : "";
}

export function artistMemorialPreparationName(value) {
  const name = boundedText(value, ARTIST_NAME_LIMIT);
  if (name.length < 2) {
    throw new TypeError("Enter the artist's full stage name before finding an exact identity.");
  }
  return name;
}

export function normalizeArtistMemorialCandidate(value) {
  const artist = object(value);
  const key = boundedText(artist.key, ARTIST_KEY_LIMIT);
  const name = boundedText(artist.name, ARTIST_NAME_LIMIT);
  const mbid = typeof artist.mbid === "string" ? artist.mbid.trim().toLowerCase() : "";
  if (!key || !name || !MUSICBRAINZ_ID.test(mbid)) return null;
  return { ...artist, key, name, mbid };
}

export function isArtistMemorialCandidate(value) {
  return normalizeArtistMemorialCandidate(value) != null;
}

export function artistMemorialCandidates(values, { limit = 6 } = {}) {
  if (!Array.isArray(values)) return [];
  const take = Math.max(1, Math.min(20, Math.trunc(Number(limit) || 6)));
  const seen = new Set();
  const candidates = [];
  for (const value of values) {
    const artist = normalizeArtistMemorialCandidate(value);
    if (!artist) continue;
    const identity = `${artist.key}\u0000${artist.mbid}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    candidates.push(artist);
    if (candidates.length >= take) break;
  }
  return candidates;
}

export function preparedMemorialArtistFromResponse(response) {
  if (!response || typeof response !== "object" || Array.isArray(response) || !Array.isArray(response.artists)) {
    throw new TypeError("Pit returned an invalid exact-artist response.");
  }
  if (response.artists.length !== 1) {
    throw new TypeError(response.artists.length
      ? "Pit found more than one exact artist. Refine the full stage name and try again."
      : "Pit could not confirm an exact MusicBrainz-backed artist. Check the full stage name and try again.");
  }
  const artist = normalizeArtistMemorialCandidate(response.artists[0]);
  if (!artist) {
    throw new TypeError("Pit returned an artist without a valid exact MusicBrainz identity.");
  }
  return artist;
}
