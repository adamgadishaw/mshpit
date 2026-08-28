import { normalizeStableShowId } from "./showAttendance.mjs";
import { LIVE_EVENT_PHASE, liveEventPhase } from "./eventLifecycle.mjs";

const SHOW_LIFECYCLES = new Set([
  "unknown", "upcoming", "happening", "completed", "postponed", "cancelled",
]);

const text = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
const timestamp = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
const SPECIAL_EVENT_KINDS = new Set(["festival", "fair", "rodeo", "multi_day"]);

export function isNamedSpecialEvent(event) {
  const kind = text(event?.eventKind)?.toLowerCase();
  const eventName = text(event?.eventName);
  const artist = text(event?.artist);
  return SPECIAL_EVENT_KINDS.has(kind) || (!!eventName && eventName !== artist);
}

export function showDocumentIdentity(concertKey, accountId) {
  return `${String(concertKey || "")}\u0000${accountId == null ? "guest" : String(accountId)}`;
}

export function normalizeShowDocument(payload) {
  const source = payload?.show && typeof payload.show === "object" ? payload.show : payload;
  if (!source || typeof source !== "object") return null;
  const id = normalizeStableShowId(source.id);
  const canonicalKey = text(source.canonicalKey);
  if (!id || !canonicalKey) return null;
  const lifecycle = text(source.lifecycle)?.toLowerCase() || "unknown";
  return {
    id,
    canonicalKey,
    aliases: Array.isArray(source.aliases) ? source.aliases
      .map((alias) => ({
        type: text(alias?.type),
        value: text(alias?.value),
      }))
      .filter((alias) => alias.type && alias.value) : [],
    artist: text(source.artist),
    artistKey: text(source.artistKey),
    performers: Array.isArray(source.performers) ? source.performers
      .map((performer) => ({
        key: text(performer?.key),
        name: text(performer?.name),
        role: text(performer?.role),
        position: Number.isSafeInteger(performer?.position) ? performer.position : 0,
      }))
      .filter((performer) => performer.key && performer.name) : [],
    venue: text(source.venue),
    venueKey: text(source.venueKey),
    city: text(source.city),
    tour: text(source.tour),
    date: text(source.date),
    localDate: text(source.localDate),
    startsAt: timestamp(source.startsAt),
    startLocalTime: text(source.startLocalTime),
    timezone: text(source.timezone),
    lifecycle: SHOW_LIFECYCLES.has(lifecycle) ? lifecycle : "unknown",
    provider: source.provider?.backed === true && text(source.provider?.name) && text(source.provider?.eventId)
      ? { name: text(source.provider.name), eventId: text(source.provider.eventId), backed: true }
      : null,
    publicEligible: source.publicEligible === true,
    indexable: source.indexable === true,
    viewerAttendance: source.viewerAttendance && typeof source.viewerAttendance === "object"
      ? source.viewerAttendance
      : null,
  };
}

export function showLifecycleView(document, legacyDate, hasScore, now = Date.now(), event = null) {
  const trusted = document?.provider?.backed === true;
  const activeMultiDay = liveEventPhase(event, now) === LIVE_EVENT_PHASE.ACTIVE;
  if (trusted && document.lifecycle !== "unknown") {
    const lifecycle = activeMultiDay && !["cancelled", "postponed"].includes(document.lifecycle)
      ? "happening"
      : document.lifecycle;
    return {
      lifecycle,
      targetMs: document.startsAt,
      upcoming: ["upcoming", "happening", "postponed"].includes(lifecycle),
      trusted: true,
    };
  }
  const parsed = typeof legacyDate === "number" ? legacyDate : null;
  return {
    lifecycle: activeMultiDay ? "happening" : "unknown",
    targetMs: parsed,
    upcoming: activeMultiDay || (parsed != null ? parsed - now > -86400000 : hasScore !== true),
    trusted: false,
  };
}

export function showPresentationModel(lifecycleView) {
  const view = lifecycleView || {};
  if (view.lifecycle === "happening") {
    return {
      screenKicker: "HAPPENING NOW",
      ticketKicker: "LIVE · HAPPENING NOW",
      showCountdown: false,
      showPostEvent: false,
      allowTickets: true,
      allowGoing: true,
    };
  }
  if (view.trusted !== true) {
    const upcoming = view.upcoming === true;
    return {
      screenKicker: upcoming ? "UPCOMING PERFORMANCE" : "PERFORMANCE",
      ticketKicker: upcoming ? "ONE NIGHT · NOT YET PLAYED" : "ONE NIGHT ONLY",
      showCountdown: upcoming,
      showPostEvent: !upcoming,
      allowTickets: upcoming,
      allowGoing: true,
    };
  }
  switch (view.lifecycle) {
    case "postponed":
      return {
        screenKicker: "POSTPONED PERFORMANCE",
        ticketKicker: "THIS SHOW IS POSTPONED",
        showCountdown: false,
        showPostEvent: false,
        allowTickets: false,
        allowGoing: true,
      };
    case "cancelled":
      return {
        screenKicker: "CANCELLED PERFORMANCE",
        ticketKicker: "THIS SHOW WAS CANCELLED",
        showCountdown: false,
        showPostEvent: false,
        allowTickets: false,
        allowGoing: false,
      };
    case "completed":
      return {
        screenKicker: "PERFORMANCE",
        ticketKicker: "ONE NIGHT ONLY",
        showCountdown: false,
        showPostEvent: true,
        allowTickets: false,
        allowGoing: true,
      };
    default:
      return {
        screenKicker: "UPCOMING PERFORMANCE",
        ticketKicker: "ONE NIGHT · NOT YET PLAYED",
        showCountdown: true,
        showPostEvent: false,
        allowTickets: true,
        allowGoing: true,
      };
  }
}
