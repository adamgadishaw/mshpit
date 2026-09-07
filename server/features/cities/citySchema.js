import { readFileSync } from "node:fs";
import { arenaVenueEntries } from "../../../src/domain/majorVenueFacts.mjs";
import { GEO } from "../../../src/domain/geo.mjs";
import { slugify } from "../../../src/domain/urls.mjs";
import { DEFAULT_CITY_COPY,CITY_COPY_PREVIOUS_DEFAULTS } from "./cityCopy.js";
import { cityIdentity, validateCityEditorial, validateCityCopy } from "./cityValidation.js";
import { CITY_EDITORIAL_SEEDS,CITY_EDITORIAL_PREVIOUS_SEEDS,CITY_WELCOME_BANNER } from "./cityEditorialSeeds.js";
import { upgradeCityCopyDefaults,upgradeCityEditorialSeeds } from "./citySeedUpgrades.js";

let trustedVenues;
function countryLookup() {
  const names = new Intl.DisplayNames(["en"], { type: "region" }), out = new Map();
  for (let a=65;a<=90;a++) for (let b=65;b<=90;b++) {
    const code = String.fromCharCode(a,b), name = names.of(code);
    if (name && name !== code) out.set(name.toLowerCase(), code);
  }
  for (const [name,code] of [["united states","US"],["united states of america","US"],["usa","US"],
    ["united kingdom","GB"],["uk","GB"],["england","GB"],["scotland","GB"],["wales","GB"],["czech republic","CZ"],
    ["south korea","KR"],["republic of korea","KR"],["taiwan","TW"]]) out.set(name,code);
  return out;
}
export function trustedCityVenues() {
  if (trustedVenues) return trustedVenues;
  let catalog = {};
  try { catalog = JSON.parse(readFileSync(new URL("../../../src/seed/catalog.core.json", import.meta.url), "utf8")).venues || {}; }
  catch { /* Curated venue facts remain usable without the optional catalog. */ }
  const countries = countryLookup();
  trustedVenues = Object.entries({ ...catalog, ...Object.fromEntries(arenaVenueEntries) }).flatMap(([key,venue]) => {
    const parts = String(venue.place || "").split(",").map((v) => v.trim()).filter(Boolean);
    const country = venue.country || parts.at(-1) || "";
    const code = String(venue.countryCode || countries.get(country.toLowerCase()) || "").toUpperCase();
    const identity = cityIdentity(code, venue.city || parts[0], venue.region || (parts.length>=3 ? parts[1] : ""));
    if (!identity || !venue.name) return [];
    return [{ ...identity, country, key, name: venue.name, lat: venue.lat ?? null, lng: venue.lng ?? null,
      capacity: Number(venue.capacity) || null }];
  });
  return trustedVenues;
}

export function ensureCitySchema(database, { venues = trustedCityVenues(), seeds = CITY_EDITORIAL_SEEDS,
  previousSeeds = CITY_EDITORIAL_PREVIOUS_SEEDS,banner = CITY_WELCOME_BANNER,geo = GEO } = {}) {
  database.function?.("pit_public_slug", { deterministic: true }, slugify);
  // Persistent indexes must stay readable by independent backup/repair clients.
  const previousCityIndex=database.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_city_tour_location'").get();
  if (previousCityIndex?.sql && !previousCityIndex.sql.includes("lower(trim(venue)),date")) database.exec("DROP INDEX idx_city_tour_location");
  database.exec(`
    CREATE TABLE IF NOT EXISTS city_profiles (
      country_code TEXT NOT NULL,city_slug TEXT NOT NULL,city TEXT NOT NULL,country TEXT NOT NULL DEFAULT '',region TEXT NOT NULL DEFAULT '',
      editorial_json TEXT NOT NULL DEFAULT '{}',revision INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      PRIMARY KEY(country_code,city_slug)
    );
    CREATE TABLE IF NOT EXISTS city_site_copy (
      id TEXT PRIMARY KEY CHECK(id='city'),copy_json TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,updated_by TEXT REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS city_catalog_venues (
      venue_key TEXT PRIMARY KEY,name TEXT NOT NULL,city TEXT NOT NULL,city_slug TEXT NOT NULL,
      country_code TEXT NOT NULL,country TEXT NOT NULL,region TEXT NOT NULL DEFAULT '',latitude REAL,longitude REAL,capacity INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_city_catalog_location ON city_catalog_venues(country_code,city_slug,name);
    CREATE INDEX IF NOT EXISTS idx_city_catalog_name ON city_catalog_venues(name COLLATE NOCASE,country_code,city_slug);
    CREATE INDEX IF NOT EXISTS idx_city_tour_location ON tour_dates(
      upper(trim(venue_country_code)),lower(trim(venue_city)),lower(trim(venue)),date,id
    ) WHERE trim(COALESCE(venue_city,''))<>'';
  `);
  for(const table of ["city_profiles","city_catalog_venues"]) {
    if(!database.prepare(`PRAGMA table_info(${table})`).all().some(column=>column.name==="region")) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN region TEXT NOT NULL DEFAULT ''`);
    }
  }
  const venueInsert = database.prepare(`INSERT INTO city_catalog_venues
    (venue_key,name,city,city_slug,country_code,country,latitude,longitude,capacity,region) VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(venue_key) DO UPDATE SET city=excluded.city,city_slug=excluded.city_slug,region=excluded.region,
      country_code=excluded.country_code,country=excluded.country`);
  for (const venue of venues) venueInsert.run(venue.key,venue.name,venue.city,venue.citySlug,venue.countryCode,venue.country,
    venue.lat ?? null,venue.lng ?? null,venue.capacity ?? null,venue.region || "");
  const seedInsert = database.prepare(`INSERT INTO city_profiles
    (country_code,city_slug,city,country,editorial_json,region) VALUES (?,?,?,?,?,?)
    ON CONFLICT(country_code,city_slug) DO UPDATE SET editorial_json=excluded.editorial_json
    WHERE city_profiles.revision=0 AND city_profiles.updated_by IS NULL AND city_profiles.updated_at=0
      AND city_profiles.editorial_json='{}'`);
  for (const seed of seeds) {
    const identity = cityIdentity(seed.countryCode,seed.city,seed.region);
    if (!identity) continue;
    const editorial = validateCityEditorial(seed.editorial);
    seedInsert.run(identity.countryCode,identity.citySlug,identity.city,seed.country || "",JSON.stringify(editorial),identity.region);
  }
  upgradeCityEditorialSeeds(database,seeds,previousSeeds);
  const countries = countryLookup();
  for (const continent of Object.values(geo)) for (const [country, regions] of Object.entries(continent)) {
    const code = countries.get(country.toLowerCase());
    if (!code) continue;
    for (const [region,names] of Object.entries(regions)) for (const name of names) {
      const identity = cityIdentity(code,name,region);
      if (identity) seedInsert.run(identity.countryCode,identity.citySlug,identity.city,country,"{}",identity.region);
    }
  }
  const copy = { ...DEFAULT_CITY_COPY, ...(banner?.url ? {
    welcomeBannerUrl: banner.url,welcomeBannerAlt: banner.alt,welcomeBannerCredit: banner.credit || "",
    welcomeBannerSourceUrl: banner.sourceUrl || "",welcomeBannerLicenseUrl: banner.licenseUrl || "",welcomeBannerOwned: !!banner.owned,
  } : {}) };
  database.prepare("INSERT OR IGNORE INTO city_site_copy (id,copy_json) VALUES ('city',?)").run(JSON.stringify(validateCityCopy(copy)));
  upgradeCityCopyDefaults(database,copy,CITY_COPY_PREVIOUS_DEFAULTS);
}
