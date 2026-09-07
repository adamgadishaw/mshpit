import { GEO } from "./geo.js";
import { discoverCountryCode } from "./domain/discoverScene.mjs";
import { cityPath, slugify } from "./domain/urls.mjs";
import { cityIdentity } from "./domain/cityIdentity.mjs";

const text = (value) => typeof value === "string" ? value.trim() : "";
const cities = new Map();
for (const countries of Object.values(GEO)) {
  for (const [country, regions] of Object.entries(countries)) {
    for (const names of Object.values(regions)) {
      for (const city of names) {
        const key = slugify(city);
        const code = discoverCountryCode(country);
        if (!cities.has(key)) cities.set(key, new Set());
        if (code) cities.get(key).add(code);
      }
    }
  }
}

// Explicit country wins. A city name alone is linked only when the known
// directory gives it a single country; London, Ontario must not become London, UK.
export function cityIdentityForLocation(value) {
  const row = typeof value === "string" ? { city: value } : value || {};
  const city = text(row.venueCity || row.venue_city || row.city || row.citySlug).split(",")[0].trim();
  if (!city) return null;
  const placeParts = text(row.place || row.city).split(",").map((part) => part.trim());
  const explicit = text(row.countryCode || row.venueCountryCode || row.venue_country_code
    || row.country || row.venueCountry || row.venue_country);
  const countryCode = discoverCountryCode(explicit)
    || (placeParts.length > 1 ? discoverCountryCode(placeParts.at(-1)) : null);
  const known = cities.get(slugify(city));
  const code = countryCode || (known?.size === 1 ? [...known][0] : null);
  if (!code) return null;
  const region = text(row.region || row.venueRegion || row.venue_region || row.state)
    || (placeParts.length > 2 ? placeParts[1] : "");
  const identity = cityIdentity(code, city, region);
  return identity && cityPath(identity) ? identity : null;
}
