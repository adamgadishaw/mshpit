const text = (value) => typeof value === "string" ? value.normalize("NFKC").trim() : "";
const key = (value) => text(value).toLocaleLowerCase();

function uniqueStrings(values, limit = 100) {
  const rows = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const label = text(value).slice(0, 120);
    const identity = key(label);
    if (!label || seen.has(identity)) continue;
    seen.add(identity);
    rows.push(label);
    if (rows.length >= limit) break;
  }
  return rows;
}

function intersection(primary, secondary) {
  const available = new Set(uniqueStrings(secondary).map(key));
  return uniqueStrings(primary).filter((value) => available.has(key(value)));
}

function listCopy(values) {
  if (values.length <= 1) return values[0] || "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values[0]}, ${values[1]}, and ${values.length - 2} more`;
}

export function tasteMatch(viewer, profile, { artistLimit = 3, genreLimit = 3 } = {}) {
  if (!viewer?.id || !profile?.id || String(viewer.id) === String(profile.id)) return null;
  // Only explicit public profile fields participate. Plays, posts, follows,
  // location, and inferred genres are intentionally outside this function.
  const sharedArtists = intersection(viewer.favoriteArtists, profile.favoriteArtists);
  const sharedGenres = intersection(viewer.genres, profile.genres);
  if (!sharedArtists.length && !sharedGenres.length) return null;
  const artists = sharedArtists.slice(0, Math.max(0, Math.min(6, Number(artistLimit) || 0)));
  const genres = sharedGenres.slice(0, Math.max(0, Math.min(6, Number(genreLimit) || 0)));
  const parts = [];
  if (sharedArtists.length) parts.push(`You both picked ${listCopy(sharedArtists)}`);
  if (sharedGenres.length) parts.push(`Shared genres: ${listCopy(sharedGenres)}`);
  return {
    sharedArtists: artists,
    sharedGenres: genres,
    artistCount: sharedArtists.length,
    genreCount: sharedGenres.length,
    summary: `${parts.join(". ")}.`,
    basis: "shared-profile-picks",
  };
}
