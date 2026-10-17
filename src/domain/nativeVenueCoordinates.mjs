import { mapCoordinate } from "./mapCoordinates.mjs";
// Same coordinate precedence as venueCoord: first valid rated row, then event.
export function nativeVenueCoordinates(ratedShows, tourDates, resolveKey) {
  const index = new Map();
  for (const row of [...ratedShows, ...tourDates]) {
    const coord = mapCoordinate(row);
    if (!coord) continue;
    const key = resolveKey(row.venue);
    if (key && !index.has(key)) index.set(key, coord);
  }
  return index;
}
