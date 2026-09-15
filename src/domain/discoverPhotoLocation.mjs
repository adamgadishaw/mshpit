import { GEO } from "./geo.mjs";
import { discoverCountryCode, discoverCountryIdentity, discoverCountryLabel } from "./discoverScene.mjs";
import { cityIdentity } from "./cityIdentity.mjs";

const clean = (value) => typeof value === "string" ? value.trim().slice(0, 240) : "";
const identity = (value) => clean(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en");
const cities = new Map();
for (const continent of Object.values(GEO)) for (const [country, regions] of Object.entries(continent)) {
  for (const [region, names] of Object.entries(regions)) for (const city of names) {
    const key = identity(city);
    const rows = cities.get(key) || [];
    rows.push({ country, countryCode: discoverCountryCode(country), region: identity(region) });
    cities.set(key, rows);
  }
}

export function discoverPhotoCity(value) {
  return identity(clean(value).split(",")[0]);
}

// Use the concert's authored location, never the member's home or IP location.
// Qualified city strings work without downloading a geocoder. Ambiguous or
// unknown cities remain in Worldwide, not a guessed country's photo gallery.
export function discoverPhotoCountry(value) {
  const parts = clean(value).split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return "";
  const cityCandidates = cities.get(identity(parts[0])) || [];
  // A city-qualified US/Canadian region code beats the same two-letter country
  // code: Los Angeles, CA is California, not Canada; London, ON is Ontario.
  if (parts.length === 2) {
    const qualified = cityCandidates.filter((row) => identity(cityIdentity(row.countryCode, parts[0], parts[1])?.region) === row.region);
    const countries = [...new Set(qualified.map((row) => discoverCountryIdentity(row.country)))];
    if (countries.length === 1) return countries[0];
  }
  const explicit = parts.length > 1 ? discoverCountryLabel(parts.at(-1)) : "";
  if (explicit) return discoverCountryIdentity(explicit);
  const candidates = cityCandidates.filter((row) =>
    parts.slice(1).every((qualifier) => identity(qualifier) === row.region));
  const countries = [...new Set(candidates.map((row) => discoverCountryIdentity(row.country)))];
  return countries.length === 1 ? countries[0] : "";
}
