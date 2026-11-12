import { GEO, formatPlace } from "../../../src/domain/geo.mjs";
import { cityIdentity } from "../../../src/domain/cityIdentity.mjs";
import { currentOrUpcomingTourDateRow } from "../../tourDateLifecycle.js";

const normalize = (value) => String(value || "").normalize("NFC").trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
const countryCodes = new Map();
const names = new Intl.DisplayNames(["en"], { type: "region" });
for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
  const code = String.fromCharCode(a, b);
  if (names.of(code) !== code) countryCodes.set(normalize(names.of(code)), code);
}
for (const [name, code] of [["united states", "US"], ["united kingdom", "GB"], ["south korea", "KR"], ["czech republic", "CZ"]]) countryCodes.set(name, code);
// Finite catalogue index, public non-account data, built once. No free-text
// country guessing or proximity matching: ambiguous labels deliberately fail.
const places = new Map();
for (const continent of Object.values(GEO)) for (const [country, regions] of Object.entries(continent)) {
  const code = countryCodes.get(normalize(country));
  for (const [region, cities] of Object.entries(regions)) for (const city of cities) {
    const identity = cityIdentity(code, city, region);
    if (!identity) continue;
    for (const label of [city, `${city}, ${country}`, formatPlace({ city, state: region, country })]) {
      const key = normalize(label), matches = places.get(key) || new Map();
      matches.set(identity.path, identity);
      places.set(key, matches);
    }
  }
}

export function resolveAlertHomeCity(label) {
  if (typeof label !== "string" || label.length > 300) return null;
  const matches = places.get(normalize(label));
  return matches?.size === 1 ? [...matches.values()][0] : null;
}

export function resolveAlertEventCity(event) {
  if (!event) return null;
  if (event.venue_country_code && event.venue_city) {
    return cityIdentity(event.venue_country_code, event.venue_city, event.venue_region);
  }
  // Creator calendar records use the same place label as the location picker.
  // Never parse an unstructured provider venue/place into an invented country.
  return event.owner_id && event.music_evidence === "mshpit:creator-calendar"
    ? resolveAlertHomeCity(event.place) : null;
}

export function alertEventIsCurrent(event, at) {
  if (!event || !Number.isSafeInteger(at)) return false;
  if (event.release_at > at || (!event.owner_id && event.provider_active === 0)) return false;
  if (["cancelled", "canceled", "postponed", "offsale", "rescheduled"].includes(normalize(event.event_status))) return false;
  return currentOrUpcomingTourDateRow(event, new Date(at).toISOString().slice(0, 10));
}

export function exactSaleTimestamp(value) {
  // A public sale needs a complete, real date and an explicit UTC offset.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const day = value.slice(0, 10);
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return null;
  const dayAt = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(dayAt) || new Date(dayAt).toISOString().slice(0, 10) !== day) return null;
  const at = Date.parse(value);
  return Number.isSafeInteger(at) ? at : null;
}

export function ticketmasterPublicSale(providerEvent) {
  const sale = providerEvent?.sales?.public;
  if (!providerEvent?.id || !sale || ![undefined, false].includes(sale.startTBD) || ![undefined, false].includes(sale.startTBA)) return null;
  const startsAt = exactSaleTimestamp(sale.startDateTime);
  const endsAt = sale.endDateTime == null ? null : exactSaleTimestamp(sale.endDateTime);
  if (startsAt == null || (sale.endDateTime != null && endsAt == null) || (endsAt != null && endsAt <= startsAt)) return null;
  return { providerEventId: String(providerEvent.id), startsAt, endsAt };
}

export const DEFAULT_LOCAL_ALERT_PREFERENCES = Object.freeze({ datesInbox: true, salesInbox: true, datesPush: false, salesPush: false });
export const SALE_FRESHNESS_MS = 24 * 60 * 60 * 1000;
export const SALE_DELIVERY_WINDOW_MS = 2 * 60 * 60 * 1000;
export const DATE_DELIVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
