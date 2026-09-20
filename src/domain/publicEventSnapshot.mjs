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
    path: eventPath(id),
    city: text(entity.city || entity.place),
    artistKey: text(entity.artistKey, 180) || null,
    ...(typeof entity.artistIdentityPending === "boolean" ? { artistIdentityPending: entity.artistIdentityPending } : {}),
    source: text(entity.source, 40) || null,
    providerVenueId: text(entity.providerVenueId, 180) || null,
    eventStatus: text(entity.eventStatus, 40),
    ticketUrl: text(entity.ticketUrl, 2048) || null,
    soldOut: entity.soldOut === true,
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
