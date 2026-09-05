const text = (value) => String(value ?? "").trim();
const normalizedName = (value) => text(value)
  .normalize("NFKC")
  .toLocaleLowerCase()
  .replace(/\s+/g, " ");

// Only a persisted catalogue key (or one already attached to the navigation
// target) is authoritative enough for memorial policy checks. A display name
// is deliberately not promoted into a key: duplicate/aliased artists must be
// resolved by the catalogue before protected archive routes can open.
export function canonicalArtistIdentity({ artistName = null, artistKey = null, catalogArtist = null } = {}) {
  const requestedName = text(artistName);
  const candidateName = text(catalogArtist?.name);
  const candidateMatches = !!requestedName
    && !!candidateName
    && normalizedName(requestedName) === normalizedName(candidateName);
  const candidateKey = candidateMatches
    ? text(catalogArtist?.key || catalogArtist?.norm || catalogArtist?.artistKey)
    : "";
  const key = text(artistKey) || candidateKey;
  return Object.freeze({
    artistName: candidateMatches ? candidateName : requestedName,
    artistKey: key || null,
  });
}

export function canonicalArtistIdentityScope({ artistName = null, artistKey = null } = {}) {
  return `${normalizedName(artistName)}:${normalizedName(artistKey)}`;
}
