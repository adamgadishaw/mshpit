import { clean } from "./validate.js";

const THEMES = new Set(["stage", "neon", "forest", "ember", "backstage", "vinyl", "daylight", "ice", "rose", "mint", "sunset", "lavender"]);
const ALLOWED_KEYS = new Set([
  "theme", "consentAt", "analyticsConsentAt", "termsAcceptedAt", "termsVersion",
  "analyticsOptOut", "searchIndexingOptOut", "concertMapVisible", "nowPlaying", "treble", "bass", "playlists",
  "accent", "pronouns", "favoriteShows",
]);

// Profile personalisation, all public: an accent colour, pronouns, and up to
// four of the member's own show reviews pinned to the top of their profile.
// null clears a value.
export const PROFILE_ACCENTS = Object.freeze(["amber", "rose", "violet", "blue", "teal", "green", "red", "gold"]);
export const PROFILE_FAVORITE_SHOWS_MAX = 4;
export const PROFILE_PRONOUNS_MAX = 24;
const POST_ID = /^[A-Za-z0-9_-]{1,80}$/u;
const accent = (value) => (value === null ? null : typeof value === "string" && PROFILE_ACCENTS.includes(value) ? value : undefined);
function pronouns(value) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > PROFILE_PRONOUNS_MAX * 2) return undefined;
  return clean(value, { max: PROFILE_PRONOUNS_MAX }) || null;
}
function favoriteShows(value) {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > PROFILE_FAVORITE_SHOWS_MAX) return undefined;
  if (!value.every((id) => typeof id === "string" && POST_ID.test(id)) || new Set(value).size !== value.length) return undefined;
  return value;
}

function timestamp(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function song(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const title = typeof value.title === "string" ? clean(value.title, { max: 200 }) : "";
  const artist = typeof value.artist === "string" ? clean(value.artist, { max: 120 }) : "";
  if (!title || !artist) return undefined;
  return { title, artist };
}

function playlists(value) {
  if (!Array.isArray(value) || value.length > 20) return undefined;
  const normalized = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const id = typeof raw.id === "string" ? clean(raw.id, { max: 100 }) : "";
    const name = typeof raw.name === "string" ? clean(raw.name, { max: 80 }) : "";
    if (!id || !name || !Array.isArray(raw.tracks) || raw.tracks.length > 100) return undefined;
    const tracks = raw.tracks.map(song);
    if (tracks.some((track) => !track)) return undefined;
    normalized.push({ id, name, tracks });
  }
  return normalized;
}

// Extras are an intentionally small compatibility envelope, not an arbitrary
// JSON extension point. `strict` is used on writes so malformed/unknown data is
// rejected; projections use the same schema non-strictly to quarantine legacy
// rows without ever handing unsafe shapes to a screen.
export function canonicalProfileExtras(value, { strict = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, value: {} };
  const output = {};
  let valid = true;
  for (const [key, raw] of Object.entries(value)) {
    if (!ALLOWED_KEYS.has(key)) { valid = false; continue; }
    let normalized;
    if (key === "theme") normalized = typeof raw === "string" && THEMES.has(raw) ? raw : undefined;
    else if (["consentAt", "analyticsConsentAt", "termsAcceptedAt"].includes(key)) normalized = timestamp(raw);
    else if (key === "termsVersion") normalized = typeof raw === "string" ? clean(raw, { max: 32 }) : undefined;
    else if (["analyticsOptOut", "searchIndexingOptOut", "concertMapVisible"].includes(key)) normalized = typeof raw === "boolean" ? raw : undefined;
    else if (["nowPlaying", "treble", "bass"].includes(key)) normalized = song(raw);
    else if (key === "playlists") normalized = playlists(raw);
    else if (key === "accent") normalized = accent(raw);
    else if (key === "pronouns") normalized = pronouns(raw);
    else if (key === "favoriteShows") normalized = favoriteShows(raw);
    if (normalized === undefined) { valid = false; continue; }
    output[key] = normalized;
  }
  return { valid: strict ? valid : true, value: output };
}
