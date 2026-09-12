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
  return { lat: row.lat, lng: row.lng, precision: row.locationPrecision === "city" ? "city" : "venue" };
}

export function concertVenueKey(row) {
  const canonical = normalized(row?.venueKey);
  const venue = normalized(row?.venue), city = normalized(row?.city);
  // Catalogue venueKey binds a name, not a globally unique place. City is
  // always part of identity. Optional map-country metadata must not split a
  // private attendance row from its existing public review at the same room.
  if (canonical) return JSON.stringify([`venue:${canonical}`, city]);
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
      venue = { key: concert.venueIdentity, name: text(concert.venue) || "Venue not recorded", city: text(concert.city), country, coordinates: null, concerts: [] };
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
    countryCount: countries.size,
    mappedConcertCount: concerts.filter((row) => concertCoordinates(row)).length,
    unmappedConcertCount: concerts.filter((row) => !concertCoordinates(row)).length,
  };
}

const FRAMES = Object.freeze({
  World: { x: 0, y: 0, width: 360, height: 180 },
  "North America": { x: 5, y: 3, width: 135, height: 102 },
  "South America": { x: 95, y: 70, width: 58, height: 85 },
  Europe: { x: 153, y: 15, width: 77, height: 57 },
  Africa: { x: 155, y: 48, width: 83, height: 84 },
  Asia: { x: 200, y: 3, width: 170, height: 110 },
  Oceania: { x: 280, y: 64, width: 110, height: 90 },
  Antarctica: { x: 0, y: 146, width: 360, height: 34 },
});

export function concertHistoryFrame(model) {
  const single = model.countries.length === 1 ? model.countries[0].continent : null;
  const name = FRAMES[single] ? single : "World";
  return { name, ...FRAMES[name] };
}

export function concertMapViewport(frame, width, height, zoom = 1, center = null) {
  const ratio = Math.max(1, width) / Math.max(1, height);
  let mapWidth = frame.width, mapHeight = frame.height;
  if (mapWidth / mapHeight < ratio) mapWidth = mapHeight * ratio;
  else mapHeight = mapWidth / ratio;
  const scale = Math.max(1, Math.min(8, Number(zoom) || 1));
  const cx = scale > 1 && center ? center.lng + 180 : frame.x + frame.width / 2;
  const cy = scale > 1 && center ? 90 - center.lat : frame.y + frame.height / 2;
  return { x: cx - mapWidth / scale / 2, y: cy - mapHeight / scale / 2, width: mapWidth / scale, height: mapHeight / scale };
}

export function projectConcertPin(coordinates, viewport) {
  if (!coordinates) return null;
  const rawX = coordinates.lng + 180, center = viewport.x + viewport.width / 2;
  const x = rawX + Math.round((center - rawX) / 360) * 360;
  const xPct = (x - viewport.x) / viewport.width, yPct = (90 - coordinates.lat - viewport.y) / viewport.height;
  return { xPct, yPct, visible: xPct >= 0 && xPct <= 1 && yPct >= 0 && yPct <= 1 };
}

export function clusterConcertMapPins(venues, viewport, width, height) {
  const clusters = [];
  for (const venue of venues) {
    const point = projectConcertPin(venue.coordinates, viewport);
    if (!point?.visible) continue;
    const near = clusters.find((cluster) => Math.hypot((cluster.xPct - point.xPct) * width, (cluster.yPct - point.yPct) * height) < 40);
    if (near) near.venues.push(venue);
    else clusters.push({ key: venue.key, ...point, venues: [venue] });
  }
  return clusters;
}

export function concertHistorySummary(model, complete) {
  const count = (value, label) => `${value.toLocaleString("en")} ${label}${value === 1 ? "" : "s"}`;
  const parts = [count(model.concertCount, "concert"), count(model.venueCount, "venue")];
  if (model.countryCount) parts.push(count(model.countryCount, "country").replace("countrys", "countries"));
  return `${parts.join(" · ")}${complete ? "" : " · partial history"}`;
}
