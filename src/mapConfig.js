// Real static map snapshots, themed to match Pit. Add ONE key to .env and every
// venue/concert map becomes a real dark street map (Google or Mapbox). No HTML
// scraping, no tiles to host - just the official Static Maps APIs.
//
//   .env  ->  EXPO_PUBLIC_GOOGLE_MAPS_KEY=AIza...        (preferred: themed below)
//        or   EXPO_PUBLIC_MAPBOX_TOKEN=pk....            (Mapbox dark-v11)
//
// Free tiers cover plenty for launch. Without a key, the drawn CityMap is used
// so the app is never blank.
export const GOOGLE_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || "";
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || "";

export const MAP_PROVIDER = GOOGLE_KEY ? "google" : MAPBOX_TOKEN ? "mapbox" : null;
export const HAS_MAP = MAP_PROVIDER !== null;

// A Google Static Maps dark theme matched to the stage-light palette: warm dark
// land, cool water, muted streets, amber highways. This is the "Google snapshot
// that matches the theme."
const GOOGLE_DARK_STYLE = [
  { elementType: "geometry", color: "0x0f131c" },
  { elementType: "labels.text.fill", color: "0x8088a0" },
  { elementType: "labels.text.stroke", color: "0x0b0e16" },
  { feature: "poi.park", element: "geometry", color: "0x16241c" },
  { feature: "poi", element: "labels.text.fill", color: "0x6b7280" },
  { feature: "road", element: "geometry", color: "0x262d43" },
  { feature: "road", element: "geometry.stroke", color: "0x161b29" },
  { feature: "road.arterial", element: "geometry", color: "0x3b445f" },
  { feature: "road.highway", element: "geometry", color: "0x7c5a30" },
  { feature: "road.highway", element: "geometry.stroke", color: "0x2a2114" },
  { feature: "road.highway", element: "labels.text.fill", color: "0xc99a52" },
  { feature: "transit", element: "geometry", color: "0x1b2030" },
  { feature: "water", element: "geometry", color: "0x0e1f31" },
  { feature: "water", element: "labels.text.fill", color: "0x1c3a55" },
  { feature: "administrative", element: "geometry", color: "0x2a3148" },
  { feature: "administrative.land_parcel", color: "0x0f131c" },
];

function googleStyleParams() {
  return GOOGLE_DARK_STYLE.map((s) => {
    const parts = [];
    if (s.feature) parts.push(`feature:${s.feature}`);
    if (s.element) parts.push(`element:${s.element}`);
    if (s.color) parts.push(`color:${s.color}`);
    if (s.visibility) parts.push(`visibility:${s.visibility}`);
    return `style=${parts.join("|")}`;
  }).join("&");
}

// Build a static image URL for a center + integer zoom + logical WxH.
export function mapStaticUrl(center, zoom, w, h) {
  const { lat, lng } = center;
  if (MAP_PROVIDER === "google") {
    return (
      `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}` +
      `&zoom=${zoom}&size=${w}x${h}&scale=2&maptype=roadmap&${googleStyleParams()}&key=${GOOGLE_KEY}`
    );
  }
  // Mapbox: lng,lat,zoom,bearing then size@2x
  return `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/${lng},${lat},${zoom},0/${w}x${h}@2x?access_token=${MAPBOX_TOKEN}&attribution=false&logo=false`;
}
