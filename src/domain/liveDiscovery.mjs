import { calendarDateKey } from "./dataPolicy.mjs";
import {
  compareCurrentAndUpcomingLiveEvents,
  isCurrentOrUpcomingLiveEvent,
} from "./eventLifecycle.mjs";

export const LIVE_EVENT_SCOPE = Object.freeze({
  LOCAL: "local",
  WORLDWIDE: "worldwide",
});

const boundedLimit = (value, fallback = 6) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
};

const clean = (value, max = 180) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max)
  : "";

const count = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
};

export function liveEventTitle(event) {
  const artist = clean(event?.artist, 160);
  const eventName = clean(event?.eventName, 200);
  const eventKind = clean(event?.eventKind, 40).toLowerCase();
  // Provider-backed festivals, fairs, rodeos, and other multi-day programs are
  // their own social object. Do not mislabel the entire event as its first act.
  if (eventName && eventKind && eventKind !== "concert") return eventName;
  return artist || eventName || "Event to be announced";
}

export function liveEventLineupLabel(event, { limit = 3 } = {}) {
  const names = Array.isArray(event?.billedArtists) ? event.billedArtists : [];
  const fallback = clean(event?.artist, 160);
  const seen = new Set();
  const lineup = [];
  for (const value of [...names, fallback]) {
    const name = clean(value, 160);
    const identity = name.toLocaleLowerCase();
    if (!name || seen.has(identity)) continue;
    seen.add(identity);
    lineup.push(name);
  }
  const max = Math.max(1, boundedLimit(limit, 3));
  const visible = lineup.slice(0, max);
  if (!visible.length) return "";
  const remaining = lineup.length - visible.length;
  return `${visible.join(" · ")}${remaining > 0 ? ` +${remaining}` : ""}`;
}

const eventIdentity = (event) => {
  const explicit = clean(event?.id, 240);
  if (explicit) return explicit;
  const parts = [event?.artist, event?.venue, event?.date].map((value) => clean(value).toLocaleLowerCase());
  return parts.some(Boolean) ? parts.join("|") : "";
};

export function upcomingEventsForScope({
  scope = LIVE_EVENT_SCOPE.LOCAL,
  localEvents = [],
  worldwideEvents = [],
  limit = 6,
  now = Date.now(),
} = {}) {
  const source = scope === LIVE_EVENT_SCOPE.WORLDWIDE ? worldwideEvents : localEvents;
  if (!Array.isArray(source)) return [];
  const max = boundedLimit(limit);
  if (max <= 0) return [];
  const at = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const seen = new Set();
  const rows = [];
  for (const event of source) {
    if (!event || typeof event !== "object") continue;
    const identity = eventIdentity(event);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    rows.push(event);
  }
  return rows
    .sort((left, right) => compareCurrentAndUpcomingLiveEvents(left, right, at))
    .slice(0, max);
}

export function localDiscoveryEvents(rows, { limit = 12 } = {}) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((event) => event && typeof event === "object" && event.local === true)
    .slice(0, boundedLimit(limit, 12));
}

// Keep the worldwide projection bounded while scanning the catalogue. The
// caller memoizes this against the tour-date collection, so unrelated screen
// state never re-sorts thousands of rows.
export function projectWorldwideUpcomingEvents(rows, { limit = 12, now = Date.now() } = {}) {
  if (!Array.isArray(rows)) return [];
  const max = boundedLimit(limit, 12);
  if (max <= 0) return [];
  const at = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const selected = [];

  for (const event of rows) {
    if (!event || typeof event !== "object") continue;
    if (!isCurrentOrUpcomingLiveEvent(event, at) || !(event.releaseAt <= at)) continue;
    const dateKey = calendarDateKey(event.date);
    if (dateKey == null) continue;
    const insertAt = selected.findIndex((candidate) => compareCurrentAndUpcomingLiveEvents(event, candidate.event, at) < 0);
    if (insertAt < 0) {
      if (selected.length < max) selected.push({ dateKey, event });
      continue;
    }
    selected.splice(insertAt, 0, { dateKey, event });
    if (selected.length > max) selected.pop();
  }

  return selected.map(({ event }) => ({ ...event }));
}

export function projectPopularLounges(rows, { limit = 6 } = {}) {
  const projected = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = clean(row?.key || row?.loungeId, 300).toLocaleLowerCase();
    const artist = clean(row?.artist, 120);
    const venue = clean(row?.venue, 160);
    if (!key || !artist || !venue || seen.has(key)) continue;
    const messageCount = count(row?.messageCount ?? row?.message_count);
    const attendeeCount = count(row?.attendeeCount ?? row?.attendee_count);
    if (messageCount <= 0 || attendeeCount <= 0) continue;
    seen.add(key);
    const explicitDate = clean(row?.date, 40);
    const keyDate = key.split("|").at(-1);
    projected.push({
      key,
      artist,
      venue,
      city: clean(row?.city, 120),
      place: clean(row?.place || row?.city, 220),
      date: explicitDate || (/^\d{4}-\d{2}-\d{2}$/.test(keyDate) ? keyDate : ""),
      messageCount,
      attendeeCount,
      lastActivityAt: count(row?.lastActivityAt ?? row?.last_activity_at) || null,
    });
  }
  projected.sort((left, right) => right.messageCount - left.messageCount
    || right.attendeeCount - left.attendeeCount
    || (right.lastActivityAt || 0) - (left.lastActivityAt || 0)
    || left.artist.localeCompare(right.artist));
  return projected.slice(0, boundedLimit(limit));
}

export function liveScopeLabel({ scope, homeCity } = {}) {
  if (scope === LIVE_EVENT_SCOPE.WORLDWIDE) return "Worldwide";
  const city = clean(homeCity, 120);
  return city ? `Near ${city}` : "Near you";
}
