import { isIP } from "node:net";
export { cityIdentity } from "../../../src/domain/cityIdentity.mjs";
import { DEFAULT_CITY_COPY, EMPTY_CITY_EDITORIAL } from "./cityCopy.js";

export class CityValidationError extends Error {}
const object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
export function cityHttpsUrl(value, { relative = false } = {}) {
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u0020\u007f\\]/u.test(value)) return null;
  if (relative && /^\/(?:assets|images|media)\/[a-zA-Z0-9_./-]+$/u.test(value) && !value.includes("..")) return value;
  try {
    const u = new URL(value), host = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || u.username || u.password || u.port || isIP(host.replace(/^\[|\]$/g,""))
      || !host.includes(".") || /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/u.test(host)) return null;
    return u.toString();
  } catch { return null; }
}
function text(value, maximum, field, optional = true) {
  if (value == null && optional) return "";
  if (typeof value !== "string" || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new CityValidationError(`${field} must be text of at most ${maximum} characters.`);
  }
  const clean = value.trim();
  if (!optional && !clean) throw new CityValidationError(`${field} is required.`);
  return clean;
}
function url(value, field, optional = false, relative = false) {
  if (!value && optional) return "";
  const safe = cityHttpsUrl(value, { relative });
  if (!safe) throw new CityValidationError(`${field} must be a public HTTPS URL.`);
  return safe;
}
export function validateCityPhoto(input) {
  if (input == null) return null;
  if (!object(input)) throw new CityValidationError("Choose one city photo.");
  const owned = input.owned === true;
  return {
    url: url(input.url, "Photo URL", false, true),
    alt: text(input.alt, 250, "Photo description", false),
    credit: text(input.credit, 250, "Photo credit", owned),
    sourceUrl: url(input.sourceUrl, "Photo source", owned),
    licenseUrl: url(input.licenseUrl, "Photo license", owned),
    owned,
  };
}
export function validateCityEditorial(input) {
  if (!object(input)) throw new CityValidationError("City page content is required.");
  const unknown = Object.keys(input).find((key) => !(key in EMPTY_CITY_EDITORIAL));
  if (unknown) throw new CityValidationError(`Unknown city field: ${unknown}.`);
  const out = {
    title: text(input.title, 160, "Title"), seoTitle: text(input.seoTitle, 80, "Search title"),
    seoDescription: text(input.seoDescription, 200, "Search description"), intro: text(input.intro, 1200, "Introduction"),
    history: text(input.history, 8000, "History"), influence: text(input.influence, 8000, "Musical influence"),
    timeZone: text(input.timeZone, 100, "Time zone"), sources: [], artists: [], stockImage: validateCityPhoto(input.stockImage),
  };
  if (out.timeZone) {
    try { new Intl.DateTimeFormat("en", { timeZone: out.timeZone }).format(0); }
    catch { throw new CityValidationError("Use an IANA time zone, such as America/Toronto."); }
  }
  if (!Array.isArray(input.sources ?? []) || (input.sources?.length || 0) > 20) throw new CityValidationError("Use up to 20 sources.");
  out.sources = (input.sources || []).map((source) => {
    if (!object(source)) throw new CityValidationError("Each source needs a title and URL.");
    return { title: text(source.title, 200, "Source title", false), url: url(source.url, "Source URL") };
  });
  if ((out.history || out.influence) && !out.sources.length) throw new CityValidationError("Add a source for music history and influence.");
  if (!Array.isArray(input.artists ?? []) || (input.artists?.length || 0) > 24) throw new CityValidationError("Use up to 24 city artists.");
  out.artists = (input.artists || []).map((artist) => {
    if (!object(artist)) throw new CityValidationError("Each artist needs a name and source.");
    return { name: text(artist.name, 160, "Artist name", false), artistKey: text(artist.artistKey, 200, "Artist key"),
      description: text(artist.description, 800, "Artist description"), sourceUrl: url(artist.sourceUrl, "Artist source") };
  });
  return out;
}
export function validateCityCopy(input) {
  if (!object(input)) throw new CityValidationError("City page copy is required.");
  const unknown = Object.keys(input).find((key) => !(key in DEFAULT_CITY_COPY));
  if (unknown) throw new CityValidationError(`Unknown copy field: ${unknown}.`);
  const out = {};
  for (const [key, fallback] of Object.entries(DEFAULT_CITY_COPY)) {
    const value = input[key] ?? fallback;
    if (key === "welcomeBannerOwned") {
      if (typeof value !== "boolean") throw new CityValidationError("Photo ownership must be true or false.");
      out[key] = value;
    } else out[key] = text(value, key.endsWith("Url") ? 2048 : key.endsWith("SeoTitle") ? 80 : key.endsWith("SeoDescription") ? 200 : 1200,
      key, key.startsWith("welcomeBanner"));
  }
  if (out.welcomeBannerUrl) {
    const photo = validateCityPhoto({ url: out.welcomeBannerUrl, alt: out.welcomeBannerAlt,
      credit: out.welcomeBannerCredit, sourceUrl: out.welcomeBannerSourceUrl,
      licenseUrl: out.welcomeBannerLicenseUrl, owned: out.welcomeBannerOwned });
    out.welcomeBannerUrl = photo.url;
  }
  return out;
}
export function cityLocalDay(at, timeZone = "UTC") {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(at); }
  catch { return new Date(at).toISOString().slice(0,10); }
}
