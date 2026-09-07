export function cityText(copy, key, values = {}) {
  const text = typeof copy?.[key] === "string" ? copy[key] : "";
  return text.replace(/\{([a-zA-Z]+)\}/g, (match, name) => values[name] == null ? match : String(values[name]));
}
export function orderedCityPhotos(photos = [], stockImage = null) {
  const seen = new Set();
  const result = [];
  for (const photo of Array.isArray(photos) ? photos : []) {
    if (photo?.kind !== "fan" || !photo.url || seen.has(photo.url)) continue;
    seen.add(photo.url);
    result.push(photo);
    if (result.length === 8) break;
  }
  const stock = stockImage || (Array.isArray(photos) ? photos.find((photo) => photo?.kind === "city") : null);
  if (stock?.url && !seen.has(stock.url)) result.push({ ...stock, kind: "city" });
  return result;
}
export function cityLocalClock(value) {
  if (typeof value !== "string" || value.length > 80) return "";
  // Providers store either a wall-clock time or an ISO local date/time. Read
  // only its clock component; converting through Date shifts the venue's time.
  const match = value.trim().match(/^(?:(\d{4}-\d{2}-\d{2})[T ])?([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?$/);
  if (!match || (match[1] && !cityDateStamp(match[1]))) return "";
  return `${match[2].padStart(2, "0")}:${match[3]}`;
}
export function cityShowTime(show) {
  const date = String(show?.date || "").slice(0, 10);
  const time = cityLocalClock(show?.startLocalTime);
  if (!cityDateStamp(date)) return time;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return time;
  return [parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }), time].filter(Boolean).join(" · ");
}
export function cityDateStamp(dateValue) {
  const date = String(dateValue || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return { month: parsed.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" }).toUpperCase(), day: date.slice(8), year: date.slice(0, 4) };
}
export function cityShowNavigation(show, city) {
  return { ...show, tourDateId: show.id, performanceEvent: true, city: city.city,
    venueCity: city.city, countryCode: city.countryCode, venueCountryCode: city.countryCode,
    ticketUrl: show.url || null, eventEndDate: show.endDate || null };
}
export function cityGalleryItems(photos) {
  return photos.map((photo) => {
    const license = Object.entries(VENUE_PHOTO_LICENSES).find(([, entry]) => entry.url.replace(/\/$/, "") === String(photo.licenseUrl || "").replace(/\/$/, ""))?.[0];
    return { ...photo, uri: photo.url, kind: "image", altText: photo.alt || "", by: photo.credit || null,
      ...(license && photo.credit && photo.sourceUrl ? { source: "licensed", creator: photo.credit, sourcePage: photo.sourceUrl, license } : {}) };
  });
}
import { VENUE_PHOTO_LICENSES } from "../../domain/venuePhotoProvenance.mjs";
