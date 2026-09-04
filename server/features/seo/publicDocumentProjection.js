import {
  artistConcertsPath,
  artistPath,
  concertPath,
  concertsPath,
  eventPath,
  profilePath,
  showPath,
  venuePath,
  venuesPath,
} from "../../../src/domain/urls.mjs";
import { projectedTourDateTicketUrl } from "../../../src/domain/ticketLinks.mjs";
import { projectArtistGenre } from "../../../src/domain/genre.mjs";
import { SUPPORT_EMAIL } from "../../../src/domain/contact.mjs";
import { LANDING_IDENTITY_COPY } from "../../../src/domain/landingPresentation.mjs";
import { postMediaStateByPost } from "../../mediaAssets.js";
import { verifiedFinalizedLegacyMedia } from "../../mediaLegacyFinalize.js";
import { safeOwnedReadyMediaUrl } from "../../publicMedia.js";
import { publicTicketmasterEventImage } from "../../providerEventImage.js";
import { publicVenuePhotoPool } from "../../venuePhotoCatalog.js";
import { projectedOnlineReviewFields } from "../../onlineReviews.js";
import { archiveShowKey } from "../artistArchive/artistArchiveKeys.js";
import { venueCoordinates, venueGuideModel } from "../../../src/domain/venueGuide.mjs";
import { publicVenueFacts } from "../../venueFacts.js";
import {
  isIndexableMusicEventRecord,
  isStrictCalendarDate,
  isStrictIsoDateTime,
} from "./publicEntityPolicy.js";

const SITE_NAME = "Mshpit";
const DEFAULT_ORIGIN = "https://www.mshpit.com";
const MUSICBRAINZ_ARTIST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NON_PURCHASABLE_EVENT_STATUSES = new Set(["cancelled", "canceled", "offsale", "off-sale", "off_sale", "unavailable"]);
const PROFILE_IMAGE_PURPOSES = new Set(["avatar", "banner"]);
const PROFILE_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function cleanLine(value, maximum = 200) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function cleanBody(value, maximum = 8_000) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maximum);
}

function summary(value, maximum = 160) {
  const text = cleanLine(value, maximum + 80);
  if (text.length <= maximum) return text;
  const sample = text.slice(0, maximum);
  const boundary = sample.lastIndexOf(" ");
  return `${(boundary > maximum * 0.6 ? sample.slice(0, boundary) : sample).trimEnd()}…`;
}

function substantiveText(value, minimum = 1) {
  return cleanLine(value, Math.max(minimum, 8_000)).length >= minimum;
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function publicArtistGenres(row) {
  const projected = projectArtistGenre(parseObject(row?.data), row?.genre);
  return projected.genre ? [cleanLine(projected.genre, 60)] : [];
}

function setlistItems(value) {
  return parseArray(value)
    .flatMap((item) => typeof item === "string" ? [cleanLine(item, 120)] : [])
    .filter(Boolean)
    .slice(0, 40);
}

function count(value) {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function rating(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 5 ? parsed : null;
}

function timestamp(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function isoTimestamp(value) {
  const at = timestamp(value);
  if (at == null) return null;
  const date = new Date(at);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function isoDuration(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  const seconds = Math.max(1, Math.round(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return `PT${hours ? `${hours}H` : ""}${minutes ? `${minutes}M` : ""}${remainder || (!hours && !minutes) ? `${remainder}S` : ""}`;
}

function validDate(value) {
  const date = cleanLine(value, 10);
  return isStrictCalendarDate(date) ? date : null;
}

function completeDateTime(value) {
  const candidate = cleanLine(value, 40);
  return isStrictIsoDateTime(candidate) ? candidate : null;
}

function publicHttpsUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function memorialProjection(value) {
  if (value?.deceased !== true) return null;
  const deathDate = validDate(value.deathDate);
  const memorialSummary = cleanBody(value.summary, 600);
  const thankYou = cleanBody(value.thankYou, 320);
  const accomplishments = (Array.isArray(value.accomplishments) ? value.accomplishments : [])
    .map((item) => cleanLine(item, 180))
    .filter((item) => item.length >= 2)
    .slice(0, 8);
  const sourceUrl = publicHttpsUrl(value.citation?.url);
  if (!deathDate || memorialSummary.length < 20 || thankYou.length < 3 || !accomplishments.length || !sourceUrl) return null;
  let sourceLabel = cleanLine(value.citation?.title, 180);
  if (!sourceLabel) {
    try { sourceLabel = new URL(sourceUrl).hostname.replace(/^www\./u, ""); } catch { sourceLabel = "Memorial source"; }
  }
  return Object.freeze({
    deathDate,
    summary: memorialSummary,
    thankYou,
    accomplishments: Object.freeze(accomplishments),
    citation: Object.freeze({ url: sourceUrl, title: sourceLabel }),
  });
}

function normalizedOrigin(value) {
  try {
    const parsed = new URL(value || DEFAULT_ORIGIN);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return DEFAULT_ORIGIN;
    return parsed.origin;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

function internalPath(value, fallback = "/") {
  const path = typeof value === "string" ? value.trim() : "";
  return path.startsWith("/") && !path.startsWith("//") && !/[\\\u0000-\u001f\u007f]/.test(path)
    ? path
    : fallback;
}

function absolute(origin, path) {
  return new URL(internalPath(path), `${origin}/`).toString();
}

function canonicalPath(override, fallback) {
  return internalPath(override, internalPath(fallback));
}

function canonicalPostPath(paths, row) {
  return internalPath(paths.post(row), showPath(row.id));
}

function canonicalMemberPath(paths, row) {
  return internalPath(paths.member(row), profilePath(row.u_handle || row.handle));
}

function canonicalArtistPath(paths, row) {
  return internalPath(paths.artist(row), artistPath(row.name));
}

function relatedArtistPath(paths, row) {
  const publicSlug = cleanLine(row?.artist_public_slug || row?.public_slug, 160);
  if (!publicSlug) return null;
  return canonicalArtistPath(paths, {
    name: row?.artist || row?.name,
    norm: row?.artist_key || row?.norm,
    public_slug: publicSlug,
  });
}

function musicBrainzArtistUrl(value) {
  const mbid = cleanLine(value, 36).toLowerCase();
  return MUSICBRAINZ_ARTIST_ID.test(mbid) ? `https://musicbrainz.org/artist/${mbid}` : null;
}

function canonicalEventPath(paths, row) {
  return internalPath(paths.event(row), eventPath(row.id));
}

function canonicalVenuePath(paths, row, { allowNameOnly = false } = {}) {
  const providerVenueId = cleanLine(row?.providerVenueId || row?.venue_provider_id, 180);
  if (!providerVenueId && !allowNameOnly) return null;
  return internalPath(paths.venue(row), venuePath({
    name: row.venue || row.name,
    providerVenueId,
    source: row.source,
  }));
}

function canonicalConcertPath(paths, key) {
  return internalPath(paths.concert(key), concertPath(key));
}

function publicMediaForRows(database, rows, { galleryOnly = false, maxPerPost = 2 } = {}) {
  const safeRows = Array.isArray(rows) ? rows.filter((row) => row?.id && row?.user_id) : [];
  const state = postMediaStateByPost(database, safeRows.map((row) => row.id));
  const result = new Map();

  for (const row of safeRows) {
    if (galleryOnly && !row.photos_public) {
      result.set(row.id, []);
      continue;
    }

    if (state.linkedPostIds.has(row.id)) {
      const assets = (state.assetsByPost.get(row.id) || []).slice(0, maxPerPost).flatMap((asset) => {
        const kind = asset?.kind === "image" || asset?.kind === "video" ? asset.kind : null;
        const url = kind
          ? safeOwnedReadyMediaUrl(database, { ownerId: row.user_id, url: asset.url, kind })
          : null;
        if (!url) return [];
        return [{
          id: cleanLine(asset.id, 120) || null,
          kind,
          url,
          posterUrl: kind === "video" && typeof asset.posterUrl === "string" ? asset.posterUrl : null,
          altText: cleanLine(asset.altText, 500),
          mimeType: cleanLine(asset.mimeType, 100) || null,
          width: count(asset.width) || null,
          height: count(asset.height) || null,
          durationMs: kind === "video" ? count(asset.durationMs) || null : null,
          createdAt: timestamp(asset.createdAt),
          updatedAt: timestamp(asset.updatedAt),
        }];
      });
      result.set(row.id, assets);
      continue;
    }

    const legacy = [];
    for (const candidate of parseArray(row.photos).slice(0, maxPerPost)) {
      const imageUrl = safeOwnedReadyMediaUrl(database, { ownerId: row.user_id, url: candidate, kind: "image" });
      const videoUrl = imageUrl ? null : safeOwnedReadyMediaUrl(database, { ownerId: row.user_id, url: candidate, kind: "video" });
      if (imageUrl) legacy.push({ id: null, kind: "image", url: imageUrl, posterUrl: null, altText: "", mimeType: null, width: null, height: null, durationMs: null, createdAt: null, updatedAt: null });
      else if (videoUrl) legacy.push({ id: null, kind: "video", url: videoUrl, posterUrl: null, altText: "", mimeType: null, width: null, height: null, durationMs: null, createdAt: null, updatedAt: null });
    }
    result.set(row.id, legacy);
  }
  return result;
}

function safeProfileImage(database, ownerId, value, purpose) {
  const expectedPurpose = cleanLine(purpose, 20).toLowerCase();
  if (!PROFILE_IMAGE_PURPOSES.has(expectedPurpose)) return null;

  // The current profile uploader uses the private decode/re-encode legacy
  // finalizer rather than media_assets. Bind that proof to the exact profile
  // field so a banner cannot be replayed as an avatar (or vice versa).
  const finalized = verifiedFinalizedLegacyMedia(database, {
    ownerId,
    publicUrl: value,
    purpose: expectedPurpose,
  });
  const finalizedUrl = publicHttpsUrl(finalized?.publicUrl);
  if (finalizedUrl) {
    const mimeType = cleanLine(finalized.contentType, 100).toLowerCase();
    return Object.freeze({
      url: finalizedUrl,
      width: count(finalized.width) || null,
      height: count(finalized.height) || null,
      mimeType: PROFILE_IMAGE_MIME_TYPES.has(mimeType) ? mimeType : null,
    });
  }

  // Preserve already-ready media_assets references during the profile-media
  // migration. That verifier proves ownership and sanitized image delivery,
  // but its intentionally minimal projection does not expose dimensions.
  const stableUrl = safeOwnedReadyMediaUrl(database, { ownerId, url: value, kind: "image" });
  return stableUrl ? Object.freeze({ url: stableUrl, width: null, height: null, mimeType: null }) : null;
}

function profileImageSchema(media, name) {
  const contentUrl = publicHttpsUrl(media?.url);
  if (!contentUrl) return null;
  if (!media.width && !media.height && !media.mimeType) return contentUrl;
  return Object.freeze({
    "@type": "ImageObject",
    contentUrl,
    url: contentUrl,
    ...(cleanLine(name, 180) ? { name: cleanLine(name, 180) } : {}),
    ...(media.width ? { width: media.width } : {}),
    ...(media.height ? { height: media.height } : {}),
    ...(media.mimeType ? { encodingFormat: media.mimeType } : {}),
  });
}

function venuePhotoProjection(photo, venueName) {
  const url = publicHttpsUrl(photo?.uri);
  const creator = cleanLine(photo?.creator, 240);
  const license = cleanLine(photo?.license, 40);
  const licenseUrl = publicHttpsUrl(photo?.licenseUrl);
  const sourcePage = publicHttpsUrl(photo?.sourcePage);
  if (!url || !creator || !license || !licenseUrl || !sourcePage) return null;
  return Object.freeze({
    url,
    alt: `${cleanLine(venueName, 180)} venue photo`,
    attribution: cleanLine(photo?.by, 320) || `${creator} · ${license.replaceAll("-", " ")}`,
    creator,
    license,
    licenseUrl,
    sourcePage,
    modificationNotice: cleanLine(photo?.modificationNotice, 240) || null,
  });
}

function venuePhotoSchema(photo, venueName) {
  if (!photo?.url) return null;
  return Object.freeze({
    "@type": "ImageObject",
    contentUrl: photo.url,
    url: photo.url,
    name: `${cleanLine(venueName, 180)} venue photo`,
    caption: photo.alt,
    creditText: photo.attribution,
    creator: Object.freeze({ "@type": "Person", name: photo.creator }),
    license: photo.licenseUrl,
    acquireLicensePage: photo.sourcePage,
  });
}

function postCard(row, media, paths, { textLimit = 8_000 } = {}) {
  const authorName = cleanLine(row.u_name, 100) || "A Mshpit member";
  const handle = cleanLine(row.u_handle, 40).replace(/^@+/, "");
  const online = projectedOnlineReviewFields(row);
  const onlineReview = online.experienceType === "online";
  const artist = cleanLine(row.artist, 160);
  const venue = onlineReview ? "" : cleanLine(row.venue, 180);
  const showDate = onlineReview ? null : validDate(row.date);
  const reviewConcertPath = row.kind !== "status" && artist && venue && showDate
    ? canonicalConcertPath(paths, archiveShowKey({
        artistIdentity: cleanLine(row.artist_key, 200) || artist,
        venueIdentity: cleanLine(row.venue_key, 200) || venue,
        date: showDate,
      }))
    : null;
  return Object.freeze({
    id: String(row.id),
    path: canonicalPostPath(paths, row),
    author: Object.freeze({
      name: authorName,
      handle: handle || null,
      path: handle ? canonicalMemberPath(paths, row) : null,
    }),
    kind: row.kind === "status" ? "status" : "review",
    artist: artist || null,
    artistPath: artist ? relatedArtistPath(paths, row) : null,
    venue: venue || null,
    venuePath: venue ? canonicalVenuePath(paths, row) : null,
    concertPath: reviewConcertPath,
    city: onlineReview ? null : cleanLine(row.city, 120) || null,
    showDate,
    rating: rating(row.overall),
    text: cleanBody(row.review, textLimit),
    setlist: onlineReview ? Object.freeze([]) : Object.freeze(setlistItems(row.setlist)),
    tour: onlineReview ? null : cleanLine(row.tour, 180) || null,
    ...online,
    media: Array.isArray(media) ? media : [],
    likes: count(row.like_count),
    comments: count(row.comment_count),
    publishedAt: timestamp(row.created_at),
    modifiedAt: timestamp(row.updated_at) || timestamp(row.created_at),
  });
}

function siteReference(origin) {
  return { "@type": "WebSite", "@id": `${origin}/#website`, name: SITE_NAME, url: `${origin}/` };
}

function organizationReference(origin) {
  return {
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: SITE_NAME,
    alternateName: "PIT",
    url: `${origin}/`,
    logo: {
      "@type": "ImageObject",
      url: `${origin}/logo.svg`,
      width: 512,
      height: 512,
    },
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: SUPPORT_EMAIL,
      url: `${origin}/contact`,
      availableLanguage: "English",
    },
  };
}

function organizationNode(origin) {
  return {
    "@context": "https://schema.org",
    ...organizationReference(origin),
  };
}

function breadcrumbNode(origin, crumbs) {
  const items = (Array.isArray(crumbs) ? crumbs : []).filter((crumb) => crumb?.name && crumb?.path);
  if (!items.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absolute(origin, crumb.path),
    })),
  };
}

function mediaCaption(asset, context, index = 0) {
  return cleanLine(asset?.altText, 500)
    || cleanLine(`${context || "Concert memory"}${index ? ` ${index + 1}` : ""}`, 500);
}

function mediaSchema(asset, { origin, pageUrl, context, author, publishedAt, index = 0 } = {}) {
  const contentUrl = publicHttpsUrl(asset?.url);
  if (!contentUrl) return null;
  const caption = mediaCaption(asset, context, index);
  const common = {
    "@id": asset.id ? `${pageUrl}#media-${encodeURIComponent(asset.id)}` : `${pageUrl}#media-${index + 1}`,
    name: caption,
    caption,
    contentUrl,
    url: pageUrl,
    ...(isoTimestamp(asset.createdAt || publishedAt) ? { uploadDate: isoTimestamp(asset.createdAt || publishedAt) } : {}),
    ...(asset.width ? { width: asset.width } : {}),
    ...(asset.height ? { height: asset.height } : {}),
    ...(author ? { creator: author } : {}),
    isPartOf: siteReference(origin),
  };
  if (asset.kind === "video") {
    const thumbnail = publicHttpsUrl(asset.posterUrl);
    const duration = isoDuration(asset.durationMs);
    // Google video features require a stable thumbnail. Incomplete legacy
    // clips stay playable in HTML but receive no VideoObject claim.
    if (!thumbnail || !duration || !isoTimestamp(asset.createdAt || publishedAt)) return null;
    return {
      "@type": "VideoObject",
      ...common,
      description: caption,
      thumbnailUrl: [thumbnail],
      duration,
      ...(asset.mimeType ? { encodingFormat: asset.mimeType } : {}),
    };
  }
  return {
    "@type": "ImageObject",
    ...common,
    ...(asset.mimeType ? { encodingFormat: asset.mimeType } : {}),
  };
}

function eventAddress(row) {
  const streetAddress = cleanLine([row.venue_address_line1, row.venue_address_line2].filter(Boolean).join(", "), 260);
  const addressLocality = cleanLine(row.venue_city, 120);
  const addressCountry = cleanLine(row.venue_country_code || row.venue_country, 100);
  // A free-form place such as "London" is useful visible copy, but is not
  // reliable enough to claim a PostalAddress in Google's Event markup.
  if (!streetAddress && !(addressLocality && addressCountry)) return null;
  const address = {
    "@type": "PostalAddress",
    ...(streetAddress ? { streetAddress } : {}),
    ...(addressLocality ? { addressLocality } : {}),
    ...(cleanLine(row.venue_region, 120) ? { addressRegion: cleanLine(row.venue_region, 120) } : {}),
    ...(cleanLine(row.venue_postal_code, 40) ? { postalCode: cleanLine(row.venue_postal_code, 40) } : {}),
    ...(addressCountry ? { addressCountry } : {}),
  };
  return address;
}

function eventStatus(value) {
  const status = cleanLine(value, 40).toLowerCase();
  if (status === "cancelled" || status === "canceled") return "https://schema.org/EventCancelled";
  if (status === "postponed") return "https://schema.org/EventPostponed";
  if (status === "rescheduled") return null;
  return "https://schema.org/EventScheduled";
}

function eventAllowsTicketOffer(event, today = null) {
  if (!event?.ticketUrl) return false;
  const status = cleanLine(event.statusLabel, 40).toLowerCase();
  if (NON_PURCHASABLE_EVENT_STATUSES.has(status) || event.status === "https://schema.org/EventCancelled") return false;
  const currentDate = validDate(today);
  return !currentDate || !event.date || event.date >= currentDate;
}

function eventCard(row, paths) {
  if (!row?.id || !isIndexableMusicEventRecord(row)) return null;
  const artist = cleanLine(row.artist, 160);
  const venue = cleanLine(row.venue, 180);
  const date = validDate(row.date);
  if (!artist || !venue || !date) return null;
  const ticketUrl = projectedTourDateTicketUrl(row) || null;
  const startDateTime = (() => {
    const value = cleanLine(row.start_date_time, 80);
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? null : value;
  })();
  const providerEvidence = cleanLine(row.music_evidence, 120);
  const billedArtists = providerEvidence ? parseArray(row.billed_artists)
    .slice(0, 20).map((name) => cleanLine(name, 160)).filter(Boolean) : [];
  const eventKind = providerEvidence && ["concert", "festival", "fair", "rodeo", "multi_day"].includes(row.event_kind)
    ? row.event_kind
    : "concert";
  const endDate = providerEvidence ? validDate(row.event_end_date) : null;
  const providerImage = publicTicketmasterEventImage(row);
  return Object.freeze({
    id: String(row.id),
    providerEventId: cleanLine(row.provider_event_id, 180) || null,
    name: (providerEvidence ? cleanLine(row.event_name, 220) : null) || `${artist} at ${venue}`,
    path: canonicalEventPath(paths, row),
    artist,
    artistPath: relatedArtistPath(paths, row),
    venue,
    venuePath: canonicalVenuePath(paths, row),
    providerVenueId: cleanLine(row.venue_provider_id, 180) || null,
    place: cleanLine(row.place, 180) || cleanLine([row.venue_city, row.venue_region, row.venue_country].filter(Boolean).join(", "), 180) || null,
    coord: venueCoordinates(row),
    date,
    endDate: endDate && endDate >= date ? endDate : null,
    startDateTime,
    localTime: cleanLine(row.start_local_time, 20) || null,
    timezone: cleanLine(row.event_timezone, 80) || null,
    status: eventStatus(row.event_status),
    statusLabel: cleanLine(row.event_status, 40) || "scheduled",
    soldOut: !!row.sold_out,
    ticketUrl,
    source: cleanLine(row.source, 40) || null,
    eventKind,
    billedArtists,
    address: eventAddress(row),
    providerImage: providerImage ? Object.freeze({
      url: providerImage.uri,
      attribution: providerImage.attribution,
      width: providerImage.width,
      height: providerImage.height,
      sourcePage: providerImage.sourcePage,
    }) : null,
    updatedAt: timestamp(row.updated_at),
  });
}

function eventSchema(event, origin, { image = null, description = null, today = null } = {}) {
  const name = cleanLine(event?.name, 220);
  const venue = cleanLine(event?.venue, 180);
  const path = cleanLine(event?.path, 500);
  const startDate = completeDateTime(event?.startDateTime);
  const address = event?.address;
  if (!name || !venue || !path || !startDate || !cleanLine(address?.streetAddress, 260)
    || !cleanLine(address?.addressLocality, 120)
    || !cleanLine(address?.addressCountry, 100)) return null;
  const performerNames = [...new Map(
    [...(event.billedArtists || []), event.artist]
      .map((candidate) => cleanLine(candidate, 160))
      .filter(Boolean)
      .map((candidate) => [candidate.toLocaleLowerCase("en"), candidate]),
  ).values()];
  const location = {
    // Google Event rich results require a Place here. The standalone venue
    // page remains the more specific MusicVenue entity.
    "@type": "Place",
    name: venue,
    ...(event.venuePath ? { url: absolute(origin, event.venuePath) } : {}),
    ...(event.address ? { address: event.address } : {}),
  };
  return {
    "@context": "https://schema.org",
    "@type": "MusicEvent",
    "@id": `${absolute(origin, path)}#event`,
    name,
    url: absolute(origin, path),
    startDate,
    ...(event.endDate ? { endDate: event.endDate } : {}),
    ...(event.status ? { eventStatus: event.status } : {}),
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location,
    ...(performerNames.length ? {
      // Schema.org MusicGroup explicitly covers both groups and solo
      // musicians, so this remains truthful without guessing artist type.
      performer: performerNames.map((performerName) => ({
        "@type": "MusicGroup",
        name: performerName,
        ...(performerName.toLocaleLowerCase("en") === cleanLine(event.artist, 160).toLocaleLowerCase("en") && event.artistPath
          ? { url: absolute(origin, event.artistPath) } : {}),
      })),
    } : {}),
    ...(description ? { description } : {}),
    ...(image ? { image: [image] } : {}),
    ...(eventAllowsTicketOffer(event, today) ? {
      offers: {
        "@type": "Offer",
        url: event.ticketUrl,
        ...(event.soldOut ? { availability: "https://schema.org/SoldOut" } : {}),
      },
    } : {}),
  };
}

function authorSchema(author, origin) {
  return {
    "@type": "Person",
    name: author?.name || "Mshpit member",
    ...(author?.handle ? { alternateName: `@${author.handle}` } : {}),
    ...(author?.path ? { url: absolute(origin, author.path) } : {}),
  };
}

function commentSchemaTree(comments, postingUrl, origin) {
  const records = new Map(comments.map((comment) => [comment.id, comment]));
  const parentById = new Map();

  for (const comment of comments) {
    const candidate = comment.parentId;
    if (!candidate || candidate === comment.id || !records.has(candidate)) {
      parentById.set(comment.id, null);
      continue;
    }
    const seen = new Set([comment.id]);
    let cursor = candidate;
    let cyclic = false;
    while (cursor && records.has(cursor)) {
      if (seen.has(cursor)) {
        cyclic = true;
        break;
      }
      seen.add(cursor);
      cursor = records.get(cursor)?.parentId || null;
    }
    parentById.set(comment.id, cyclic ? null : candidate);
  }

  const children = new Map();
  for (const comment of comments) {
    const parentId = parentById.get(comment.id);
    if (!parentId) continue;
    const siblings = children.get(parentId) || [];
    siblings.push(comment);
    children.set(parentId, siblings);
  }

  const node = (comment) => {
    const id = `${postingUrl}#comment-${encodeURIComponent(comment.id)}`;
    const replies = children.get(comment.id) || [];
    return {
      "@type": "Comment",
      "@id": id,
      url: id,
      text: comment.text,
      author: authorSchema(comment.author, origin),
      ...(isoTimestamp(comment.publishedAt) ? { datePublished: isoTimestamp(comment.publishedAt) } : {}),
      parentItem: parentById.get(comment.id)
        ? { "@id": `${postingUrl}#comment-${encodeURIComponent(parentById.get(comment.id))}` }
        : { "@id": `${postingUrl}#posting` },
      ...(replies.length ? { comment: replies.map(node) } : {}),
    };
  };

  return comments.filter((comment) => !parentById.get(comment.id)).map(node);
}

export function createPublicDocumentProjector({ database, origin = DEFAULT_ORIGIN, paths = {} } = {}) {
  if (!database?.prepare) throw new TypeError("Public SEO projection requires a database");
  const publicOrigin = normalizedOrigin(origin);
  const publicPaths = Object.freeze({
    artist: typeof paths.artist === "function" ? paths.artist : (row) => artistPath(row),
    member: typeof paths.member === "function" ? paths.member : (row) => profilePath(row.u_handle || row.handle),
    post: typeof paths.post === "function" ? paths.post : (row) => showPath(row.id),
    event: typeof paths.event === "function" ? paths.event : (row) => eventPath(row.id),
    venue: typeof paths.venue === "function" ? paths.venue : (row) => venuePath({
      name: row.venue || row.name,
      providerVenueId: row.providerVenueId || row.venue_provider_id,
      source: row.source,
    }),
    concert: typeof paths.concert === "function" ? paths.concert : (key) => concertPath(key),
  });

  return Object.freeze({
    home(raw = {}, { canonicalPath: requestedPath = "/" } = {}) {
      const path = canonicalPath(requestedPath, "/");
      const artists = (raw.artists || []).map((row) => Object.freeze({
        name: cleanLine(row.name, 160),
        path: canonicalArtistPath(publicPaths, row),
        genre: publicArtistGenres(row),
        description: summary(row.bio, 220),
        reviewCount: count(row.review_count),
      })).filter((artist) => artist.name);
      // A public feed post is not automatically consent to feature its media on
      // the marketing homepage. The interactive landing reel has its own
      // landing_showcase publication gate; this document stays text-only.
      const posts = (raw.posts || []).map((row) => postCard(row, [], publicPaths, { textLimit: 420 }));
      const description = LANDING_IDENTITY_COPY.body;
      return Object.freeze({
        kind: "home",
        siteName: SITE_NAME,
        title: "Mshpit — Concert reviews, photos and live music discovery",
        description,
        canonicalPath: path,
        canonicalUrl: absolute(publicOrigin, path),
        image: null,
        artists,
        posts,
        breadcrumbs: [],
        jsonLd: [Object.freeze({
          "@context": "https://schema.org",
          ...siteReference(publicOrigin),
          alternateName: ["PIT", "mshpit.com"],
          description,
          publisher: organizationReference(publicOrigin),
        }), Object.freeze(organizationNode(publicOrigin))],
      });
    },

    discover(raw, { canonicalPath: requestedPath = "/discover" } = {}) {
      if (!raw) return null;
      const path = canonicalPath(requestedPath, "/discover");
      const artists = (raw.artists || []).slice(0, 24).map((row) => Object.freeze({
        name: cleanLine(row.name, 160),
        path: canonicalArtistPath(publicPaths, row),
        genre: publicArtistGenres(row),
        description: summary(row.bio, 180),
      })).filter((artist) => artist.name && artist.path);
      const events = (raw.events || []).slice(0, 48)
        .map((row) => eventCard(row, publicPaths))
        .filter(Boolean);
      // Public review text may appear in discovery. Media remains excluded here
      // because gallery/showcase consent is narrower than publishing a post.
      const posts = (raw.posts || []).slice(0, 16)
        .map((row) => postCard(row, [], publicPaths, { textLimit: 520 }));
      const title = "Discover live music, concerts and reviews | Mshpit";
      const description = "Explore artists, upcoming concerts worldwide and honest live reviews from the Mshpit community.";
      const breadcrumbs = Object.freeze([
        Object.freeze({ name: "Mshpit", path: "/" }),
        Object.freeze({ name: "Discover", path }),
      ]);
      const listItems = [
        ...artists.map((artist) => ({ name: artist.name, path: artist.path })),
        ...events.map((event) => ({ name: event.name, path: event.path })),
      ].slice(0, 100).map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        url: absolute(publicOrigin, item.path),
      }));
      const modifiedAt = Math.max(
        0,
        ...(raw.artists || []).map((row) => timestamp(row.updated_at) || 0),
        ...(raw.events || []).map((row) => timestamp(row.updated_at) || 0),
        ...(raw.posts || []).map((row) => timestamp(row.updated_at || row.created_at) || 0),
      ) || null;
      return Object.freeze({
        kind: "discover",
        indexable: true,
        siteName: SITE_NAME,
        title,
        description,
        canonicalPath: path,
        canonicalUrl: absolute(publicOrigin, path),
        image: null,
        modifiedAt,
        artists,
        events,
        posts,
        breadcrumbs,
        jsonLd: [Object.freeze({
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          "@id": `${absolute(publicOrigin, path)}#page`,
          name: "Discover live music on Mshpit",
          url: absolute(publicOrigin, path),
          description,
          ...(isoTimestamp(modifiedAt) ? { dateModified: isoTimestamp(modifiedAt) } : {}),
          isPartOf: siteReference(publicOrigin),
          publisher: organizationReference(publicOrigin),
          mainEntity: {
            "@type": "ItemList",
            numberOfItems: listItems.length,
            itemListElement: listItems,
          },
        }), Object.freeze(breadcrumbNode(publicOrigin, breadcrumbs))].filter(Boolean),
      });
    },

    search({ canonicalPath: requestedPath = "/search" } = {}) {
      const path = canonicalPath(requestedPath, "/search");
      const description = "Search Mshpit for artists, concerts, venues, people and songs, or browse the public artist and event directories.";
      const breadcrumbs = Object.freeze([
        Object.freeze({ name: "Mshpit", path: "/" }),
        Object.freeze({ name: "Search", path }),
      ]);
      return Object.freeze({
        kind: "search",
        // Internal search-result URLs are deliberately excluded from Google.
        // This document exists so no-JavaScript visitors get useful navigation,
        // not so arbitrary query combinations become indexable landing pages.
        indexable: false,
        siteName: SITE_NAME,
        title: "Search artists, concerts and fans | Mshpit",
        description,
        canonicalPath: path,
        canonicalUrl: absolute(publicOrigin, path),
        image: null,
        breadcrumbs,
        jsonLd: [],
      });
    },

    artist(raw, { canonicalPath: requestedPath = null } = {}) {
      if (!raw?.artist) return null;
      const source = raw.artist;
      const artistCanonicalPath = canonicalArtistPath(publicPaths, source);
      const path = canonicalPath(requestedPath, artistCanonicalPath);
      // Legacy vanity routes redirect before rendering, and this second gate
      // keeps a memorial out of any mistakenly requested non-canonical document.
      const memorial = path === artistCanonicalPath ? memorialProjection(raw.memorial) : null;
      const mediaByPost = publicMediaForRows(database, raw.reviews || [], { galleryOnly: true, maxPerPost: 3 });
      const reviews = (raw.reviews || []).map((row) => postCard(row, mediaByPost.get(row.id), publicPaths));
      const profileOwner = raw.profile?.owner_id || null;
      const avatarOwner = raw.profile?.avatar_owner_id || profileOwner;
      const bannerOwner = raw.profile?.banner_owner_id || profileOwner;
      const avatarMedia = avatarOwner
        ? safeProfileImage(database, avatarOwner, raw.profile.avatar_uri, "avatar") : null;
      const bannerMedia = bannerOwner
        ? safeProfileImage(database, bannerOwner, raw.profile.banner, "banner") : null;
      const avatar = avatarMedia?.url || null;
      const banner = bannerMedia?.url || null;
      const fanImage = reviews.flatMap((review) => review.media)
        .map((asset) => asset.kind === "image" ? asset.url : asset.posterUrl)
        .find(Boolean) || null;
      const name = cleanLine(source.name, 160);
      const bio = cleanBody(raw.profile?.bio || source.bio, 2_000);
      const reviewCount = count(raw.stats?.review_count);
      const averageRating = memorial ? null : rating(raw.stats?.average_rating);
      const events = memorial ? [] : (raw.events || []).map((event) => eventCard(event, publicPaths)).filter(Boolean);
      const artistSignals = [
        events.length ? `${events.length} upcoming ${events.length === 1 ? "show" : "shows"}` : "",
        averageRating != null && reviewCount > 0
          ? `${averageRating.toFixed(1)}/5 live rating from ${reviewCount} ${reviewCount === 1 ? "review" : "reviews"}`
          : reviewCount > 0 ? `${reviewCount} concert ${reviewCount === 1 ? "review" : "reviews"}` : "",
      ].filter(Boolean);
      const description = summary(memorial?.summary || [
        bio || `Music artist page for ${name} on Mshpit: concert reviews, fan photos, ratings and upcoming tour dates.`,
        artistSignals.length ? `${artistSignals.join("; ")}.` : "",
      ].filter(Boolean).join(" "));
      const concerts = (raw.concerts || []).flatMap((concert) => {
        const date = validDate(concert.date);
        const venue = cleanLine(concert.venue, 180);
        if (!date || !venue) return [];
        const key = archiveShowKey({
          artistIdentity: source.norm || name,
          venueIdentity: concert.venue_key || venue,
          date,
        });
        return [Object.freeze({
          key,
          path: canonicalConcertPath(publicPaths, key),
          venue,
          venuePath: canonicalVenuePath(publicPaths, concert),
          city: cleanLine(concert.city, 120) || null,
          date,
          ratingCount: memorial ? null : count(concert.rating_count),
          reviewCount: count(concert.review_count),
          averageRating: memorial ? null : rating(concert.average_rating),
          modifiedAt: timestamp(concert.latest_at),
        })];
      });
      const archiveTotal = count(raw.concerts?.[0]?.archive_item_count);
      const archivePath = archiveTotal > 3 ? artistConcertsPath(source.public_slug) : null;
      const updates = (raw.updates || []).map((update) => Object.freeze({
        id: String(update.id),
        text: cleanBody(update.text, 2_000),
        publishedAt: timestamp(update.created_at),
      })).filter((update) => update.text);
      const modifiedAt = Math.max(
        timestamp(source.updated_at) || 0,
        timestamp(raw.profile?.updated_at) || 0,
        timestamp(raw.stats?.latest_at) || 0,
        ...events.map((event) => event.updatedAt || 0),
        ...concerts.map((concert) => concert.modifiedAt || 0),
        memorial ? timestamp(raw.memorialUpdatedAt) || 0 : 0,
      );
      const musicBrainzUrl = musicBrainzArtistUrl(source.mbid);
      const entityImage = profileImageSchema(avatarMedia, `${name} profile photo`)
        || profileImageSchema(bannerMedia, `${name} profile banner`)
        || fanImage;
      const socialProfileImage = bannerMedia || avatarMedia;
      const entity = {
        // The catalogue currently does not preserve Person versus Group. Keep
        // the generic type unless the identity-bound memorial workflow has a
        // published record; that workflow requires an explicit individual
        // attestation before it can write anything public.
        "@type": memorial ? "Person" : "Thing",
        "@id": `${absolute(publicOrigin, path)}#artist`,
        name,
        disambiguatingDescription: "Music artist",
        url: absolute(publicOrigin, path),
        ...(musicBrainzUrl ? { sameAs: [musicBrainzUrl] } : {}),
        ...((bio || memorial?.summary) ? { description: bio || memorial.summary } : {}),
        ...(entityImage ? { image: entityImage } : {}),
        ...(memorial ? {
          deathDate: memorial.deathDate,
          subjectOf: {
            "@type": "CreativeWork",
            name: `Remembering ${name}`,
            text: [memorial.summary, ...memorial.accomplishments, memorial.thankYou].join("\n"),
            url: `${absolute(publicOrigin, path)}#memorial`,
            citation: {
              "@type": "CreativeWork",
              name: memorial.citation.title,
              url: memorial.citation.url,
            },
          },
        } : {}),
      };
      const breadcrumbs = Object.freeze([
        Object.freeze({ name: "Mshpit", path: "/" }),
        Object.freeze({ name: "Artists", path: "/artists" }),
        Object.freeze({ name, path }),
      ]);
      const collection = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "@id": `${absolute(publicOrigin, path)}#page`,
        name: `${name} on Mshpit`,
        url: absolute(publicOrigin, path),
        description,
        ...(isoTimestamp(modifiedAt) ? { dateModified: isoTimestamp(modifiedAt) } : {}),
        about: entity,
        mainEntity: { "@id": entity["@id"] },
        isPartOf: siteReference(publicOrigin),
        publisher: organizationReference(publicOrigin),
        ...(events.length ? {
          hasPart: events.slice(0, 6).map((event) => ({ "@id": `${absolute(publicOrigin, event.path)}#page` })),
        } : {}),
      };
      return Object.freeze({
        kind: "artist",
        siteName: SITE_NAME,
        title: memorial
          ? `Remembering ${name} — music, shows and fan memories | Mshpit`
          : `${name} — music artist reviews, photos & tour dates | Mshpit`,
        description,
        canonicalPath: path,
        canonicalUrl: absolute(publicOrigin, path),
        image: socialProfileImage?.url || fanImage,
        imageProvenance: socialProfileImage?.url ? "entity-profile" : fanImage ? "fan-gallery" : null,
        imageWidth: socialProfileImage?.width || null,
        imageHeight: socialProfileImage?.height || null,
        imageMimeType: socialProfileImage?.mimeType || null,
        artist: Object.freeze({ name, bio, genres: publicArtistGenres(source), country: cleanLine(source.country, 100) || null, formed: cleanLine(source.formed, 80) || null }),
        memorial,
        stats: Object.freeze({ reviewCount, averageRating }),
        reviews,
        updates,
        events,
        concerts,
        archivePath,
        archiveTotal,
        breadcrumbs,
        jsonLd: [
          Object.freeze(collection),
          Object.freeze(breadcrumbNode(publicOrigin, breadcrumbs)),
        ].filter(Boolean),
      });
    },

    member(raw, { canonicalPath: requestedPath = null } = {}) {
      if (!raw?.member) return null;
      const source = raw.member;
      const path = canonicalPath(requestedPath, canonicalMemberPath(publicPaths, source));
      // A profile is an aggregate gallery context. Respect the member's
      // explicit artist/profile-gallery opt-out even though the attachment
      // remains visible on its original post page.
      const mediaByPost = publicMediaForRows(database, raw.posts || [], { galleryOnly: true });
      const posts = (raw.posts || []).map((row) => postCard(row, mediaByPost.get(row.id), publicPaths));
      const name = cleanLine(source.name, 100) || "Mshpit member";
      const handle = cleanLine(source.handle, 40).replace(/^@+/, "");
      const bio = cleanBody(source.bio, 2_000);
      const avatarMedia = safeProfileImage(database, source.id, source.avatar_uri, "avatar");
      const bannerMedia = safeProfileImage(database, source.id, source.banner, "banner");
      const avatar = avatarMedia?.url || null;
      const banner = bannerMedia?.url || null;
      const description = summary(bio || `${name} shares live music memories and recommendations on Mshpit.`);
      const socialProfileImage = bannerMedia || avatarMedia;
      const person = {
        "@type": "Person",
        "@id": `${absolute(publicOrigin, path)}#person`,
        name,
        ...(handle ? { alternateName: `@${handle}` } : {}),
        url: absolute(publicOrigin, path),
        ...(bio ? { description: bio } : {}),
        ...(avatarMedia ? { image: profileImageSchema(avatarMedia, `${name} profile photo`) } : {}),
        interactionStatistic: [{
          "@type": "InteractionCounter",
          interactionType: "https://schema.org/FollowAction",
          userInteractionCount: count(raw.stats?.follower_count),
        }],
      };
      const createdAt = isoTimestamp(source.created_at);
      const breadcrumbs = Object.freeze([
        Object.freeze({ name: "Mshpit", path: "/" }),
        Object.freeze({ name: handle ? `@${handle}` : name, path }),
      ]);
      return Object.freeze({
        kind: "member",
        siteName: SITE_NAME,
        title: `${name}${handle ? ` (@${handle})` : ""} | Mshpit`,
        description,
        canonicalPath: path,
        canonicalUrl: absolute(publicOrigin, path),
        image: socialProfileImage?.url || posts.flatMap((post) => post.media).find((asset) => asset.kind === "image")?.url || null,
        imageWidth: socialProfileImage?.width || null,
        imageHeight: socialProfileImage?.height || null,
        imageMimeType: socialProfileImage?.mimeType || null,
        member: Object.freeze({ name, handle: handle || null, bio, avatar, banner, artistName: cleanLine(source.artist_name, 160) || null }),
        stats: Object.freeze({ postCount: count(raw.stats?.post_count), followerCount: count(raw.stats?.follower_count) }),
        posts,
        breadcrumbs,
        jsonLd: [Object.freeze({
          "@context": "https://schema.org",
          "@type": "ProfilePage",
          "@id": `${absolute(publicOrigin, path)}#page`,
          name: `${name} on Mshpit`,
          url: absolute(publicOrigin, path),
          description,
          ...(createdAt ? { dateCreated: createdAt } : {}),
          mainEntity: person,
          isPartOf: siteReference(publicOrigin),
          publisher: organizationReference(publicOrigin),
          ...(posts.length ? { hasPart: posts.slice(0, 12).map((post) => ({ "@id": `${absolute(publicOrigin, post.path)}#posting` })) } : {}),
        }), Object.freeze(breadcrumbNode(publicOrigin, breadcrumbs))].filter(Boolean),
      });
    },

    post(raw, { canonicalPath: requestedPath = null } = {}) {
      if (!raw?.post) return null;
      const source = raw.post;
      const path = canonicalPath(requestedPath, canonicalPostPath(publicPaths, source));
      const media = publicMediaForRows(database, [source], { maxPerPost: 8 }).get(source.id) || [];
      const projectedCard = postCard(source, media, publicPaths);
      const comments = (raw.comments || []).map((comment) => {
        const handle = cleanLine(comment.u_handle, 40).replace(/^@+/, "");
        return Object.freeze({
          id: String(comment.id),
          parentId: comment.parent_id ? String(comment.parent_id) : null,
          text: cleanBody(comment.text, 2_000),
          author: Object.freeze({
            name: cleanLine(comment.u_name, 100) || "Mshpit member",
            handle: handle || null,
            path: handle ? internalPath(publicPaths.member({ handle, u_handle: handle }), profilePath(handle)) : null,
            avatar: safeProfileImage(database, comment.user_id, comment.u_avatar, "avatar")?.url || null,
          }),
          publishedAt: timestamp(comment.created_at),
        });
      }).filter((comment) => comment.text);
      // Denormalized counters can include a comment that was later moderated or
      // authored by an account that is no longer public. The standalone post
      // can prove only the filtered list it renders, so its visible/schema count
      // is derived from that same list.
      const card = Object.freeze({ ...projectedCard, comments: count(raw.commentCount) });
      const isOnlineReview = card.kind === "review" && card.experienceType === "online";
      const isReview = card.kind === "review" && !!card.artist;
      const headline = isOnlineReview
        ? `${card.onlineTitle || card.artist || "Online concert"} — ${card.author.name}'s online concert review`
        : isReview
        ? `${card.artist}${card.venue ? ` at ${card.venue}` : ""} — ${card.author.name}'s review`
        : `${card.author.name}: ${summary(card.text, 72) || "a music update"}`;
      const description = summary(card.text || `${headline}.`);
      const imageUrls = media.flatMap((asset) => asset.kind === "image" ? [asset.url] : (asset.posterUrl ? [asset.posterUrl] : []));
      const postingUrl = absolute(publicOrigin, path);
      const postingAuthor = authorSchema(card.author, publicOrigin);
      const mediaObjects = media.map((asset, index) => mediaSchema(asset, {
        origin: publicOrigin,
        pageUrl: postingUrl,
        context: headline,
        author: postingAuthor,
        publishedAt: card.publishedAt,
        index,
      })).filter(Boolean);
      const imageObjects = mediaObjects.filter((item) => item["@type"] === "ImageObject");
      const videoObjects = mediaObjects.filter((item) => item["@type"] === "VideoObject");
      const publishedAt = isoTimestamp(card.publishedAt);
      const commentNodes = commentSchemaTree(comments, postingUrl, publicOrigin);
      const posting = publishedAt && (card.text || mediaObjects.length) ? {
        "@context": "https://schema.org",
        "@type": ["DiscussionForumPosting", "SocialMediaPosting"],
        "@id": `${postingUrl}#posting`,
        headline,
        ...(card.text ? { text: card.text, articleBody: card.text } : {}),
        url: postingUrl,
        author: postingAuthor,
        datePublished: publishedAt,
        ...(isoTimestamp(card.modifiedAt) ? { dateModified: isoTimestamp(card.modifiedAt) } : {}),
        ...(card.artist ? { about: { "@type": "Thing", name: card.artist, ...(card.artistPath ? { url: absolute(publicOrigin, card.artistPath) } : {}) } } : {}),
        ...(imageObjects.length ? { image: imageObjects } : {}),
        ...(videoObjects.length ? { video: videoObjects } : {}),
        ...(commentNodes.length ? { comment: commentNodes } : {}),
        commentCount: card.comments,
        interactionStatistic: [
          { "@type": "InteractionCounter", interactionType: "https://schema.org/LikeAction", userInteractionCount: card.likes },
          { "@type": "InteractionCounter", interactionType: "https://schema.org/CommentAction", userInteractionCount: card.comments },
        ],
        isPartOf: siteReference(publicOrigin),
        publisher: organizationReference(publicOrigin),
      } : null;
      const breadcrumbs = Object.freeze([
        Object.freeze({ name: "Mshpit", path: "/" }),
        ...(card.artist && card.artistPath ? [Object.freeze({ name: card.artist, path: card.artistPath })] : []),
        Object.freeze({ name: isOnlineReview ? "Online concert review" : isReview ? "Review" : "Community post", path }),
      ]);
      const primaryAsset = media[0] || null;
      return Object.freeze({
        kind: "post",
        siteName: SITE_NAME,
        title: `${headline} | Mshpit`,
        description,
        canonicalPath: path,
        canonicalUrl: absolute(publicOrigin, path),
        image: imageUrls[0] || null,
        imageProvenance: imageUrls[0] ? "same-post" : null,
        imageWidth: primaryAsset?.kind === "image" ? primaryAsset.width : null,
        imageHeight: primaryAsset?.kind === "image" ? primaryAsset.height : null,
        imageMimeType: primaryAsset?.kind === "image" ? primaryAsset.mimeType : null,
        video: primaryAsset?.kind === "video" ? Object.freeze(primaryAsset) : null,
        publishedAt: card.publishedAt,
        modifiedAt: card.modifiedAt,
        post: card,
        comments,
        breadcrumbs,
        jsonLd: [posting ? Object.freeze(posting) : null, Object.freeze(breadcrumbNode(publicOrigin, breadcrumbs))].filter(Boolean),
      });
    },

    event(raw, { canonicalPath: requestedPath = null, at = Date.now(), today = null } = {}) {
      if (!raw?.event) return null;
      const event = eventCard(raw.event, publicPaths);
      if (!event) return null;
      const path = canonicalPath(requestedPath, event.path);
      const instant = Number.isFinite(Number(at)) ? Number(at) : Date.now();
      const currentDate = validDate(today) || new Date(instant).toISOString().slice(0, 10);
      const publicEvent = Object.freeze({ ...event, path, ticketUrl: eventAllowsTicketOffer(event, currentDate) ? event.ticketUrl : null });
      const mediaByPost = publicMediaForRows(database, raw.posts || [], { galleryOnly: true, maxPerPost: 3 });
      const posts = (raw.posts || []).map((row) => postCard(row, mediaByPost.get(row.id), publicPaths));
      const primaryAsset = posts.flatMap((post) => post.media).find((asset) => asset.kind === "image" || asset.posterUrl) || null;
      const fanImage = primaryAsset?.kind === "image" ? primaryAsset.url : primaryAsset?.posterUrl || null;
      const image = event.providerImage?.url || fanImage;
      const imageProvenance = event.providerImage?.url ? "provider" : fanImage ? "fan-gallery" : null;
      const description = summary(
        posts.find((post) => substantiveText(post.text, 40))?.text
          || `${event.name} brings live music to ${event.venue}${event.place ? ` in ${event.place}` : ""} on ${event.date}. Find event details and fan memories on Mshpit.`,
      );
      const breadcrumbs = Object.freeze([
        Object.freeze({ name: "Mshpit", path: "/" }),
        Object.freeze({ name: "Events", path: "/events" }),
        Object.freeze({ name: event.artist, path: event.artistPath }),
        Object.freeze({ name: `${event.venue} · ${event.date}`, path }),
      ].filter((crumb) => crumb.path));
      const schemaEvent = eventSchema(publicEvent, publicOrigin, { image, description, today: currentDate });
      const pageUrl = absolute(publicOrigin, path);
      const pageSchema = {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "@id": `${pageUrl}#page`,
        name: `${event.artist} at ${event.venue}`,
        url: pageUrl,
        description,
        isPartOf: siteReference(publicOrigin),
        publisher: organizationReference(publicOrigin),
        ...(schemaEvent ? { mainEntity: { "@id": schemaEvent["@id"] } } : {
          about: [
            { "@type": "Thing", name: event.artist, ...(event.artistPath ? { url: absolute(publicOrigin, event.artistPath) } : {}) },
            { "@type": "MusicVenue", name: event.venue, url: absolute(publicOrigin, event.venuePath) },
          ],
        }),
        ...(posts.length ? { hasPart: posts.map((post) => ({ "@id": `${absolute(publicOrigin, post.path)}#posting` })) } : {}),
      };
      const titleLead = event.name.toLocaleLowerCase("en").includes(event.venue.toLocaleLowerCase("en"))
        ? event.name : `${event.name} at ${event.venue}`;
      return Object.freeze({
        kind: "event",
        siteName: SITE_NAME,
        title: `${titleLead} — ${event.date} | Mshpit`,
        description,
        canonicalPath: path,
        canonicalUrl: absolute(publicOrigin, path),
        image,
        imageProvenance,
        imageWidth: event.providerImage?.url ? event.providerImage.width : primaryAsset?.kind === "image" ? primaryAsset.width : null,
        imageHeight: event.providerImage?.url ? event.providerImage.height : primaryAsset?.kind === "image" ? primaryAsset.height : null,
        imageMimeType: event.providerImage?.url ? null : primaryAsset?.kind === "image" ? primaryAsset.mimeType : null,
        event: publicEvent,
        posts,
        breadcrumbs,
        jsonLd: [schemaEvent ? Object.freeze(schemaEvent) : null, Object.freeze(pageSchema), Object.freeze(breadcrumbNode(publicOrigin, breadcrumbs))].filter(Boolean),
      });
    },

    concert(raw, { canonicalPath: requestedPath = null, showKey = null, at = Date.now(), today = null } = {}) {
      const sourceRows = Array.isArray(raw?.reviews) ? raw.reviews : [];
      if (!sourceRows.length || !showKey) return null;
      const first = sourceRows[0];
      const date = validDate(first.date);
      const artist = cleanLine(first.artist, 160);
      const venue = cleanLine(first.venue, 180);
      if (!date || !artist || !venue) return null;
      const path = canonicalPath(requestedPath, canonicalConcertPath(publicPaths, showKey));
      const mediaByPost = publicMediaForRows(database, sourceRows, { galleryOnly: true, maxPerPost: 4 });
      const reviews = sourceRows.map((row) => postCard(row, mediaByPost.get(row.id), publicPaths));
      const artistCanonicalPath = relatedArtistPath(publicPaths, first);
      const venueCanonicalPath = canonicalVenuePath(publicPaths, first);
      const primaryAsset = reviews.flatMap((review) => review.media).find((asset) => asset.kind === "image" || asset.posterUrl) || null;
      const image = primaryAsset?.kind === "image" ? primaryAsset.url : primaryAsset?.posterUrl || null;
      const reviewCount = count(raw.stats?.review_count);
      const ratingCount = count(raw.stats?.rating_count);
      const averageRating = rating(raw.stats?.average_rating);
      const historicalEvent = raw.event ? eventCard(raw.event, publicPaths) : null;
      const description = summary(
        reviews.find((review) => substantiveText(review.text, 40))?.text
          || `Reviews and photos from ${artist} at ${venue} on ${date}.`,
      );
      const pageUrl = absolute(publicOrigin, path);
      const currentDate = validDate(today) || new Date(Number.isFinite(Number(at)) ? Number(at) : Date.now()).toISOString().slice(0, 10);
      const isPast = date < currentDate;
      const eventForSchema = historicalEvent ? {
        ...historicalEvent,
        path,
        name: `${artist} at ${venue}`,
        ...(isPast && historicalEvent.status === "https://schema.org/EventScheduled" ? { status: null } : {}),
        ...(isPast ? { ticketUrl: null } : {}),
      } : null;
      const concertEvent = eventSchema(eventForSchema, publicOrigin, { image, description, today: currentDate });
      const reviewNodes = concertEvent ? (() => {
        const latestByPerson = new Map();
        reviews.forEach((review, index) => {
          if (review.rating == null) return;
          const personKey = cleanLine(sourceRows[index]?.user_id, 120);
          if (!personKey) return;
          const candidate = { review, index, changedAt: review.modifiedAt || review.publishedAt || 0 };
          const previous = latestByPerson.get(personKey);
          if (
            !previous
            || candidate.changedAt > previous.changedAt
            || (candidate.changedAt === previous.changedAt && candidate.review.id.localeCompare(previous.review.id) > 0)
          ) {
            latestByPerson.set(personKey, candidate);
          }
        });
        return [...latestByPerson.values()]
          .sort((left, right) => left.index - right.index)
          .map(({ review }) => ({
            "@type": "Review",
            "@id": `${absolute(publicOrigin, review.path)}#review`,
            url: absolute(publicOrigin, review.path),
            author: authorSchema(review.author, publicOrigin),
            itemReviewed: { "@id": concertEvent["@id"] },
            ...(review.text ? { reviewBody: review.text } : {}),
            reviewRating: { "@type": "Rating", ratingValue: review.rating, bestRating: 5, worstRating: 1 },
            ...(isoTimestamp(review.publishedAt) ? { datePublished: isoTimestamp(review.publishedAt) } : {}),
          }));
      })() : [];
      if (concertEvent) {
        if (averageRating != null && ratingCount) {
          concertEvent.aggregateRating = {
            "@type": "AggregateRating",
            ratingValue: Number(averageRating.toFixed(2)),
            bestRating: 5,
            worstRating: 1,
            ratingCount,
            reviewCount,
          };
        }
        if (reviewNodes.length) concertEvent.review = reviewNodes;
      }
      const collectionPage = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "@id": `${pageUrl}#page`,
        name: `${artist} at ${venue} fan concert archive`,
        url: pageUrl,
        description,
        isPartOf: siteReference(publicOrigin),
        publisher: organizationReference(publicOrigin),
        ...(concertEvent ? { mainEntity: { "@id": concertEvent["@id"] } } : {
          about: [
            { "@type": "Thing", name: artist, ...(artistCanonicalPath ? { url: absolute(publicOrigin, artistCanonicalPath) } : {}) },
            { "@type": "MusicVenue", name: venue, url: absolute(publicOrigin, venueCanonicalPath) },
          ],
        }),
      };
      const breadcrumbs = Object.freeze([
        Object.freeze({ name: "Mshpit", path: "/" }),
        Object.freeze({ name: "Concerts", path: "/concerts" }),
        ...(artistCanonicalPath ? [Object.freeze({ name: artist, path: artistCanonicalPath })] : []),
        Object.freeze({ name: `${venue} · ${date}`, path }),
      ]);
      return Object.freeze({
        kind: "concert",
        siteName: SITE_NAME,
        title: `${artist} at ${venue} — reviews from ${date} | Mshpit`,
        description,
        canonicalPath: path,
        canonicalUrl: pageUrl,
        image,
        imageWidth: primaryAsset?.kind === "image" ? primaryAsset.width : null,
        imageHeight: primaryAsset?.kind === "image" ? primaryAsset.height : null,
        imageMimeType: primaryAsset?.kind === "image" ? primaryAsset.mimeType : null,
        concert: Object.freeze({
          artist,
          artistPath: artistCanonicalPath,
          venue,
          venuePath: venueCanonicalPath,
          city: cleanLine(first.city, 120) || null,
          date,
          averageRating,
          ratingCount,
          reviewCount,
          providerImage: historicalEvent?.providerImage || null,
          address: concertEvent?.location?.address ? Object.freeze({ ...concertEvent.location.address }) : null,
        }),
        reviews,
        breadcrumbs,
        jsonLd: [concertEvent ? Object.freeze(concertEvent) : null, Object.freeze(collectionPage), Object.freeze(breadcrumbNode(publicOrigin, breadcrumbs))].filter(Boolean),
      });
    },

    venue(raw, { canonicalPath: requestedPath = null } = {}) {
      if (!raw?.venue?.name) return null;
      const name = cleanLine(raw.venue.name, 180);
      const path = canonicalPath(requestedPath, canonicalVenuePath(publicPaths, raw.venue, { allowNameOnly: true }));
      const mediaByPost = publicMediaForRows(database, raw.posts || [], { galleryOnly: true, maxPerPost: 3 });
      const posts = (raw.posts || []).map((row) => postCard(row, mediaByPost.get(row.id), publicPaths));
      const events = (raw.events || []).map((row) => eventCard(row, publicPaths)).filter(Boolean);
      const venueReviews = (raw.venueReviews?.reviews || []).slice(0, 8).flatMap((review) => {
        const id = cleanLine(review?.id, 120);
        const text = cleanBody(review?.text, 8_000);
        const photos = Object.freeze((review?.photos || []).slice(0, 3).flatMap((url) => {
          const safe = publicHttpsUrl(url);
          return safe ? [safe] : [];
        }));
        if (!id || (!text && photos.length === 0)) return [];
        const ratingValue = Number(review?.rating);
        const rating = Number.isFinite(ratingValue) && ratingValue >= 1 && ratingValue <= 5
          ? ratingValue : null;
        return [Object.freeze({
          id,
          author: Object.freeze({
            name: cleanLine(review?.author?.name, 100) || "Mshpit member",
            handle: cleanLine(review?.author?.handle, 40).replace(/^@+/u, "") || null,
          }),
          rating,
          text,
          photos,
          createdAt: Number.isSafeInteger(Number(review?.createdAt)) && Number(review.createdAt) >= 0
            ? Number(review.createdAt) : null,
        })];
      });
      const reviewCount = count(raw.venueReviews?.stats?.reviewCount);
      const ratingCount = count(raw.venueReviews?.stats?.ratingCount);
      const rawAverageRating = Number(raw.venueReviews?.stats?.averageRating);
      const averageRating = ratingCount > 0 && Number.isFinite(rawAverageRating)
        && rawAverageRating >= 1 && rawAverageRating <= 5 ? rawAverageRating : null;
      const licensedVenuePhotos = Object.freeze(publicVenuePhotoPool(name, {
        limit: 3,
        source: raw.venue?.source,
        providerVenueId: raw.venue?.providerVenueId,
      })
        .map((photo) => venuePhotoProjection(photo, name)).filter(Boolean));
      const licensedVenuePhoto = licensedVenuePhotos[0] || null;
      const primaryAsset = posts.flatMap((post) => post.media).find((asset) => asset.kind === "image" || asset.posterUrl) || null;
      const fanImage = primaryAsset?.kind === "image" ? primaryAsset.url : primaryAsset?.posterUrl || null;
      const heroPhoto = licensedVenuePhoto || (fanImage ? Object.freeze({
        url: fanImage,
        alt: `${name} concert venue shared by the Mshpit community`,
        attribution: "Mshpit community photo",
        creator: null,
        license: null,
        licenseUrl: null,
        sourcePage: null,
        modificationNotice: null,
      }) : null);
      const image = heroPhoto?.url || null;
      const contentPlace = events.find((event) => event.place)?.place || posts.find((post) => post.city)?.city || null;
      const curatedFacts = publicVenueFacts({
        name,
        place: contentPlace,
        providerVenueId: raw.venue?.providerVenueId,
      });
      const place = contentPlace || curatedFacts?.place || null;
      const address = events.find((event) => event.address)?.address || null;
      const coord = events.find((event) => event.coord)?.coord || curatedFacts?.coord || null;
      const capacity = curatedFacts?.capacity || null;
      const guide = venueGuideModel({ name, place, capacity, coord });
      const descriptionDetails = [
        guide.capacityLabel ? `a listed capacity of ${guide.capacityLabel}` : null,
        events.length ? `${events.length} upcoming ${events.length === 1 ? "concert" : "concerts"}` : null,
        reviewCount ? `${reviewCount} public ${reviewCount === 1 ? "review" : "reviews"}` : null,
        guide.actions.length ? "live directions, parking and transit searches" : null,
        "event-specific seating guidance",
      ].filter(Boolean).join(", ");
      const description = summary(`${name}${place ? ` in ${place}` : ""} concert venue guide: ${descriptionDetails}.`);
      const breadcrumbs = Object.freeze([
        Object.freeze({ name: "Mshpit", path: "/" }),
        Object.freeze({ name: "Venues", path: "/venues" }),
        Object.freeze({ name, path }),
      ]);
      const venueUrl = absolute(publicOrigin, path);
      const venueEntityId = `${venueUrl}#venue`;
      const venueReviewNodes = venueReviews.flatMap((review) => {
        if (!review.text && review.rating == null) return [];
        return [{
          "@type": "Review",
          "@id": `${venueUrl}#venue-review-${encodeURIComponent(review.id)}`,
          author: {
            "@type": "Person",
            name: review.author.name,
            ...(review.author.handle ? { alternateName: `@${review.author.handle}` } : {}),
          },
          itemReviewed: { "@id": venueEntityId },
          ...(review.text ? { reviewBody: review.text } : {}),
          ...(review.rating != null ? {
            reviewRating: { "@type": "Rating", ratingValue: review.rating, bestRating: 5, worstRating: 1 },
          } : {}),
          ...(isoTimestamp(review.createdAt) ? { datePublished: isoTimestamp(review.createdAt) } : {}),
        }];
      });
      const venueEntity = {
        "@context": "https://schema.org",
        "@type": "MusicVenue",
        "@id": venueEntityId,
        name,
        url: venueUrl,
        description,
        mainEntityOfPage: { "@id": `${absolute(publicOrigin, path)}#page` },
        ...(address ? { address } : {}),
        ...(coord ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: coord.lat,
            longitude: coord.lng,
          },
        } : {}),
        ...(capacity ? { maximumAttendeeCapacity: capacity } : {}),
        ...(guide.actions.find((action) => action.id === "directions")?.url
          ? { hasMap: guide.actions.find((action) => action.id === "directions").url }
          : {}),
        ...(licensedVenuePhoto ? { image: venuePhotoSchema(licensedVenuePhoto, name) } : fanImage ? { image: fanImage } : {}),
        ...(venueReviewNodes.length ? { review: venueReviewNodes } : {}),
      };
      return Object.freeze({
        kind: "venue",
        siteName: SITE_NAME,
        title: `${name} concert venue guide — shows, seating & reviews | Mshpit`,
        description,
        canonicalPath: path,
        canonicalUrl: venueUrl,
        image,
        imageProvenance: licensedVenuePhoto ? "licensed-venue"
          : fanImage ? "fan-gallery" : null,
        imageWidth: licensedVenuePhoto ? null
          : fanImage && primaryAsset?.kind === "image" ? primaryAsset.width : null,
        imageHeight: licensedVenuePhoto ? null
          : fanImage && primaryAsset?.kind === "image" ? primaryAsset.height : null,
        imageMimeType: licensedVenuePhoto ? null
          : fanImage && primaryAsset?.kind === "image" ? primaryAsset.mimeType : null,
        venue: Object.freeze({ name, place, address, heroPhoto, capacity, coord, guide }),
        venuePhotos: licensedVenuePhotos,
        venueReviewStats: Object.freeze({ reviewCount, ratingCount, averageRating }),
        venueReviews: Object.freeze(venueReviews),
        posts,
        events,
        breadcrumbs,
        jsonLd: [Object.freeze(venueEntity), Object.freeze({
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          "@id": `${venueUrl}#page`,
          name: `${name} on Mshpit`,
          url: venueUrl,
          description,
          about: { "@id": venueEntityId },
          mainEntity: { "@id": venueEntityId },
          ...(events.length ? { hasPart: events.slice(0, 12).map((event) => ({ "@id": `${absolute(publicOrigin, event.path)}#page` })) } : {}),
          isPartOf: siteReference(publicOrigin),
          publisher: organizationReference(publicOrigin),
        }), Object.freeze(breadcrumbNode(publicOrigin, breadcrumbs))].filter(Boolean),
      });
    },

    directory(raw, { canonicalPath: requestedPath = null } = {}) {
      if (!raw || !["artists", "events", "venues", "concerts"].includes(raw.kind)) return null;
      const page = Math.max(1, Math.min(1_000, Math.trunc(Number(raw.page) || 1)));
      const collectionPath = raw.kind === "venues" ? venuesPath
        : raw.kind === "concerts" ? concertsPath
          : (targetPage) => targetPage > 1 ? `/${raw.kind}/page/${targetPage}` : `/${raw.kind}`;
      const path = canonicalPath(requestedPath, collectionPath(page));
      const artists = raw.kind === "artists" ? (raw.artists || []).slice(0, 200).map((row) => Object.freeze({
        name: cleanLine(row.name, 160),
        path: canonicalArtistPath(publicPaths, row),
        genre: publicArtistGenres(row),
        description: summary(row.bio, 180),
      })).filter((artist) => artist.name && artist.path) : [];
      const events = raw.kind === "events" ? (raw.events || []).slice(0, 200).map((row) => eventCard(row, publicPaths)).filter(Boolean) : [];
      const venues = raw.kind === "venues" ? (raw.venues || []).slice(0, 12).flatMap((row) => {
        const name = cleanLine(row.name, 180);
        if (!name) return [];
        const path = canonicalVenuePath(publicPaths, {
          name,
          providerVenueId: row.venue_provider_id,
          source: row.source,
        }, { allowNameOnly: true });
        if (!path) return [];
        const featuredEvent = row.event_id ? eventCard({
          id: row.event_id,
          event_name: row.event_name,
          artist: row.featured_artist,
          artist_key: row.featured_artist_key,
          artist_public_slug: row.featured_artist_public_slug,
          venue: name,
          venue_provider_id: row.venue_provider_id,
          source: row.source,
          place: row.place,
          venue_city: row.venue_city,
          venue_region: row.venue_region,
          venue_country_code: row.venue_country_code,
          venue_country: row.venue_country,
          date: row.event_date,
          start_date_time: row.event_start_date_time,
          start_local_time: row.event_local_time,
          event_timezone: row.event_timezone,
          event_status: row.event_status,
          ticket_url: row.event_ticket_url,
          sold_out: row.event_sold_out,
          venue_address_line1: row.venue_address_line1,
          venue_address_line2: row.venue_address_line2,
          venue_postal_code: row.venue_postal_code,
          updated_at: row.updated_at,
        }, publicPaths) : null;
        const featuredArtist = cleanLine(row.featured_artist, 160) || null;
        const venuePhoto = publicVenuePhotoPool(name, {
          limit: 1,
          source: row.source,
          providerVenueId: row.venue_provider_id,
        })
          .map((photo) => venuePhotoProjection(photo, name)).find(Boolean) || null;
        return [Object.freeze({
          name,
          path,
          place: cleanLine(row.place, 180)
            || cleanLine([row.venue_city, row.venue_region, row.venue_country].filter(Boolean).join(", "), 180)
            || null,
          reviewCount: count(row.review_count),
          featuredArtist,
          featuredArtistPath: featuredArtist ? relatedArtistPath(publicPaths, {
            artist: featuredArtist,
            artist_key: row.featured_artist_key,
            artist_public_slug: row.featured_artist_public_slug,
          }) : null,
          featuredEvent,
          image: venuePhoto?.url || null,
          photo: venuePhoto,
          modifiedAt: timestamp(row.updated_at),
        })];
      }) : [];
      const concerts = raw.kind === "concerts" ? (raw.concerts || []).slice(0, 12).flatMap((row) => {
        const date = validDate(row.date);
        const artist = cleanLine(row.artist, 160);
        const venue = cleanLine(row.venue, 180);
        if (!date || !artist || !venue) return [];
        const key = archiveShowKey({
          artistIdentity: row.artist_key || row.show_artist || artist,
          venueIdentity: row.venue_key || row.show_venue || venue,
          date,
        });
        return [Object.freeze({
          key,
          path: canonicalConcertPath(publicPaths, key),
          artist,
          artistPath: relatedArtistPath(publicPaths, row),
          venue,
          venuePath: canonicalVenuePath(publicPaths, row),
          city: cleanLine(row.city, 120) || null,
          date,
          ratingCount: count(row.rating_count),
          reviewCount: count(row.review_count),
          averageRating: rating(row.average_rating),
          modifiedAt: timestamp(row.latest_at),
        })];
      }) : [];
      if (
        (raw.kind === "artists" && !artists.length)
        || (raw.kind === "events" && !events.length)
        || (raw.kind === "venues" && !venues.length)
        || (raw.kind === "concerts" && !concerts.length)
      ) return null;
      const isArtists = raw.kind === "artists";
      const isVenues = raw.kind === "venues";
      const isConcerts = raw.kind === "concerts";
      const titleBase = isArtists ? "Artists with live reviews and concert archives"
        : isVenues ? "Concert venues, reviews and upcoming shows"
          : isConcerts ? "Fan-rated concert archive" : "Upcoming concerts around the world";
      const title = titleBase + (page > 1 ? ' — Page ' + page : '') + ' | Mshpit';
      const description = isArtists
        ? "Browse artist pages with reviews, concert photos, upcoming shows and historical live archives on Mshpit."
        : isVenues
          ? "Browse established live music venues with real upcoming shows and Mshpit fan activity."
          : isConcerts
            ? "Browse real concert nights documented by Mshpit fans, with ratings, reviews and links to artists and venues."
            : "Browse upcoming concerts worldwide, then open an event for venue details, ticket links and fan memories on Mshpit.";
      const directoryLabel = isArtists ? "Artists" : isVenues ? "Venues" : isConcerts ? "Concert archive" : "Events";
      const breadcrumbs = Object.freeze([
        Object.freeze({ name: "Mshpit", path: "/" }),
        Object.freeze({ name: page > 1 ? `${directoryLabel} — Page ${page}` : directoryLabel, path }),
      ]);
      const directoryItems = isArtists ? artists : isVenues ? venues : isConcerts ? concerts : events;
      const items = directoryItems.slice(0, 100).map((item, index) => {
        const name = item.name || [item.artist, item.venue].filter(Boolean).join(" at ");
        const url = absolute(publicOrigin, item.path);
        return {
          "@type": "ListItem",
          position: index + 1,
          name,
          url,
          ...(isVenues ? {
            item: {
              "@type": "MusicVenue",
              name,
              url,
              ...(item.photo ? { image: venuePhotoSchema(item.photo, name) } : {}),
            },
          } : {}),
        };
      });
      const directoryImage = isVenues ? venues.find((venue) => venue.image)?.image || null : null;
      return Object.freeze({
        kind: "directory",
        directoryKind: raw.kind,
        page,
        // Page 1 is the collection's canonical entry point. Every later slice is
        // the same boilerplate title and description over a different window of
        // rows, so indexing them created 1,640 near-duplicate pages that beat the
        // real content to the site's sitelinks. noindex,follow keeps the crawler
        // walking the list through to each leaf entity while removing the slices
        // themselves from the index. The renderer turns this into the robots tag.
        indexable: page <= 1,
        hasNext: raw.hasNext === true,
        previousPath: page > 1 ? collectionPath(page - 1) : null,
        nextPath: raw.hasNext === true ? collectionPath(page + 1) : null,
        siteName: SITE_NAME,
        title,
        description,
        canonicalPath: path,
        canonicalUrl: absolute(publicOrigin, path),
        image: directoryImage,
        imageProvenance: directoryImage ? "licensed-venue" : null,
        artists,
        events,
        venues,
        concerts,
        breadcrumbs,
        jsonLd: [Object.freeze({
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          "@id": `${absolute(publicOrigin, path)}#page`,
          name: isArtists ? "Mshpit artist directory"
            : isVenues ? "Mshpit venue directory"
              : isConcerts ? "Mshpit fan concert archive" : "Mshpit event directory",
          url: absolute(publicOrigin, path),
          description,
          isPartOf: siteReference(publicOrigin),
          publisher: organizationReference(publicOrigin),
          mainEntity: { "@type": "ItemList", numberOfItems: directoryItems.length, itemListElement: items },
        }), Object.freeze(breadcrumbNode(publicOrigin, breadcrumbs))].filter(Boolean),
      });
    },
  });
}
