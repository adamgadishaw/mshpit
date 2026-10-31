import { isVenuePlaceActionable, venuePlaceIdentity } from "./venueDiscovery.mjs";

// Consume the same bounded, identity-qualified rows as venue search. Do not
// rejoin by name: separate provider rooms can share a name and city.
export function venueDirectoryGroups(index) {
  const groups = new Map();
  for (const { row } of index) {
    if (!isVenuePlaceActionable(row.place)) continue;
    const place = venuePlaceIdentity(row.place);
    if (!groups.has(place.id)) groups.set(place.id, { ...place, venues: [] });
    groups.get(place.id).venues.push({ ...row });
  }
  return [...groups.values()]
    .map(group => ({
      ...group,
      count: group.venues.length,
      upcoming: group.venues.reduce((sum, venue) => sum + venue.upcoming, 0),
      venues: group.venues.sort((a, b) => b.upcoming - a.upcoming || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
}
