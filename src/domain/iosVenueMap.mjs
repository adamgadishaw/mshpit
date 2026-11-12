import { mapCoordinate } from "./mapCoordinates.mjs";

export const IOS_VENUE_MAP_LIMIT = 24;
export const IOS_VENUE_MAP_TIMEOUT_MS = 15000;

// Code-point truncation cannot split emoji. Replace any already-unpaired source
// surrogate so a malformed provider label cannot make encodeURIComponent throw.
const mapLabel = value => Array.from(String(value || "Venue")).slice(0, 200)
  .map(character => character.length === 1 && /^[\uD800-\uDFFF]$/.test(character) ? "\uFFFD" : character).join("");

// Only coordinates supplied by the current city-scoped venue list. No geocoding,
// device position, guessed locations, provider credentials or additional reads.
export function iosVenueMapModel(venues, selected) {
  const rows = Array.isArray(venues) ? venues : [];
  const ids = new Set();
  const mapped = [];
  rows.forEach((row, index) => {
    if (!row || !["string", "number"].includes(typeof row.id)) return;
    const id = String(row.id);
    const coord = mapCoordinate(row.coord);
    if (!id.trim() || !coord || Math.abs(coord.lat) > 85 || ids.has(id)) return;
    ids.add(id);
    mapped.push({ id, name: mapLabel(row.name), latitude: coord.lat, longitude: coord.lng, number: index + 1, sourceId: row.id });
  });
  const selectedId = selected == null ? null : String(selected);
  const active = mapped.find(point => point.id === selectedId) || null;
  const points = mapped.slice(0, IOS_VENUE_MAP_LIMIT);
  if (active && !points.includes(active)) points[points.length - 1] = active;
  const nativePoints = points.map(({ sourceId, ...point }) => point);
  return { points, nativePoints, active, mappedCount: mapped.length,
    unmappedCount: rows.length - mapped.length, key: JSON.stringify(nativePoints) };
}

export function iosVenueMapsURL(point) {
  if (!point || !mapCoordinate({ lat: point.latitude, lng: point.longitude })) return null;
  return `https://maps.apple.com/?ll=${point.latitude},${point.longitude}&q=${encodeURIComponent(mapLabel(point.name))}`;
}
