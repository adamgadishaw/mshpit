import { bundledArtistNorms, normName } from "./db.js";

const SPOTIFY_ARTIST_ID = /^[A-Za-z0-9]{22}$/u;

function objectData(row) {
  try {
    const parsed = JSON.parse(row?.data || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Popularity is provider-controlled ranking data, so a loose name match is not
// enough to publish it. Checked-in catalogue identities remain the baseline.
// A provider-only row must carry one exact Spotify identity in both the typed
// column and its rich-data record, attached to the same normalized name. This
// fails closed for cross-artist enrichment such as one artist inheriting a
// different artist's followers or top track, without deleting the searchable
// row or preventing staff from repairing it.
export function artistHasRankedPopularityProvenance(row, {
  reviewedArtistNorms = bundledArtistNorms,
} = {}) {
  const popularity = Number(row?.popularity);
  if (!Number.isFinite(popularity) || popularity < 0 || popularity > 100) return false;
  const identity = normName(row?.norm || row?.name);
  if (!identity) return false;
  if (reviewedArtistNorms?.has(identity)) return true;
  if ([...identity].length < 2) return false;

  const data = objectData(row);
  const typedSpotifyId = String(row?.spotify_id || "").trim();
  const recordedSpotifyId = String(data.spotifyId || "").trim();
  return SPOTIFY_ARTIST_ID.test(typedSpotifyId)
    && recordedSpotifyId === typedSpotifyId
    && normName(data.name) === identity;
}

export function eligiblePopularityArtists(rows, {
  reviewedArtistNorms = bundledArtistNorms,
  limit = Number.POSITIVE_INFINITY,
} = {}) {
  const maximum = Number.isFinite(Number(limit))
    ? Math.max(0, Math.trunc(Number(limit)))
    : Number.POSITIVE_INFINITY;
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => artistHasRankedPopularityProvenance(row, { reviewedArtistNorms }))
    .slice(0, maximum);
}
