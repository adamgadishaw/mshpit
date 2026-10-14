// Preserve Nearby's counts while avoiding a global venues × events scan.
export function nativeNearbyVenues(venues, events, { center, maxKm, distance, canonicalKey, isUpcoming, now }) {
  const keys = new Map();
  const key = name => { if (!keys.has(name)) keys.set(name, canonicalKey(name)); return keys.get(name); };
  const nearby = venues.filter(v => v.coord).map(v => ({ ...v, distanceKm: distance(center, v.coord) }))
    .filter(v => v.distanceKm <= maxKm);
  const wanted = new Set(nearby.map(v => key(v.name))), counts = new Map();
  for (const event of events) {
    if (!isUpcoming(event) || !(event.releaseAt <= now)) continue;
    const venue = key(event.venue);
    if (wanted.has(venue)) counts.set(venue, (counts.get(venue) || 0) + 1);
  }
  return nearby.map(v => ({ ...v, upcoming: counts.get(key(v.name)) || 0 })).sort((a,b) => a.distanceKm - b.distanceKm);
}
