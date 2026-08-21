// One boundary-safe, Unicode-preserving identity for authoritative song pins.
// Staff overrides must never collapse distinct non-Latin titles into the same
// row (the former ASCII-only key reduced all-symbol/non-Latin pairs to "|").
export function normalizeTrackIdentityText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[‘’‛ʼ`´]/g, "'")
    .replace(/[‐‑‒–—―]/g, "-")
    .trim()
    .replace(/\s+/g, " ");
}

export function trackOverrideIdentityKey(title, artist) {
  return `track:v2:${JSON.stringify([
    normalizeTrackIdentityText(artist),
    normalizeTrackIdentityText(title),
  ])}`;
}

// Read/cleanup compatibility only. New rows are never keyed this way.
export function legacyTrackOverrideIdentityKey(title, artist) {
  const legacy = (value) => String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return `${legacy(artist)}|${legacy(title)}`;
}

export function sameTrackOverrideIdentity(row, title, artist) {
  return trackOverrideIdentityKey(row?.title, row?.artist) === trackOverrideIdentityKey(title, artist);
}
