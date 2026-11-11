import { profileGenreSelection } from "./genrePreferences.mjs";

// Suggestions, never an access/completion gate. Older accounts can save other
// details without adopting today's signup genre requirement.
export function profileGuidance(user) {
  const music = !profileGenreSelection(user?.genres).valid;
  const optional = [];
  if (!user?.avatarUri) optional.push("a profile photo");
  if (!user?.bio?.trim()) optional.push("a bio");
  if (!user?.home?.city) optional.push("your city");
  return { music, optional, visible: music || optional.length > 0 };
}
