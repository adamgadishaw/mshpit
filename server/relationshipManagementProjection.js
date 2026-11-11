// Relationship management must keep an opaque target id so an account can
// unmute/unblock someone whose profile is no longer accessible. It must not
// become an alternate directory for that person's current profile fields.
const DIRECTORY_FIELDS = Object.freeze([
  "id", "name", "handle", "initials", "avatarUri", "avatarColor", "profileUpdatedAt",
]);

function unavailableAccount(id) {
  // Settings and Avatar consume these same fields on web and native. Explicit
  // null images also replace an older cached avatar when this row is hydrated.
  return {
    id,
    name: "Unavailable account",
    handle: "unavailable",
    initials: "?",
    avatarUri: null,
    avatarColor: null,
    profileUpdatedAt: 0,
    unavailable: true,
  };
}

export function createRelationshipManagementProjection({ visibleProfileOrNull, blockedEitherWay, projectUser }) {
  if (typeof visibleProfileOrNull !== "function" || typeof blockedEitherWay !== "function"
    || typeof projectUser !== "function") {
    throw new TypeError("Relationship management requires profile visibility and block boundaries");
  }
  return (row, viewer) => {
    if (!viewer?.id || blockedEitherWay(viewer.id, row.id)) return unavailableAccount(row.id);
    const current = visibleProfileOrNull(row.id, viewer);
    if (!current) return unavailableAccount(row.id);
    const projected = projectUser(current);
    return Object.fromEntries(DIRECTORY_FIELDS.filter((field) => projected[field] !== undefined)
      .map((field) => [field, projected[field]]));
  };
}
