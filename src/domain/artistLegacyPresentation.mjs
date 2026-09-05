const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const rows = (value) => Array.isArray(value) ? value : [];
const text = (value) => typeof value === "string" && value.trim() ? value.trim() : null;

// A memorial transition can happen while a viewer still has an ordinary
// artist-owner profile cached on device. Once the artist is classified as
// legacy, only the current server response (which applies staff provenance)
// may supply profile overrides or editorial notes. Until that exact response
// arrives, catalogue identity content is the fail-closed presentation.
export function artistLegacyPresentation({
  legacyMode = false,
  cachedArtist = null,
  catalogArtist = null,
  cachedPosts = null,
  confirmedPage = null,
  gallery = null,
} = {}) {
  const cached = record(cachedArtist);
  const catalog = record(catalogArtist);
  if (!legacyMode) {
    return Object.freeze({
      bio: text(cached.ownerBio) || text(catalog.bio),
      bannerUri: text(cached.banner) || text(catalog.photo),
      profileUri: text(cached.photo) || text(catalog.photo),
      profileAvatarUri: text(cached.profileAvatarUri),
      profileOwnerId: cached.ownerId || null,
      posts: rows(cachedPosts),
      heroGallery: rows(gallery),
    });
  }

  // `confirmedPage` can have been requested before the memorial transition.
  // Only the explicit server projection marker proves its profile and posts
  // passed the legacy staff-provenance policy.
  const current = confirmedPage?.legacyProfile === true ? record(confirmedPage) : null;
  const profile = current ? record(current.profile) : {};
  return Object.freeze({
    bio: text(profile.bio) || text(catalog.bio),
    bannerUri: text(profile.banner) || text(catalog.photo),
    profileUri: text(profile.avatarUri) || text(catalog.photo),
    profileAvatarUri: text(profile.avatarUri),
    profileOwnerId: null,
    // These rows are labelled Mshpit editorial in the UI, so a persisted
    // pre-transition cache must never be accepted as their provenance.
    posts: current ? rows(current.posts) : [],
    // Community photos remain in the gallery, but do not become identity art
    // for a protected historical profile.
    heroGallery: [],
  });
}
