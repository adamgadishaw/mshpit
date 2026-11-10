import { toIsoDate } from "./dates.mjs";
import { ticketUrlDecision } from "./ticketLinks.mjs";
import { calendarEventTiming, nextCalendarDay } from "./calendarEventTiming.mjs";
import { calendarPerformanceKey } from "./calendarPerformanceIdentity.mjs";

const CRLF = "\r\n";
const MAX_TEXT = 240;

function cleanText(value, max = MAX_TEXT) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function escapeText(value) {
  return cleanText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function utf8Bytes(character) {
  const code = character.codePointAt(0);
  if (code <= 0x7f) return 1;
  if (code <= 0x7ff) return 2;
  if (code <= 0xffff) return 3;
  return 4;
}

// RFC 5545 content lines are limited to 75 octets. Fold without splitting a
// Unicode code point; continuation lines begin with one space.
export function foldCalendarLine(line) {
  const parts = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const character of String(line || "")) {
    const width = utf8Bytes(character);
    if (current && bytes + width > limit) {
      parts.push(current);
      current = ` ${character}`;
      bytes = 1 + width;
      limit = 75;
    } else {
      current += character;
      bytes += width;
    }
  }
  if (current || !parts.length) parts.push(current);
  return parts.join(CRLF);
}

const compactDate = (iso) => iso.replace(/-/g, "");

function stamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("A valid export timestamp is required.");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function stableHash(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function confirmedTicketUrlSet(values) {
  const confirmed = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const decision = ticketUrlDecision(value, { allowUntrusted: true });
    if (decision.valid) confirmed.add(decision.url);
  }
  return confirmed;
}

export function normalizeCalendarEvent(event, { confirmedTicketUrls = [] } = {}) {
  const date = toIsoDate(event?.date);
  const artist = cleanText(event?.artist, 120);
  if (!date || !artist) return null;
  const venue = cleanText(event?.venue || event?.place, 140);
  const city = cleanText(event?.city || (event?.place !== venue ? event?.place : ""), 100);
  const ticketDecision = ticketUrlDecision(event?.ticketUrl, { allowUntrusted: true });
  const confirmed = confirmedTicketUrlSet(confirmedTicketUrls);
  const ticketUrl = ticketDecision.valid
    && (!ticketDecision.requiresConfirmation || confirmed.has(ticketDecision.url))
    ? ticketDecision.url
    : "";
  const identity = calendarPerformanceKey(event);
  const timing = calendarEventTiming(event);
  return {
    date,
    artist,
    venue,
    city,
    ticketUrl,
    timing,
    eventStatus: cleanText(event?.eventStatus || event?.lifecycle, 40).toLowerCase(),
    uid: `pit-${stableHash(identity)}${stableHash([...identity].reverse().join(""))}@mshpit.com`,
  };
}

export function buildCalendarDocument(events, {
  now = new Date(),
  calendarName = "PIT concerts",
  confirmedTicketUrls = [],
} = {}) {
  const unique = new Map();
  for (const candidate of Array.isArray(events) ? events : [events]) {
    const event = normalizeCalendarEvent(candidate, { confirmedTicketUrls });
    if (event) unique.set(event.uid, event);
  }
  if (!unique.size) throw new Error("This show does not have a valid artist and date yet.");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PIT//Concert Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];
  const created = stamp(now);
  for (const event of unique.values()) {
    const location = [event.venue, event.city].filter(Boolean).join(", ");
    const summary = event.venue ? `${event.artist} at ${event.venue}` : event.artist;
    const { timing } = event;
    // Without a known final time, a festival remains a truthful whole-date
    // span. Single shows with a known start omit DTEND rather than inventing
    // a duration. UTC avoids floating-time shifts and incomplete TZID output.
    const timed = !!timing.startAt && (timing.endDate === timing.date || !!timing.endAt);
    const notes = ["Concert saved from PIT."];
    if (!timed) {
      if (timing.startAt) notes.push(`Starts: ${timing.startAt}${timing.timeZone ? ` (${timing.timeZone})` : ""}. End time unconfirmed.`);
      else if (timing.status === "unresolved") notes.push(`Start time unconfirmed${timing.startLocalTime ? `: ${timing.startLocalTime}${timing.timeZone ? ` (${timing.timeZone})` : " (venue local time)"}` : ""}.`);
      else notes.push("Start time not announced.");
    }
    if (event.eventStatus === "postponed") notes.push("Postponed; confirm the new date with the event organizer.");
    if (event.eventStatus === "rescheduled") notes.push("Rescheduled; check the latest event details.");
    if (event.ticketUrl) notes.push(`Tickets: ${event.ticketUrl}`);
    lines.push("BEGIN:VEVENT", `UID:${event.uid}`, `DTSTAMP:${created}`);
    if (timed) {
      lines.push(`DTSTART:${stamp(timing.startAt)}`);
      if (timing.endAt) lines.push(`DTEND:${stamp(timing.endAt)}`);
    } else {
      lines.push(
        `DTSTART;VALUE=DATE:${compactDate(event.date)}`,
        `DTEND;VALUE=DATE:${compactDate(nextCalendarDay(timing.endDate))}`,
        "TRANSP:TRANSPARENT",
      );
    }
    if (["cancelled", "canceled"].includes(event.eventStatus)) lines.push("STATUS:CANCELLED");
    else if (event.eventStatus === "postponed") lines.push("STATUS:TENTATIVE");
    lines.push(`SUMMARY:${escapeText(summary)}`);
    if (location) lines.push(`LOCATION:${escapeText(location)}`);
    lines.push(`DESCRIPTION:${escapeText(notes.join(" "))}`);
    if (event.ticketUrl) lines.push(`URL:${event.ticketUrl}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldCalendarLine).join(CRLF)}${CRLF}`;
}

export function calendarExportFileName(events) {
  const normalized = (Array.isArray(events) ? events : [events]).map((event) => normalizeCalendarEvent(event)).filter(Boolean);
  if (normalized.length === 1) {
    const event = normalized[0];
    const slug = event.artist.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || "concert";
    return `pit-${slug}-${event.date}.ics`;
  }
  return "pit-going-shows.ics";
}
