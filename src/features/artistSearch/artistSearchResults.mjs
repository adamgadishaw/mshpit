const accessDenied = (error) => /^PIT-AUTH-/.test(String(error?.code || ""))
  || [401, 403].includes(Number(error?.status))
  || ["IDENTITY_CHANGED", "AUTH_REQUIRED", "AUTH_INVALID", "FORBIDDEN"].includes(error?.serverCode);

export function settleArtistSearchSnapshot(current, { scope, rows, error } = {}) {
  if (error && !accessDenied(error) && current?.scope === scope) return current;
  return { scope, rows: error ? [] : Array.isArray(rows) ? rows : [] };
}

// Keep canonical identity when combining saved catalogue matches with local
// show labels. A display-only fallback cannot replace a stored artist link.
export function artistSearchRowIdentity(row) {
  for (const field of ["key", "norm", "publicSlug", "public_slug", "mbid"]) {
    if (typeof row?.[field] === "string" && row[field].trim()) return `${field}:${row[field].trim().toLowerCase()}`;
  }
  return `name:${String(row?.name || "").trim().toLowerCase()}`;
}

export function mergeArtistSearchResults(catalogRows, localRows, limit = 30) {
  const result = new Map();
  const names = new Set();
  const maximum = Math.min(40, Math.max(1, Number(limit) || 30));
  for (const row of [...(Array.isArray(catalogRows) ? catalogRows : []), ...(Array.isArray(localRows) ? localRows : [])]) {
    const name = typeof row?.name === "string" ? row.name.trim() : "";
    const identity = artistSearchRowIdentity(row);
    if (!name || result.has(identity) || (identity.startsWith("name:") && names.has(name.toLowerCase()))) continue;
    names.add(name.toLowerCase());
    result.set(identity, { ...row, name });
    if (result.size >= maximum) break;
  }
  return [...result.values()];
}
