import { STATUS_BADGES } from "./badges.mjs";

// A display preference, never a source of earned badges or account authority.
// null/omitted follows current and future awards; [] deliberately hides all.
export function canonicalProfileBadges(value) {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > Object.keys(STATUS_BADGES).length
    || value.some(id => typeof id !== "string" || !Object.hasOwn(STATUS_BADGES, id))
    || new Set(value).size !== value.length) return undefined;
  return [...value].sort();
}

export function displayedProfileBadges(earned, selection) {
  const available = [...new Set(Array.isArray(earned) ? earned : [])]
    .filter(id => Object.hasOwn(STATUS_BADGES, id));
  const chosen = canonicalProfileBadges(selection);
  // Malformed legacy preferences fail closed rather than inventing awards.
  if (selection !== undefined && chosen === undefined) return [];
  return chosen == null ? available : available.filter(id => chosen.includes(id));
}

export function toggleProfileBadge(selection, id, earned) {
  if (!earned.includes(id) || !Object.hasOwn(STATUS_BADGES, id)) return selection;
  const current = displayedProfileBadges(earned, selection);
  return canonicalProfileBadges(current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
}

export function profileBadgesSaveConfirmed(user, requested) {
  if (user?.profileBadgeSelectionSupported !== true || !Object.hasOwn(user, "profileBadges")) return false;
  const sent = canonicalProfileBadges(requested), received = canonicalProfileBadges(user.profileBadges);
  return sent !== undefined && received !== undefined && JSON.stringify(sent) === JSON.stringify(received);
}
