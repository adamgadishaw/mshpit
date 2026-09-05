import { calendarDateKey } from "../src/domain/dataPolicy.mjs";

export const MAX_PROVIDER_MULTI_DAY_SPAN_DAYS = 21;
export const MAX_PROVIDER_FESTIVAL_FAIR_SPAN_DAYS = 45;
const PROVIDER_RANGE_EVENT_KINDS = new Set(["festival", "fair", "multi_day"]);

const sqlAlias = (value) => {
  const alias = String(value || "");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new TypeError("Invalid tour-date SQL alias");
  return alias;
};

const sqlPlaceholder = (value) => {
  const placeholder = String(value || "?");
  if (!/^\?(?:[1-9][0-9]*)?$/.test(placeholder)) throw new TypeError("Invalid tour-date SQL placeholder");
  return placeholder;
};

const safeBilledArtistsSql = (table) =>
  `CASE WHEN json_valid(COALESCE(${table}.billed_artists,'')) THEN ${table}.billed_artists ELSE '[]' END`;

// Provider imports use ISO dates, while a small set of retained legacy rows use
// the former display separator. Normalize both to the same strict SQL date key.
const normalizedTourDateStartSql = (table) =>
  `REPLACE(REPLACE(TRIM(COALESCE(${table}.date,'')),'·','-'),' ','')`;

const providerRangeEndEvidenceSql = (table) => {
  const kind = `LOWER(TRIM(COALESCE(${table}.event_kind,'')))`;
  const billedArtists = safeBilledArtistsSql(table);
  const start = normalizedTourDateStartSql(table);
  return `(${kind} IN ('festival','fair','multi_day')
    AND TRIM(COALESCE(${table}.music_evidence,''))<>''
    AND json_type(${billedArtists})='array'
    AND EXISTS (
      SELECT 1 FROM json_each(${billedArtists}) billed_artist
      WHERE billed_artist.type='text' AND TRIM(billed_artist.value)<>''
    )
    AND date(${start})=${start}
    AND date(${table}.event_end_date)=${table}.event_end_date
    AND ${table}.event_end_date>${start}
    AND julianday(${table}.event_end_date)-julianday(${start}) BETWEEN 1 AND CASE
      WHEN ${kind}='multi_day' THEN ${MAX_PROVIDER_MULTI_DAY_SPAN_DAYS}
      ELSE ${MAX_PROVIDER_FESTIVAL_FAIR_SPAN_DAYS}
    END
  )`;
};

const calendarKeyUtcMilliseconds = (key) => Date.UTC(
  Math.trunc(key / 10_000),
  Math.trunc(key / 100) % 100 - 1,
  key % 100,
);

// Treat only a strict, later ISO end date as a range. Bad legacy metadata falls
// back to the start date rather than keeping an event current indefinitely.
export function effectiveTourDateEndSql(alias = "td") {
  const table = sqlAlias(alias);
  const start = normalizedTourDateStartSql(table);
  return "COALESCE(CASE WHEN date(" + table + ".event_end_date)=" + table + ".event_end_date AND "
    + table + ".event_end_date>" + start + " THEN " + table + ".event_end_date END," + start + ")";
}

export function currentOrUpcomingTourDateSql(alias = "td", placeholder = "?") {
  const table = sqlAlias(alias);
  const parameter = sqlPlaceholder(placeholder);
  const start = normalizedTourDateStartSql(table);
  // Member-authored records keep their explicit ranges. A provider end date is
  // trusted only for an evidenced range product; an ordinary concert remains
  // current by its start date even when a corrupt provider end date is present.
  const lifecycleEnd = `CASE
    WHEN ${table}.owner_id IS NOT NULL THEN ${effectiveTourDateEndSql(table)}
    WHEN ${providerRangeEndEvidenceSql(table)} THEN ${table}.event_end_date
    ELSE ${start}
  END`;
  return `(date(${start})=${start} AND ${providerMultiDayConcertEvidenceSql(table)} AND ${lifecycleEnd}>=${parameter})`;
}

// A provider can classify a season ticket, course, or year-long venue pass as
// Music and give it a long end date. Such products are not one concert and
// must not remain in the upcoming feed for months. Keep this SQL-only gate at
// the shared read boundary: a provider range row needs explicit music
// evidence, at least one billed performer, and a finite event-sized span.
// Ambiguous multi-day imports use the tighter limit; explicit festivals and
// fairs get a more generous limit. Member-authored ranges remain unaffected.
export function providerMultiDayConcertEvidenceSql(alias = "td") {
  const table = sqlAlias(alias);
  const billedArtists = safeBilledArtistsSql(table);
  const start = normalizedTourDateStartSql(table);
  const kind = `LOWER(TRIM(COALESCE(${table}.event_kind,'')))`;
  const rangeEvidence = `(TRIM(COALESCE(${table}.music_evidence,''))<>''
    AND json_type(${billedArtists})='array'
    AND EXISTS (
      SELECT 1 FROM json_each(${billedArtists}) billed_artist
      WHERE billed_artist.type='text' AND TRIM(billed_artist.value)<>''
    )
    AND date(${start})=${start}
    AND date(${table}.event_end_date)=${table}.event_end_date
    AND julianday(${table}.event_end_date)-julianday(${start}) BETWEEN 1 AND CASE
      WHEN ${kind}='multi_day' THEN ${MAX_PROVIDER_MULTI_DAY_SPAN_DAYS}
      ELSE ${MAX_PROVIDER_FESTIVAL_FAIR_SPAN_DAYS}
    END)`;
  return `(${table}.owner_id IS NOT NULL
    OR ${kind} NOT IN ('festival','fair','multi_day')
    OR (${kind} IN ('festival','fair') AND TRIM(COALESCE(${table}.event_end_date,''))='')
    OR (${kind} IN ('festival','fair')
      AND date(${table}.event_end_date)=${table}.event_end_date
      AND ${table}.event_end_date=${start})
    OR ${rangeEvidence})`;
}

export function currentOrUpcomingTourDateRow(row, today) {
  const start = calendarDateKey(row?.date);
  const current = calendarDateKey(today);
  if (start == null || current == null) return false;
  const ownerId = row?.owner_id ?? row?.ownerId ?? null;
  const kind = String(row?.event_kind ?? row?.eventKind ?? "concert").trim().toLowerCase();
  const rawEnd = row?.event_end_date ?? row?.eventEndDate;
  const end = calendarDateKey(rawEnd);
  const hasRange = end != null && end > start;
  if (ownerId == null && PROVIDER_RANGE_EVENT_KINDS.has(kind)) {
    const hasEndValue = String(rawEnd ?? "").trim().length > 0;
    if (kind === "multi_day" && !hasRange) return false;
    if (kind !== "multi_day" && hasEndValue && (end == null || end < start)) return false;
    const spanDays = hasRange
      ? (calendarKeyUtcMilliseconds(end) - calendarKeyUtcMilliseconds(start)) / 86_400_000
      : 0;
    if (hasRange) {
      const maximum = kind === "multi_day"
        ? MAX_PROVIDER_MULTI_DAY_SPAN_DAYS
        : MAX_PROVIDER_FESTIVAL_FAIR_SPAN_DAYS;
      if (!hasProviderRangeEvidence(row) || spanDays < 1 || spanDays > maximum) return false;
    }
  }
  if (ownerId != null) return (hasRange ? end : start) >= current;
  return (hasRange && PROVIDER_RANGE_EVENT_KINDS.has(kind) && hasProviderRangeEvidence(row) ? end : start) >= current;
}

function hasProviderRangeEvidence(row) {
  if (!String(row?.music_evidence ?? row?.musicEvidence ?? "").trim()) return false;
  let billedArtists = row?.billed_artists ?? row?.billedArtists ?? [];
  if (!Array.isArray(billedArtists)) {
    try { billedArtists = JSON.parse(billedArtists || "[]"); }
    catch { return false; }
  }
  return Array.isArray(billedArtists)
    && billedArtists.some((artist) => typeof artist === "string" && artist.trim());
}
