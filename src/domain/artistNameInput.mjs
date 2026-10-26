import { clean } from "./validation.mjs";

export const ARTIST_NAME_MAX_CODE_POINTS = 120;

// Identity input must never become another artist's name by truncation. Check
// the complete input first; 240 UTF-16 units accommodate 120 astral characters.
// Keep the established whitespace/control normalization after the length check.
export function artistNameInput(value) {
  if (typeof value !== "string") return "";
  const name = value.trim();
  if (!name || name.length > ARTIST_NAME_MAX_CODE_POINTS * 2
    || [...name].length > ARTIST_NAME_MAX_CODE_POINTS
    || /[\ud800-\udfff]/u.test(name)) return "";
  return clean(name, { max: ARTIST_NAME_MAX_CODE_POINTS * 2 });
}
