// Remember only public catalogue keys returned by Discover, never who viewed
// them, search text, or account activity. No database writes or provider calls
// happen on the page-read path. A restart simply rebuilds this small hint cache.
const byDatabase = new WeakMap();
export const DISCOVER_PRIORITY_LIMIT = 512;
export const DISCOVER_PRIORITY_TTL_MS = 24 * 60 * 60 * 1000;

export function discoverArtistPriorityKeys(database, at = Date.now()) {
  const entries = byDatabase.get(database);
  if (!entries || !Number.isSafeInteger(at)) return [];
  for (const [key, seenAt] of entries) {
    if (seenAt > at || at - seenAt >= DISCOVER_PRIORITY_TTL_MS) entries.delete(key);
  }
  return [...entries.keys()];
}

export function rememberDiscoverArtists(database, rows, at = Date.now()) {
  if (!database || typeof database !== "object" || !Number.isSafeInteger(at) || !Array.isArray(rows)) return;
  discoverArtistPriorityKeys(database, at);
  let entries = byDatabase.get(database);
  if (!entries) { entries = new Map(); byDatabase.set(database, entries); }
  for (const row of rows.slice(0, 60)) {
    const key = row?.key;
    if (typeof key !== "string" || !key.trim() || key.length > 240 || /[\u0000-\u001f\u007f]/u.test(key)) continue;
    entries.delete(key);
    entries.set(key, at);
    if (entries.size > DISCOVER_PRIORITY_LIMIT) entries.delete(entries.keys().next().value);
  }
}

// Interleave regular catalogue work so even a busy Discover cannot monopolize
// a pass. Both inputs have already passed the same due-time/lease checks.
export function interleaveDiscoverPriority(priority, regular, limit) {
  const selected = [];
  let p = 0, r = 0;
  const priorityRun = Math.min(3, Math.max(1, limit - 1));
  while (selected.length < limit && (p < priority.length || r < regular.length)) {
    for (let n = 0; n < priorityRun && p < priority.length && selected.length < limit; n++) selected.push(priority[p++]);
    if (r < regular.length && selected.length < limit) selected.push(regular[r++]);
  }
  return selected;
}
