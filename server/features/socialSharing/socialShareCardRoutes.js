import { createPngApiResponse } from "../../binaryApiResponse.js";
import { isStrictCalendarDate } from "../seo/publicEntityPolicy.js";
import { normalizeTourDateId } from "../shows/showIdentity.js";
import {
  createSocialShareCardRenderer,
  eventShareCardModel,
  reviewShareCardModel,
  SocialShareCardArtworkUnavailableError,
  SocialShareCardBusyError,
} from "./socialShareCardRenderer.js";
import { trustedShareArtworkUrl } from "./socialShareArtwork.js";
import { eventPath, postPath } from "../../../src/domain/urls.mjs";

const TEN_MINUTES = 10 * 60 * 1000;
const ALLOWED_POST_FIELDS = new Set(["kind", "postId"]);
const ALLOWED_EVENT_FIELDS = new Set(["kind", "eventId", "intent"]);

function boundedPostId(value) {
  if (typeof value !== "string") return null;
  const id = value.normalize("NFKC").trim();
  return /^[A-Za-z0-9._:-]{1,200}$/u.test(id) ? id : null;
}

function exactBodyKeys(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  return Object.keys(body).every((key) => allowed.has(key));
}

function internalArtworkPaths(document) {
  const entity = document?.kind === "post" ? document.post
    : document?.kind === "event" ? document.event : null;
  return [...new Set([entity?.concertPath, entity?.artistPath, entity?.venuePath]
    .filter((path) => typeof path === "string" && path.startsWith("/") && !path.startsWith("//") && path.length <= 500))];
}

function trustedArtworkCandidate(url, source, env) {
  const trusted = trustedShareArtworkUrl({ url, source }, { env });
  return trusted ? Object.freeze({ url: trusted, source }) : null;
}

function projectedOfficialArtwork(document, env) {
  if (document?.kind === "event") {
    if (document.imageProvenance !== "provider") return null;
    return trustedArtworkCandidate(document.event?.providerImage?.url, "ticketmaster", env);
  }
  if (document?.kind === "concert") {
    return trustedArtworkCandidate(document.concert?.providerImage?.url, "ticketmaster", env);
  }
  if (document?.kind !== "artist" || !document.artist
    || document.imageProvenance !== "entity-profile" || !document.image) return null;
  return trustedArtworkCandidate(document.image, "owned-media", env);
}

function eventDocumentForShare(document, env) {
  if (document?.kind !== "event" || !document.event) return document;
  const providerArtwork = projectedOfficialArtwork(document, env);
  return Object.freeze({
    ...document,
    image: providerArtwork?.url || null,
    event: Object.freeze({
      ...document.event,
      providerImage: providerArtwork
        ? Object.freeze({ ...document.event.providerImage, url: providerArtwork.url })
        : null,
    }),
  });
}

async function projectedArtworkFallbacks(document, resolvePublicDocument, env) {
  const candidates = [];
  for (const path of internalArtworkPaths(document)) {
    const fallback = await resolvePublicDocument(path);
    const candidate = projectedOfficialArtwork(fallback, env);
    if (candidate) candidates.push(candidate);
    if (candidates.length >= 2) break;
  }
  return candidates;
}

function attendanceArtworkCandidates(ticket, env, resolveCurrentArtistProfileImage) {
  const providerArtwork = trustedArtworkCandidate(ticket?.artistPhotoUri, "ticketmaster", env);
  const persistedArtwork = trustedArtworkCandidate(ticket?.artistPhotoUri, "owned-media", env);
  let currentProfileImage = null;
  if (typeof resolveCurrentArtistProfileImage === "function") {
    try {
      currentProfileImage = resolveCurrentArtistProfileImage({
        artist: ticket.artist,
        artistKey: ticket.artistKey,
      });
    } catch {
      // Profile state is the revocation authority for owned media. A provider
      // snapshot remains independently safe, but an unreadable profile must
      // never revive an old member-uploaded URL.
    }
  }
  const currentArtwork = trustedArtworkCandidate(currentProfileImage, "owned-media", env);
  if (currentArtwork) {
    return [...new Map([currentArtwork, providerArtwork]
      .filter(Boolean)
      .map((candidate) => [candidate.url, candidate])).values()];
  }
  if (persistedArtwork) return [];
  return providerArtwork ? [providerArtwork] : [];
}

export function publicAttendanceTicketShareSnapshot(value, {
  env = process.env,
  resolveCurrentArtistProfileImage = null,
} = {}) {
  let ticket = null;
  try { ticket = typeof value === "string" ? JSON.parse(value) : value; }
  catch { return null; }
  if (!ticket || typeof ticket !== "object" || Array.isArray(ticket)
    || Number(ticket.version) !== 1 || ticket.state !== "going") return null;
  const id = normalizeTourDateId(ticket.tourDateId);
  const safe = (candidate, max) => {
    if (typeof candidate !== "string" && typeof candidate !== "number") return "";
    return String(candidate).normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
      .replace(/\s+/gu, " ").trim().slice(0, max);
  };
  const artist = safe(ticket.artist, 160);
  const artistKey = safe(ticket.artistKey, 120);
  const venue = safe(ticket.venue, 180);
  const date = safe(ticket.date, 10);
  if (!id || !artist || !venue || !isStrictCalendarDate(date)) return null;
  const eventName = safe(ticket.eventName || ticket.tourName, 180);
  const fallbackArtwork = attendanceArtworkCandidates({
    artist,
    artistKey,
    artistPhotoUri: ticket.artistPhotoUri,
  }, env, resolveCurrentArtistProfileImage);
  return Object.freeze({
    kind: "event",
    event: Object.freeze({
      id,
      name: eventName || `${artist} at ${venue}`,
      artist,
      venue,
      place: safe(ticket.place || ticket.city, 180),
      date,
      localTime: safe(ticket.startLocalTime || ticket.startDateTime, 40),
    }),
    fallbackArtwork: Object.freeze(fallbackArtwork),
  });
}

export function socialShareCardRoutes({
  database,
  ApiError,
  attendanceRepository,
  blockedEitherWay,
  rateLimit,
  requireUser,
  resolvePublicDocument,
  resolveCurrentArtistProfileImage = null,
  renderer = createSocialShareCardRenderer(),
  artworkEnv = process.env,
} = {}) {
  if (!database?.prepare || typeof ApiError !== "function" || !attendanceRepository?.ownExactAttendance
    || typeof blockedEitherWay !== "function"
    || typeof rateLimit !== "function" || typeof requireUser !== "function"
    || typeof resolvePublicDocument !== "function" || !renderer?.render) {
    throw new TypeError("Social share-card routes require complete boundary dependencies");
  }
  const postBoundaryById = database.prepare(`SELECT user_id,kind,attendance_ticket FROM posts
    WHERE id=? AND removed=0 LIMIT 1`);

  return Object.freeze({
    "POST /api/share-cards/render": async (ctx) => {
      const user = requireUser(ctx);
      rateLimit(ctx, "social-share-card", 30, TEN_MINUTES);
      ctx.setHeader?.("Cache-Control", "private, no-store");

      const kind = typeof ctx.body?.kind === "string" ? ctx.body.kind.trim().toLowerCase() : "";
      let model = null;
      let filename = "mshpit-share.png";

      if (kind === "post") {
        if (!exactBodyKeys(ctx.body, ALLOWED_POST_FIELDS)) {
          throw new ApiError(400, "Choose one post to share.", "VALIDATION_FAILED");
        }
        const postId = boundedPostId(ctx.body.postId);
        if (!postId) throw new ApiError(400, "Choose a valid post to share.", "VALIDATION_FAILED");
        const postBoundary = postBoundaryById.get(postId);
        if (!postBoundary || blockedEitherWay(user.id, postBoundary.user_id)) {
          throw new ApiError(404, "That post is not available to share.", "NOT_FOUND");
        }
        const document = await resolvePublicDocument(postPath(postId));
        if (document?.kind !== "post") {
          throw new ApiError(404, "That post is not available to share.", "NOT_FOUND");
        }
        model = document.post?.kind === "review"
          ? reviewShareCardModel(document, {
              fallbackArtwork: await projectedArtworkFallbacks(
                document,
                resolvePublicDocument,
                artworkEnv,
              ),
            })
          : null;
        if (!model && document.post?.kind === "status") {
          const ticketDocument = publicAttendanceTicketShareSnapshot(
            postBoundary.attendance_ticket,
            { env: artworkEnv, resolveCurrentArtistProfileImage },
          );
          const eventId = ticketDocument?.event?.id || null;
          const resolvedEventDocument = eventId
            ? (await resolvePublicDocument(eventPath(eventId)) || ticketDocument)
            : null;
          const eventDocument = eventDocumentForShare(resolvedEventDocument, artworkEnv);
          model = eventShareCardModel(eventDocument, "going", {
            postId,
            authorName: document.post?.author?.name,
            preferFallbackArtwork: true,
            fallbackArtwork: [
              ...(ticketDocument?.fallbackArtwork || []),
              ...await projectedArtworkFallbacks(eventDocument, resolvePublicDocument, artworkEnv),
            ],
          });
        }
        filename = model?.variant === "review" ? "mshpit-review.png" : "mshpit-going.png";
      } else if (kind === "event") {
        if (!exactBodyKeys(ctx.body, ALLOWED_EVENT_FIELDS)) {
          throw new ApiError(400, "Choose one event to share.", "VALIDATION_FAILED");
        }
        const eventId = normalizeTourDateId(ctx.body.eventId);
        const intent = typeof ctx.body.intent === "string" ? ctx.body.intent.trim().toLowerCase() : "";
        if (!eventId || !["going", "interested"].includes(intent)) {
          throw new ApiError(400, "Choose a saved Going or Interested event.", "VALIDATION_FAILED");
        }
        const own = attendanceRepository.ownExactAttendance(user.id, { tourDateId: eventId });
        if (own?.attendance?.state !== intent) {
          throw new ApiError(
            409,
            `Save this event as ${intent === "going" ? "Going" : "Interested"} before sharing it.`,
            "CONFLICT",
          );
        }
        const document = eventDocumentForShare(
          await resolvePublicDocument(eventPath(eventId)),
          artworkEnv,
        );
        model = eventShareCardModel(document, intent, {
          authorName: user.name,
          fallbackArtwork: await projectedArtworkFallbacks(document, resolvePublicDocument, artworkEnv),
        });
        filename = `mshpit-${intent}.png`;
      } else {
        throw new ApiError(400, "Choose a review, Going event, or Interested event to share.", "VALIDATION_FAILED");
      }

      if (!model) throw new ApiError(404, "That item is not available to share.", "NOT_FOUND");
      let rendered;
      try {
        rendered = await renderer.render(model, { signal: ctx.signal || null });
      } catch (error) {
        if (error instanceof SocialShareCardBusyError) {
          throw new ApiError(
            503,
            "Share artwork is busy. Wait a moment and try again.",
            "SHARE_RENDER_UNAVAILABLE",
          );
        }
        if (error instanceof SocialShareCardArtworkUnavailableError) {
          throw new ApiError(
            503,
            "The photo for this share card could not be prepared. Try again.",
            "SHARE_RENDER_UNAVAILABLE",
          );
        }
        throw error;
      }
      return createPngApiResponse(rendered.bytes, {
        canonicalUrl: model.canonicalUrl,
        filename,
      });
    },
  });
}
