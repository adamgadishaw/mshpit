export const PROFILE_GENRE_MIN = 1;
export const PROFILE_GENRE_MAX = 3;
export const PROFILE_GENRE_MAX_LENGTH = 30;

const cleanGenre = (value) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/gu, "").replace(/\s+/gu, " ").trim()
  : "";

// Genre preferences describe a member's taste, not an artist classification.
// Preserve the labels the member actually chose while keeping the payload
// small, case-insensitively unique, and safe to use in matching queries.
export function profileGenreSelection(values) {
  if (!Array.isArray(values)) {
    return { valid: false, genres: [], error: "Choose 1 to 3 music genres." };
  }
  const genres = [];
  const seen = new Set();
  let malformed = false;
  for (const value of values) {
    const genre = cleanGenre(value);
    if (!genre || genre.length > PROFILE_GENRE_MAX_LENGTH) {
      malformed = true;
      continue;
    }
    const identity = genre.toLocaleLowerCase("en-US");
    if (seen.has(identity)) continue;
    seen.add(identity);
    genres.push(genre);
  }
  const valid = !malformed
    && genres.length >= PROFILE_GENRE_MIN
    && genres.length <= PROFILE_GENRE_MAX;
  return {
    valid,
    genres,
    error: valid ? null : "Choose 1 to 3 music genres.",
  };
}

// Existing accounts may carry older labels or more than three selections.
// Keep those labels visible in Edit Profile so the member can deliberately
// reduce/change them; do not silently truncate their stored preferences.
export function profileGenreOptions(preferred, defaults) {
  const output = [];
  const seen = new Set();
  for (const value of [...(Array.isArray(preferred) ? preferred : []), ...(Array.isArray(defaults) ? defaults : [])]) {
    const genre = cleanGenre(value);
    const identity = genre.toLocaleLowerCase("en-US");
    if (!genre || genre.length > PROFILE_GENRE_MAX_LENGTH || seen.has(identity)) continue;
    seen.add(identity);
    output.push(genre);
  }
  return output;
}
