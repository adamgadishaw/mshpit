function normalizedIdentityPart(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en")
    .replace(/\s+/gu, " ");
}

const PROVIDER_SOURCE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._~-]{0,255}$/u;

// This matches the durable provider venue identity used by the SEO repository.
// Keeping the photo key provider-scoped prevents same-named rooms in different
// cities from sharing a structural photograph.
export function providerVenuePhotoCatalogKey(source, providerVenueId) {
  const normalizedSource = normalizedIdentityPart(source);
  const normalizedId = normalizedIdentityPart(providerVenueId);
  return PROVIDER_SOURCE_PATTERN.test(normalizedSource) && PROVIDER_ID_PATTERN.test(normalizedId)
    ? `provider:${normalizedSource}:${normalizedId}`
    : null;
}
