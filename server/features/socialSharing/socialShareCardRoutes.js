import { createPngApiResponse } from "../../binaryApiResponse.js";
import { isStrictCalendarDate } from "../seo/publicEntityPolicy.js";
import { normalizeTourDateId } from "../shows/showIdentity.js";
import {
  createSocialShareCardRenderer,
  eventShareCardModel,
  reviewShareCardModel,
  SocialShareCardBusyError,
} from "./socialShareCardRenderer.js";
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

export function publicAttendanceTicketShareSnapshot(value) {
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
  const venue = safe(ticket.venue, 180);
  const date = safe(ticket.date, 10);
  if (!id || !artist || !venue || !isStrictCalendarDate(date)) return null;
  const eventName = safe(ticket.eventName || ticket.tourName, 180);
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
  renderer = createSocialShareCardRenderer(),
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
        model = reviewShareCardModel(document);
        if (!model && document.post?.kind === "status") {
          const ticketDocument = publicAttendanceTicketShareSnapshot(
            postBoundary.attendance_ticket,
          );
          const eventId = ticketDocument?.event?.id || null;
          const eventDocument = eventId
            ? (await resolvePublicDocument(eventPath(eventId)) || ticketDocument)
            : null;
          model = eventShareCardModel(eventDocument, "going", {
            postId,
            authorName: document.post?.author?.name,
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
        const document = await resolvePublicDocument(eventPath(eventId));
        model = eventShareCardModel(document, intent, { authorName: user.name });
        filename = `mshpit-${intent}.png`;
      } else {
        throw new ApiError(400, "Choose a review, Going event, or Interested event to share.", "VALIDATION_FAILED");
      }

      if (!model) throw new ApiError(404, "That item is not available to share.", "NOT_FOUND");
      let rendered;
      try {
        rendered = await renderer.render(model);
      } catch (error) {
        if (!(error instanceof SocialShareCardBusyError)) throw error;
        throw new ApiError(
          503,
          "Share artwork is busy. Wait a moment and try again.",
          "SHARE_RENDER_UNAVAILABLE",
        );
      }
      return createPngApiResponse(rendered.bytes, {
        canonicalUrl: model.canonicalUrl,
        filename,
      });
    },
  });
}
