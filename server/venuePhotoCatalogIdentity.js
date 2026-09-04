function normalizedIdentityPart(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en")
    .replace(/\s+/gu, " ");
}

// This matches the durable provider venue identity used by the SEO repository.
// Keeping the photo key provider-scoped prevents same-named rooms in different
// cities from sharing a structural photograph.
export function providerVenuePhotoCatalogKey(source, providerVenueId) {
  const normalizedSource = normalizedIdentityPart(source);
  const normalizedId = normalizedIdentityPart(providerVenueId);
  return normalizedSource && normalizedId
    ? `provider:${normalizedSource}:${normalizedId}`
    : null;
}
