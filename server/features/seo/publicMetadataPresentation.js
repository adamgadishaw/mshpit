import { isStrictCalendarDate } from "./publicEntityPolicy.js";

const line = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
const dateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthFormatter = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
const dateObject = (value) => isStrictCalendarDate(value) ? new Date(`${value}T00:00:00Z`) : null;

export function publicMetadataSummary(value, maximum = 160) {
  const text = line(value);
  if (text.length <= maximum) return text;
  const sample = text.slice(0, maximum - 1), boundary = sample.lastIndexOf(" ");
  return `${(boundary > maximum * 0.6 ? sample.slice(0, boundary) : sample).trimEnd()}…`;
}

export function publicEventDateLabel(date, endDate = null) {
  const start = dateObject(date), end = dateObject(endDate);
  if (!start) return null;
  if (!end || endDate <= date) return dateFormatter.format(start);
  if (start.getUTCFullYear() !== end.getUTCFullYear()) return `${dateFormatter.format(start)}–${dateFormatter.format(end)}`;
  const endLabel = `${end.getUTCDate()}, ${end.getUTCFullYear()}`;
  return `${monthFormatter.format(start)} ${start.getUTCDate()}–${start.getUTCMonth() === end.getUTCMonth() ? "" : `${monthFormatter.format(end)} `}${endLabel}`;
}

// Provider local-time fields sometimes contain a complete naive ISO datetime.
// Read the wall-clock components, never reinterpret them in the server's zone.
export function publicEventTimeLabel(value) {
  const input = line(value);
  const parts = /^(?:(\d{4}-\d{2}-\d{2})T)?(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(input);
  if (!parts || (parts[1] && !isStrictCalendarDate(parts[1]))) return null;
  const hour = Number(parts[2]), minute = Number(parts[3]), second = Number(parts[4] || 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${hour < 12 ? "AM" : "PM"}`;
}

// Inputs are already privacy-filtered public projections. Status and exact
// calendar dates come before optional community content, never ticket promises.
export function publicEventMetadata(event, { today, posts = [] } = {}) {
  const name = line(event?.name || event?.artist), venue = line(event?.venue), place = line(event?.place);
  const identity = venue && !name.toLocaleLowerCase("en").includes(venue.toLocaleLowerCase("en")) ? `${name} at ${venue}` : name;
  const status = line(event?.statusLabel).toLowerCase();
  const cancelled = ["cancelled", "canceled"].includes(status) || event?.status === "https://schema.org/EventCancelled";
  const postponed = status === "postponed" || event?.status === "https://schema.org/EventPostponed";
  const rescheduled = status === "rescheduled" || event?.status === "https://schema.org/EventRescheduled";
  const lastDate = isStrictCalendarDate(event?.endDate) && event.endDate >= event.date ? event.endDate : event?.date;
  const past = isStrictCalendarDate(today) && isStrictCalendarDate(lastDate) && lastDate < today;
  const prefix = cancelled ? "Cancelled: " : postponed ? "Postponed: " : rescheduled ? "Rescheduled: " : event?.soldOut && !past ? "Sold out: " : "";
  const dateLabel = publicEventDateLabel(event?.date, event?.endDate);
  const heading = `${prefix}${identity}${dateLabel ? ` — ${dateLabel}` : ""}`;
  const hasMemories = posts.some((post) => line(post?.text) || post?.media?.length);
  const hasPhotos = posts.some((post) => post?.media?.some((asset) => asset.kind === "image"));
  const details = cancelled ? "This event is cancelled." : postponed ? "The listed date is postponed; check the organizer for updates."
    : past ? "Past event details." : "View the date, venue and event details.";
  const community = hasMemories ? ` Read fan memories${hasPhotos ? " and view concert photos" : ""}.` : "";
  return {
    heading,
    title: `${heading} | Mshpit`,
    description: publicMetadataSummary(`${prefix}${identity}${place ? ` in ${place}` : ""}${dateLabel ? ` — ${dateLabel}` : ""}. ${details}${community}`),
  };
}

export function publicVenueMetadataName(name, place) {
  const venue = line(name), location = line(place).split(",").map((part) => part.trim()).filter(Boolean).slice(0, 2).join(", ");
  return location && !venue.toLocaleLowerCase("en").includes(location.toLocaleLowerCase("en")) ? `${venue} in ${location}` : venue;
}

export function publicCityMetadata(location, guide = {}, photos = []) {
  const place = line(location);
  const publicPath = (value) => typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !/[\\\u0000-\u001f]/u.test(value);
  const venues = (guide.venues || []).filter((row) => line(row.name) && publicPath(row.path));
  const events = [...(guide.today || []), ...(guide.upcoming || [])].filter((row) => publicPath(row.path));
  const hasHistory = !!line(guide.editorial?.history || guide.editorial?.influence);
  const hasFanPhotos = photos.some((photo) => photo.kind === "fan" && publicPath(photo.path));
  const topic = events.length ? venues.length ? "concerts & live music venues" : "concerts & live music"
    : venues.length ? "live music venues & guide" : "live music guide";
  const parts = [`Live music in ${place}.`];
  if (events.length) parts.push("See upcoming concert listings.");
  if (venues.length) parts.push(`Explore venues including ${line(venues[0].name)}.`);
  if (hasHistory) parts.push("Read about the local music history.");
  if (hasFanPhotos) parts.push("Browse public fan photos.");
  if (parts.length === 1) parts.push("Explore the city's public music guide.");
  return { title: `${place} ${topic}`, description: publicMetadataSummary(parts.join(" ")) };
}
