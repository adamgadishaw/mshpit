export function artistPageEditReady(resource) {
  return resource?.updatedAt != null
    && !!resource?.data
    && typeof resource.data.profile === "object"
    && resource.data.profile !== null
    && !Array.isArray(resource.data.profile);
}

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

const nullableText = (value) => value == null
  ? null
  : typeof value === "string" ? value : undefined;

const nullableHttpsUrl = (value) => {
  if (value == null) return null;
  if (typeof value !== "string" || !/^https:\/\/[^\s]+$/i.test(value.trim())) return undefined;
  return value.trim();
};

// A profile mutation is complete only when the API returns the authoritative
// public projection and it contains every field the editor asked to save. The
// old bare success response forced the client to trust an optimistic cache,
// which made a successful database write and a stale artist page look exactly
// like a no-op to the person editing it.
export function confirmedArtistProfileMutation(response, expectedPatch = {}) {
  const profile = response?.profile;
  if (response?.ok !== true || !profile || typeof profile !== "object" || Array.isArray(profile)) return null;

  const normalized = {
    ownerId: profile.ownerId == null ? null : String(profile.ownerId),
    bio: nullableText(profile.bio),
    banner: nullableHttpsUrl(profile.banner),
    avatarUri: nullableHttpsUrl(profile.avatarUri),
    feedEnabled: profile.feedEnabled === true,
  };
  if (normalized.bio === undefined || normalized.banner === undefined || normalized.avatarUri === undefined) return null;

  if (hasOwn(expectedPatch, "bio")) {
    // The API stores an intentionally blank biography as NULL. The editor sends
    // an empty string because TextInput is string-backed, so compare their
    // canonical meanings instead of reporting a false save failure.
    const expectedBio = typeof expectedPatch.bio === "string" && !expectedPatch.bio.trim()
      ? null
      : expectedPatch.bio;
    if (normalized.bio !== expectedBio) return null;
  }
  if (hasOwn(expectedPatch, "feedEnabled") && normalized.feedEnabled !== !!expectedPatch.feedEnabled) return null;
  if (hasOwn(expectedPatch, "banner") && normalized.banner !== (expectedPatch.banner || null)) return null;
  if (hasOwn(expectedPatch, "avatarUri") && normalized.avatarUri !== (expectedPatch.avatarUri || null)) return null;
  return normalized;
}
