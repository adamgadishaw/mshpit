const IMMUTABLE_EXPO_ASSET = /^\/_expo\/static\//;
const IMMUTABLE_EXPO_PUBLIC_ASSET = /^\/assets\/.*\.[a-f0-9]{16,}\.[a-z0-9]+$/i;

/**
 * Expo fingerprints compiled chunks and imported assets, so those URLs can be
 * cached forever. Files copied verbatim from /public keep stable names (for
 * example /logo.svg and /og.png) and must revalidate so a brand or share-card
 * update is not trapped behind a year-long immutable browser cache.
 */
export function staticAssetCacheControl(pathname) {
  const path = String(pathname || "");
  // These same-origin modules, stylesheet and catalogue share stable URLs.
  // Revalidate on every use so a deploy or rollback cannot reuse a stale member
  // of the map's module/data graph alongside the current application bundle.
  if (path.startsWith("/mshpit-maplibre/")) return "no-cache";
  if (IMMUTABLE_EXPO_ASSET.test(path) || IMMUTABLE_EXPO_PUBLIC_ASSET.test(path)) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=3600, stale-while-revalidate=86400";
}
