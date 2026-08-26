export const PUBLIC_ENTITY_THRESHOLDS = Object.freeze({
  artistBioCharacters: 80, memberBioCharacters: 60, authoredBodyCharacters: 40,
  cityConcertItems: 3, cityConcertVenues: 2, cityVenueItems: 3, cityVenueVenues: 2,
  attendancePeople: 5, collectionPageSize: 12,
});
export const normalizedPublicText = (value) => String(value ?? "").replace(/\s+/gu, " ").trim();
export function hasSubstantivePublicText(value, minimum) {
  const threshold = Number(minimum);
  return Number.isSafeInteger(threshold) && threshold >= 1 && [...normalizedPublicText(value)].length >= threshold;
}
export const hasSubstantiveArtistBio = (value) => hasSubstantivePublicText(value, PUBLIC_ENTITY_THRESHOLDS.artistBioCharacters);
export const hasSubstantiveMemberBio = (value) => hasSubstantivePublicText(value, PUBLIC_ENTITY_THRESHOLDS.memberBioCharacters);
export const hasSubstantiveAuthoredBody = (value) => hasSubstantivePublicText(value, PUBLIC_ENTITY_THRESHOLDS.authoredBodyCharacters);
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
