import { parsePath, venuePath } from "./urls.mjs";
import { normalizeVenuePhotoProviderIdentity } from "./venuePhotos.mjs";
import { venueCoordinates, venueCapacity } from "./venueGuide.mjs";

const text = (value, max = 300) => typeof value === "string" && value.trim().length <= max ? value.trim() : "";
const safePath = value => typeof value === "string" && /^\/venue\/[a-z0-9-]{1,240}$/.test(value) ? value : null;

export function publicVenueRequestPath(name, identity) {
  const provider = normalizeVenuePhotoProviderIdentity(identity);
  // Explicit provider identity takes precedence over stale navigation hints.
  return provider ? venuePath({ name, ...provider }) : safePath(identity?.path) || venuePath(name);
}

export function normalizePublicVenueSnapshot(value, { path, identity, after = null } = {}) {
  const provider = normalizeVenuePhotoProviderIdentity(identity);
  const received = normalizeVenuePhotoProviderIdentity(value?.venue);
  const canonical = safePath(value?.path);
  if (!canonical || !text(value?.venue?.name, 180) || value.after !== (after || null)
    || (provider && (!received || provider.source !== received.source || provider.providerVenueId !== received.providerVenueId))
    || (received && canonical !== venuePath({ name: value.venue.name, ...received }))
    || (!received && canonical !== path)
    || !Array.isArray(value.events) || value.events.length > 8
    || typeof value.hasMore !== "boolean"
    || (value.hasMore ? !text(value.nextCursor, 1024) : value.nextCursor !== null)) return null;
  const address = value.venue.address;
  const events = value.events.map(row => ({
    id: text(row.id, 180), kind: "event", eventName: text(row.name), artist: text(row.artist, 180),
    // No name-only adoption: every row of an exact provider venue must agree.
    venue: text(row.venue, 180), source: text(row.source, 40) || null,
    providerVenueId: text(row.providerVenueId, 180) || null,
    date: text(row.date, 10), place: text(row.place), eventEndDate: text(row.endDate, 10) || null,
    startDateTime: text(row.startDateTime, 80) || null, startLocalTime: text(row.localTime, 20) || null,
    eventTimezone: text(row.timezone, 80) || null, eventStatus: text(row.statusLabel, 40),
    ticketUrl: text(row.ticketUrl, 2048) || null, soldOut: row.soldOut === true,
    artistPath: text(row.artistPath, 500) || null, eventKind: text(row.eventKind, 40),
    billedArtists: Array.isArray(row.billedArtists) ? row.billedArtists.slice(0, 20).map(name => text(name, 180)).filter(Boolean) : [],
  }));
  if (events.some(row => !row.id || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)
    || (received && (row.source !== received.source || row.providerVenueId !== received.providerVenueId)))) return null;
  return {
    path: canonical,
    venue: {
      name: text(value.venue.name, 180), ...(received || { source: null, providerVenueId: null }),
      place: text(value.venue.place), capacity: venueCapacity(value.venue.capacity), coord: venueCoordinates(value.venue.coord),
      address: address ? Object.fromEntries(["streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"]
        .map(key => [key, text(address[key]) || null])) : null,
    },
    events, hasMore: value.hasMore, nextCursor: value.nextCursor, after: after || null,
  };
}

export function publicVenueUpcomingLabel(snapshot) {
  return !snapshot ? { value: "—", label: "UPCOMING" }
    : { value: snapshot.events.length, label: snapshot.hasMore || snapshot.after ? "UPCOMING PREVIEW" : "UPCOMING" };
}

export function publicVenueArtistTarget(event) {
  const parsed = parsePath(event?.artistPath || "");
  return parsed?.type === "artist" && text(event?.artist, 180)
    ? { name: event.artist, publicSlug: parsed.value } : null;
}
