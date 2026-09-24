import { readBoundedJsonResponse } from "../../boundedJsonResponse.js";

// Reads the performer and venue records Ticketmaster already publishes for the
// shows Mshpit imports. Only facts and official links are kept: no images, no
// prices, no member data. Every URL is re-validated before it is stored.

const API = "https://app.ticketmaster.com/discovery/v2";
const PROVIDER_ID = /^[A-Za-z0-9_-]{1,100}$/u;
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const MAX_RESPONSE_BYTES = 512 * 1024;
const DETAIL_MAX = 600;

// Official profiles worth linking from an artist page, in display order, and
// the hosts each may point to.
export const ARTIST_LINK_KINDS = Object.freeze({
  homepage: { label: "Official site", hosts: null },
  instagram: { label: "Instagram", hosts: ["instagram.com"] },
  youtube: { label: "YouTube", hosts: ["youtube.com", "youtu.be"] },
  wiki: { label: "Wikipedia", hosts: ["wikipedia.org"] },
  facebook: { label: "Facebook", hosts: ["facebook.com"] },
  twitter: { label: "X (Twitter)", hosts: ["twitter.com", "x.com"] },
  spotify: { label: "Spotify", hosts: ["spotify.com"] },
  itunes: { label: "Apple Music", hosts: ["apple.com", "itunes.apple.com"] },
});

const IGNORED_GENRES = new Set(["undefined", "other", "miscellaneous", "music", "holiday", "children's music", ""]);

// Ticketmaster's genre names, shortened to the labels the site already uses.
const GENRE_LABELS = Object.freeze({
  "hip-hop/rap": "Hip-Hop",
  "dance/electronic": "Electronic",
  "ballads/romantic": "Ballads",
  "chanson francaise": "Chanson",
  "medieval/renaissance": "Early Music",
});

export function ticketmasterGenreLabel(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || IGNORED_GENRES.has(name.toLowerCase()) || name.length > 40) return null;
  return GENRE_LABELS[name.toLowerCase()] || name;
}

function text(value, max = DETAIL_MAX) {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/<br\s*\/?>/giu, " ")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;/gu, " ").replace(/&amp;/gu, "&").replace(/&quot;/gu, "\"").replace(/&#0?39;|&apos;/gu, "'")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s*[—–]\s*/gu, ", ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned) return null;
  return [...cleaned].length <= max ? cleaned : `${[...cleaned].slice(0, max - 1).join("").trimEnd()}...`;
}

export function safePublicUrl(value, hosts = null) {
  if (typeof value !== "string" || value.length > 1_000 || /[\u0000- \u007f]/u.test(value.trim())) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol === "http:") url.protocol = "https:";
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./u, "");
    if (!host.includes(".") || /^(?:localhost|.*\.local|\d+(?:\.\d+){3})$/u.test(host)) return null;
    if (hosts && !hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function firstLink(list, hosts) {
  for (const entry of Array.isArray(list) ? list.slice(0, 5) : []) {
    const url = safePublicUrl(entry?.url, hosts);
    if (url) return url;
  }
  return null;
}

function primaryClassification(value) {
  const list = Array.isArray(value?.classifications) ? value.classifications.slice(0, 10) : [];
  return list.find((entry) => entry?.primary === true) || list[0] || null;
}

function genreName(value) {
  const name = text(value?.name, 60);
  return name && !IGNORED_GENRES.has(name.toLowerCase()) ? name : null;
}

// One Ticketmaster attraction (a performer). Returns null for anything that is
// not a music attraction with the expected id.
export function parseTicketmasterAttraction(payload, { id } = {}) {
  if (!payload || typeof payload !== "object" || payload.id !== id || !PROVIDER_ID.test(String(id || ""))) return null;
  const classification = primaryClassification(payload);
  const segment = String(classification?.segment?.name || "").trim().toLowerCase();
  if (segment && segment !== "music") return null;
  const external = payload.externalLinks && typeof payload.externalLinks === "object" ? payload.externalLinks : {};
  const links = {};
  for (const [kind, rule] of Object.entries(ARTIST_LINK_KINDS)) {
    const url = firstLink(external[kind], rule.hosts);
    if (url) links[kind] = url;
  }
  const mbids = [...new Set((Array.isArray(external.musicbrainz) ? external.musicbrainz.slice(0, 5) : [])
    .map((entry) => String(entry?.id || "").trim().toLowerCase()).filter((value) => MBID.test(value)))];
  return {
    id,
    name: text(payload.name, 120),
    links,
    // Two different IDs means Ticketmaster is unsure; use neither.
    mbid: mbids.length === 1 ? mbids[0] : null,
    genre: genreName(classification?.genre),
    subGenre: genreName(classification?.subGenre),
    pageUrl: safePublicUrl(payload.url, ["ticketmaster.com", "ticketmaster.ca", "ticketmaster.co.uk", "ticketmaster.com.au",
      "ticketmaster.ie", "ticketmaster.de", "ticketmaster.nl", "ticketmaster.es", "ticketmaster.fr", "ticketmaster.com.mx",
      "ticketmaster.co.nz", "ticketmaster.se", "ticketmaster.no", "ticketmaster.dk", "ticketmaster.fi", "ticketmaster.be",
      "ticketmaster.at", "ticketmaster.ch", "ticketmaster.it", "ticketmaster.pl", "livenation.com"]),
  };
}

// One Ticketmaster venue: the visitor information the venue itself supplies.
export function parseTicketmasterVenue(payload, { id } = {}) {
  if (!payload || typeof payload !== "object" || payload.id !== id || !PROVIDER_ID.test(String(id || ""))) return null;
  const boxOffice = payload.boxOfficeInfo && typeof payload.boxOfficeInfo === "object" ? payload.boxOfficeInfo : {};
  const general = payload.generalInfo && typeof payload.generalInfo === "object" ? payload.generalInfo : {};
  const details = {
    boxOfficeHours: text(boxOffice.openHoursDetail),
    boxOfficePhone: text(boxOffice.phoneNumberDetail, 200),
    payment: text(boxOffice.acceptedPaymentDetail, 300),
    willCall: text(boxOffice.willCallDetail),
    parking: text(payload.parkingDetail),
    accessibility: text(payload.accessibleSeatingDetail),
    rules: text(general.generalRule),
    children: text(general.childRule),
  };
  const filled = Object.fromEntries(Object.entries(details).filter(([, value]) => value));
  return {
    id,
    name: text(payload.name, 160),
    address: text([payload.address?.line1, payload.address?.line2].filter((line) => typeof line === "string").join(", "), 200),
    postalCode: text(payload.postalCode, 20),
    details: filled,
    pageUrl: safePublicUrl(payload.url, ["ticketmaster.com", "ticketmaster.ca", "ticketmaster.co.uk", "ticketmaster.com.au",
      "ticketmaster.ie", "ticketmaster.de", "ticketmaster.nl", "ticketmaster.es", "ticketmaster.fr", "ticketmaster.com.mx",
      "ticketmaster.co.nz", "livenation.com"]),
  };
}

export function ticketmasterProfileUrl(kind, id, apiKey) {
  if (!["attractions", "venues"].includes(kind) || !PROVIDER_ID.test(String(id || ""))) throw new TypeError("Unknown Ticketmaster record.");
  const url = new URL(`${API}/${kind}/${encodeURIComponent(id)}.json`);
  url.searchParams.set("locale", "*");
  url.searchParams.set("apikey", String(apiKey || ""));
  return url.toString();
}

export class TicketmasterProfileError extends Error {
  constructor(message, { code, status = 0 } = {}) {
    super(message);
    this.name = "TicketmasterProfileError";
    this.code = code;
    this.status = status;
  }
}

// Fetches one record. Returns the parsed record, or null when Ticketmaster no
// longer has it (404).
export async function fetchTicketmasterProfile(kind, id, { apiKey, fetchImpl = globalThis.fetch, signal } = {}) {
  if (!apiKey) throw new TicketmasterProfileError("Ticketmaster is not configured.", { code: "not_configured" });
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
  let response;
  try {
    response = await fetchImpl(ticketmasterProfileUrl(kind, id, apiKey), {
      method: "GET", redirect: "error", signal: requestSignal, headers: { Accept: "application/json" },
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new TicketmasterProfileError("Ticketmaster could not be reached.", { code: "network" });
  }
  if (response.status === 404) {
    // architecture: allow-empty-catch -- the missing record's body is not needed
    await response.body?.cancel?.().catch(() => {});
    return null;
  }
  if (!response.ok) {
    // architecture: allow-empty-catch -- the failed response's body is not needed
    await response.body?.cancel?.().catch(() => {});
    throw new TicketmasterProfileError("Ticketmaster refused the request.", {
      code: response.status === 429 ? "rate_limited" : response.status === 401 || response.status === 403 ? "auth" : "unavailable",
      status: response.status,
    });
  }
  const payload = await readBoundedJsonResponse(response, { maxBytes: MAX_RESPONSE_BYTES, signal: requestSignal });
  return kind === "attractions" ? parseTicketmasterAttraction(payload, { id }) : parseTicketmasterVenue(payload, { id });
}
