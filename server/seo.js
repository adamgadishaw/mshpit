// Public discovery documents, canonical URL resolution, and crawler controls.
//
// The interactive app remains an Expo web bundle. Public entity routes receive
// meaningful HTML inside #root before that bundle mounts, so people without
// JavaScript, link-preview bots, and search crawlers all see the same public
// facts. React replaces the preview when it starts; private/session state is
// never projected into this layer.

import { DATABASE_DIRECTORY, db, artistStmts, normName } from "./db.js";
import { activeAccountSql } from "./accountVisibility.js";
import { htmlRobotsDirective, isProduction } from "./environment.js";
import { profileAllowsSearchIndexing } from "./profileSearchIndexing.js";
import { projectedTourDateTicketUrl } from "../src/domain/ticketLinks.mjs";
import {
  artistConcertsPath,
  artistPath,
  artistsPath,
  concertPath,
  concertsPath,
  cityConcertsPath,
  cityVenuesPath,
  eventPath,
  eventsPath,
  parsePath,
  parsePublicCollectionPath,
  postPath,
  profilePath,
  slugify,
  venuePath,
  venuesPath,
} from "../src/domain/urls.mjs";
import {
  createPublicDocumentService,
  renderPublicDocumentHead,
  renderPublicDocumentShell,
} from "./features/seo/publicDocuments.js";
import {
  hasIndexableEventEvidence,
  isSitemapRequestPath,
} from "./features/seo/sitemapService.js";
import { createSitemapSnapshotManager } from "./features/seo/sitemapSnapshotManager.js";
import { decodeArchiveShowKey } from "./features/artistArchive/artistArchiveKeys.js";
import { isStrictCalendarDate } from "./features/seo/publicEntityPolicy.js";
import { effectiveTourDateEndSql } from "./tourDateLifecycle.js";
import { tourDateHasNoPublishedMemorialSql } from "./artistMemorialTourDateVisibility.js";
import { inPersonReviewSql } from "./onlineReviews.js";

const SITE_NAME = "Mshpit";
const DEFAULT_TITLE = "Mshpit — Concert reviews, photos and live music discovery";
const DEFAULT_DESCRIPTION =
  "Log the concerts that shape your story, share the nights you were there, and discover live music through people whose taste you trust.";

function configuredOrigin(env = process.env) {
  try {
    const parsed = new URL(env.PUBLIC_ORIGIN || "https://www.mshpit.com");
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new TypeError("Unsupported public origin");
    return parsed.origin;
  } catch {
    return "https://www.mshpit.com";
  }
}

export const origin = () => configuredOrigin(process.env);

const publicDocuments = createPublicDocumentService({
  database: db,
  origin: origin(),
  paths: {
    artist: (row) => artistPath({
      name: row?.name,
      public_slug: row?.public_slug || row?.artist_public_slug,
    }),
    member: (row) => profilePath(row?.u_handle || row?.handle),
    post: (row) => postPath(row?.id),
    event: (row) => eventPath(row?.id),
    concert: (key) => concertPath(key),
    venue: (row) => venuePath({
      name: row?.venue || row?.name,
      providerVenueId: row?.providerVenueId || row?.venue_provider_id,
      source: row?.source,
    }),
  },
});

const memberByHandle = db.prepare(`SELECT u.id,u.name,u.handle,u.extras FROM users u
  WHERE u.handle=? AND ${activeAccountSql("u")} LIMIT 1`);
const publicPostIdentity = db.prepare(`SELECT p.id FROM posts p JOIN users u ON u.id=p.user_id
  WHERE p.id=? AND p.removed=0 AND ${activeAccountSql("u")} LIMIT 1`);
const publicEventIdentity = db.prepare(`SELECT td.id,td.event_name,td.artist,td.venue,td.place,td.date,
    td.start_date_time,td.start_local_time,td.event_timezone,td.event_status,td.ticket_url,td.sold_out,
    td.source,td.owner_id,td.venue_provider_id,td.event_kind,td.music_qualified,
    td.music_evidence,td.billed_artists,td.event_end_date
  FROM tour_dates td LEFT JOIN users owner ON owner.id=td.owner_id
  WHERE td.id=?1 AND td.release_at<=?2
    AND COALESCE(td.music_qualified,1)=1
    AND (td.owner_id IS NULL OR ${activeAccountSql("owner")})
    AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1 OR ${effectiveTourDateEndSql("td")}<?3)
    AND (${effectiveTourDateEndSql("td")}<?3 OR ${tourDateHasNoPublishedMemorialSql("td")})
  LIMIT 1`);
const publicConcertIdentity = db.prepare(`SELECT p.artist,p.artist_key,p.venue,p.venue_key,p.city,p.date,
    AVG(p.overall) AS average_rating,COUNT(DISTINCT p.user_id) AS rating_count
  FROM posts p JOIN users u ON u.id=p.user_id
  WHERE p.removed=0 AND ${inPersonReviewSql("p")}
    AND pit_archive_identity(COALESCE(NULLIF(TRIM(p.artist_key),''),p.artist))=?
    AND pit_archive_identity(COALESCE(NULLIF(TRIM(p.venue_key),''),p.venue))=?
    AND p.date=? AND ${activeAccountSql("u")}
    AND (LENGTH(TRIM(COALESCE(p.review,'')))>=40 OR EXISTS (
      SELECT 1 FROM post_media media WHERE media.post_id=p.id
    ))
  GROUP BY pit_archive_identity(COALESCE(NULLIF(TRIM(p.artist_key),''),p.artist)),
    pit_archive_identity(COALESCE(NULLIF(TRIM(p.venue_key),''),p.venue)),p.date
  LIMIT 1`);
const PUBLIC_VENUE_EVENT_IDENTITY_COLUMNS = `td.venue,LOWER(td.venue) AS venue_key,
    COALESCE(NULLIF(td.venue_city,''),td.place) AS city,td.source,td.venue_provider_id,td.updated_at`;
const venueProviderByPublicSlug = db.prepare(`SELECT ${PUBLIC_VENUE_EVENT_IDENTITY_COLUMNS}
  FROM tour_dates td LEFT JOIN users owner ON owner.id=td.owner_id
  WHERE pit_venue_public_slug(td.source,td.venue_provider_id)=?
    AND td.venue_provider_id IS NOT NULL AND TRIM(td.venue_provider_id)<>''
    AND td.release_at<=? AND (td.owner_id IS NULL OR ${activeAccountSql("owner")})
    AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1 OR td.date<?)
  ORDER BY td.updated_at DESC,td.id DESC LIMIT 1`);
const venueProvidersByNameSlug = db.prepare(`SELECT MAX(td.venue) AS venue,td.source,td.venue_provider_id,
    MAX(COALESCE(NULLIF(td.venue_city,''),td.place)) AS city,MAX(td.updated_at) AS updated_at
  FROM tour_dates td LEFT JOIN users owner ON owner.id=td.owner_id
  WHERE pit_public_slug(td.venue)=? AND TRIM(COALESCE(td.venue,''))<>''
    AND td.venue_provider_id IS NOT NULL AND TRIM(td.venue_provider_id)<>''
    AND td.release_at<=? AND (td.owner_id IS NULL OR ${activeAccountSql("owner")})
    AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1 OR td.date<?)
  GROUP BY td.source,td.venue_provider_id
  ORDER BY MAX(td.updated_at) DESC,td.source,td.venue_provider_id LIMIT 2`);
const venueEventIdentitiesByNameSlug = db.prepare(`SELECT LOWER(TRIM(td.venue)) AS venue_identity,
    pit_public_slug(COALESCE(NULLIF(td.venue_city,''),NULLIF(td.place,''))) AS location_identity
  FROM tour_dates td LEFT JOIN users owner ON owner.id=td.owner_id
  WHERE pit_public_slug(td.venue)=? AND TRIM(COALESCE(td.venue,''))<>''
    AND td.release_at<=? AND (td.owner_id IS NULL OR ${activeAccountSql("owner")})
    AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1 OR td.date<?)
  GROUP BY venue_identity,location_identity
  ORDER BY MAX(td.updated_at) DESC,venue_identity,location_identity LIMIT 2`);
const venuePostIdentitiesByNameSlug = db.prepare(`SELECT LOWER(TRIM(p.venue)) AS venue_identity,
    pit_public_slug(p.city) AS location_identity
  FROM posts p JOIN users u ON u.id=p.user_id
  WHERE pit_public_slug(p.venue)=? AND p.removed=0
    AND ${inPersonReviewSql("p")}
    AND TRIM(COALESCE(p.venue,''))<>'' AND ${activeAccountSql("u")}
  GROUP BY venue_identity,location_identity
  ORDER BY MAX(COALESCE(p.updated_at,p.created_at)) DESC,venue_identity,location_identity LIMIT 2`);
const venueEventByNameSlug = db.prepare(`SELECT ${PUBLIC_VENUE_EVENT_IDENTITY_COLUMNS}
  FROM tour_dates td LEFT JOIN users owner ON owner.id=td.owner_id
  WHERE pit_public_slug(td.venue)=? AND TRIM(COALESCE(td.venue,''))<>''
    AND td.release_at<=? AND (td.owner_id IS NULL OR ${activeAccountSql("owner")})
    AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1 OR td.date<?)
  ORDER BY td.updated_at DESC,td.id DESC LIMIT 1`);
const venuePostByNameSlug = db.prepare(`SELECT p.venue,p.venue_key,p.city,
    NULL AS source,NULL AS venue_provider_id,COALESCE(p.updated_at,p.created_at) AS updated_at
  FROM posts p JOIN users u ON u.id=p.user_id
  WHERE pit_public_slug(p.venue)=? AND p.removed=0
    AND ${inPersonReviewSql("p")}
    AND TRIM(COALESCE(p.venue,''))<>'' AND ${activeAccountSql("u")}
  ORDER BY COALESCE(p.updated_at,p.created_at) DESC,p.id DESC LIMIT 1`);

const esc = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

function cleanPathname(value) {
  const pathname = String(value || "/");
  if (!pathname.startsWith("/") || pathname.length > 500 || /[\u0000-\u001f\u007f\\]/.test(pathname)) return null;
  return pathname;
}

function artistResolution(slug) {
  const artist = artistStmts.byPublicSlug.get(String(slug || "").trim());
  if (!artist) return null;
  const path = artistPath(artist);
  return {
    entity: { kind: "artist", name: artist.name, path },
    canonicalPath: path,
    documentRequest: { kind: "artist", artistKey: artist.norm, canonicalPath: path },
  };
}

function memberResolution(handle) {
  const member = memberByHandle.get(String(handle || "").replace(/^@+/, "").toLowerCase());
  if (!member) return null;
  const path = profilePath(member.handle);
  const allowsSearchIndexing = profileAllowsSearchIndexing(member);
  return {
    entity: { kind: "profile", name: member.name, handle: member.handle, id: member.id, path },
    canonicalPath: path,
    ...(allowsSearchIndexing
      ? { documentRequest: { kind: "member", id: member.id, canonicalPath: path } }
      : {}),
  };
}

function postResolution(id) {
  const post = publicPostIdentity.get(String(id || ""));
  if (!post) return null;
  const path = postPath(id);
  return {
    // The client still calls a logged review a "show" internally. Its public
    // identity is /post/:id; this compatibility value does not affect schema.
    entity: { kind: "show", id: String(id), path },
    canonicalPath: path,
    documentRequest: { kind: "post", id: post.id, canonicalPath: path },
  };
}

function eventResolution(id, at = Date.now()) {
  const instant = Number.isFinite(Number(at)) ? Number(at) : Date.now();
  const today = new Date(instant).toISOString().slice(0, 10);
  const event = publicEventIdentity.get(String(id || ""), instant, today);
  if (!event || !isStrictCalendarDate(event.date)) return null;
  const path = eventPath(event.id);
  return {
    entity: {
      kind: "event",
      id: event.id,
      name: event.event_name || `${event.artist} at ${event.venue}`,
      artist: event.artist,
      venue: event.venue,
      place: event.place || "",
      city: event.place || "",
      date: event.date,
      startDateTime: event.start_date_time || null,
      startLocalTime: event.start_local_time || null,
      eventTimezone: event.event_timezone || null,
      eventStatus: event.event_status || "scheduled",
      ticketUrl: projectedTourDateTicketUrl(event) || null,
      soldOut: !!event.sold_out,
      performanceEvent: true,
      path,
    },
    canonicalPath: path,
    documentRequest: { kind: "event", id: event.id, canonicalPath: path, at: instant, today },
  };
}

function concertResolution(showKey) {
  const decoded = decodeArchiveShowKey(showKey);
  if (!decoded || !isStrictCalendarDate(decoded.date)) return null;
  const concert = publicConcertIdentity.get(decoded.artistIdentity, decoded.venueIdentity, decoded.date);
  if (!concert) return null;
  const path = concertPath(showKey);
  return {
    entity: {
      kind: "concert",
      id: showKey,
      showKey,
      archiveShowKey: showKey,
      artist: concert.artist,
      venue: concert.venue,
      city: concert.city || "",
      place: concert.city || "",
      date: concert.date,
      overall: Number.isFinite(Number(concert.average_rating)) ? Number(concert.average_rating) : null,
      ratingCount: Math.max(0, Number(concert.rating_count) || 0),
      performanceEvent: true,
      path,
    },
    canonicalPath: path,
    documentRequest: { kind: "concert", showKey, canonicalPath: path },
  };
}

function canonicalVenueSlug(candidate) {
  return venuePath({
    name: candidate?.venue,
    providerVenueId: candidate?.venue_provider_id,
    source: candidate?.source,
  })?.slice("/venue/".length) || "";
}

function venueIdentityKey(row) {
  const name = String(row?.venue_identity || "").trim();
  const location = String(row?.location_identity || "").trim();
  return name ? `${name}|${location}` : "";
}

function unambiguousVenueByNameSlug(requestedSlug, at, today) {
  const providers = venueProvidersByNameSlug.all(requestedSlug, at, today);
  if (providers.length > 1) return null;

  const identities = new Set([
    ...venueEventIdentitiesByNameSlug.all(requestedSlug, at, today),
    ...venuePostIdentitiesByNameSlug.all(requestedSlug),
  ].map(venueIdentityKey).filter(Boolean));
  if (identities.size > 1) return null;

  if (providers.length === 1) {
    const providerSlug = canonicalVenueSlug(providers[0]);
    return providerSlug ? venueProviderByPublicSlug.get(providerSlug, at, today) || null : null;
  }
  return venueEventByNameSlug.get(requestedSlug, at, today)
    || venuePostByNameSlug.get(requestedSlug)
    || null;
}

function venueResolution(value) {
  const requestedSlug = String(value || "").trim().toLowerCase();
  if (!requestedSlug || requestedSlug.length > 240 || slugify(requestedSlug) !== requestedSlug) return null;
  const at = Date.now();
  const today = new Date(at).toISOString().slice(0, 10);
  const venue = venueProviderByPublicSlug.get(requestedSlug, at, today)
    || unambiguousVenueByNameSlug(requestedSlug, at, today);
  if (!venue) return null;
  const path = venuePath({
    name: venue.venue,
    providerVenueId: venue.venue_provider_id,
    source: venue.source,
  });
  if (!path) return null;
  return {
    entity: { kind: "venue", name: venue.venue, city: venue.city || null, path },
    canonicalPath: path,
    documentRequest: {
      kind: "venue",
      name: venue.venue,
      venueKey: venue.venue_key || normName(venue.venue),
      providerVenueId: venue.venue_provider_id || null,
      source: venue.source || null,
      canonicalPath: path,
      at,
      today,
    },
  };
}

const PUBLIC_DOCUMENT_UNAVAILABLE = Symbol("public-document-unavailable");

function hydrateResolution(resolution) {
  if (!resolution) return null;
  if (!resolution?.documentRequest) return { ...resolution, document: null };
  const document = safePublicDocument(() => publicDocuments.documentFor(resolution.documentRequest));
  return document === PUBLIC_DOCUMENT_UNAVAILABLE
    ? { ...resolution, document: null, unavailable: true }
    : { ...resolution, document: document || null, unavailable: false };
}

function safePublicDocument(read) {
  try {
    return read();
  } catch (error) {
    const cause = error instanceof Error && error.name ? error.name : "UnknownError";
    console.error(`[seo] public document projection unavailable: cause=${cause}`);
    return PUBLIC_DOCUMENT_UNAVAILABLE;
  }
}

function entityResolution(pathname) {
  const parsed = parsePath(pathname);
  if (!parsed) return null;

  if (parsed.type === "artist") return artistResolution(parsed.value);
  if (parsed.type === "profile") return memberResolution(parsed.value);
  if (parsed.type === "show") return postResolution(parsed.value);
  if (parsed.type === "event") return eventResolution(parsed.value);
  if (parsed.type === "concert") return concertResolution(parsed.value);
  if (parsed.type === "venue") return venueResolution(parsed.value);

  // Legacy root vanity links had one shared namespace. Preserve their original
  // collision policy, then redirect profiles/artists to explicit canonicals.
  return memberResolution(parsed.value)
    || artistResolution(parsed.value)
    || venueResolution(parsed.value);
}

export function resolveEntity(pathname) {
  const path = cleanPathname(pathname);
  return path ? entityResolution(path)?.entity || null : null;
}

const APP_SCREENS = new Set([
  "/about", "/admin", "/badges", "/calendar", "/clips", "/discover",
  "/download", "/feed", "/help", "/home", "/inbox", "/login", "/menu",
  "/messages", "/moderation", "/nearby", "/new", "/notifications",
  "/playlist", "/playlists", "/search", "/settings", "/signup", "/tour",
  "/venues", "/you",
]);

function publicRoute(pathname) {
  const path = cleanPathname(pathname);
  if (!path) return { type: "not-found", status: 404 };
  if (path === "/") {
    const document = safePublicDocument(() => publicDocuments.homeDocument({ canonicalPath: "/" }));
    if (document === PUBLIC_DOCUMENT_UNAVAILABLE) return { type: "unavailable", status: 503 };
    if (!document) return { type: "app", status: 200 };
    return {
      type: "document",
      status: 200,
      canonicalPath: "/",
      document,
    };
  }

  const collection = parsePublicCollectionPath(path);
  if (collection && ["artists", "events", "venues", "concerts"].includes(collection.type)) {
    const buildPath = {
      artists: artistsPath,
      events: eventsPath,
      venues: venuesPath,
      concerts: concertsPath,
    }[collection.type];
    if (collection.nonCanonicalPageOne) {
      return { type: "redirect", status: 301, location: buildPath(1) };
    }
    if (collection.page > 1_000) return { type: "not-found", status: 404 };
    const canonicalPath = buildPath(collection.page);
    const document = safePublicDocument(() => publicDocuments.directoryDocument({
      kind: collection.type,
      page: collection.page,
      canonicalPath,
      at: Date.now(),
    }));
    if (document === PUBLIC_DOCUMENT_UNAVAILABLE) return { type: "unavailable", status: 503 };
    const rows = document?.[collection.type];
    if (!document || !Array.isArray(rows) || rows.length === 0) {
      return { type: "not-found", status: 404 };
    }
    if (document.canonicalPath !== canonicalPath || path !== document.canonicalPath) {
      return { type: "redirect", status: 301, location: document.canonicalPath || canonicalPath };
    }
    return { type: "document", status: 200, canonicalPath, indexable: true, document };
  }

  if (collection && ["city-venues", "city-concerts", "artist-concerts"].includes(collection.type)) {
    const buildPath = collection.type === "city-venues" ? cityVenuesPath
      : collection.type === "city-concerts" ? cityConcertsPath : artistConcertsPath;
    const identity = collection.type === "artist-concerts"
      ? collection.artistSlug
      : { countryCode: collection.countryCode, city: collection.citySlug };
    if (collection.page > 1_000) return { type: "not-found", status: 404 };
    const canonicalPath = buildPath(identity, collection.page);
    if (!canonicalPath) return { type: "not-found", status: 404 };
    if (collection.nonCanonicalPageOne) {
      return { type: "redirect", status: 301, location: buildPath(identity, 1) };
    }
    const document = safePublicDocument(() => publicDocuments.documentFor({
      kind: collection.type,
      page: collection.page,
      at: Date.now(),
      ...(collection.type === "artist-concerts"
        ? { publicSlug: collection.artistSlug }
        : { countryCode: collection.countryCode, citySlug: collection.citySlug }),
    }));
    if (document === PUBLIC_DOCUMENT_UNAVAILABLE) return { type: "unavailable", status: 503 };
    const rows = document?.directoryKind === "venues" ? document.venues : document?.concerts;
    if (!document || !Array.isArray(rows) || rows.length === 0) {
      return { type: "not-found", status: 404 };
    }
    if (document.canonicalPath !== canonicalPath || path !== document.canonicalPath) {
      return { type: "redirect", status: 301, location: document.canonicalPath || canonicalPath };
    }
    return { type: "document", status: 200, canonicalPath, indexable: true, document };
  }

  if (!collection && (/^\/(?:venues|concerts)(?:\/|$)/iu.test(path)
    || /^\/artist\/[^/]+\/concerts(?:\/|$)/iu.test(path))) {
    return { type: "not-found", status: 404 };
  }

  if (path === "/discover") {
    const document = safePublicDocument(() => publicDocuments.discoverDocument({
      canonicalPath: path,
      at: Date.now(),
    }));
    if (document === PUBLIC_DOCUMENT_UNAVAILABLE) return { type: "unavailable", status: 503 };
    if (!document || !documentIsIndexable(document)) return { type: "app", status: 200 };
    return { type: "document", status: 200, canonicalPath: path, indexable: true, document };
  }

  if (path === "/search") {
    const document = safePublicDocument(() => publicDocuments.searchDocument({ canonicalPath: path }));
    if (document === PUBLIC_DOCUMENT_UNAVAILABLE) return { type: "unavailable", status: 503 };
    if (!document) return { type: "app", status: 200 };
    return { type: "document", status: 200, canonicalPath: path, indexable: false, document };
  }

  const parsed = parsePath(path);
  if (parsed) {
    const identity = entityResolution(path);
    if (!identity) return { type: "not-found", status: 404 };
    if (identity.canonicalPath && identity.canonicalPath !== path) {
      return { type: "redirect", status: 301, location: identity.canonicalPath, entity: identity.entity };
    }
    const resolution = hydrateResolution(identity);
    if (resolution.unavailable) return { type: "unavailable", status: 503 };
    if (resolution.document) {
      return {
        type: "document",
        status: 200,
        indexable: documentIsIndexable(resolution.document),
        ...resolution,
      };
    }
    if (identity.documentRequest) return { type: "not-found", status: 404 };
    return { type: "app", status: 200, entity: resolution.entity };
  }

  if (APP_SCREENS.has(path.toLowerCase())) return { type: "app", status: 200 };
  return { type: "not-found", status: 404 };
}

function substantiveText(value, minimum) {
  return String(value || "").replace(/\s+/g, " ").trim().length >= minimum;
}

function documentIsIndexable(document) {
  if (!document) return false;
  if (document.kind === "home") return true;
  if (document.kind === "artist") {
    return substantiveText(document.memorial?.summary, 20)
      || substantiveText(document.artist?.bio, 80)
      || document.reviews?.some((review) => substantiveText(review.text, 40) || review.media?.length)
      || document.events?.length > 0
      || document.concerts?.length > 0;
  }
  if (document.kind === "member") {
    return substantiveText(document.member?.bio, 60)
      || document.posts?.some((post) => substantiveText(post.text, 40) || post.media?.length);
  }
  if (document.kind === "post") {
    return substantiveText(document.post?.text, 40) || document.post?.media?.length > 0;
  }
  if (document.kind === "event") {
    return hasIndexableEventEvidence({
      eligibleFanContent: document.posts?.some((post) => (
        substantiveText(post.text, 40) || post.media?.length > 0
      )),
      // The event projector has already revalidated the persisted URL and
      // removes past/non-purchasable offers before this policy runs.
      currentPublicTicketUrl: document.event?.ticketUrl,
      // The projector emits MusicEvent only for strict offset DateTime plus a
      // complete structured street/locality/country address.
      completeRichEvent: document.jsonLd?.some((node) => node?.["@type"] === "MusicEvent"),
    });
  }
  if (document.kind === "concert") {
    return document.reviews?.some((review) => substantiveText(review.text, 40) || review.media?.length)
      || Number(document.concert?.ratingCount) > 0;
  }
  if (document.kind === "venue") {
    return document.events?.length > 0
      || document.posts?.some((post) => substantiveText(post.text, 40) || post.media?.length);
  }
  if (document.kind === "discover") {
    return document.artists?.length > 0 || document.events?.length > 0 || document.posts?.length > 0;
  }
  if (document.kind === "directory") return true;
  return false;
}

export function seoHttpPlan(pathname) {
  return publicRoute(pathname);
}

function legacyMetadata(resolution) {
  if (!resolution) return null;
  const { document, entity } = resolution;
  if (!document) {
    if (entity?.kind !== "venue") return null;
    return {
      kind: "venue",
      name: entity.name,
      path: entity.path,
      title: `${entity.name} — live music on Mshpit`,
      description: `Open ${entity.name} on Mshpit.`,
      image: null,
    };
  }
  const kind = document.kind === "member" ? "profile" : document.kind === "post" ? "show" : document.kind;
  return {
    kind,
    name: document.artist?.name || document.member?.name || null,
    handle: document.member?.handle || null,
    id: document.post?.id || entity?.id || null,
    path: document.canonicalPath,
    title: document.title,
    description: document.description,
    image: document.image,
    ...(kind === "show" ? {
      show: {
        id: document.post.id,
        artist: document.post.artist,
        venue: document.post.venue,
        city: document.post.city,
        date: document.post.showDate,
        overall: document.post.rating,
        review: document.post.text,
      },
    } : {}),
  };
}

export function metadataFor(pathname) {
  const path = cleanPathname(pathname);
  return path ? legacyMetadata(hydrateResolution(entityResolution(path))) : null;
}

const ROBOTS_META_PATTERN = /<meta\b(?=[^>]*\bname\s*=\s*["']robots["'])[^>]*\/?>\s*/gi;

function withRobotsMeta(tags, { indexable = false, env = process.env } = {}) {
  const withoutRobots = String(tags || "").replace(ROBOTS_META_PATTERN, "").trimStart();
  const directive = htmlRobotsDirective({ indexable, env });
  return `<meta name="robots" content="${esc(directive)}" />\n${withoutRobots}`;
}

export function enforceHtmlRobotsMeta(html, { indexable = false, env = process.env } = {}) {
  const directive = htmlRobotsDirective({ indexable, env });
  const tag = `<meta name="robots" content="${esc(directive)}" />`;
  const withoutRobots = String(html || "").replace(ROBOTS_META_PATTERN, "");
  return /<\/head>/i.test(withoutRobots)
    ? withoutRobots.replace(/<\/head>/i, `  ${tag}\n</head>`)
    : `${tag}\n${withoutRobots}`;
}

function defaultHead(pathname) {
  const path = cleanPathname(pathname) || "/";
  const url = `${origin()}${path}`;
  const image = `${origin()}/og.png`;
  return `<title>${esc(DEFAULT_TITLE)}</title>
    <meta name="description" content="${esc(DEFAULT_DESCRIPTION)}" />
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${esc(DEFAULT_TITLE)}" />
    <meta property="og:description" content="${esc(DEFAULT_DESCRIPTION)}" />
    <meta property="og:url" content="${esc(url)}" />
    <meta property="og:image" content="${esc(image)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />`;
}

function headTagsForRoute(pathname, route, env) {
  const tags = route.type === "document" && route.document
    ? renderPublicDocumentHead(route.document)
    : defaultHead(pathname);
  return withRobotsMeta(tags, {
    indexable: route.type === "document" && !!route.document && route.indexable !== false,
    env,
  });
}

export function headTagsFor(pathname, env = process.env) {
  const route = publicRoute(pathname);
  return headTagsForRoute(pathname, route, env);
}

function replaceHead(html, tags) {
  const withoutTitle = String(html).replace(/\s*<title[^>]*>[\s\S]*?<\/title>/i, "");
  const withoutRobots = withoutTitle.replace(ROBOTS_META_PATTERN, "");
  return withoutRobots.replace(/<\/head>/i, `    ${tags}\n  </head>`);
}

export function injectHead(html, pathname, resolvedRoute = null, env = process.env) {
  const route = resolvedRoute || publicRoute(pathname);
  let output = replaceHead(html, headTagsForRoute(pathname, route, env));
  if (route.type === "document" && route.document) {
    const shell = renderPublicDocumentShell(route.document);
    if (shell) output = output.replace(/<div\s+id=["']root["']\s*><\/div>/i, `<div id="root">${shell}</div>`);
  }
  return output;
}

export function renderNotFoundDocument(env = process.env) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Page not found | Mshpit</title><meta name="robots" content="${esc(htmlRobotsDirective({ env }))}" />
  <style>body{margin:0;background:#080807;color:#f8f4ec;font:16px/1.5 system-ui;display:grid;min-height:100vh;place-items:center}main{max-width:42rem;padding:2rem}p:first-child{color:#f4b72a;font:800 .75rem monospace;letter-spacing:.15em;text-transform:uppercase}h1{font:900 clamp(3rem,10vw,6rem)/.95 Georgia,serif;margin:.4rem 0}p{color:#bdb4aa}a{display:inline-block;margin-top:1rem;border-radius:999px;background:#f4b72a;color:#150f05;padding:.8rem 1.1rem;text-decoration:none;font-weight:800}</style>
</head><body><main><p>Lost in the crowd</p><h1>That page isn't here.</h1><p>The link may be old, private, or removed.</p><a href="/">Back to Mshpit</a></main></body></html>`;
}

export function robotsTxt() {
  if (!isProduction()) {
    return ["# staging — not for indexing", "User-agent: *", "Disallow: /", ""].join("\n");
  }
  return [
    "# mshpit.com",
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "",
    `Sitemap: ${origin()}/sitemap.xml`,
    "",
  ].join("\n");
}

const sitemapSnapshots = createSitemapSnapshotManager({
  database: db,
  dataDir: DATABASE_DIRECTORY,
  env: process.env,
});

export const loadSitemapSnapshot = () => sitemapSnapshots.load();
export const refreshSitemapSnapshot = (options) => sitemapSnapshots.refresh(options);
export const drainSitemapSnapshotRefresh = () => sitemapSnapshots.drain();
export const sitemapSnapshotHealth = () => sitemapSnapshots.health();

export function sitemapXml() {
  return sitemapForPath("/sitemap.xml");
}

export function sitemapForPath(pathname) {
  const path = cleanPathname(pathname);
  if (!path || !isSitemapRequestPath(path)) return null;
  return sitemapSnapshots.xmlFor(path);
}

export function sitemapResponseForPath(pathname) {
  const path = cleanPathname(pathname);
  return path ? sitemapSnapshots.lookup(path) : Object.freeze({ status: "unrecognized" });
}
