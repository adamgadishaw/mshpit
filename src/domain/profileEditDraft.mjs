// Keep an editor's original snapshot separate from later session refreshes.
// PATCH only deliberate edits: legacy values and unrelated concurrent changes
// must not be revalidated or overwritten just because someone changes a photo.
export function changedProfileDraftFields(original, draft) {
  const fields = ["name", "handle", "bio", "avatarUri", "banner", "genres", "home", "pronouns", "accent", "favoriteShows"];
  return Object.fromEntries(fields
    .filter(key => Object.hasOwn(draft, key) && JSON.stringify(original[key]) !== JSON.stringify(draft[key]))
    .map(key => [key, draft[key]]));
}
