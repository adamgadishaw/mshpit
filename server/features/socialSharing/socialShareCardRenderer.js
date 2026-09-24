import { createHash } from "node:crypto";

import sharp from "sharp";
import { acquireMemoryWork } from "../../memoryAdmission.js";
import { renderIsolatedSocialShareCard } from "./socialShareCardProcess.js";

import { eventPath, postPath } from "../../../src/domain/urls.mjs";
import {
  absolutePhotoCreditUrl,
  licensedArtworkXmp,
  photoCreditPathFromArtwork,
} from "../../photoCredits.js";
import { isStrictCalendarDate } from "../seo/publicEntityPolicy.js";
import {
  loadShareArtwork,
  shareArtworkFailureReason,
  ShareArtworkTransientError,
} from "./socialShareArtwork.js";

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1920;
const CARD_VERSION = "mshpit-social-story-v7";
const CANONICAL_ORIGIN = "https://www.mshpit.com";
const MAX_RENDER_BYTES = 4 * 1024 * 1024;
const MAX_ARTWORK_INPUT_BYTES = 6 * 1024 * 1024;
const MAX_ARTWORK_INPUT_PIXELS = 12_000_000;
const DEFAULT_CACHE_ENTRIES = 160;
const DEFAULT_CACHE_BYTES = 24 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT_RENDERS = 1;
const DEFAULT_MAX_CONCURRENT_ARTWORK_LOADS = 4;
const DEFAULT_TRANSIENT_FAILURE_CACHE_ENTRIES = 160;
const DEFAULT_TRANSIENT_FAILURE_CACHE_TTL_MS = 5_000;
const DEFAULT_TOTAL_WORK_TIMEOUT_MS = 4_000;
const PREPARED_ARTWORK_RENDER = Symbol("preparedArtworkRender");

const COPY = Object.freeze({
  going: Object.freeze({ label: "GOING", kicker: "Going to this show" }),
  interested: Object.freeze({ label: "INTERESTED", kicker: "Interested in this show" }),
  review: Object.freeze({ label: "REVIEW", kicker: "RATED LIVE BY AN MSHPIT MEMBER" }),
});

const PALETTES = Object.freeze({
  going: Object.freeze([
    Object.freeze({ start: "#ff5a3d", end: "#7b3fe4", ink: "#20111a" }),
    Object.freeze({ start: "#f97837", end: "#d82d67", ink: "#20110e" }),
  ]),
  interested: Object.freeze([
    Object.freeze({ start: "#6842d8", end: "#16748a", ink: "#151225" }),
    Object.freeze({ start: "#9b3ea5", end: "#3049a7", ink: "#1b1124" }),
  ]),
  review: Object.freeze([
    Object.freeze({ start: "#edb12f", end: "#b82d68", ink: "#21170c" }),
    Object.freeze({ start: "#d58a22", end: "#5935a7", ink: "#21170c" }),
  ]),
});

export class SocialShareCardBusyError extends Error {
  constructor() {
    super("Social share card renderer is busy");
    this.name = "SocialShareCardBusyError";
    this.code = "renderer_busy";
  }
}

export class SocialShareCardArtworkUnavailableError extends Error {
  constructor(transientError = null) {
    super("Social share card artwork is temporarily unavailable");
    this.name = "SocialShareCardArtworkUnavailableError";
    this.code = transientError instanceof ShareArtworkTransientError
      ? shareArtworkFailureReason(transientError) : "artwork_unavailable";
  }
}

class SocialShareCardRenderError extends Error {
  constructor(cause) {
    super("Social share card rendering failed", { cause });
    this.name = "SocialShareCardRenderError";
  }
}

function cleanText(value, max = 200) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value)
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, max);
}

function cleanReview(value, max = 360) {
  return cleanText(value, max)
    .replace(/(?:https?:\/\/|www\.)\S+/giu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function strictId(value) {
  const id = cleanText(value, 201);
  return /^[A-Za-z0-9._:-]{1,200}$/u.test(id) ? id : null;
}

function canonicalUrl(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return null;
  const parsed = new URL(path, `${CANONICAL_ORIGIN}/`);
  return parsed.origin === CANONICAL_ORIGIN && !parsed.search && !parsed.hash ? parsed.toString() : null;
}

function normalizedDate(value) {
  const candidate = cleanText(value, 10);
  return isStrictCalendarDate(candidate) ? candidate : "";
}

function formatDate(value) {
  const date = normalizedDate(value);
  if (!date) return "DATE TO BE ANNOUNCED";
  const parsed = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) return "DATE TO BE ANNOUNCED";
  return new Intl.DateTimeFormat("en-CA", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(parsed).toUpperCase();
}

function formatTime(value) {
  const candidate = cleanText(value, 40);
  const match = /(?:T|^)(\d{1,2}):(\d{2})/u.exec(candidate);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23
    || !Number.isInteger(minute) || minute < 0 || minute > 59) return "";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function cleanRating(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 && number <= 5
    ? (Math.round(number * 10) / 10).toFixed(1)
    : "";
}

function normalizedWords(value) {
  return cleanText(value, 240).toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

function eventSubtitle(event) {
  const name = cleanText(event?.name, 180);
  const generic = `${cleanText(event?.artist, 160)} at ${cleanText(event?.venue, 180)}`;
  return name && normalizedWords(name) !== normalizedWords(generic)
    && normalizedWords(name) !== normalizedWords(event?.artist) ? name : "";
}

function normalizedHttpsUrl(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2_048) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.hash) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizedCreditPath(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 500) return null;
  try {
    const parsed = new URL(value.trim(), CANONICAL_ORIGIN);
    if (parsed.origin !== CANONICAL_ORIGIN || parsed.username || parsed.password
      || parsed.search || parsed.hash
      || !/^\/photo-credits\/[a-f0-9]{48}$/u.test(parsed.pathname)) return null;
    return parsed.pathname;
  } catch {
    return null;
  }
}

function normalizedFocalPoint(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1
    ? Object.freeze({ x, y })
    : null;
}

function artworkCandidate(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const source = candidate.source;
  if (!["owned-media", "licensed-media"].includes(source)) return null;
  const url = normalizedHttpsUrl(candidate.url);
  if (!url) return null;
  const focalPoint = normalizedFocalPoint(candidate.focalPoint);
  if (source === "owned-media") return Object.freeze({
    url,
    source,
    ...(focalPoint ? { focalPoint } : {}),
  });

  const title = cleanText(candidate.title, 240);
  const creator = cleanText(candidate.creator, 120);
  const license = cleanText(candidate.license, 40);
  const licenseUrl = normalizedHttpsUrl(candidate.licenseUrl);
  const sourcePage = normalizedHttpsUrl(candidate.sourcePage);
  const modificationNotice = cleanText(candidate.modificationNotice, 160);
  const creditPath = normalizedCreditPath(candidate.creditPath);
  if (!title || !creator || !license || !licenseUrl || !sourcePage || !modificationNotice
    || !creditPath) return null;
  const projected = {
    url,
    source,
    title,
    creator,
    license,
    licenseUrl,
    sourcePage,
    modificationNotice,
    creditPath,
    ...(focalPoint ? { focalPoint } : {}),
  };
  const registeredCreditPath = photoCreditPathFromArtwork(projected);
  return registeredCreditPath === creditPath
    ? Object.freeze({ ...projected, creditPath: registeredCreditPath })
    : null;
}

function normalizedArtwork(candidates) {
  const unique = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const normalized = artworkCandidate(candidate);
    if (normalized && !unique.has(normalized.url)) unique.set(normalized.url, normalized);
    if (unique.size >= 3) break;
  }
  return Object.freeze([...unique.values()]);
}

function eventArtwork(document) {
  // Provider image presence is not a license to create a derivative Story
  // asset. Attendance exports rely on verified owned media or CC0/PDM venue
  // fallbacks admitted by the route boundary.
  return normalizedArtwork([]);
}

function reviewArtwork(document) {
  const media = Array.isArray(document?.post?.media) ? document.post.media : [];
  const primary = media.find((asset) =>
    (asset?.kind === "image" && asset.url)
    || (asset?.kind === "video" && asset.posterUrl));
  const url = primary?.kind === "video" ? primary.posterUrl : primary?.url;
  return normalizedArtwork([
    url ? { url, source: "owned-media" } : null,
    document?.image ? { url: document.image, source: "owned-media" } : null,
  ]);
}

/**
 * Only values already admitted by the public SEO projection enter the model.
 * The model has no fields for seat, order, barcode, ticket URL, attendance
 * visibility, email, or account identifiers.
 */
export function eventShareCardModel(document, intent, {
  postId = null,
  authorName = null,
  fallbackArtwork = [],
  preferFallbackArtwork = false,
} = {}) {
  const event = document?.event;
  if (document?.kind !== "event" || !event || !["going", "interested"].includes(intent)) return null;
  const id = strictId(event.id);
  const artist = cleanText(event.artist, 160);
  const venue = cleanText(event.venue, 180);
  const date = normalizedDate(event.date);
  if (!id || !artist || !venue || !date) return null;
  const canonicalPath = postId ? postPath(strictId(postId)) : eventPath(id);
  const shareUrl = canonicalUrl(canonicalPath);
  if (!shareUrl) return null;
  const author = cleanText(authorName, 100);
  const subtitle = eventSubtitle(event);
  const eventCandidates = eventArtwork(document);
  const fallbackCandidates = Array.isArray(fallbackArtwork) ? fallbackArtwork : [];
  const artwork = normalizedArtwork(preferFallbackArtwork
    ? [...fallbackCandidates, ...eventCandidates]
    : [...eventCandidates, ...fallbackCandidates]);
  return Object.freeze({
    version: CARD_VERSION,
    variant: intent,
    label: COPY[intent].label,
    kicker: author
      ? `${author} is ${intent === "going" ? "going" : "interested"}`
      : COPY[intent].kicker,
    statement: intent === "going"
      ? `${author || "A Mshpit fan"} is going to ${artist}${subtitle ? ` for ${subtitle}` : ""}.`
      : `${author || "A Mshpit fan"} is interested in ${artist}${subtitle ? ` for ${subtitle}` : ""}.`,
    artist,
    subtitle,
    venue,
    place: cleanText(event.place, 180),
    date: formatDate(date),
    time: formatTime(event.localTime || event.startDateTime),
    rating: "",
    quote: "",
    artwork,
    canonicalUrl: shareUrl,
  });
}

export function reviewShareCardModel(document, { fallbackArtwork = [] } = {}) {
  const post = document?.post;
  if (document?.kind !== "post" || post?.kind !== "review") return null;
  const id = strictId(post.id);
  const artist = cleanText(post.artist || post.onlineTitle, 160);
  if (!id || !artist) return null;
  const score = cleanRating(post.rating);
  const quote = cleanReview(post.text, 300);
  const mediaCount = Array.isArray(post.media) ? post.media.length : 0;
  if (!score && !quote && mediaCount === 0) return null;
  const shareUrl = canonicalUrl(postPath(id));
  if (!shareUrl) return null;
  const author = cleanText(post.author?.name, 100) || "AN MSHPIT MEMBER";
  const artwork = normalizedArtwork([
    ...reviewArtwork(document),
    ...(Array.isArray(fallbackArtwork) ? fallbackArtwork : []),
  ]);
  return Object.freeze({
    version: CARD_VERSION,
    variant: "review",
    label: COPY.review.label,
    kicker: author,
    statement: `${author} reviewed ${artist}.`,
    artist,
    subtitle: cleanText(post.tour || post.onlineTitle, 180),
    venue: cleanText(post.venue || (post.experienceType === "online" ? "ONLINE CONCERT" : ""), 180),
    place: cleanText(post.city, 180),
    date: post.showDate ? formatDate(post.showDate) : "",
    time: "",
    rating: score,
    quote,
    artwork,
    canonicalUrl: shareUrl,
  });
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

function estimatedTextWidth(value, {
  fontSize,
  letterSpacing = 0,
  monospace = false,
}) {
  const points = [...String(value || "")];
  let width = 0;
  for (const point of points) {
    if (/\s/u.test(point)) width += fontSize * 0.34;
    else if (monospace) width += fontSize * 0.62;
    else if (/[MW@#%&]/u.test(point)) width += fontSize * 0.9;
    else if (/[ilI1.,:;!?|']/u.test(point)) width += fontSize * 0.32;
    else if (/[A-Z0-9]/u.test(point)) width += fontSize * 0.64;
    else if (/[a-z]/u.test(point)) width += fontSize * 0.54;
    else width += fontSize * (point.codePointAt(0) > 0x2ff ? 1 : 0.62);
  }
  return width + (Math.max(0, points.length - 1) * letterSpacing);
}

function fittedPrefix(value, options) {
  const points = [...value];
  let length = 0;
  while (length < points.length) {
    const candidate = points.slice(0, length + 1).join("");
    if (length > 0 && estimatedTextWidth(candidate, options) > options.maxWidth) break;
    length += 1;
  }
  return {
    head: points.slice(0, Math.max(1, length)).join(""),
    tail: points.slice(Math.max(1, length)).join(""),
  };
}

function ellipsizedLine(value, options) {
  const points = [...String(value || "").replace(/[.,;:!?\s]+$/u, "")];
  while (points.length > 1
    && estimatedTextWidth(`${points.join("")}…`, options) > options.maxWidth) points.pop();
  return `${points.join("")}…`;
}

function wrapMeasuredLines(value, {
  maxWidth,
  fontSize,
  maxLines,
  letterSpacing = 0,
  monospace = false,
}) {
  const source = cleanText(value, 420);
  if (!source) return [];
  const width = Math.max(1, Number(maxWidth) || 1);
  const size = Math.max(1, Number(fontSize) || 1);
  const lineLimit = Math.max(1, Math.floor(Number(maxLines) || 1));
  const options = { maxWidth: width, fontSize: size, letterSpacing, monospace };
  const words = source.split(" ");
  const lines = [];
  let current = "";
  let cursor = 0;
  let truncated = false;
  while (cursor < words.length) {
    const word = words[cursor];
    const candidate = current ? `${current} ${word}` : word;
    if (estimatedTextWidth(candidate, options) <= width) {
      current = candidate;
      cursor += 1;
      continue;
    }
    if (current) {
      lines.push(current);
      current = "";
      if (lines.length >= lineLimit) {
        truncated = true;
        break;
      }
      continue;
    }
    const { head, tail } = fittedPrefix(word, options);
    if (!tail) {
      current = head;
      cursor += 1;
      continue;
    }
    lines.push(head);
    words[cursor] = tail;
    if (lines.length >= lineLimit) {
      truncated = true;
      break;
    }
  }
  if (current && lines.length < lineLimit) lines.push(current);
  if (cursor < words.length) truncated = true;
  if (truncated && lines.length) {
    const last = lines.length - 1;
    lines[last] = ellipsizedLine(lines[last], options);
  }
  return lines;
}

function svgTextLines(lines, {
  x, y, lineHeight, fontSize, fill, weight = 700,
  family = "Arial, Helvetica, sans-serif", letterSpacing = 0,
}) {
  return lines.map((line, index) => `<text x="${x}" y="${y + (index * lineHeight)}" fill="${fill}" font-family="${family}" font-size="${fontSize}" font-weight="${weight}" letter-spacing="${letterSpacing}">${escapeXml(line)}</text>`).join("");
}

function paletteFor(model) {
  const palettes = PALETTES[model.variant] || PALETTES.review;
  const digest = createHash("sha256").update(`${model.artist}\0${model.variant}`).digest();
  return palettes[digest[0] % palettes.length];
}

function communityMarkSvg({ x, y, scale = 1, fill = "#ffffff", opacity = 1 } = {}) {
  const outer = Array.from({ length: 12 }, (_, index) => `<g transform="rotate(${index * 30}) translate(0 -350)"><circle cx="0" cy="-44" r="24"/><path d="M-50 44C-49 6-28-16 0-16S49 6 50 44C19 35-19 35-50 44Z"/></g>`).join("");
  const inner = Array.from({ length: 8 }, (_, index) => `<g transform="rotate(${index * 45}) translate(0 -190)"><circle cx="0" cy="-35" r="19"/><path d="M-40 35C-39 5-22-13 0-13S39 5 40 35C15 28-15 28-40 35Z"/></g>`).join("");
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="${fill}" opacity="${opacity}">${outer}${inner}</g>`;
}

function safeArtworkDataUri(value) {
  return typeof value === "string"
    && value.length <= 3 * 1024 * 1024
    && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/u.test(value)
    ? value : "";
}

const ARTWORK_PRESERVE_ASPECT_RATIOS = new Set([
  "xMinYMin slice",
  "xMinYMid slice",
  "xMidYMid slice",
  "xMidYMin slice",
  "xMaxYMin slice",
  "xMaxYMid slice",
]);

function artworkCropAlignment(candidate) {
  const focalPoint = artworkCandidate(candidate)?.focalPoint;
  if (!focalPoint) return "xMidYMid slice";
  const horizontal = focalPoint.x < 0.34 ? "xMin" : focalPoint.x > 0.66 ? "xMax" : "xMid";
  const vertical = focalPoint.y < 0.4 ? "YMin" : "YMid";
  return `${horizontal}${vertical} slice`;
}

function artworkImage(dataUri, {
  x,
  y,
  width,
  height,
  clipId,
  preserveAspectRatio = "xMidYMid slice",
}) {
  const safe = safeArtworkDataUri(dataUri);
  const safePreserveAspectRatio = ARTWORK_PRESERVE_ASPECT_RATIOS.has(preserveAspectRatio)
    ? preserveAspectRatio
    : "xMidYMid slice";
  return safe
    ? `<image href="${safe}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="${safePreserveAspectRatio}" clip-path="url(#${clipId})"/>`
    : "";
}

function shareSvgDefs(palette, extra = "") {
  return `<defs>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette.start}"/><stop offset="1" stop-color="${palette.end}"/></linearGradient>
    <linearGradient id="photoScrim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#08070a" stop-opacity="0.03"/><stop offset="0.58" stop-color="#08070a" stop-opacity="0.18"/><stop offset="1" stop-color="#08070a" stop-opacity="0.96"/></linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="22" stdDeviation="24" flood-color="#000000" flood-opacity="0.42"/></filter>
    ${extra}
  </defs>`;
}

// Instagram lays its own bars over roughly the top 250 and bottom 340 pixels of
// a story, so everything readable sits inside y 250 to 1560. The reviewer, the
// artist and the rating lead; the brand appears once, on the tear-off stub.
const REVIEW_CARD = Object.freeze({ x: 60, y: 250, width: 960, height: 1310, hero: 620, stubTop: 1430 });

function starPoints(cx, cy, outer, inner) {
  const points = [];
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = (Math.PI / 5) * index - Math.PI / 2;
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(1)},${(cy + radius * Math.sin(angle)).toFixed(1)}`);
  }
  return points.join(" ");
}

function reviewStarsSvg(rating, { x, cy, outer = 26, inner = 11, gap = 12, fill = "#ffb347", empty = "#3a3642" }) {
  const halves = Math.max(0, Math.min(10, Math.round(Number(rating) * 2)));
  let svg = "";
  for (let index = 0; index < 5; index += 1) {
    const cx = x + outer + index * (outer * 2 + gap);
    const points = starPoints(cx, cy, outer, inner);
    svg += `<polygon points="${points}" fill="${empty}"/>`;
    const filledHalves = Math.max(0, Math.min(2, halves - index * 2));
    if (filledHalves === 2) svg += `<polygon points="${points}" fill="${fill}"/>`;
    else if (filledHalves === 1) {
      svg += `<clipPath id="halfStar${index}"><rect x="${cx - outer}" y="${cy - outer}" width="${outer}" height="${outer * 2}"/></clipPath>`
        + `<polygon points="${points}" fill="${fill}" clip-path="url(#halfStar${index})"/>`;
    }
  }
  return { svg, width: 5 * outer * 2 + 4 * gap };
}

function reviewShareSvg(model, artworkDataUri) {
  const palette = paletteFor(model);
  const hasArtwork = !!safeArtworkDataUri(artworkDataUri);
  const card = REVIEW_CARD;
  const left = card.x + 44;
  const right = card.x + card.width - 44;
  const heroBottom = card.y + card.hero;
  const reviewer = /^an mshpit member$/iu.test(String(model.kicker || "")) || !model.kicker ? "A Mshpit member" : model.kicker;
  const artistLines = wrapMeasuredLines(model.artist, { maxWidth: 872, fontSize: 84, letterSpacing: -1.5, maxLines: 2 });
  const subtitleLines = wrapMeasuredLines(model.subtitle, { maxWidth: 872, fontSize: 32, maxLines: 1 });
  const reviewerLines = wrapMeasuredLines(`${reviewer}'s review`, { maxWidth: 872, fontSize: 36, maxLines: 1 });
  const quoteLines = wrapMeasuredLines(model.quote, { maxWidth: 800, fontSize: 36, maxLines: 4 });
  const metaLines = wrapMeasuredLines([model.venue, model.place, model.date].filter(Boolean).join(" · ") || "Details on Mshpit", { maxWidth: 872, fontSize: 28, maxLines: 2 });
  const lastArtistBaseline = subtitleLines.length ? heroBottom - 70 : heroBottom - 36;
  const artistY = lastArtistBaseline - (artistLines.length - 1) * 88;
  const rating = Number(model.rating);
  const hasRating = Number.isFinite(rating) && rating > 0;
  const stars = hasRating ? reviewStarsSvg(rating, { x: left, cy: 1034 }) : null;
  const quoteTop = hasRating ? 1150 : 1060;
  // Measured from the last quote baseline, so a four-line quote and two meta
  // lines still clear the tear line at stubTop.
  const metaTop = quoteLines.length ? quoteTop + (quoteLines.length - 1) * 50 + 64 : quoteTop;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  ${shareSvgDefs(palette, `<clipPath id="reviewCard"><rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.height}" rx="40"/></clipPath><clipPath id="reviewHero"><rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.hero}"/></clipPath>`)}
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#0b0815"/>
  <rect x="0" y="0" width="${CARD_WIDTH}" height="12" fill="url(#accent)"/>
  <g data-layout="review-photo" filter="url(#shadow)" clip-path="url(#reviewCard)">
    <rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.height}" rx="40" fill="#0f0d14"/>
    <rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.hero}" fill="#17141d"/>
    ${artworkImage(artworkDataUri, { x: card.x, y: card.y, width: card.width, height: card.hero, clipId: "reviewHero" })}
    ${hasArtwork ? "" : `<rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.hero}" fill="url(#accent)" data-hero="no-photo"/>${communityMarkSvg({ x: card.x + card.width - 170, y: card.y + 220, scale: 0.42, opacity: 0.16 })}`}
    <rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.hero}" fill="url(#photoScrim)"/>
  </g>
  ${svgTextLines(artistLines, { x: left, y: artistY, lineHeight: 88, fontSize: 84, fill: "#fff8ee", weight: 900, letterSpacing: -1.5 })}
  ${svgTextLines(subtitleLines, { x: left + 2, y: heroBottom - 26, lineHeight: 40, fontSize: 32, fill: palette.end, weight: 800 })}
  ${svgTextLines(reviewerLines, { x: left, y: heroBottom + 78, lineHeight: 44, fontSize: 36, fill: "#fff8ee", weight: 800 })}
  ${stars ? `<g data-section="review-rating">${stars.svg}<text x="${left + stars.width + 26}" y="1056" fill="#fff8ee" font-family="Arial, Helvetica, sans-serif" font-size="64" font-weight="900">${escapeXml(model.rating)}<tspan fill="#8d8a96" font-size="32" font-weight="700" dx="10">/ 5</tspan></text></g>` : ""}
  ${quoteLines.length ? `<text x="${left - 4}" y="${quoteTop + 22}" fill="${palette.end}" font-family="Georgia, Times New Roman, serif" font-size="84" font-weight="900">“</text>${svgTextLines(quoteLines, { x: left + 50, y: quoteTop, lineHeight: 50, fontSize: 36, fill: "#e3dfd6", weight: 600 })}` : ""}
  ${svgTextLines(metaLines, { x: left, y: metaTop, lineHeight: 38, fontSize: 28, fill: "#a9a5b1", weight: 700 })}
  <line x1="${card.x + 30}" y1="${card.stubTop}" x2="${card.x + card.width - 30}" y2="${card.stubTop}" stroke="#3d3a46" stroke-width="3" stroke-dasharray="10 12"/>
  <circle cx="${card.x}" cy="${card.stubTop}" r="22" fill="#0b0815"/><circle cx="${card.x + card.width}" cy="${card.stubTop}" r="22" fill="#0b0815"/>
  ${communityMarkSvg({ x: left + 22, y: card.stubTop + 66, scale: 0.07, opacity: 1 })}
  <text x="${left + 64}" y="${card.stubTop + 77}" fill="#fff8ee" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="900" letter-spacing="7">MSHPIT</text>
  <text x="${right}" y="${card.stubTop + 76}" text-anchor="end" fill="${palette.end}" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="800">Read it on mshpit.com</text>
</svg>`;
}

// The attendance ticket shares the review card's frame and safe area. It gives
// the photo more room, since an upcoming show has no rating or quote to carry.
const ATTENDANCE_CARD = Object.freeze({ x: 60, y: 250, width: 960, height: 1310, hero: 700, stubTop: 1410 });

function attendanceShareSvg(model, artworkDataUri, selectedArtwork = null) {
  const palette = paletteFor(model);
  const hasArtwork = !!safeArtworkDataUri(artworkDataUri);
  const card = ATTENDANCE_CARD;
  const left = card.x + 44;
  const right = card.x + card.width - 44;
  const heroBottom = card.y + card.hero;
  const cardBottom = card.y + card.height;
  const column = card.x + card.width / 2 + 20;
  const artistLines = wrapMeasuredLines(model.artist, { maxWidth: 872, fontSize: 84, letterSpacing: -1.5, maxLines: 2 });
  const subtitleLines = wrapMeasuredLines(model.subtitle, { maxWidth: 872, fontSize: 32, maxLines: 1 });
  const subtitleY = subtitleLines.length ? heroBottom - 40 : 0;
  const lastArtistBaseline = subtitleLines.length ? heroBottom - 90 : heroBottom - 48;
  const artistY = lastArtistBaseline - (artistLines.length - 1) * 88;
  const memberLines = wrapMeasuredLines(model.kicker, { maxWidth: 872, fontSize: 36, maxLines: 1 });
  const dateLines = wrapMeasuredLines(model.date || "Date to be announced", { maxWidth: 380, fontSize: 44, maxLines: 1 });
  const timeLines = wrapMeasuredLines(model.time, { maxWidth: 380, fontSize: 34, maxLines: 1 });
  const venueLines = wrapMeasuredLines(model.venue || "Details on Mshpit", { maxWidth: 400, fontSize: 40, maxLines: 2 });
  const placeLines = wrapMeasuredLines(model.place, { maxWidth: 400, fontSize: 28, maxLines: 1 });
  const detailTop = heroBottom + 170;
  const placeY = detailTop + 54 + venueLines.length * 48;
  const stampText = model.variant === "going" ? "GOING" : "INTERESTED";
  const stampWidth = Math.round(estimatedTextWidth(stampText, { fontSize: 40, letterSpacing: 5 }) + 72);
  const stampX = right - stampWidth + 12;
  const stampY = card.stubTop - 52;
  const cropAlignment = artworkCropAlignment(selectedArtwork);
  const register = model.variant === "going"
    ? `<rect x="${card.x}" y="${card.y}" width="420" height="10" fill="#ff5a3d"/><rect x="${card.x + 420}" y="${card.y}" width="300" height="10" fill="#b82d8e"/><rect x="${card.x + 720}" y="${card.y}" width="240" height="10" fill="#3f74ce"/>`
    : `<rect x="${card.x}" y="${card.y}" width="480" height="10" fill="${palette.start}"/><rect x="${card.x + 480}" y="${card.y}" width="480" height="10" fill="${palette.end}"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  ${shareSvgDefs(palette, `<clipPath id="attendanceCard"><rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.height}" rx="40"/></clipPath><clipPath id="attendanceHero"><rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.hero}"/></clipPath><clipPath id="attendanceHeroCopy"><rect x="${card.x + 20}" y="${card.y + 30}" width="${card.width - 40}" height="${card.hero - 40}"/></clipPath><clipPath id="attendancePlace"><rect x="${column}" y="${detailTop - 10}" width="${right - column}" height="${card.stubTop - detailTop - 60}"/></clipPath>`)}
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#0b0715"/>
  <rect x="0" y="0" width="${CARD_WIDTH}" height="12" fill="url(#accent)"/>
  <g data-layout="attendance-ticket" filter="url(#shadow)" clip-path="url(#attendanceCard)">
    <rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.height}" rx="40" fill="#1d1434"/>
    <rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.hero}" fill="#121018"/>
    ${hasArtwork ? `${artworkImage(artworkDataUri, { x: card.x, y: card.y, width: card.width, height: card.hero, clipId: "attendanceHero", preserveAspectRatio: cropAlignment })}<rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.hero}" fill="url(#photoScrim)"/>` : `<rect x="${card.x}" y="${heroBottom - 8}" width="${card.width}" height="8" fill="url(#accent)"/>`}
    ${register}
    <rect x="${card.x}" y="${card.stubTop}" width="${card.width}" height="${cardBottom - card.stubTop}" fill="#251940"/>
  </g>
  <g data-section="attendance-hero-copy" data-artist-y="${artistY}" data-artist-lines="${artistLines.length}" data-subtitle-y="${subtitleY}" data-subtitle-lines="${subtitleLines.length}" data-hero-bottom="${heroBottom}" clip-path="url(#attendanceHeroCopy)">
    ${svgTextLines(artistLines, { x: left, y: artistY, lineHeight: 88, fontSize: 84, fill: "#fff8ee", weight: 900, letterSpacing: -1.5 })}
    ${svgTextLines(subtitleLines, { x: left + 2, y: subtitleY, lineHeight: 40, fontSize: 32, fill: palette.start, weight: 800 })}
  </g>
  <g data-section="attendance-meta" data-detail-top="${detailTop}">
    ${svgTextLines(memberLines, { x: left, y: heroBottom + 78, lineHeight: 44, fontSize: 36, fill: "#fff8ee", weight: 800 })}
    <line x1="${left}" y1="${heroBottom + 112}" x2="${right}" y2="${heroBottom + 112}" stroke="#3b2f52" stroke-width="2"/>
    <text x="${left}" y="${detailTop}" fill="#a79fb8" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700">Date</text>
    ${svgTextLines(dateLines, { x: left, y: detailTop + 54, lineHeight: 50, fontSize: 44, fill: "#fff8ee", weight: 900 })}
    ${svgTextLines(timeLines, { x: left, y: detailTop + 102, lineHeight: 40, fontSize: 34, fill: "#ddd6e8", weight: 700 })}
    <line x1="${column - 30}" y1="${detailTop - 30}" x2="${column - 30}" y2="${detailTop + 150}" stroke="#3b2f52" stroke-width="2"/>
    <text x="${column}" y="${detailTop}" fill="#a79fb8" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700">Where</text>
    <g clip-path="url(#attendancePlace)">
      ${svgTextLines(venueLines, { x: column, y: detailTop + 54, lineHeight: 48, fontSize: 40, fill: "#fff8ee", weight: 900 })}
      ${svgTextLines(placeLines, { x: column, y: placeY, lineHeight: 36, fontSize: 28, fill: "#b9b2c6", weight: 700 })}
    </g>
  </g>
  <line x1="${card.x + 30}" y1="${card.stubTop}" x2="${card.x + card.width - 30}" y2="${card.stubTop}" stroke="#6a5a86" stroke-width="3" stroke-dasharray="10 12"/>
  <circle cx="${card.x}" cy="${card.stubTop}" r="22" fill="#0b0715"/><circle cx="${card.x + card.width}" cy="${card.stubTop}" r="22" fill="#0b0715"/>
  <g data-section="attendance-stamp" transform="rotate(-6 ${stampX + stampWidth / 2} ${stampY + 52})" opacity="0.92">
    <rect x="${stampX}" y="${stampY}" width="${stampWidth}" height="104" rx="22" fill="#1d1434" fill-opacity="0.55" stroke="${palette.start}" stroke-width="6"/>
    <rect x="${stampX + 10}" y="${stampY + 10}" width="${stampWidth - 20}" height="84" rx="14" fill="none" stroke="${palette.start}" stroke-width="2"/>
    <text x="${stampX + stampWidth / 2}" y="${stampY + 67}" text-anchor="middle" fill="${palette.start}" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="900" letter-spacing="5">${stampText}</text>
  </g>
  ${communityMarkSvg({ x: left + 22, y: card.stubTop + 66, scale: 0.07, opacity: 1 })}
  <text x="${left + 64}" y="${card.stubTop + 77}" fill="#fff8ee" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="900" letter-spacing="7">MSHPIT</text>
  <text x="${left}" y="${card.stubTop + 124}" fill="${palette.start}" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="800">See it on mshpit.com</text>
  <text x="${right}" y="${card.stubTop + 124}" text-anchor="end" fill="#8f86a3" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700">Not valid for entry</text>
</svg>`;
}

export function socialShareCardSvg(model, { artworkDataUri = "", artwork = null } = {}) {
  if (!model || !COPY[model.variant]) throw new TypeError("A valid social share-card model is required");
  return model.variant === "review"
    ? reviewShareSvg(model, artworkDataUri)
    : attendanceShareSvg(model, artworkDataUri, artwork);
}

async function preparedArtworkDataUri(bytes, sharpFactory) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12 || bytes.length > MAX_ARTWORK_INPUT_BYTES) return "";
  const pipeline = sharpFactory(bytes, {
    animated: false,
    failOn: "warning",
    limitInputPixels: MAX_ARTWORK_INPUT_PIXELS,
    sequentialRead: true,
  });
  const metadata = await pipeline.metadata();
  const width = Number(metadata?.width);
  const height = Number(metadata?.height);
  const pixels = width * height;
  if (!["jpeg", "png", "webp"].includes(metadata?.format)
    || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1 || !Number.isSafeInteger(pixels)
    || pixels > MAX_ARTWORK_INPUT_PIXELS || Number(metadata?.pages || 1) !== 1) return "";
  const normalized = await pipeline
    .rotate()
    // Keep the source aspect ratio here. The SVG is the one authoritative crop
    // boundary, so its explicit top/centre alignment can preserve faces instead
    // of receiving an image that was already irreversibly centre-cropped.
    .resize({
      width: 1000,
      height: 1000,
      fit: "inside",
      withoutEnlargement: false,
    })
    .jpeg({ quality: 82 })
    .toBuffer();
  if (!Buffer.isBuffer(normalized) || normalized.length < 12 || normalized.length > 1_500_000) return "";
  return `data:image/jpeg;base64,${normalized.toString("base64")}`;
}

export async function renderSocialShareCardResult(model, options = {}) {
  const sharpFactory = typeof options === "function" ? options : options?.sharpFactory || sharp;
  let artworkDataUri = safeArtworkDataUri(options?.artworkDataUri);
  if (!artworkDataUri && Buffer.isBuffer(options?.artworkBytes)) {
    try {
      artworkDataUri = await preparedArtworkDataUri(options.artworkBytes, sharpFactory);
    } catch {
      // architecture: allow-empty-catch -- untrusted optional artwork must degrade to the complete no-photo card.
      artworkDataUri = "";
    }
  }
  let acceptedArtwork = artworkDataUri ? artworkCandidate(options?.artwork) : null;
  let xmp = null;
  if (artworkDataUri && options?.artwork?.source === "licensed-media" && !acceptedArtwork) {
    artworkDataUri = "";
  }
  if (acceptedArtwork?.source === "licensed-media") {
    const creditUrl = absolutePhotoCreditUrl(acceptedArtwork.creditPath);
    xmp = licensedArtworkXmp({ artwork: acceptedArtwork, creditUrl });
    if (!xmp) {
      // A third-party photo without a complete registered attribution record
      // is never composited into pixels. Higher-level rendering can try the
      // next candidate; the low-level helper produces the clean no-photo card.
      artworkDataUri = "";
      acceptedArtwork = null;
    }
  }
  const svg = socialShareCardSvg(model, {
    artworkDataUri,
    artwork: acceptedArtwork,
  });
  let pipeline = sharpFactory(Buffer.from(svg, "utf8"), {
    limitInputPixels: CARD_WIDTH * CARD_HEIGHT,
  });
  if (xmp) pipeline = pipeline.withXmp(xmp);
  const output = await pipeline.png({
    adaptiveFiltering: true,
    compressionLevel: 9,
  }).toBuffer();
  if (!Buffer.isBuffer(output) || output.length < 100 || output.length > MAX_RENDER_BYTES) {
    throw new Error("Social share card renderer returned invalid bytes");
  }
  return Object.freeze({
    bytes: output,
    artworkApplied: !!artworkDataUri,
    artwork: acceptedArtwork,
  });
}

export async function renderSocialShareCardPng(model, options = {}) {
  return (await renderSocialShareCardResult(model, options)).bytes;
}

export function socialShareCardEtag(model) {
  const digest = createHash("sha256").update(JSON.stringify(model)).digest("base64url").slice(0, 32);
  return `"pit-share-${digest}"`;
}

function createLruBufferCache({ maxEntries = DEFAULT_CACHE_ENTRIES, maxBytes = DEFAULT_CACHE_BYTES } = {}) {
  const rows = new Map();
  let totalBytes = 0;
  const bytesFor = (value) => Buffer.isBuffer(value) ? value : value?.bytes;
  return {
    get(key) {
      const value = rows.get(key);
      if (!value) return null;
      rows.delete(key);
      rows.set(key, value);
      return value;
    },
    set(key, value) {
      const bytes = bytesFor(value);
      if (!Buffer.isBuffer(bytes) || bytes.length > maxBytes) return;
      const previous = rows.get(key);
      if (previous) totalBytes -= bytesFor(previous)?.length || 0;
      rows.delete(key);
      rows.set(key, value);
      totalBytes += bytes.length;
      while (rows.size > maxEntries || totalBytes > maxBytes) {
        const oldest = rows.entries().next().value;
        if (!oldest) break;
        rows.delete(oldest[0]);
        totalBytes -= bytesFor(oldest[1])?.length || 0;
      }
    },
  };
}

function createExpiringKeyCache({ maxEntries = DEFAULT_TRANSIENT_FAILURE_CACHE_ENTRIES } = {}) {
  const rows = new Map();
  return {
    get(key, now) {
      const expiresAt = rows.get(key);
      if (!Number.isFinite(expiresAt) || expiresAt <= now) {
        rows.delete(key);
        return false;
      }
      rows.delete(key);
      rows.set(key, expiresAt);
      return true;
    },
    set(key, expiresAt) {
      if (!Number.isFinite(expiresAt)) return;
      rows.delete(key);
      rows.set(key, expiresAt);
      while (rows.size > maxEntries) {
        const oldest = rows.keys().next().value;
        if (oldest == null) break;
        rows.delete(oldest);
      }
    },
  };
}

function requestAbortReason(signal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("The share-card request was aborted.", "AbortError");
}

function waitForSharedOperation(operation, signal) {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(requestAbortReason(signal));
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(requestAbortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function boundedWorkTimeout(value) {
  return Math.max(
    500,
    Math.min(10_000, Number(value) || DEFAULT_TOTAL_WORK_TIMEOUT_MS),
  );
}

export function createSocialShareCardRenderer({
  loadArtwork = loadShareArtwork,
  renderPng = renderIsolatedSocialShareCard,
  maxConcurrentRenders = DEFAULT_MAX_CONCURRENT_RENDERS,
  maxQueuedRenders = 4,
  maxConcurrentArtworkLoads = DEFAULT_MAX_CONCURRENT_ARTWORK_LOADS,
  cache = createLruBufferCache(),
  transientFailureCache = createExpiringKeyCache(),
  transientFailureCacheTtlMs = DEFAULT_TRANSIENT_FAILURE_CACHE_TTL_MS,
  totalWorkTimeoutMs = DEFAULT_TOTAL_WORK_TIMEOUT_MS,
  now = Date.now,
  acquireMemoryLease = (options) => acquireMemoryWork("share", options),
} = {}) {
  if (typeof loadArtwork !== "function") throw new TypeError("A social share-card artwork loader is required");
  if (typeof renderPng !== "function") throw new TypeError("A social share-card renderer is required");
  if (typeof now !== "function") throw new TypeError("A social share-card cache clock is required");
  const renderLimit = Math.max(1, Number(maxConcurrentRenders) || DEFAULT_MAX_CONCURRENT_RENDERS);
  const artworkLoadLimit = Math.max(
    1,
    Number(maxConcurrentArtworkLoads) || DEFAULT_MAX_CONCURRENT_ARTWORK_LOADS,
  );
  const transientFailureTtl = Math.max(
    1_000,
    Math.min(30_000, Number(transientFailureCacheTtlMs) || DEFAULT_TRANSIENT_FAILURE_CACHE_TTL_MS),
  );
  const workTimeout = boundedWorkTimeout(totalWorkTimeoutMs);
  const renderQueueLimit = Math.max(1, Math.min(16, Math.trunc(Number(maxQueuedRenders) || 4)));
  const inFlight = new Map();
  let activeRenders = 0;
  const renderWaiters = [];
  let activeArtworkLoads = 0;

  const releaseRenderSlot = () => {
    activeRenders = Math.max(0, activeRenders - 1);
    while (activeRenders < renderLimit && renderWaiters.length) {
      const waiter = renderWaiters.shift();
      waiter.signal?.removeEventListener("abort", waiter.onAbort);
      if (waiter.signal?.aborted) continue;
      activeRenders += 1;
      waiter.resolve(releaseRenderSlot);
    }
  };

  const acquireRenderSlot = (signal) => {
    if (signal?.aborted) return Promise.reject(requestAbortReason(signal));
    if (activeRenders < renderLimit && !renderWaiters.length) {
      activeRenders += 1;
      return Promise.resolve(releaseRenderSlot);
    }
    if (renderWaiters.length >= renderQueueLimit) return Promise.reject(new SocialShareCardBusyError());
    return new Promise((resolve, reject) => {
      const waiter = { signal, resolve, reject, onAbort: null };
      waiter.onAbort = () => {
        const index = renderWaiters.indexOf(waiter);
        if (index < 0) return;
        renderWaiters.splice(index, 1);
        signal.removeEventListener("abort", waiter.onAbort);
        reject(requestAbortReason(signal));
      };
      renderWaiters.push(waiter);
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      if (signal?.aborted) waiter.onAbort();
    });
  };

  const withRenderAdmission = async (task, { signal = null, retainedBytes = 0 } = {}) => {
    const releaseSlot = await acquireRenderSlot(signal);
    let lease = null;
    try {
      lease = await Promise.resolve(acquireMemoryLease({
        signal,
        timeoutMs: workTimeout,
        retainedBytes,
        priority: "interactive",
      }));
      if (!lease) throw new SocialShareCardBusyError();
      if (signal?.aborted) throw requestAbortReason(signal);
      return await task();
    } finally {
      lease?.release();
      releaseSlot();
    }
  };

  const withArtworkLoadAdmission = async (task) => {
    if (activeArtworkLoads >= artworkLoadLimit) throw new SocialShareCardBusyError();
    activeArtworkLoads += 1;
    try {
      return await task();
    } finally {
      activeArtworkLoads = Math.max(0, activeArtworkLoads - 1);
    }
  };

  const renderAcceptedArtwork = async (model, bytes, artwork, signal) => withRenderAdmission(async () => {
    if (signal?.aborted) throw requestAbortReason(signal);
    const acceptedArtwork = artworkCandidate(artwork);
    if (!acceptedArtwork) return null;
    if (renderPng === renderIsolatedSocialShareCard) {
      let rendered;
      try {
        rendered = await renderPng(model, { artworkBytes: bytes, artwork: acceptedArtwork, signal });
      } catch (error) {
        if (signal?.aborted) throw requestAbortReason(signal);
        throw new SocialShareCardRenderError(error);
      }
      if (rendered?.artworkApplied !== true) return null;
      return Object.freeze({ [PREPARED_ARTWORK_RENDER]: true, artworkBytes: null,
        artworkDataUri: "", artwork: acceptedArtwork, rendered });
    }
    let artworkDataUri = "";
    try {
      artworkDataUri = await preparedArtworkDataUri(bytes, sharp);
    } catch (error) {
      // architecture: allow-ambiguous-result -- an optional untrusted candidate decode failure tells the loader to try the next trusted photo.
      return null;
    }
    if (!artworkDataUri) return null;
    if (signal?.aborted) throw requestAbortReason(signal);
    let rendered = null;
    try {
      rendered = await renderPng(model, { artworkDataUri, artwork: acceptedArtwork, signal });
    } catch (error) {
      if (signal?.aborted) throw requestAbortReason(signal);
      throw new SocialShareCardRenderError(error);
    }
    if (signal?.aborted) throw requestAbortReason(signal);
    return Object.freeze({
      [PREPARED_ARTWORK_RENDER]: true,
      artworkBytes: null,
      artworkDataUri,
      artwork: acceptedArtwork,
      rendered,
    });
  }, { signal, retainedBytes: Buffer.isBuffer(bytes) ? bytes.byteLength : 0 });

  const renderLoadedArtwork = async (model, loaded, signal) => {
    if (loaded?.[PREPARED_ARTWORK_RENDER] === true) return loaded;
    if (signal?.aborted) throw requestAbortReason(signal);
    const artworkBytes = Buffer.isBuffer(loaded) ? loaded : null;
    const artworkDataUri = safeArtworkDataUri(loaded);
    const rendered = await withRenderAdmission(() => renderPng(model, {
      artworkBytes,
      artworkDataUri,
      signal,
    }), { signal, retainedBytes: artworkBytes?.byteLength || Buffer.byteLength(artworkDataUri || "", "utf8") });
    if (signal?.aborted) throw requestAbortReason(signal);
    return { artworkBytes, artworkDataUri, artwork: null, rendered };
  };

  return Object.freeze({
    async render(model, { signal = null } = {}) {
      if (signal?.aborted) throw requestAbortReason(signal);
      const etag = socialShareCardEtag(model);
      const cached = cache.get(etag);
      if (cached) {
        const bytes = Buffer.isBuffer(cached) ? cached : cached?.bytes;
        const artwork = Buffer.isBuffer(cached) ? null : artworkCandidate(cached?.artwork);
        if (Buffer.isBuffer(bytes)) return { bytes, etag, artwork };
      }
      const currentTime = Number(now());
      if (transientFailureCache.get(etag, Number.isFinite(currentTime) ? currentTime : Date.now())) {
        throw new SocialShareCardArtworkUnavailableError();
      }
      const existing = inFlight.get(etag);
      if (existing) return waitForSharedOperation(existing, signal);
      const hasArtworkCandidates = Array.isArray(model?.artwork) && model.artwork.length > 0;
      const requiresArtwork = model?.variant === "going" || model?.variant === "interested";
      const workController = new AbortController();
      const timeout = setTimeout(() => {
        workController.abort(new SocialShareCardArtworkUnavailableError());
      }, workTimeout);
      timeout.unref?.();
      const coreOperation = Promise.resolve()
        .then(() => {
          if (requiresArtwork && !hasArtworkCandidates) {
            throw new SocialShareCardArtworkUnavailableError();
          }
          return hasArtworkCandidates
            ? withArtworkLoadAdmission(() => loadArtwork(model.artwork, {
                acceptBytes: (bytes, artwork) =>
                  renderAcceptedArtwork(model, bytes, artwork, workController.signal),
                acceptErrorIsTerminal: (error) =>
                  !(error instanceof SocialShareCardBusyError)
                  && !(error instanceof SocialShareCardRenderError),
                signal: workController.signal,
              }))
            : null;
        })
        .then((loaded) => {
          if (requiresArtwork && !loaded) {
            throw new SocialShareCardArtworkUnavailableError();
          }
          return renderLoadedArtwork(model, loaded, workController.signal);
        })
        .then(({ artworkBytes, artworkDataUri, artwork, rendered }) => {
          if (requiresArtwork && !artworkDataUri && rendered?.artworkApplied !== true) {
            throw new SocialShareCardArtworkUnavailableError();
          }
          const bytes = Buffer.isBuffer(rendered) ? rendered : rendered?.bytes;
          if (!Buffer.isBuffer(bytes) || bytes.length < 100 || bytes.length > MAX_RENDER_BYTES) {
            throw new Error("Invalid social share card render");
          }
          const acceptedArtwork = artworkCandidate(rendered?.artwork) || artworkCandidate(artwork);
          cache.set(etag, Object.freeze({ bytes, artwork: acceptedArtwork }));
          return { bytes, etag, artwork: acceptedArtwork };
        })
        .catch((error) => {
          if (!(error instanceof ShareArtworkTransientError)
            && !(error instanceof SocialShareCardArtworkUnavailableError)) throw error;
          const failureTime = Number(now());
          const normalizedFailureTime = Number.isFinite(failureTime) ? failureTime : Date.now();
          transientFailureCache.set(etag, normalizedFailureTime + transientFailureTtl);
          throw error instanceof SocialShareCardArtworkUnavailableError
            ? error
            : new SocialShareCardArtworkUnavailableError(error);
        });
      // The deadline belongs to the shared work, not to any one caller. The
      // underlying task remains observed and keeps its admission slot until it
      // really settles, while waiters receive a bounded retryable response if
      // a fetch/decoder or native render temporarily ignores abort.
      const operation = waitForSharedOperation(coreOperation, workController.signal)
        .catch((error) => {
          if (!(error instanceof SocialShareCardArtworkUnavailableError)) throw error;
          const failureTime = Number(now());
          const normalizedFailureTime = Number.isFinite(failureTime) ? failureTime : Date.now();
          transientFailureCache.set(etag, normalizedFailureTime + transientFailureTtl);
          throw error;
        })
        .finally(() => {
          clearTimeout(timeout);
          inFlight.delete(etag);
        });
      inFlight.set(etag, operation);
      // Keep the shared operation observed if its only request waiter aborts;
      // active callers still receive the original rejection through their
      // individual waitForSharedOperation promise.
      // architecture: allow-empty-catch -- shared operation remains observed after all request waiters abort; errors are delivered through waiter promises.
      void operation.catch(() => {});
      return waitForSharedOperation(operation, signal);
    },
  });
}

export const socialShareCardConstants = Object.freeze({
  artworkInputBytes: MAX_ARTWORK_INPUT_BYTES,
  artworkInputPixels: MAX_ARTWORK_INPUT_PIXELS,
  canonicalOrigin: CANONICAL_ORIGIN,
  height: CARD_HEIGHT,
  maxConcurrentArtworkLoads: DEFAULT_MAX_CONCURRENT_ARTWORK_LOADS,
  maxConcurrentRenders: DEFAULT_MAX_CONCURRENT_RENDERS,
  maxBytes: MAX_RENDER_BYTES,
  totalWorkTimeoutMs: DEFAULT_TOTAL_WORK_TIMEOUT_MS,
  transientFailureCacheTtlMs: DEFAULT_TRANSIENT_FAILURE_CACHE_TTL_MS,
  version: CARD_VERSION,
  width: CARD_WIDTH,
});
