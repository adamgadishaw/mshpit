import { clean } from "./validate.js";

const THEMES = new Set(["stage", "neon", "forest", "ember", "backstage", "vinyl", "daylight", "ice", "rose", "mint", "sunset", "lavender"]);
const ALLOWED_KEYS = new Set([
  "theme", "consentAt", "analyticsConsentAt", "termsAcceptedAt", "termsVersion",
  "analyticsOptOut", "searchIndexingOptOut", "nowPlaying", "treble", "bass", "playlists",
]);

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
    else if (["analyticsOptOut", "searchIndexingOptOut"].includes(key)) normalized = typeof raw === "boolean" ? raw : undefined;
    else if (["nowPlaying", "treble", "bass"].includes(key)) normalized = song(raw);
    else if (key === "playlists") normalized = playlists(raw);
    if (normalized === undefined) { valid = false; continue; }
    output[key] = normalized;
  }
  return { valid: strict ? valid : true, value: output };
}
