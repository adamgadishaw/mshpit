// Public discovery widgets may share a future sponsorship host. A private
// overlay must unmount that host, not merely cover it with another screen.
// No vendor script or ad requests are enabled by this policy.
const PUBLIC_FRAME_KEYS = new Set([
  "artistName", "artistPublicSlug", "venueName", "venue", "cityGuide", "venues", "nearby", "nearbyTab", "post",
  "artistArchive", "artistTour", "artistGallery", "topRated", "openLog", "news",
  "discoverRegion", "directory", "discoverProgramme",
]);
const PUBLIC_DESTINATIONS = new Set(["artistName", "venueName", "cityGuide", "venues", "nearby", "artistArchive", "artistTour", "artistGallery", "topRated", "openLog", "news", "post"]);
export function publicDiscoveryRailAllowed(frame = {}, tab = "discover") {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return false;
  const keys = Object.keys(frame).filter(key => frame[key] != null && frame[key] !== false);
  if (keys.some(key => !PUBLIC_FRAME_KEYS.has(key))) return false;
  if (keys.some(key => PUBLIC_DESTINATIONS.has(key))) return true;
  return ["feed", "discover", "search"].includes(tab);
}

// A technical media-verification flag is NOT evidence of commercial rights.
// Until a reviewed server-side campaign, consent and rights workflow exists,
// player monetization is fail-closed regardless of arbitrary client metadata.
export const PLAYER_ADS_ENABLED = false;
export function playerAdvertisingAllowed() { return PLAYER_ADS_ENABLED; }
