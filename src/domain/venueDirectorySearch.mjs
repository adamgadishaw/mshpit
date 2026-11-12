import { isVenuePlaceActionable, venuePlaceIdentity } from './venueDiscovery.mjs';

// Use the same bounded, authorized index as venue search. The old directory
// grouped a name-only projection and dropped distinct provider identities.
export function venueDirectoryCities(index, { filter } = {}) {
  const groups = new Map(), seen = new Set();
  for (const { row } of Array.isArray(index) ? index : []) {
    if (!row?.identity || seen.has(row.identity) || !isVenuePlaceActionable(row.place)
      || (filter && !filter(row))) continue;
    seen.add(row.identity);
    const place = venuePlaceIdentity(row.place);
    if (!groups.has(place.id)) groups.set(place.id, { ...place, venues: [], count: 0, upcoming: 0 });
    const group = groups.get(place.id);
    group.venues.push(row); group.count++;
    group.upcoming += Math.max(0, Number(row.upcoming) || 0);
  }
  return [...groups.values()];
}

const words = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function matchingVenueCities(cities, query) {
  const tokens = words(query).split(' ').filter(Boolean);
  if (!tokens.length) return [];
  return cities.filter(city => {
    const label = words(`${city.city} ${city.region}`);
    return tokens.every(token => label.includes(token));
  }).slice(0, 8);
}
