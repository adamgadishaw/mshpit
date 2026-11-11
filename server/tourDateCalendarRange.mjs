import { createHash } from "node:crypto";

const DAY_MS = 86_400_000;
const QUERY_KEYS = new Set(["month", "limit", "after", "city", "country", "date", "fromDate"]);
export const CALENDAR_SUMMARY_RAW_SCAN_LIMIT = 20_000;

const invalid = () => new TypeError("That calendar range is invalid. Refresh and try again.");
// Match SQLite's ASCII NOCASE comparison rather than conflating locations
// whose Unicode spellings the actual query treats as different.
const scopeText = (value) => value?.replace(/[A-Z]/gu, (letter) => letter.toLowerCase()) || null;

function location(value, maximum) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) throw invalid();
  return value.trim().replace(/\s+/gu, " ") || null;
}

function selectedDate(value, month, through) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)
    || !value.startsWith(`${month}-`) || value < `${month}-01` || value > through) throw invalid();
  return value;
}

function cursorDate(value) {
  if (typeof value !== "string" || value.length > 40) return null;
  const day = value.replaceAll("·", "-").replaceAll(" ", "");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) return null;
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
}

export function tourDateCalendarRequest(query = {}, { viewerId = null } = {}) {
  if (!Object.hasOwn(query, "month")) return null;
  if (Object.keys(query).some((key) => !QUERY_KEYS.has(key))
    || typeof query.month !== "string" || !/^(?:19\d{2}|20\d{2}|2100)-(?:0[1-9]|1[0-2])$/u.test(query.month)) throw invalid();
  const month = query.month;
  const [year, number] = month.split("-").map(Number);
  const from = `${month}-01`;
  const through = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  const date = selectedDate(query.date, month, through);
  const fromDate = selectedDate(query.fromDate, month, through);
  if (date && fromDate) throw invalid();
  const requestedLimit = query.limit == null || query.limit === "" ? 100 : Number(query.limit);
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) throw invalid();
  const city = location(query.city, 120);
  const countryLabel = location(query.country, 80);
  const countryCode = countryLabel && /^[A-Za-z]{2}$/u.test(countryLabel) ? countryLabel.toUpperCase() : null;
  const country = countryCode ? null : countryLabel;
  // This is an integrity/scope check, not authorization. Every continuation
  // still runs the current viewer's visibility and block predicates.
  const cursorScope = createHash("sha256").update(JSON.stringify([
    month, date, fromDate, scopeText(city), countryCode || scopeText(country), viewerId,
  ])).digest("hex");
  let after = null;
  if (query.after != null && query.after !== "") {
    try {
      if (typeof query.after !== "string" || query.after.length > 1000 || !/^[A-Za-z0-9_-]+$/u.test(query.after)) throw invalid();
      const cursor = JSON.parse(Buffer.from(query.after, "base64url").toString("utf8"));
      if (!Array.isArray(cursor) || cursor.length !== 4 || cursor[0] !== 1 || cursor[1] !== cursorScope) throw invalid();
      const [, , rawDate, id] = cursor;
      const day = cursorDate(rawDate);
      if (!day || day > (date || through) || typeof id !== "string" || !id.trim()
        || id.length > 180 || id !== id.trim() || /[\u0000-\u001f\u007f]/u.test(id)) throw invalid();
      after = { date: rawDate, id };
    } catch { throw invalid(); }
  }
  return {
    month, from, through, date, fromDate, city, countryCode, country, countryLabel,
    limit: Math.min(requestedLimit, 500), after, cursorScope,
    calendarFrom: date || fromDate || from,
    calendarThrough: date || through,
  };
}

export function encodeTourDateCalendarCursor(row, range) {
  return Buffer.from(JSON.stringify([1, range.cursorScope, row.date, row.id]), "utf8").toString("base64url");
}

export function tourDateCalendarPublicRange(range) {
  return {
    month: range.month, from: range.from, through: range.through,
    city: range.city, country: range.countryLabel, date: range.date, fromDate: range.fromDate,
  };
}

// Presence needs only one eligible performance, not a download of every event.
// Unknown dates are omitted when the shared work budget is exhausted. A false
// value is emitted only after the day query has proved that no event exists.
export function tourDateCalendarSummary(range, readPage, { rawScanLimit = CALENDAR_SUMMARY_RAW_SCAN_LIMIT } = {}) {
  const dayPresence = {};
  let remaining = rawScanLimit;
  let complete = true;
  for (let at = Date.parse(`${range.from}T00:00:00Z`); at <= Date.parse(`${range.through}T00:00:00Z`); at += DAY_MS) {
    const day = new Date(at).toISOString().slice(0, 10);
    if (remaining <= 0) { complete = false; continue; }
    const result = readPage({
      ...range, after: null, limit: 1, calendarFrom: day, calendarThrough: day,
      rawScanLimit: Math.min(remaining, 5000), scanBatch: 25,
    });
    remaining -= result.scanned;
    if (result.rows.length) dayPresence[day] = true;
    else if (result.nextCursor == null) dayPresence[day] = false;
    else complete = false;
  }
  return { dayPresence, complete };
}
