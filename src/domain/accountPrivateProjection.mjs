const accountKey = (value) => value == null ? null : String(value);
const EMPTY_ROWS = Object.freeze([]);

export function accountScopeMatches(ownerId, activeAccountId) {
  return accountKey(ownerId) === accountKey(activeAccountId);
}

// Effects eventually replace account-private caches, but this projection closes
// the render that occurs first when React adopts account B while A's rows remain
// in state. A stable empty array also avoids needless consumer recalculation.
export function accountScopedRows(rows, ownerId, activeAccountId) {
  return accountScopeMatches(ownerId, activeAccountId) && Array.isArray(rows) ? rows : EMPTY_ROWS;
}

export function favoriteGenreFromHistory(rows, genreForArtist, fallback = null) {
  const counts = new Map();
  for (const track of (Array.isArray(rows) ? rows : []).slice(0, 60)) {
    const genre = typeof genreForArtist === "function" ? genreForArtist(track?.artist) : null;
    if (genre) counts.set(genre, (counts.get(genre) || 0) + 1);
  }
  const top = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
  return top?.[0] || fallback || null;
}
