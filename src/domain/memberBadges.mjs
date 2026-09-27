// These are server-projected, cosmetic milestones. Never infer an identity
// check, artist ownership, or staff permissions from either value.
export function memberBadgeTypes(user) {
  return user?.membershipBadge === "first-wave" ? ["first-wave"]
    : user?.membershipBadge === "email-confirmed" ? ["email-confirmed"] : [];
}
