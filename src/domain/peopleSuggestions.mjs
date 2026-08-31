const EARTH_RADIUS_KM = 6371;

const normalized = (value) => String(value || "").trim().toLocaleLowerCase();
const finite = (value) => (value == null || value === "" || !Number.isFinite(Number(value))
  ? null
  : Number(value));

const normalizedSet = (values) => new Set((Array.isArray(values) ? values : [])
  .map(normalized)
  .filter(Boolean));

function sharedValues(left, right) {
  const rightSet = normalizedSet(right);
  const shared = [];
  const seen = new Set();
  for (const value of Array.isArray(left) ? left : []) {
    const key = normalized(value);
    if (!key || seen.has(key) || !rightSet.has(key)) continue;
    seen.add(key);
    shared.push(String(value).trim());
  }
  return shared;
}

export function peopleSuggestionDistanceKm(left, right) {
  const lat1 = finite(left?.lat);
  const lng1 = finite(left?.lng);
  const lat2 = finite(right?.lat);
  const lng2 = finite(right?.lng);
  if ([lat1, lng1, lat2, lng2].some((value) => value == null)) return null;
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function locationScore(distanceKm, sameCity) {
  if (distanceKm == null) return sameCity ? 80 : 0;
  if (distanceKm <= 25) return 100;
  if (distanceKm <= 100) return 82;
  if (distanceKm <= 250) return 64;
  if (distanceKm <= 1000) return 34;
  return 8;
}

function suggestionReason({ city, sameCity, sharedArtists, sharedGenres, showCount }) {
  const parts = [];
  if (city) parts.push(city);
  if (sharedArtists.length) {
    parts.push(sharedArtists.length === 1 ? `Also likes ${sharedArtists[0]}` : `${sharedArtists.length} shared artists`);
  } else if (sharedGenres.length) {
    parts.push(sharedGenres.length === 1 ? `Also likes ${sharedGenres[0]}` : `${sharedGenres.length} shared genres`);
  } else if (showCount > 0) {
    parts.push(`${showCount} ${showCount === 1 ? "show" : "shows"} logged`);
  }
  return parts.slice(0, 2).join(" · ") || "A fan to follow";
}

// This is deliberately explainable rather than engagement-maximizing. Nearby
// fans lead, shared declared artists/genres can move somebody within a broad
// distance band, and show history only breaks otherwise close ties. Exact
// distances stay inside the ranking result and must never be sent to clients.
export function rankPeopleSuggestions({ viewer, candidates, limit = 5 } = {}) {
  const cappedLimit = Math.max(0, Math.min(20, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 5));
  if (!viewer?.id || !cappedLimit) return [];
  const viewerHome = viewer.home || {};
  const viewerCity = normalized(viewerHome.city);

  return (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => candidate?.id && candidate.id !== viewer.id)
    .map((candidate) => {
      const home = candidate.home || {};
      const sameCity = !!viewerCity && normalized(home.city) === viewerCity;
      const distanceKm = peopleSuggestionDistanceKm(viewerHome, home);
      const sharedArtists = sharedValues(viewer.favoriteArtists, candidate.favoriteArtists);
      const sharedGenres = sharedValues(viewer.genres, candidate.genres);
      const showCount = Math.max(0, Number(candidate.showCount) || 0);
      const tasteScore = Math.min(36, sharedArtists.length * 12) + Math.min(18, sharedGenres.length * 6);
      const activityScore = Math.min(10, showCount) * 0.5;
      return {
        ...candidate,
        sharedArtists,
        sharedGenres,
        distanceKm,
        score: locationScore(distanceKm, sameCity) + tasteScore + activityScore,
        reason: suggestionReason({ city: home.city, sameCity, sharedArtists, sharedGenres, showCount }),
      };
    })
    .sort((left, right) => right.score - left.score
      || (left.distanceKm ?? Number.POSITIVE_INFINITY) - (right.distanceKm ?? Number.POSITIVE_INFINITY)
      || right.sharedArtists.length - left.sharedArtists.length
      || right.sharedGenres.length - left.sharedGenres.length
      || right.showCount - left.showCount
      || String(left.name || "").localeCompare(String(right.name || "")))
    .slice(0, cappedLimit);
}
