import { postBadgeBundle } from "../src/domain/postBadgeBundle.mjs";
import { profileAudienceAllows } from "./accountVisibility.js";

// Read from current stored authority on every post response. A public post does
// not grant access to the author's otherwise hidden profile or its preferences.
export function postAuthorBadgeProjection({ user, viewerId, projectUser }) {
  if (!profileAudienceAllows(user, viewerId ? { id: viewerId } : null)) {
    return { ...postBadgeBundle(null), profileBadges: [] };
  }
  return postBadgeBundle(projectUser(user));
}
