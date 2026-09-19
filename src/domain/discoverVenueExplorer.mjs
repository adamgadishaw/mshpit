const normalized = value => String(value ?? "").trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().slice(0, 100);

// City selection and venue search are separate: typing never changes city.
export function discoverVenueCityMatches(cities, query) {
  const needle = normalized(query);
  return needle ? cities.filter(city => normalized(`${city.city} ${city.region}`).includes(needle)) : cities;
}

// The same city-scoped matches feed both the optional map and primary list.
export function discoverVenueExplorerRows(city, query) {
  if (!city) return [];
  const venues = Array.isArray(city.venues) ? city.venues : [];
  const needle = normalized(query);
  if (!needle) return venues;
  return venues.filter(venue => normalized(venue.name).includes(needle));
}

// City controls must not move when pressed: a second tap should stay in place.
export function discoverVenueCityChoices(cities, selectedId, limit = 6) {
  const shown = cities.slice(0, limit);
  const selected = cities.find(city => city.id === selectedId);
  if (selected && !shown.includes(selected)) shown[shown.length - 1] = selected;
  return shown;
}

export function discoverVenueMapPoints(venues, selectedId, limit = 24) {
  const mapped = venues.filter(venue => venue.coord);
  const points = mapped.slice(0, limit);
  const active = mapped.find(venue => venue.id === selectedId);
  if (active && !points.includes(active)) points[points.length - 1] = active;
  return { points, mappedCount: mapped.length, unmappedCount: venues.length - mapped.length };
}
