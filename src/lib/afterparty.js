// "Still open near you" - post-show food / bars / clubs / activities around the
// venue. Generated deterministically around the venue's real coords so the
// Google Maps + Uber deep links land in the right neighborhood. Swap this for a
// Google Places "nearby, open now" query when EXPO_PUBLIC_GOOGLE_MAPS_KEY is set.
const POOL = {
  bar: ["The Lock-In", "Last Call Saloon", "Encore Bar", "Neon Alley", "The Greenroom", "Amp Lounge"],
  food: ["Late Night Slice", "2AM Tacos", "The All-Niter Diner", "Noodle Bar", "Smash & Co.", "Dough Re Mi"],
  club: ["Afterhours", "The Basement", "Pulse", "Warehouse 9", "Strobe", "Subwoofer"],
  activity: ["Midnight Arcade", "Karaoke Box", "Rooftop Lounge", "24h Records"],
};
const TYPES = ["bar", "food", "club", "bar", "food", "activity"];
const CLOSE = ["12:30 AM", "1:00 AM", "1:30 AM", "2:00 AM", "2:00 AM", "3:00 AM"];

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = (seed) => { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

export function afterpartySpots(coord, count = 6) {
  if (!coord || coord.lat == null) return [];
  const rand = rng(hash(`${coord.lat.toFixed(4)},${coord.lng.toFixed(4)}`));
  const out = [];
  for (let i = 0; i < count; i++) {
    const type = TYPES[i % TYPES.length];
    const names = POOL[type];
    const name = names[Math.floor(rand() * names.length)];
    const dLat = (rand() - 0.5) * 0.012; // ~0.6 km
    const dLng = (rand() - 0.5) * 0.012;
    // ~1 deg lat ≈ 111 km; ~80 m per walking minute
    const km = Math.sqrt(dLat * dLat + dLng * dLng) * 111;
    const walk = Math.max(2, Math.round((km * 1000) / 80));
    out.push({ id: `ap${i}`, name, type, lat: coord.lat + dLat, lng: coord.lng + dLng, openUntil: CLOSE[i % CLOSE.length], walk });
  }
  // de-dupe identical names
  const seen = new Set();
  return out.filter((s) => (seen.has(s.name) ? false : seen.add(s.name)));
}

export const mapsDir = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
export const uberTo = (lat, lng, name) =>
  `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]=${lat}&dropoff[longitude]=${lng}&dropoff[nickname]=${encodeURIComponent(name)}`;
