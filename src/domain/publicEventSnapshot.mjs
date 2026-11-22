import { hasPostDiscussion } from "./showDiscussion.mjs";
import { accountTargetScope } from "./screenScope.mjs";
import { eventPath } from "./urls.mjs";

const text = (value, max = 300) => typeof value === "string" && value.trim().length <= max
  ? value.trim() : "";
const calendarDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value;
};

// Exact reviewed first-party action. Never accept a navigation prop's URL,
// extend the last review, or promote this waitlist into a ticket offer.
export const REVIEWED_WAITLIST_EVENT_ID = "editorial_sasha-keable_toronto_2027-03-30";
const WAITLIST_URL = "https://sasha-keable.lnk.to/actrighttour";
const WAITLIST_START = Date.parse("2027-03-31T00:30:00Z");
const WAITLIST_MAX_AGE = 24 * 60 * 60 * 1000;
const WAITLIST_VENUE_PATH = "/venue/ticketmaster-kovzpzaflvva";

export function reviewedEventWaitlistUrl(snapshot, now = Date.now()) {
  const checkedAt = snapshot?.ticketAvailabilityCheckedAt;
  return snapshot?.id === REVIEWED_WAITLIST_EVENT_ID && snapshot.publicEventSnapshot === true
    && snapshot.source === "reviewed-editorial" && snapshot.date === "2027-03-30"
    && snapshot.eventStatus === "scheduled" && snapshot.soldOut === true && snapshot.ticketUrl == null
    && snapshot.ticketWaitlistUrl === WAITLIST_URL && Number.isSafeInteger(checkedAt)
    && checkedAt >= Date.parse("2026-11-20T15:00:00Z") && checkedAt <= now && now - checkedAt < WAITLIST_MAX_AGE && now < WAITLIST_START
    ? WAITLIST_URL : null;
}

export function reviewedVenueNavigation(event) {
  if (event?.publicEventSnapshot !== true || event.id !== REVIEWED_WAITLIST_EVENT_ID || event.source !== "reviewed-editorial"
    || event.venueCanonicalPath !== WAITLIST_VENUE_PATH) return null;
  // This is the existing venue's identity, not the source of the event.
  return { name: event.venue, place: event.city, source: "ticketmaster", providerVenueId: "KovZpZAFlvvA" };
}

// A caller's event flag is only a lookup hint, never permission. Review posts
// and artist-archive aggregates must continue through their existing policies.
export function publicEventCandidateId(log) {
  if (!log || log.archiveShowKey || hasPostDiscussion(log)
    || (log.kind && log.kind !== "event")) return null;
  return text(log.tourDateId || log.id, 180) || null;
}

export const publicEventSnapshotScope = (eventId, accountId) => accountTargetScope(accountId, `public-event:${eventId || ""}`);

// Call only on a fresh resolver response, not navigation props. Select fields
// explicitly so caller metadata, ratings, posts and unknown response fields
// cannot piggyback on a public event's read permission.
export function normalizePublicEventSnapshot(entity, requestedId) {
  const id = text(requestedId, 180);
  if (!id || entity?.kind !== "event" || entity.publicEventSnapshot !== true
    || entity.id !== id || entity.path !== eventPath(id)) return null;
  const name = text(entity.eventName || entity.name);
  const artist = text(entity.artist);
  const venue = text(entity.venue);
  const date = text(entity.date, 10);
  if (!name || !artist || !venue || !calendarDate(date)) return null;
  return Object.freeze({
    id, name, artist, venue, date,
    publicEventSnapshot: true,
    path: eventPath(id),
    city: text(entity.city || entity.place),
    artistKey: text(entity.artistKey, 180) || null,
    ...(typeof entity.artistIdentityPending === "boolean" ? { artistIdentityPending: entity.artistIdentityPending } : {}),
    source: text(entity.source, 40) || null,
    providerVenueId: text(entity.providerVenueId, 180) || null,
    ...(entity.venueGuideAvailable === false ? { venueGuideAvailable: false } : {}),
    eventStatus: text(entity.eventStatus, 40),
    ...(text(entity.eventNotice) ? {
      eventNotice: text(entity.eventNotice),
      eventNoticeSource: /^https:\/\//.test(entity.eventNoticeSource || "") ? text(entity.eventNoticeSource, 2048) : null,
      originalDate: calendarDate(entity.originalDate) ? entity.originalDate : null,
    } : {}),
    ticketUrl: text(entity.ticketUrl, 2048) || null,
    soldOut: entity.soldOut === true,
    ...(id === REVIEWED_WAITLIST_EVENT_ID && entity.source === "reviewed-editorial" ? {
      venueCanonicalPath: entity.venueCanonicalPath === WAITLIST_VENUE_PATH ? WAITLIST_VENUE_PATH : null,
      ticketWaitlistUrl: entity.ticketWaitlistUrl === WAITLIST_URL ? WAITLIST_URL : null,
      ticketAvailabilityCheckedAt: Number.isSafeInteger(entity.ticketAvailabilityCheckedAt) ? entity.ticketAvailabilityCheckedAt : null,
    } : {}),
  });
}

// A conservative navigation restriction can be lifted only by a new explicit
// server answer. Older responses without this field must not clear a conflict.
export function publicEventArtistIdentityPending(log, snapshot = null, { status = null } = {}) {
  if (snapshot?.artistIdentityPending === true) return true;
  if (status === "ready" && snapshot?.artistIdentityPending === false) return false;
  return log?.artistIdentityPending === true;
}

export function readablePublicEventSnapshot(resource, { eventId, accountId, legacyMode = false } = {}) {
  if (!eventId || legacyMode || resource?.scope !== publicEventSnapshotScope(eventId, accountId)) return null;
  return resource.updatedAt != null && resource.data?.id === eventId ? resource.data : null;
}
