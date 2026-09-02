import { PRODUCTION_API_ORIGIN } from "./apiOrigin.mjs";
import { buildAttendanceTicketPreview, formatAttendanceTicketDate, normalizeAttendanceTicketShow, safeAttendanceTicketImageUri } from "./attendanceTicket.mjs";
import { mediaDisplayItems, mediaDisplayKind, mediaDisplayUri, mediaPosterUri } from "./postMediaDisplay.mjs";
import { eventPath, postPath } from "./urls.mjs";

const SHARE_KINDS = new Set(["going", "interested", "review"]);
const SHARE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/u;
const MAX_TITLE = 120;
const MAX_META = 120;
const MAX_QUOTE = 180;

const cleanText = (value, limit = MAX_META) => String(value ?? "")
  .replace(/[\u0000-\u001F\u007F]/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, limit);

const firstText = (...values) => {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
};

const strictShareId = (value) => {
  const normalized = String(value ?? "").normalize("NFKC").trim();
  return SHARE_ID_PATTERN.test(normalized) ? normalized : null;
};

const absoluteMshpitUrl = (path) => {
  const clean = cleanText(path, 2_000);
  if (!clean) return null;
  try {
    const parsed = new URL(clean, `${PRODUCTION_API_ORIGIN}/`);
    if (parsed.origin !== PRODUCTION_API_ORIGIN || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

const safeArtworkUri = (value) => {
  const clean = typeof value === "object" && value !== null
    ? firstText(value.uri, value.url, value.sourceUrl)
    : cleanText(value, 2_000);
  if (!clean) return null;
  if (clean.startsWith("/")) return absoluteMshpitUrl(clean);
  return safeAttendanceTicketImageUri(clean);
};

const authorName = (author) => firstText(
  author?.name,
  author?.displayName,
  author?.handle ? `@${String(author.handle).replace(/^@/, "")}` : "",
);

const finiteScore = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? Math.min(5, Math.max(0, number))
    : null;
};

const firstPostArtwork = (log) => {
  for (const item of mediaDisplayItems(log)) {
    const candidate = mediaDisplayKind(item) === "video"
      ? mediaPosterUri(item)
      : mediaDisplayUri(item);
    const uri = safeArtworkUri(candidate);
    if (uri) return uri;
  }
  return safeArtworkUri(
    log?.artistImageUri
      || log?.artistPhotoUri
      || log?.artistImage
      || log?.imageUri,
  );
};

const makeModel = ({
  kind,
  id,
  url,
  renderRequest,
  title,
  contextTitle,
  venue,
  city,
  dateLabel,
  timeLabel,
  author,
  rating,
  quote,
  artworkUri,
}) => {
  if (!SHARE_KINDS.has(kind) || !url || !renderRequest || !cleanText(title, MAX_TITLE)) return null;
  const safeAuthor = authorName(author);
  const safeTitle = cleanText(title, MAX_TITLE);
  const safeContext = cleanText(contextTitle, MAX_META);
  const safeVenue = cleanText(venue, MAX_META);
  const safeCity = cleanText(city, MAX_META);
  const safeDate = cleanText(dateLabel, 80);
  const safeTime = cleanText(timeLabel, 60);
  const safeQuote = cleanText(quote, MAX_QUOTE);
  const safeRating = finiteScore(rating);
  const place = [safeVenue, safeCity].filter(Boolean).join(" · ");
  const actionLine = kind === "review"
    ? `${safeAuthor || "A fan"} reviewed ${safeTitle}`
    : kind === "going"
      ? `${safeAuthor || "A Mshpit fan"} is going to ${safeTitle}`
      : `${safeAuthor || "A Mshpit fan"} is interested in ${safeTitle}`;
  const shareText = [
    actionLine,
    safeContext && safeContext !== safeTitle ? safeContext : "",
    place,
    safeDate,
    safeRating ? `${safeRating.toFixed(1)} out of 5` : "",
  ].filter(Boolean).join(" — ");

  return Object.freeze({
    kind,
    id: cleanText(id, 240),
    eyebrow: kind === "review" ? "REVIEW" : kind.toUpperCase(),
    title: safeTitle,
    contextTitle: safeContext || null,
    venue: safeVenue || null,
    city: safeCity || null,
    place: place || null,
    dateLabel: safeDate || null,
    timeLabel: safeTime || null,
    authorName: safeAuthor || null,
    rating: safeRating,
    quote: safeQuote || null,
    artworkUri: safeArtworkUri(artworkUri),
    url,
    renderRequest: Object.freeze({ ...renderRequest }),
    shareText,
    accessibilityLabel: [actionLine, safeContext, place, safeDate, safeTime].filter(Boolean).join(". "),
  });
};

export function buildPostShareModel(log = {}, { author = null } = {}) {
  const postId = strictShareId(log?.id);
  if (!postId) return null;
  const canonicalPath = postPath(postId);
  if (!canonicalPath) return null;
  const url = absoluteMshpitUrl(canonicalPath);

  if (log?.kind === "status" && log?.attendanceTicket) {
    const ticket = log.attendanceTicket?.kind === "attendance-ticket"
      ? log.attendanceTicket
      : buildAttendanceTicketPreview({ author, show: log.attendanceTicket });
    if (!ticket?.eventTitle) return null;
    const show = normalizeAttendanceTicketShow(ticket) || ticket;
    return makeModel({
      kind: "going",
      id: postId,
      url,
      renderRequest: { kind: "post", postId },
      title: show.eventTitle,
      contextTitle: show.contextTitle,
      venue: show.venue,
      city: show.city,
      dateLabel: ticket.dateLabel || show.dateLabel,
      timeLabel: ticket.timing?.find((item) => item.kind === "start")?.value
        || show.timing?.find((item) => item.kind === "start")?.value,
      author,
      quote: log.review,
      artworkUri: ticket.imageUri || show.artistImageUri || firstPostArtwork(log),
    });
  }

  if (log?.kind !== "review") return null;
  const reviewText = firstText(log.review, log.caption, log.text);
  if (!finiteScore(log.overall) && !reviewText && mediaDisplayItems(log).length === 0) return null;
  const title = firstText(log.artist, log.onlineTitle, log.eventTitle, "Live show");
  return makeModel({
    kind: "review",
    id: postId,
    url,
    renderRequest: { kind: "post", postId },
    title,
    contextTitle: firstText(log.tour, log.eventTitle, log.onlineTitle),
    venue: log.venue,
    city: log.city,
    dateLabel: formatAttendanceTicketDate(log.date) || cleanText(log.date, 80),
    author,
    rating: log.overall,
    quote: reviewText,
    artworkUri: firstPostArtwork(log),
  });
}

export function buildAttendanceShareModel({ show = {}, state, author = null } = {}) {
  if (state !== "going" && state !== "interested") return null;
  // Event cards authorize against the exact public tour-date identity saved by
  // /api/going. Provider IDs and the internal hashed Show id are different
  // identities and must never be substituted after the fact.
  const eventId = strictShareId(show.tourDateId);
  if (!eventId) return null;
  const canonicalPath = eventPath(eventId);
  if (!canonicalPath) return null;
  const normalized = normalizeAttendanceTicketShow(show);
  if (!normalized?.eventTitle) return null;
  return makeModel({
    kind: state,
    id: eventId,
    url: absoluteMshpitUrl(canonicalPath),
    renderRequest: { kind: "event", eventId, intent: state },
    title: normalized.eventTitle,
    contextTitle: normalized.contextTitle,
    venue: normalized.venue,
    city: normalized.city,
    dateLabel: normalized.dateLabel,
    timeLabel: normalized.timing?.find((item) => item.kind === "start")?.value,
    author,
    artworkUri: normalized.artistImageUri
      || show.imageUri
      || show.artistPhotoUri
      || show.artistImageUri,
  });
}

export function socialShareIntentUrl(platform, model) {
  if (!model?.url || !model?.shareText) return null;
  if (platform === "x" || platform === "twitter") {
    const params = new URLSearchParams({ text: model.shareText, url: model.url });
    return `https://twitter.com/intent/tweet?${params.toString()}`;
  }
  if (platform === "facebook") {
    const params = new URLSearchParams({ u: model.url });
    return `https://www.facebook.com/sharer/sharer.php?${params.toString()}`;
  }
  // Instagram does not provide a reliable public web composer. Native builds
  // use the dedicated Story composer; browsers only download the Story PNG.
  return null;
}

export function socialShareFileName(model) {
  const id = cleanText(model?.id, 80).replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
  const kind = SHARE_KINDS.has(model?.kind) ? model.kind : "live";
  return `mshpit-${kind}-${id || "share"}.png`;
}
