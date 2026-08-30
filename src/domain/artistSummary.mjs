import { verifiedArtistGenre } from "./genre.mjs";

const average = (rows, select) => rows.length
  ? rows.reduce((sum, row) => sum + select(row), 0) / rows.length
  : 0;

// Pure artist-page projection. Keeping this outside the React store makes the
// public genre contract testable: unknown and legacy crawl genres are `null`,
// never the old truthy "-" sentinel that leaked through the UI fallback.
export function buildArtistSummary({
  name,
  key,
  nights = [],
  upcoming = [],
  remoteArtist = null,
  catalogArtist = null,
  profile = {},
} = {}) {
  const safeNights = Array.isArray(nights) ? nights : [];
  const safeUpcoming = Array.isArray(upcoming) ? upcoming : [];
  const cat = remoteArtist || catalogArtist || {};
  const prof = profile && typeof profile === "object" ? profile : {};
  return {
    name,
    genre: verifiedArtistGenre(remoteArtist, catalogArtist),
    photo: prof.avatarUri || cat.photo || null,
    profileAvatarUri: prof.avatarUri || null,
    photoCredit: prof.avatarUri ? null : cat.photoCredit || null,
    banner: prof.banner || null,
    ownerBio: prof.bio || null,
    ownerId: prof.ownerId || null,
    profileKey: key,
    feedEnabled: !!prof.feedEnabled,
    nights: safeNights,
    upcoming: safeUpcoming,
    avgOverall: average(safeNights, (night) => night.overall),
    avgBand: average(safeNights, (night) => night.band),
    avgRoom: average(safeNights, (night) => night.room),
    totalRatings: safeNights.reduce((sum, night) => sum + (night.likes || 0), 0),
  };
}
