const TYPES = new Set(["person", "group", "other", "unknown"]);
const GROUP_TYPES = new Set(["group", "orchestra", "choir"]);
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

export class ArtistBiographyValidationError extends Error {}

export const artistBiographyIdentity = (value) => typeof value === "string" && MBID.test(value.trim()) ? value.trim().toLowerCase() : null;

export function artistBiographyBindingMatches(value, artistMbid) {
  const correction = object(value);
  return Object.prototype.hasOwnProperty.call(correction, "artistMbid")
    && correction.artistMbid === artistBiographyIdentity(correction.artistMbid)
    && correction.artistMbid === artistBiographyIdentity(artistMbid);
}

function sourceUrl(value) {
  if (typeof value !== "string" || value.length > 1200 || /[\u0000-\u0020\u007f]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.includes(".")
      || /^(?:localhost|.*\.localhost|.*\.local|\d+(?:\.\d+){3}|\[.*\])$/i.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

function factDate(value, at = Date.now()) {
  if (typeof value !== "string" || !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value)) return null;
  const [year, month = "01", day = "01"] = value.split("-");
  if (Number(year) < 1) return null;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== `${year}-${month}-${day}`
    || date.valueOf() > at) return null;
  return value;
}

function normalizedFacts(value, { at = Date.now() } = {}) {
  const input = object(value);
  if (input.version !== 1 || input.verified !== true || !TYPES.has(input.artistType)
    || !["staff", "musicbrainz"].includes(input.source)) return null;
  if (["birthDate", "formedDate", "careerStartYear", "sourceUrl"].some((key) => input[key] != null && typeof input[key] !== "string")) return null;
  const url = sourceUrl(input.sourceUrl);
  const birthDate = input.birthDate == null || input.birthDate === "" ? null : factDate(input.birthDate, at);
  const formedDate = input.formedDate == null || input.formedDate === "" ? null : factDate(input.formedDate, at);
  const careerStartYear = input.careerStartYear == null || input.careerStartYear === "" ? null
    : /^\d{4}$/.test(input.careerStartYear) ? factDate(input.careerStartYear, at) : null;
  if ((input.birthDate && !birthDate) || (input.formedDate && !formedDate) || (input.careerStartYear && !careerStartYear)
    || (birthDate && input.artistType !== "person") || (formedDate && input.artistType !== "group")
    || (input.artistType === "unknown" && (birthDate || formedDate || careerStartYear))
    || (input.artistType !== "unknown" && !url) || (input.sourceUrl && !url)) return null;
  if (birthDate && careerStartYear && careerStartYear < birthDate.slice(0, 4)) return null;
  if (formedDate && careerStartYear && careerStartYear < formedDate.slice(0, 4)) return null;
  if (input.source === "musicbrainz" && (!url || !/^https:\/\/musicbrainz\.org\/artist\/[0-9a-f-]{36}\/?$/i.test(url)
    || !MBID.test(new URL(url).pathname.replace(/^\/artist\//, "").replace(/\/$/, ""))
    || careerStartYear)) return null;
  return Object.freeze({ version: 1, artistType: input.artistType, birthDate, formedDate, careerStartYear,
    source: input.source, sourceUrl: url, verified: true });
}

// Legacy `formed` and `beginYear` deliberately never enter this projection:
// MusicBrainz's lifespan begins at birth for people, not at their first show.
export function projectArtistBiography(data, options) {
  const value = object(data);
  if (Object.prototype.hasOwnProperty.call(value, "biographyStaff")) {
    const correction = object(value.biographyStaff);
    const currentMbid = artistBiographyIdentity(Object.prototype.hasOwnProperty.call(object(options), "artistMbid") ? options.artistMbid : value.mbid);
    // An old unbound correction stays stored for staff review, but cannot make
    // public claims about a replacement identity occupying the same catalog row.
    if (!artistBiographyBindingMatches(correction, currentMbid)) return null;
    const facts = normalizedFacts(correction.facts, options);
    return facts?.source === "staff" ? facts : null;
  }
  const facts = normalizedFacts(value.biographyProvider || value.biographyFacts, options);
  if (facts?.source === "musicbrainz" && options?.artistMbid
    && !facts.sourceUrl.toLowerCase().replace(/\/$/, "").endsWith(`/artist/${String(options.artistMbid).toLowerCase()}`)) return null;
  return facts;
}

export function musicBrainzBiographyFacts(candidate, options) {
  const type = String(candidate?.type || "").toLowerCase();
  const id = String(candidate?.id || "").toLowerCase();
  if (!MBID.test(id) || !type) return null;
  const artistType = type === "person" ? "person" : GROUP_TYPES.has(type) ? "group" : "other";
  const begin = factDate(candidate?.["life-span"]?.begin, options?.at);
  return normalizedFacts({ version: 1, artistType, birthDate: artistType === "person" ? begin : null,
    formedDate: artistType === "group" ? begin : null, careerStartYear: null,
    source: "musicbrainz", sourceUrl: `https://musicbrainz.org/artist/${id}`, verified: true }, options);
}

export function validateStaffArtistBiography(value, options) {
  const input = object(value);
  const allowed = new Set(["version", "artistType", "birthDate", "formedDate", "careerStartYear", "source", "sourceUrl", "verified"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new ArtistBiographyValidationError("Choose only the listed artist facts.");
  const facts = normalizedFacts({ ...input, version: 1, source: "staff", verified: true }, options);
  if (!facts) throw new ArtistBiographyValidationError("Choose an artist type, valid past dates, and an HTTPS source. Birth applies to people; formation applies to groups.");
  return facts;
}

export function artistBiographyRows(value) {
  const facts = normalizedFacts(value);
  if (!facts) return [];
  return [
    ["born", "Born", facts.birthDate],
    ["formed", "Formed", facts.formedDate],
    ["career", "Career began", facts.careerStartYear],
  ].filter(([, , date]) => date).map(([key, label, value]) => Object.freeze({ key, label, value, sourceUrl: facts.sourceUrl }));
}

export function preserveArtistBiography(existingData, incomingData) {
  const existing = object(existingData), incoming = object(incomingData);
  return { ...incoming,
    ...(existing.biographyProvider && !incoming.biographyProvider ? { biographyProvider: existing.biographyProvider } : {}),
    ...(Object.prototype.hasOwnProperty.call(existing, "biographyStaff") ? { biographyStaff: existing.biographyStaff } : {}),
  };
}
