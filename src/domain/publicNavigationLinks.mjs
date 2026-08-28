import {
  artistPath,
  concertPath,
  eventPath,
  postPath,
  profilePath,
  venuePath,
} from "./urls.mjs";
import { liveEventTitle } from "./liveDiscovery.mjs";

const text = (value) => String(value ?? "").trim();

const publicUser = (log, resolveUser) => {
  const embedded = log?.user && typeof log.user === "object" ? log.user : null;
  if (embedded?.handle) return embedded;
  return log?.userId ? resolveUser?.(log.userId) || null : null;
};

const append = (links, link) => {
  if (!link?.label) return;
  if (link.href && links.some((candidate) => candidate.href === link.href)) return;
  links.push(link);
};

const currentLink = (label, href = null) => ({
  key: `current:${href || label}`,
  label,
  href,
  current: true,
});

/**
 * Project live directory data into a small, visible set of canonical links.
 * Keeping this in the domain layer makes the hydrated `/artists` and `/events`
 * link graph testable without depending on a browser renderer.
 */
export function publicDirectoryItems(directory, rows = [], limit = 10) {
  if (directory !== "artists" && directory !== "events") return [];
  const seen = new Set();
  const items = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const artist = directory === "artists" ? row : null;
    const event = directory === "events" ? row : null;
    const href = artist ? artistPath(artist) : eventPath(event);
    if (!href || seen.has(href)) continue;
    seen.add(href);

    const projectedEventTitle = event ? liveEventTitle(event) : "";
    const title = text(artist?.name
      || (projectedEventTitle === "Event to be announced" ? event?.name : projectedEventTitle))
      || "Upcoming event";
    const detail = artist
      ? text(artist.genre) || "Artist profile"
      : [event?.venue, event?.place, event?.date].map(text).filter(Boolean).join(" · ") || "Event details";
    items.push({
      key: href,
      href,
      title,
      detail,
      action: artist ? "View artist" : "View event",
      value: row,
    });
    if (items.length >= Math.max(0, limit)) break;
  }

  return items;
}

// The compact app tabs are not public documents and should not inherit a fixed
// SEO breadcrumb. Keeping it only for real public routes prevents scrolled
// cards from being visibly clipped beneath an unrelated opaque strip.
export function shouldShowMobilePublicTrail(frame = {}) {
  return !!(
    frame?.directory
    || frame?.artistName
    || frame?.venueName
    || frame?.profileId
    || frame?.openLog
    || frame?.post
  );
}

/**
 * Visible, public navigation for the hydrated web app.
 *
 * Server-rendered documents already contain a rich link graph, but Expo replaces
 * that document once React hydrates. Keeping this model independent of rendering
 * lets the shared shell retain genuine anchors without inventing hidden SEO copy.
 */
export function publicNavigationLinks(frame = {}, { resolveUser } = {}) {
  const links = [
    { key: "home", label: "Home", href: "/", target: { type: "home" } },
    { key: "artists", label: "Artists", href: "/artists", target: { type: "directory", value: "artists" } },
    { key: "events", label: "Events", href: "/events", target: { type: "directory", value: "events" } },
  ];

  if (frame.artistName) {
    const href = frame.artistPublicSlug
      ? artistPath(frame.artistName, frame.artistPublicSlug)
      : null;
    append(links, currentLink(text(frame.artistName) || "Artist", href));
    return links;
  }

  if (frame.venueName) {
    append(links, currentLink(text(frame.venueName) || "Venue", venuePath(frame.venue || frame.venueName)));
    return links;
  }

  if (frame.profileId) {
    const user = resolveUser?.(frame.profileId) || null;
    const handle = text(user?.handle).replace(/^@/, "");
    append(links, currentLink(handle ? `@${handle}` : "Member", handle ? profilePath(handle) : null));
    return links;
  }

  const log = frame.post || frame.openLog || null;
  if (!log) {
    if (frame.directory === "artists") links[1] = { ...links[1], current: true, target: null };
    if (frame.directory === "events") links[2] = { ...links[2], current: true, target: null };
    return links;
  }

  const user = publicUser(log, resolveUser);
  const handle = text(user?.handle).replace(/^@/, "");
  if (handle) {
    append(links, {
      key: `profile:${handle}`,
      label: `@${handle}`,
      href: profilePath(handle),
      target: { type: "profile", value: user.id || log.userId },
    });
  }

  const artistName = text(log.artist);
  if (artistName) {
    const artist = {
      name: artistName,
      publicSlug: log.artistPublicSlug || log.artist_public_slug || null,
    };
    append(links, {
      key: `artist:${artist.publicSlug || artistName}`,
      label: artistName,
      href: artistPath(artist),
      target: { type: "artist", value: artist },
    });
  }

  const venueName = text(log.venue);
  if (venueName) {
    const venue = {
      name: venueName,
      providerVenueId: log.providerVenueId || log.venue_provider_id || null,
      source: log.source || null,
    };
    append(links, {
      key: `venue:${venue.providerVenueId || venueName}`,
      label: venueName,
      href: venuePath(venue),
      target: { type: "venue", value: venue },
    });
  }

  if (frame.post?.id) {
    append(links, currentLink("Post", postPath(frame.post.id)));
  } else if (log.archiveShowKey) {
    append(links, currentLink("Concert archive", concertPath(log.archiveShowKey)));
  } else if (log.performanceEvent === true && log.id) {
    append(links, currentLink("Event", eventPath(log.id)));
  } else if (log.id) {
    append(links, currentLink("Post", postPath(log.id)));
  }

  return links;
}

export function shouldUseSpaLinkNavigation(event) {
  const nativeEvent = event?.nativeEvent || event || {};
  if (event?.defaultPrevented || nativeEvent.defaultPrevented) return false;
  if (nativeEvent.button != null && nativeEvent.button !== 0) return false;
  return !(nativeEvent.altKey || nativeEvent.ctrlKey || nativeEvent.metaKey || nativeEvent.shiftKey);
}
