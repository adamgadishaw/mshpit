// Calendar dates remain strings: never shift a selected day through a timezone.
export function concertLookupDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}
const identity = (value) => String(value || "").normalize("NFKC").trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
export function concertCityMatches(place, city) {
  const wanted = identity(city).split(",").map(part => part.trim()).filter(Boolean);
  const parts = identity(place).split(",").map(part => part.trim()).filter(Boolean);
  return !!wanted.length && wanted[0] === parts[0] && wanted.slice(1).every(part => parts.includes(part));
}
export function mergeConcertMatches(...sets) {
  const byId = new Map();
  for (const row of sets.flat()) if (row?.id) byId.set(row.id, byId.has(row.id) ? { ...row, ...byId.get(row.id) } : row);
  const groups = new Map();
  for (const row of byId.values()) {
    const key = [row.artistKey || row.artist, row.venue, row.city.split(",")[0], row.date].map(identity).join("\0");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].flatMap(rows => {
    const events = rows.filter(row => row.eventId);
    const compatible = (a, b) => concertCityMatches(a.city, b.city) || concertCityMatches(b.city, a.city);
    // Keep distinct provider events: matching fields can describe two sets.
    // A short community city label may describe a more complete catalog match,
    // but disambiguated cities in different regions must never collapse.
    const kept = [...events];
    for (const row of rows.filter(row => !row.eventId).sort((a, b) => b.city.length - a.city.length)) {
      if (!kept.some(candidate => compatible(row, candidate))) kept.push(row);
    }
    return kept;
  }).sort((a, b) => a.venue.localeCompare(b.venue) || (a.startLocalTime || "").localeCompare(b.startLocalTime || "") || a.id.localeCompare(b.id));
}
