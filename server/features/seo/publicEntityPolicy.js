import {
  MAX_PROVIDER_FESTIVAL_FAIR_SPAN_DAYS,
  MAX_PROVIDER_MULTI_DAY_SPAN_DAYS,
} from "../../tourDateLifecycle.js";

export const PUBLIC_ENTITY_THRESHOLDS = Object.freeze({
  artistBioCharacters: 80, memberBioCharacters: 60, authoredBodyCharacters: 40,
  cityConcertItems: 3, cityConcertVenues: 2, cityVenueItems: 3, cityVenueVenues: 2,
  attendancePeople: 5, collectionPageSize: 12,
});
export const normalizedPublicText = (value) => String(value ?? "").replace(/\s+/gu, " ").trim();
const PUBLIC_TEXT_ENCODING_HAZARD = /[\u0080-\u009f\ufffd]/u;
const CURRENT_RANGE_EVENT_KINDS = new Set(["festival", "fair", "multi_day"]);
export function hasSubstantivePublicText(value, minimum) {
  const threshold = Number(minimum);
  return Number.isSafeInteger(threshold) && threshold >= 1 && [...normalizedPublicText(value)].length >= threshold;
}
export const hasSubstantiveArtistBio = (value) => hasSubstantivePublicText(value, PUBLIC_ENTITY_THRESHOLDS.artistBioCharacters);
export const hasSubstantiveMemberBio = (value) => hasSubstantivePublicText(value, PUBLIC_ENTITY_THRESHOLDS.memberBioCharacters);
export const hasSubstantiveAuthoredBody = (value) => hasSubstantivePublicText(value, PUBLIC_ENTITY_THRESHOLDS.authoredBodyCharacters);

// Provider rows must prove they were classified as music. Member-authored
// records predate the provider classifier and remain separately authorized.
// Keep the JavaScript and SQL forms together so crawler
// documents, directories, and sitemaps cannot silently drift apart.
export function isPublicMusicEventCandidate(value = {}) {
  value = value && typeof value === "object" ? value : {};
  const includesStoredQualification = ["musicQualified", "music_qualified"]
    .some((field) => Object.hasOwn(value, field));
  // Some projections are assembled only after the repository has applied the
  // SQL policy. Do not make those safe, reduced shapes prove storage fields a
  // second time.
  if (!includesStoredQualification) return true;
  const ownerId = value.ownerId ?? value.owner_id ?? null;
  const qualified = value.musicQualified ?? value.music_qualified ?? null;
  return ownerId != null || Number(qualified) === 1;
}
export function publicMusicEventCandidateSql(alias = "td") {
  const identifier = String(alias || "");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(identifier)) throw new TypeError("Invalid SQL alias");
  return `(${identifier}.owner_id IS NOT NULL OR COALESCE(${identifier}.music_qualified,0)=1)`;
}

const NON_CONCERT_PRODUCT = /\b(?:parking(?:\s+pass)?|camping(?:\s+pass)?|weekend\s+camping|hotel\s+packages?|ticket\s*\+\s*hotel|souvenir\s+tickets?|entry\s+to\s+all\s+shows|(?:full\s+)?season\s+(?:memberships?|pass(?:es)?)|concert\s+package(?:\s+events?)?|beginner\s+class|workshop)\b/iu;
const GENERIC_NON_CONCERT_PRODUCT = /^(?:the\s+)?bundles?$/iu;
function publicBilledArtists(value) {
  value = value && typeof value === "object" ? value : {};
  const source = value.billedArtists ?? value.billed_artists;
  const publicArtistStrings = (artists) => artists
    .filter((artist) => typeof artist === "string" && normalizedPublicText(artist))
    .slice(0, 20);
  if (Array.isArray(source)) return publicArtistStrings(source);
  try {
    const parsed = JSON.parse(source || "[]");
    return Array.isArray(parsed) ? publicArtistStrings(parsed) : [];
  } catch {
    return [];
  }
}
function hasBoundedProviderRange(value, kind, ownerId) {
  if (ownerId != null || !CURRENT_RANGE_EVENT_KINDS.has(kind)) return true;
  const start = value.date;
  const end = value.eventEndDate ?? value.event_end_date;
  if (kind !== "multi_day" && !normalizedPublicText(end)) return true;
  if (!isStrictCalendarDate(start) || !isStrictCalendarDate(end)) return false;
  if (kind !== "multi_day" && end === start) return true;
  if (end <= start) return false;
  // A provider range represents one crawlable event, not a season-long pass or
  // recurring series. Ambiguous multi-day records use the tighter bound while
  // explicit festivals and fairs may span up to 45 elapsed days.
  const spanDays = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
  const maximum = kind === "multi_day"
    ? MAX_PROVIDER_MULTI_DAY_SPAN_DAYS
    : MAX_PROVIDER_FESTIVAL_FAIR_SPAN_DAYS;
  return spanDays >= 1 && spanDays <= maximum;
}
export function isIndexableMusicEventRecord(value = {}) {
  value = value && typeof value === "object" ? value : {};
  if (!isPublicMusicEventCandidate(value)) return false;
  const kind = normalizedPublicText(value.eventKind ?? value.event_kind ?? "concert").toLowerCase();
  if (kind && !["concert", "festival", "fair", "multi_day"].includes(kind)) return false;
  const ownerId = value.ownerId ?? value.owner_id ?? null;
  if (ownerId == null && CURRENT_RANGE_EVENT_KINDS.has(kind)) {
    const evidence = normalizedPublicText(value.musicEvidence ?? value.music_evidence);
    if (!evidence || publicBilledArtists(value).length === 0) return false;
  }
  if (!hasBoundedProviderRange(value, kind, ownerId)) return false;
  const name = normalizedPublicText(value.eventName ?? value.event_name ?? value.name ?? value.artist);
  const artist = normalizedPublicText(value.artist);
  const venue = normalizedPublicText(value.venue);
  return Boolean(name)
    && ![name, artist, venue].some((text) => PUBLIC_TEXT_ENCODING_HAZARD.test(text))
    && !NON_CONCERT_PRODUCT.test(name)
    && !GENERIC_NON_CONCERT_PRODUCT.test(name);
}

// A corrupt range on an ordinary concert must not keep an old event in
// directories or sitemaps. Only provider-evidenced range events may
// stay current by its end date; every other record is current by start date.
export function isCurrentOrUpcomingPublicMusicEvent(value = {}, today) {
  value = value && typeof value === "object" ? value : {};
  if (!isIndexableMusicEventRecord(value) || !isStrictCalendarDate(today)) return false;
  const start = value.date;
  if (!isStrictCalendarDate(start)) return false;
  if (start >= today) return true;
  const kind = normalizedPublicText(value.eventKind ?? value.event_kind ?? "concert").toLowerCase();
  const end = value.eventEndDate ?? value.event_end_date;
  const ownerId = value.ownerId ?? value.owner_id ?? null;
  if (ownerId != null) return isStrictCalendarDate(end) && end > start && end >= today;
  const evidence = normalizedPublicText(value.musicEvidence ?? value.music_evidence);
  return Boolean(evidence) && CURRENT_RANGE_EVENT_KINDS.has(kind)
    && isStrictCalendarDate(end) && end > start && end >= today;
}

export function currentOrUpcomingPublicMusicEventSql(alias = "td", placeholder = "?") {
  const identifier = String(alias || "");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(identifier)) throw new TypeError("Invalid SQL alias");
  const parameter = String(placeholder || "?");
  if (!/^\?(?:[1-9][0-9]*)?$/u.test(parameter)) throw new TypeError("Invalid SQL placeholder");
  const kind = `LOWER(TRIM(COALESCE(${identifier}.event_kind,'')))`;
  const start = `${identifier}.date`;
  const end = `${identifier}.event_end_date`;
  const providerRangeBound = `(${identifier}.owner_id IS NOT NULL
    OR ${kind} NOT IN ('festival','fair','multi_day')
    OR (${kind} IN ('festival','fair') AND TRIM(COALESCE(${end},''))='')
    OR (${kind} IN ('festival','fair') AND date(${end})=${end} AND ${end}=${start})
    OR (date(${end})=${end} AND ${end}>${start}
      AND julianday(${end})-julianday(${start}) BETWEEN 1 AND CASE
        WHEN ${kind}='multi_day' THEN ${MAX_PROVIDER_MULTI_DAY_SPAN_DAYS}
        ELSE ${MAX_PROVIDER_FESTIVAL_FAIR_SPAN_DAYS}
      END))`;
  return `(date(${start})=${start} AND ${providerRangeBound} AND (${start}>=${parameter} OR (
    date(${end})=${end}
    AND ${end}>${start}
    AND ${end}>=${parameter}
    AND (${identifier}.owner_id IS NOT NULL OR (
      ${kind} IN ('festival','fair','multi_day')
      AND TRIM(COALESCE(${identifier}.music_evidence,''))<>''
    ))
  )))`;
}

export function hasCompleteRichMusicEventRecord(value = {}) {
  return Boolean(
    normalizedPublicText(value.id)
    && normalizedPublicText(value.artist)
    && normalizedPublicText(value.venue)
    && isStrictIsoDateTime(value.startDateTime ?? value.start_date_time)
    && normalizedPublicText(value.venueAddressLine1 ?? value.venue_address_line1
      ?? value.venueAddressLine2 ?? value.venue_address_line2)
    && normalizedPublicText(value.venueCity ?? value.venue_city)
    && normalizedPublicText(value.venueCountryCode ?? value.venue_country_code
      ?? value.venueCountry ?? value.venue_country),
  );
}
export function isStrictCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}
export function isStrictIsoDateTime(value) {
  const text = String(value || "");
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(text);
  if (!match || !isStrictCalendarDate(match[1])) return false;
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] || 0) > 59) return false;
  if (match[6] !== "Z" && (Number(match[8]) > 14 || Number(match[9]) > 59 || (Number(match[8]) === 14 && Number(match[9]) !== 0))) return false;
  return Number.isFinite(Date.parse(text));
}
export function structuredCityIdentity(value) {
  const countryCode = String(value?.venueCountryCode || value?.venue_country_code || "").trim().toUpperCase();
  const city = normalizedPublicText(value?.venueCity || value?.venue_city || "");
  return /^[A-Z]{2}$/.test(countryCode) && city ? Object.freeze({ countryCode, city }) : null;
}
export function structuredShowLocationKey(value) {
  const identity = structuredCityIdentity(value);
  return identity ? `${identity.countryCode}|${identity.city.toLocaleLowerCase("en")}` : null;
}
export function hasStructuredShowLocationCollision(values) {
  const identities = new Set((Array.isArray(values) ? values : [])
    .map(structuredShowLocationKey)
    .filter(Boolean));
  return identities.size > 1;
}
export const qualifiesCityConcertDirectory = ({ itemCount, venueCount } = {}) => Number(itemCount) >= PUBLIC_ENTITY_THRESHOLDS.cityConcertItems && Number(venueCount) >= PUBLIC_ENTITY_THRESHOLDS.cityConcertVenues;
export const qualifiesCityVenueDirectory = ({ itemCount, venueCount } = {}) => Number(itemCount) >= PUBLIC_ENTITY_THRESHOLDS.cityVenueItems && Number(venueCount) >= PUBLIC_ENTITY_THRESHOLDS.cityVenueVenues;
export function publishableAttendanceCount(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= PUBLIC_ENTITY_THRESHOLDS.attendancePeople ? count : null;
}
