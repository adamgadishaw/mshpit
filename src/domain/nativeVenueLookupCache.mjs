import { createNativeVenueCatalogResolver } from "./nativeVenueCatalogIndex.mjs";

// Derived lookup state follows catalogue identity and can be collected with it.
// Keep it outside the legacy Store's React lifecycle, like the search indexes.
const catalogues = new WeakMap();
export function nativeVenueLookupCache(catalogue, curated) {
  let byCurated = catalogues.get(catalogue);
  if (!byCurated) { byCurated = new WeakMap(); catalogues.set(catalogue, byCurated); }
  let cache = byCurated.get(curated);
  if (!cache) {
    cache = {
      keyCacheRef: { current: new Map() },
      coordinatesRef: { current: null },
      resolveCatalog: createNativeVenueCatalogResolver([...Object.keys(curated), ...Object.keys(catalogue)]),
    };
    byCurated.set(curated, cache);
  }
  return cache;
}
