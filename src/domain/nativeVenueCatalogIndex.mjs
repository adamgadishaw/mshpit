import { canonicalVenueKey, normalizeVenueKey, venueIdentityFingerprint } from "./venueIdentity.mjs";
// Native Nearby must not scan the full catalogue for every event/venue lookup.
// Keep the resolver's exact-match precedence and fail-closed collision rules.
export function createNativeVenueCatalogResolver(catalogKeys) {
  const exact = new Map(), fingerprints = new Map(), articles = new Map(), cache = new Map();
  const add = (map, value, key) => { const rows = map.get(value) || []; rows.push(key); map.set(value, rows); };
  const short = value => value.replace(/^the\s+/u, "");
  for (const key of Array.isArray(catalogKeys) ? catalogKeys : []) {
    add(exact, normalizeVenueKey(key), key);
    const fingerprint = venueIdentityFingerprint(canonicalVenueKey(key));
    add(fingerprints, fingerprint, key); add(articles, short(fingerprint), key);
  }
  return value => {
    const raw = String(value ?? "");
    if (cache.has(raw)) return cache.get(raw);
    const canonical = canonicalVenueKey(value);
    let result = null;
    if (canonical) {
      const target = venueIdentityFingerprint(canonical);
      const rows = exact.get(canonical) || fingerprints.get(target) || articles.get(short(target));
      if (rows?.length === 1) result = rows[0];
    }
    if (cache.size >= 4096) cache.delete(cache.keys().next().value);
    cache.set(raw, result); return result;
  };
}
