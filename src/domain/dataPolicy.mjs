// Data-boundary helpers shared by store bootstrap and discovery calculations.
// Keep these functions pure so production migrations can be tested without React.

import { MUSIC_PLAYER_ENABLED } from "./musicPlayerAvailability.mjs";

const DEMO_USER_IDS = new Set(["u_demo", "u_artist", "u_mara", "u_devon", "u_priya"]);
const DEMO_FEED_IDS = new Set(["log_1", "log_2", "log_3"]);
export const PERSISTED_FEED_LIMIT = 80;
export const PERSISTED_TOUR_DATE_LIMIT = 400;
// localStorage is commonly limited to a few MiB per origin and usually counts
// JavaScript strings as UTF-16. Reserve most of that space for drafts and other
// small continuity state instead of letting one catalogue cache consume it.
export const PERSISTED_TOUR_DATE_CHARACTER_BUDGET = 384 * 1024;

const isObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);
const asArray = (value) => (Array.isArray(value) ? value : []);
const withoutIds = (value, ids) => asArray(value).filter((item) => !ids.has(String(item?.id || "")));

export function publicProfileCacheEntry(user) {
  if (!isObject(user) || !user.id) return null;
  const keys = [
    "id", "name", "handle", "role", "verified", "sponsor", "artistName",
    "bio", "avatarUri", "avatarColor", "banner", "initials",
    ...(MUSIC_PLAYER_ENABLED ? ["nowPlaying"] : []),
  ];
  const projected = Object.fromEntries(keys.filter((key) => user[key] !== undefined).map((key) => [key, user[key]]));
  if (Array.isArray(user.genres)) projected.genres = user.genres.filter((value) => typeof value === "string").slice(0, 12);
  if (Array.isArray(user.favoriteArtists)) projected.favoriteArtists = user.favoriteArtists.filter((value) => typeof value === "string").slice(0, 50);
  if (typeof user.home?.city === "string" && user.home.city) projected.home = { city: user.home.city };
  return projected;
}

function withoutDemoUsers(value) {
  return asArray(value)
    .filter((user) => !DEMO_USER_IDS.has(String(user?.id || "")))
    .map(publicProfileCacheEntry)
    .filter(Boolean);
}

function withoutDemoUserKeys(value, { filterValues = false } = {}) {
  if (!isObject(value)) return {};
  const clean = {};
  for (const [userId, entry] of Object.entries(value)) {
    if (DEMO_USER_IDS.has(userId)) continue;
    clean[userId] = filterValues && Array.isArray(entry)
      ? entry.filter((id) => !DEMO_USER_IDS.has(String(id)))
      : entry;
  }
  return clean;
}

function withoutNestedRecordIds(value, ids) {
  if (!isObject(value)) return {};
  const clean = {};
  for (const [key, records] of Object.entries(value)) {
    const kept = withoutIds(records, ids);
    if (kept.length) clean[key] = kept;
  }
  return clean;
}

function withoutDemoRatings(value) {
  if (!isObject(value)) return {};
  const clean = {};
  for (const [subject, ratings] of Object.entries(value)) {
    if (!isObject(ratings)) continue;
    const kept = Object.fromEntries(
      Object.entries(ratings).filter(([userId]) => !DEMO_USER_IDS.has(userId)),
    );
    if (Object.keys(kept).length) clean[subject] = kept;
  }
  return clean;
}

export function isLegacyGeneratedTourDate(event) {
  const id = String(event?.id || "").toLowerCase();
  return id.startsWith("g_t_")
    || id.startsWith("ca_t_")
    || /^ct\d+$/.test(id)
    || /^t[1-4]$/.test(id);
}

export function sanitizeTourDates(value, demoEnabled = false) {
  const dates = asArray(value);
  return demoEnabled ? dates : dates.filter((event) => !isLegacyGeneratedTourDate(event));
}

// Removes only identifiers owned by the bundled prototype. Server-created rows
// use different IDs and are retained, including when mixed into a persisted map.
export function sanitizePersistedStoreValue(key, value, demoEnabled = false) {
  if (demoEnabled) return value;
  if (key === "pit.comments" || key.startsWith("pit.comments.v2.")) {
    return withoutNestedRecordIds(value, new Set(["c1", "c2"]));
  }

  switch (key) {
    case "pit.session":
      return DEMO_USER_IDS.has(String(value?.id || "")) ? null : value;
    case "pit.users":
      return withoutDemoUsers(value);
    case "pit.feed":
      return withoutIds(value, DEMO_FEED_IDS).slice(0, PERSISTED_FEED_LIMIT);
    case "pit.tourDates":
      return sanitizeTourDates(value, false);
    case "pit.requests":
      return withoutIds(value, new Set(["r1"]));
    case "pit.likes":
    case "pit.myLikes": {
      if (!isObject(value)) return {};
      return Object.fromEntries(Object.entries(value).filter(([postId]) => !DEMO_FEED_IDS.has(postId)));
    }
    case "pit.lounge":
      return withoutNestedRecordIds(value, new Set(["m1", "m2"]));
    case "pit.going":
    case "pit.fanClubs":
      return withoutDemoUserKeys(value);
    case "pit.fanClubMsgs":
      return withoutNestedRecordIds(value, new Set(["fc1", "fc2"]));
    case "pit.artistProfiles": {
      if (!isObject(value)) return {};
      const clean = { ...value };
      const turnstile = clean.turnstile;
      if (isObject(turnstile)
        && Object.keys(turnstile).length === 1
        && turnstile.feedEnabled === true) delete clean.turnstile;
      return clean;
    }
    case "pit.artistPosts":
      return withoutNestedRecordIds(value, new Set(["ap1"]));
    case "pit.dms":
      return withoutNestedRecordIds(value, new Set(["dm1", "dm2", "dm3", "dm4"]));
    case "pit.dmRead": {
      if (!isObject(value)) return {};
      return Object.fromEntries(Object.entries(value).filter(([thread]) =>
        !thread.split("__").some((id) => DEMO_USER_IDS.has(id))));
    }
    case "pit.notifications":
      return withoutIds(value, new Set(["nf1", "nf2", "nf3"]));
    case "pit.albumRatings":
    case "pit.songRatings":
      return withoutDemoRatings(value);
    case "pit.follows":
      return withoutDemoUserKeys(value, { filterValues: true });
    case "pit.blocked":
      return asArray(value).filter((id) => !DEMO_USER_IDS.has(String(id)));
    default:
      return value;
  }
}

// Tour-date strings currently arrive as either `YYYY · MM · DD` or ISO-style
// dates. Compare calendar components instead of milliseconds so timezone offsets
// cannot make today's show look expired before the local day ends.
export function calendarDateKey(value) {
  const match = String(value || "").match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  const valid = year >= 1970
    && candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
  return valid ? year * 10000 + month * 100 + day : null;
}

export function isUpcomingEventDate(event, now = Date.now()) {
  const startKey = calendarDateKey(event?.date);
  if (startKey == null) return false;
  const today = new Date(now);
  const todayKey = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  const endKey = calendarDateKey(event?.eventEndDate ?? event?.event_end_date);
  // A real multi-day event remains current through its inclusive end date.
  // Invalid, missing, or start-before-end-inverted ranges deliberately fall
  // back to the one-day rule so stale rows cannot linger indefinitely.
  if (endKey != null && endKey > startKey) return endKey >= todayKey;
  return startKey >= todayKey;
}

// The live catalogue may contain thousands of provider rows. Persist only the
// nearest public dates needed to avoid a blank first paint; the API remains the
// complete source of truth and replaces this projection after startup.
export function persistedTourDateCache(value, {
  at = Date.now(),
  demoEnabled = false,
  limit = PERSISTED_TOUR_DATE_LIMIT,
  characterBudget = PERSISTED_TOUR_DATE_CHARACTER_BUDGET,
} = {}) {
  const maximum = Math.max(0, Math.min(PERSISTED_TOUR_DATE_LIMIT, Math.trunc(Number(limit) || 0)));
  const budget = Math.max(2, Math.min(
    PERSISTED_TOUR_DATE_CHARACTER_BUDGET,
    Math.trunc(Number(characterBudget) || 0),
  ));
  const candidates = sanitizeTourDates(value, demoEnabled)
    .filter((event) => {
      const releaseAt = Number(event?.releaseAt);
      return (!Number.isFinite(releaseAt) || releaseAt <= at)
        && isUpcomingEventDate(event, at);
    })
    .sort((a, b) => {
      const byDate = (calendarDateKey(a?.date) || Number.MAX_SAFE_INTEGER)
        - (calendarDateKey(b?.date) || Number.MAX_SAFE_INTEGER);
      return byDate || String(a?.id || "").localeCompare(String(b?.id || ""));
    })
    .slice(0, maximum);
  const saved = [];
  let characters = 2; // JSON array brackets
  for (const event of candidates) {
    let serialized;
    try { serialized = JSON.stringify(event); }
    catch { continue; }
    if (!serialized) continue;
    const nextCharacters = characters + serialized.length + (saved.length ? 1 : 0);
    if (nextCharacters > budget) continue;
    saved.push(event);
    characters = nextCharacters;
  }
  return saved;
}
