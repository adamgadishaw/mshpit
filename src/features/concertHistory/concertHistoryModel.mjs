import { toIsoDate } from "../../domain/dates.mjs";
import { countryMetadata } from "./countryMetadata.mjs";

const text = (value) => typeof value === "string" ? value.trim() : "";
const normalized = (value) => text(value).normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
const countryByCode = new Map(countryMetadata.map((country) => [country.code, country]));
const countryByName = new Map(countryMetadata.map((country) => [normalized(country.name), country]));
for (const [name, code] of [["united states", "US"], ["usa", "US"], ["uk", "GB"], ["czech republic", "CZ"], ["south korea", "KR"]]) {
  if (countryByCode.has(code)) countryByName.set(name, countryByCode.get(code));
}

export function concertCountry(row) {
  const code = text(row?.countryCode).toUpperCase();
  const known = countryByCode.get(code) || countryByName.get(normalized(row?.country));
  if (known) return known;
  // Unknown country metadata is not a license to infer a location from a city.
  return code || text(row?.country) ? { code: code || normalized(row.country), name: text(row.country) || code, continent: null } : null;
}

export function concertCoordinates(row) {
  // Do not turn null, blanks, or numeric strings into a pin at 0,0. The server
  // provides validated venue coordinates; an explicit city precision stays
  // approximate and is labelled as such throughout the presentation.
  if (typeof row?.lat !== "number" || typeof row?.lng !== "number"
    || !Number.isFinite(row.lat) || !Number.isFinite(row.lng)
    || row.lat < -90 || row.lat > 90 || row.lng < -180 || row.lng > 180) return null;
  if (row.locationPrecision && !["venue", "city"].includes(row.locationPrecision)) return null;
  if (!text(row.venue) && row.locationPrecision !== "city") return null;
  return { lat: row.lat, lng: row.lng, precision: row.locationPrecision === "city" ? "city" : "venue" };
}

export function concertLocationLabel(row) {
  const venue = text(row?.venue), address = text(row?.eventAddress), city = text(row?.city);
  return [venue || address, city].filter(Boolean).join(" · ") || "Location not recorded";
}

export function concertLocationPhrase(row) {
  if (text(row?.venue)) return `at ${text(row.venue)}`;
  if (text(row?.eventAddress)) return `at ${concertLocationLabel(row)}`;
  return text(row?.city) ? `in ${text(row.city)}` : "at an unrecorded location";
}

export function concertVenueKey(row) {
  const canonical = normalized(row?.venueKey);
  const venue = normalized(row?.venue), city = normalized(row?.city);
  // Catalogue venueKey binds a name, not a globally unique place. City is
  // always part of identity. Optional map-country metadata must not split a
  // private attendance row from its existing public review at the same room.
  if (canonical && venue) return JSON.stringify([`venue:${canonical}`, city]);
  const address = normalized(row?.eventAddress);
  if (!venue && city && concertCoordinates(row)?.precision === "city") {
    // One city pin can hold several separate nights. This is only map grouping;
    // concertNightKey deliberately never deduplicates venue-less posts.
    return JSON.stringify([address ? "address" : "city", address, city, concertCountry(row)?.code || "", row.lat, row.lng]);
  }
  // Missing venue identity must never group unrelated unmapped concerts.
  return venue ? JSON.stringify([venue, city]) : `unknown:${text(row?.postId) || text(row?.id)}`;
}

export function concertNightKey(row) {
  const date = toIsoDate(row?.date), artist = normalized(row?.artist);
  return artist && date && text(row?.venue) ? JSON.stringify([artist, concertVenueKey(row), date])
    : `post:${text(row?.postId) || text(row?.id)}`;
}

const compareRows = (a, b) => (toIsoDate(b.date) || "").localeCompare(toIsoDate(a.date) || "")
  || Number(!!text(b.postId)) - Number(!!text(a.postId))
  || String(a.postId || a.id).localeCompare(String(b.postId || b.id));

export function concertHistoryModel(rows = []) {
  const ordered = (Array.isArray(rows) ? rows : []).filter((row) => row && (text(row.id) || text(row.postId)))
    .slice().sort(compareRows);
  const nights = new Map();
  for (const row of ordered) {
    const key = concertNightKey(row);
    if (!nights.has(key)) nights.set(key, { ...row, id: text(row.id) || text(row.postId), venueIdentity: concertVenueKey(row) });
  }
  const concerts = [...nights.values()];
  const venueMap = new Map(), countries = new Map(), artists = new Set();
  for (const concert of concerts) {
    if (text(concert.artist)) artists.add(normalized(concert.artist));
    const country = concertCountry(concert);
    if (country) countries.set(country.code, country);
    let venue = venueMap.get(concert.venueIdentity);
    if (!venue) {
      const name = text(concert.venue) || text(concert.eventAddress) || text(concert.city) || "Location not recorded";
      venue = { key: concert.venueIdentity, name, city: name === text(concert.city) ? "" : text(concert.city), hasVenue: !!text(concert.venue), country, coordinates: null, concerts: [] };
      venueMap.set(venue.key, venue);
    }
    venue.concerts.push(concert);
    const coordinates = concertCoordinates(concert);
    if (coordinates && (!venue.coordinates || venue.coordinates.precision === "city" && coordinates.precision === "venue")) venue.coordinates = coordinates;
  }
  const venues = [...venueMap.values()];
  return {
    concerts, venues, countries: [...countries.values()],
    concertCount: concerts.length, artistCount: artists.size,
    venueCount: venues.filter((venue) => venue.concerts.some((row) => text(row.venue))).length,
    cityLocationCount: new Set(concerts.filter((row) => !text(row.venue) && text(row.city)).map((row) => JSON.stringify([normalized(row.city), concertCountry(row)?.code || ""]))).size,
    countryCount: countries.size,
    mappedConcertCount: concerts.filter((row) => concertCoordinates(row)).length,
    unmappedConcertCount: concerts.filter((row) => !concertCoordinates(row)).length,
  };
}

export function concertHistorySummary(model, complete) {
  const count = (value, label) => `${value.toLocaleString("en")} ${label}${value === 1 ? "" : "s"}`;
  const parts = [count(model.concertCount, "concert")];
  if (model.venueCount || !model.cityLocationCount) parts.push(count(model.venueCount, "venue"));
  if (model.cityLocationCount) parts.push(count(model.cityLocationCount, "city location"));
  if (model.countryCount) parts.push(count(model.countryCount, "country").replace("countrys", "countries"));
  return `${parts.join(" · ")}${complete ? "" : " · partial history"}`;
}
