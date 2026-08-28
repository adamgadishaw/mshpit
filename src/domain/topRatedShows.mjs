const clean = (value, maximum = 240) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/gu, "").replace(/\s+/gu, " ").trim().slice(0, maximum)
  : "";
const finiteCount = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;

export function normalizeTopRatedShows(rows, { limit = 30 } = {}) {
  const maximum = Number.isFinite(Number(limit)) ? Math.max(0, Math.min(30, Math.trunc(Number(limit)))) : 30;
  const normalized = [];
  const seen = new Set();
  for (const candidate of Array.isArray(rows) ? rows : []) {
    if (!candidate || typeof candidate !== "object") continue;
    const artist = clean(candidate.artist, 160);
    const venue = clean(candidate.venue, 180);
    const date = clean(candidate.date, 40);
    const avgRating = Number(candidate.avgRating);
    const ratingCount = finiteCount(candidate.ratingCount);
    const key = clean(candidate.key, 800);
    if (!artist || !venue || !date || !key || seen.has(key)
      || !Number.isFinite(avgRating) || avgRating < 1 || avgRating > 5 || ratingCount < 1) continue;
    seen.add(key);
    normalized.push({
      ...candidate,
      key,
      artist,
      artistKey: clean(candidate.artistKey, 180) || null,
      venue,
      venueKey: clean(candidate.venueKey, 180) || null,
      city: clean(candidate.city, 180),
      place: clean(candidate.place, 240) || clean(candidate.city, 180),
      date,
      tourName: clean(candidate.tourName, 180) || null,
      avgRating,
      ratingCount,
      reviewCount: finiteCount(candidate.reviewCount),
      rankScore: Number.isFinite(Number(candidate.rankScore)) ? Number(candidate.rankScore) : null,
      source: clean(candidate.source, 40) || null,
      providerVenueId: clean(candidate.providerVenueId, 180) || null,
      venueIdentity: clean(candidate.venueIdentity, 420) || null,
      venueCity: clean(candidate.venueCity, 120) || null,
      venueRegion: clean(candidate.venueRegion, 120) || null,
      venueCountryCode: clean(candidate.venueCountryCode, 8).toLocaleUpperCase("en") || null,
      venueCountry: clean(candidate.venueCountry, 80) || null,
    });
    if (normalized.length >= maximum) break;
  }
  return normalized;
}

export function topRatedShowCities(rows) {
  const cities = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const city = clean(row?.venueCity || row?.city?.split(",")[0], 120);
    const identity = city.toLocaleLowerCase("en");
    if (!city || cities.has(identity)) continue;
    cities.set(identity, city);
  }
  return [...cities.values()].sort((left, right) => left.localeCompare(right));
}

export function topRatedShowMatchesCity(row, city) {
  const requested = clean(city, 120).toLocaleLowerCase("en");
  if (!requested) return true;
  return clean(row?.venueCity || row?.city?.split(",")[0], 120).toLocaleLowerCase("en") === requested;
}

export function topRatedShowNavigation(row) {
  if (!row) return null;
  return {
    ...row,
    key: row.key,
    performanceEvent: true,
    overall: row.avgRating,
    ratingCount: row.ratingCount,
    city: row.place || row.city || "",
    tour: row.tourName || "",
    review: "",
    media: 0,
    likes: 0,
    comments: 0,
    setlist: [],
    inTourWindow: false,
  };
}
