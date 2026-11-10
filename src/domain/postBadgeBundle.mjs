// Only a complete, freshly projected bundle may replace cached badge claims.
// This is presentation metadata; permissions still come from stored account data.
export const POST_BADGE_FIELDS = Object.freeze(["role", "verified", "sponsor", "artistName", "membershipBadge", "profileBadges"]);
export function postBadgeBundle(user) {
  return {
    badgeSnapshot: true,
    role: user?.role || "fan",
    verified: user?.verified === true,
    sponsor: user?.sponsor === true,
    artistName: user?.artistName || null,
    membershipBadge: user?.membershipBadge || null,
    profileBadges: user?.profileBadges ?? null,
  };
}

export function reconcilePostAuthorBadges(posts, user) {
  if (!Array.isArray(posts) || !user?.id) return posts;
  let changed = false;
  const bundle = postBadgeBundle(user);
  const next = posts.map(post => {
    if (post?.userId !== user.id) return post;
    if (Object.entries(bundle).every(([key, value]) => JSON.stringify(post.user?.[key]) === JSON.stringify(value))) return post;
    changed = true;
    return { ...post, user: { ...post.user, ...bundle } };
  });
  return changed ? next : posts;
}

export function reconcileCommentAuthorBadges(groups, user) {
  if (!groups || !user?.id) return groups;
  const bundle = postBadgeBundle(user);
  return Object.fromEntries(Object.entries(groups).map(([id, rows]) => [id, Array.isArray(rows)
    ? rows.map(row => !row.deleted && row.userId === user.id ? { ...row, ...bundle } : row) : rows]));
}
