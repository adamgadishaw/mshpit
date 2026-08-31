const validCatalogTotal = (value) => {
  if (value == null || value === "") return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
};

export function projectDiscoveryCatalogTotals(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const artists = validCatalogTotal(value.artists);
  const venues = validCatalogTotal(value.venues);
  return artists == null && venues == null ? null : { artists, venues };
}

export function resolveDiscoveryCatalogTotal(authoritative, fallback) {
  return validCatalogTotal(authoritative) ?? validCatalogTotal(fallback) ?? 0;
}
