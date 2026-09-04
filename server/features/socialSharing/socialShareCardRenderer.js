import { createHash } from "node:crypto";

import sharp from "sharp";

import { eventPath, postPath } from "../../../src/domain/urls.mjs";
import { isStrictCalendarDate } from "../seo/publicEntityPolicy.js";
import {
  loadShareArtwork,
  ShareArtworkTransientError,
} from "./socialShareArtwork.js";

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1920;
const CARD_VERSION = "mshpit-social-story-v5";
const CANONICAL_ORIGIN = "https://www.mshpit.com";
const MAX_RENDER_BYTES = 4 * 1024 * 1024;
const MAX_ARTWORK_INPUT_BYTES = 6 * 1024 * 1024;
const MAX_ARTWORK_INPUT_PIXELS = 12_000_000;
const DEFAULT_CACHE_ENTRIES = 160;
const DEFAULT_CACHE_BYTES = 48 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT_RENDERS = 1;
const DEFAULT_MAX_CONCURRENT_ARTWORK_LOADS = 4;
const DEFAULT_TRANSIENT_FAILURE_CACHE_ENTRIES = 160;
const DEFAULT_TRANSIENT_FAILURE_CACHE_TTL_MS = 5_000;
const DEFAULT_TOTAL_WORK_TIMEOUT_MS = 4_000;
const PREPARED_ARTWORK_RENDER = Symbol("preparedArtworkRender");

const COPY = Object.freeze({
  going: Object.freeze({ label: "GOING", kicker: "A SHOW WORTH COUNTING DOWN TO" }),
  interested: Object.freeze({ label: "INTERESTED", kicker: "ONE TO KEEP ON THE CALENDAR" }),
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
  }
}

export class SocialShareCardArtworkUnavailableError extends Error {
  constructor() {
    super("Social share card artwork is temporarily unavailable");
    this.name = "SocialShareCardArtworkUnavailableError";
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

function artworkCandidate(value, source) {
  if (source !== "owned-media" || typeof value !== "string") return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.hash) return null;
    return Object.freeze({ url: parsed.toString(), source });
  } catch {
    return null;
  }
}

function normalizedArtwork(candidates) {
  const unique = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const normalized = artworkCandidate(candidate?.url, candidate?.source);
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
      ? `${author} IS ${intent === "going" ? "GOING" : "INTERESTED"}`
      : COPY[intent].kicker,
    statement: intent === "going"
      ? `${author || "A Mshpit fan"} is going to ${artist}${subtitle ? ` for ${subtitle}` : ""}.`
      : `${author || "A Mshpit fan"} is interested in ${artist}${subtitle ? ` — ${subtitle}` : ""}.`,
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

function artworkImage(dataUri, { x, y, width, height, clipId }) {
  const safe = safeArtworkDataUri(dataUri);
  return safe
    ? `<image href="${safe}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`
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

function reviewShareSvg(model, artworkDataUri) {
  const palette = paletteFor(model);
  const hasArtwork = !!safeArtworkDataUri(artworkDataUri);
  const kickerLines = wrapMeasuredLines(model.kicker, {
    maxWidth: 700, fontSize: 18, letterSpacing: 3, maxLines: 1, monospace: true,
  });
  const artistLines = wrapMeasuredLines(model.artist, {
    maxWidth: 904, fontSize: 74, letterSpacing: -1.5, maxLines: 2,
  });
  const subtitleLines = wrapMeasuredLines(model.subtitle, {
    maxWidth: 904, fontSize: 30, maxLines: 2,
  });
  const quoteLines = wrapMeasuredLines(model.quote, {
    maxWidth: 820, fontSize: 29, maxLines: 4,
  });
  const artistY = artistLines.length > 1 ? 735 : 790;
  const subtitleY = artistY + (artistLines.length * 80) + 18;
  const placeLine = [model.venue, model.place].filter(Boolean).join(" · ");
  const scheduleLine = [model.date, model.time].filter(Boolean).join(" · ");
  const placeLines = wrapMeasuredLines(placeLine || "DETAILS ON MSHPIT", {
    maxWidth: 430, fontSize: 27, maxLines: 2,
  });
  const scheduleLines = wrapMeasuredLines(scheduleLine || "OPEN FOR DETAILS", {
    maxWidth: 400, fontSize: 27, maxLines: 1,
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  ${shareSvgDefs(palette, '<clipPath id="reviewCard"><rect x="40" y="190" width="1000" height="1460" rx="42"/></clipPath><clipPath id="reviewHero"><rect x="40" y="328" width="1000" height="632"/></clipPath>')}
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#0b0815"/>
  <rect x="0" y="0" width="${CARD_WIDTH}" height="12" fill="url(#accent)"/>
  <text x="62" y="104" fill="#fff8ee" font-family="Courier New, monospace" font-size="18" font-weight="800" letter-spacing="4">LIVE MUSIC, REMEMBERED</text>
  <g data-layout="review-photo" filter="url(#shadow)" clip-path="url(#reviewCard)">
    <rect x="40" y="190" width="1000" height="1460" rx="42" fill="#090a0e"/>
    <rect x="40" y="190" width="1000" height="10" fill="url(#accent)"/>
    <rect x="40" y="200" width="1000" height="128" fill="#090a0e"/>
    <rect x="40" y="328" width="1000" height="632" fill="#15121a"/>
    ${artworkImage(artworkDataUri, { x: 40, y: 328, width: 1000, height: 632, clipId: "reviewHero" })}
    ${hasArtwork ? '<rect x="40" y="328" width="1000" height="632" fill="url(#photoScrim)"/>' : '<rect x="40" y="328" width="1000" height="6" fill="url(#accent)" opacity="0.75"/>'}
    <rect x="40" y="960" width="1000" height="690" fill="#090a0e"/>
  </g>
  ${communityMarkSvg({ x: 98, y: 264, scale: 0.075, opacity: 1 })}
  <text x="152" y="273" fill="#fff8ee" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="900" letter-spacing="8">MSHPIT</text>
  <text x="154" y="299" fill="#858895" font-family="Courier New, monospace" font-size="12" font-weight="800" letter-spacing="2.6">LIVE MUSIC, REMEMBERED</text>
  <rect x="814" y="239" width="174" height="50" rx="25" fill="none" stroke="${palette.end}" stroke-width="3"/>
  <text x="901" y="271" text-anchor="middle" fill="${palette.end}" font-family="Courier New, monospace" font-size="17" font-weight="900" letter-spacing="3">${escapeXml(model.label)}</text>
  ${svgTextLines(kickerLines, { x: 88, y: artistY - 72, lineHeight: 24, fontSize: 18, fill: "#d6d1c9", weight: 900, family: "Courier New, monospace", letterSpacing: 3 })}
  ${svgTextLines(artistLines, { x: 84, y: artistY, lineHeight: 80, fontSize: 74, fill: "#fff8ee", weight: 900, letterSpacing: -1.5 })}
  ${svgTextLines(subtitleLines, { x: 88, y: subtitleY, lineHeight: 38, fontSize: 30, fill: palette.end, weight: 800 })}
  <text x="88" y="1022" fill="#858895" font-family="Courier New, monospace" font-size="15" font-weight="900" letter-spacing="2.5">VENUE / CITY</text>
  ${svgTextLines(placeLines, { x: 88, y: 1064, lineHeight: 34, fontSize: 27, fill: "#fff8ee", weight: 800 })}
  <line x1="555" y1="1005" x2="555" y2="1112" stroke="#30323b" stroke-width="2"/>
  <text x="992" y="1022" text-anchor="end" fill="#858895" font-family="Courier New, monospace" font-size="15" font-weight="900" letter-spacing="2.5">DATE / TIME</text>
  <text x="992" y="1066" text-anchor="end" fill="#fff8ee" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="800">${escapeXml(scheduleLines[0] || "OPEN FOR DETAILS")}</text>
  <line x1="88" y1="1152" x2="992" y2="1152" stroke="#30323b" stroke-width="2"/>
  ${model.rating ? `<rect x="88" y="1200" width="78" height="78" rx="20" fill="url(#accent)"/><text x="127" y="1252" text-anchor="middle" fill="#090a0e" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="900">★</text><text x="192" y="1255" fill="#fff8ee" font-family="Courier New, monospace" font-size="58" font-weight="900">${escapeXml(model.rating)}</text><text x="318" y="1248" fill="#858895" font-family="Courier New, monospace" font-size="16" font-weight="800" letter-spacing="2">FAN SCORE / 5</text>` : ""}
  ${quoteLines.length ? `<text x="88" y="1344" fill="${palette.end}" font-family="Arial, Helvetica, sans-serif" font-size="52" font-weight="900">“</text>${svgTextLines(quoteLines, { x: 126, y: 1350, lineHeight: 42, fontSize: 29, fill: "#d7d4cc", weight: 600 })}` : ""}
  <line x1="78" y1="1510" x2="1002" y2="1510" stroke="#3d3f49" stroke-width="2" stroke-dasharray="8 10"/>
  <circle cx="40" cy="1510" r="18" fill="#0b0815"/><circle cx="1040" cy="1510" r="18" fill="#0b0815"/>
  <text x="88" y="1580" fill="#858895" font-family="Courier New, monospace" font-size="16" font-weight="900" letter-spacing="3">OPEN THE REVIEW ON MSHPIT</text>
  <text x="992" y="1580" text-anchor="end" fill="${palette.end}" font-family="Courier New, monospace" font-size="19" font-weight="900" letter-spacing="2">MSHPIT.COM</text>
  <text x="540" y="1784" text-anchor="middle" fill="#fff8ee" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="900" letter-spacing="9">MSHPIT</text>
  <text x="540" y="1827" text-anchor="middle" fill="#858895" font-family="Courier New, monospace" font-size="16" font-weight="800" letter-spacing="3.4">SEE THE FULL NIGHT</text>
</svg>`;
}

function attendanceShareSvg(model, artworkDataUri) {
  const palette = paletteFor(model);
  const hasArtwork = !!safeArtworkDataUri(artworkDataUri);
  // The authoritative photo may be absent, but the ticket must never switch to
  // a different composition after the preview loads. Reserve the same neutral
  // hero area in both cases so every attendance card keeps one geometry.
  const bodyTop = 720;
  const statementFontSize = 28;
  const statementLineHeight = 34;
  const subtitleFontSize = 26;
  const subtitleLineHeight = 32;
  const artistFontSize = 62;
  const artistLineHeight = 68;
  const statementLines = wrapMeasuredLines(model.statement, {
    maxWidth: 904, fontSize: statementFontSize, maxLines: 2,
  });
  const subtitleLines = wrapMeasuredLines(model.subtitle, {
    maxWidth: 904, fontSize: subtitleFontSize, maxLines: 2,
  });
  const artistLines = wrapMeasuredLines(model.artist, {
    maxWidth: 904, fontSize: artistFontSize, letterSpacing: -1, maxLines: 2,
  });
  let cursor = bodyTop + 48;
  const statementY = cursor + statementFontSize;
  cursor = statementY + ((Math.max(1, statementLines.length) - 1) * statementLineHeight) + 18;
  const contextY = subtitleLines.length ? cursor + 15 : null;
  const subtitleY = subtitleLines.length ? contextY + 35 : null;
  if (subtitleLines.length) {
    cursor = subtitleY + ((subtitleLines.length - 1) * subtitleLineHeight) + subtitleFontSize + 18;
  }
  const artistY = cursor + artistFontSize;
  cursor = artistY + ((Math.max(1, artistLines.length) - 1) * artistLineHeight) + 18;
  const scheduleY = Math.min(1160, Math.max(bodyTop + 420, cursor + 26));
  const placeLine = [model.venue, model.place].filter(Boolean).join(" · ");
  const venueMaxWidth = model.time ? 310 : 510;
  const placeLines = wrapMeasuredLines(placeLine || "DETAILS ON MSHPIT", {
    maxWidth: venueMaxWidth, fontSize: 24, maxLines: 2,
  });
  const dateLines = wrapMeasuredLines(model.date || "DATE TO BE ANNOUNCED", {
    maxWidth: 250, fontSize: 29, maxLines: 2,
  });
  const register = model.variant === "going"
    ? '<rect x="40" y="318" width="420" height="10" fill="#ff5a3d"/><rect x="460" y="318" width="330" height="10" fill="#b82d8e"/><rect x="790" y="318" width="250" height="10" fill="#3f74ce"/>'
    : `<rect x="40" y="318" width="500" height="10" fill="${palette.start}"/><rect x="540" y="318" width="500" height="10" fill="${palette.end}"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  ${shareSvgDefs(palette, `<clipPath id="attendanceCard"><rect x="40" y="180" width="1000" height="1500" rx="42"/></clipPath><clipPath id="attendanceHero"><rect x="40" y="328" width="1000" height="392"/></clipPath><clipPath id="attendanceBody"><rect x="70" y="${bodyTop}" width="940" height="${Math.max(1, scheduleY - bodyTop - 12)}"/></clipPath><clipPath id="attendanceDate"><rect x="98" y="${scheduleY + 12}" width="300" height="134"/></clipPath><clipPath id="attendanceVenue"><rect x="460" y="${scheduleY + 8}" width="${venueMaxWidth + 20}" height="142"/></clipPath>`)}
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#0b0715"/>
  <rect x="0" y="0" width="${CARD_WIDTH}" height="12" fill="url(#accent)"/>
  <text x="62" y="108" fill="#fff8ee" font-family="Courier New, monospace" font-size="18" font-weight="800" letter-spacing="4">YOUR NIGHT. YOUR TICKET.</text>
  <g data-layout="attendance-ticket" filter="url(#shadow)" clip-path="url(#attendanceCard)">
    <rect x="40" y="180" width="1000" height="1500" rx="42" fill="#1d1434"/>
    <rect x="40" y="180" width="1000" height="138" fill="#0b0a0f"/>
    ${register}
    <rect x="40" y="328" width="1000" height="392" fill="#121018"/>
    ${hasArtwork ? `${artworkImage(artworkDataUri, { x: 40, y: 328, width: 1000, height: 392, clipId: "attendanceHero" })}<rect x="40" y="328" width="1000" height="392" fill="url(#photoScrim)" opacity="0.5"/>` : '<rect x="40" y="328" width="1000" height="392" fill="#17141d"/><line x1="88" y1="674" x2="992" y2="674" stroke="#2e2936" stroke-width="2"/>'}
    <rect x="40" y="${bodyTop}" width="1000" height="${1350 - bodyTop}" fill="#1d1434"/>
    <rect x="40" y="1350" width="1000" height="330" fill="#251940"/>
  </g>
  ${communityMarkSvg({ x: 98, y: 250, scale: 0.075, opacity: 1 })}
  <text x="152" y="250" fill="#fff8ee" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="900" letter-spacing="7">MSHPIT</text>
  <text x="154" y="281" fill="#858895" font-family="Courier New, monospace" font-size="12" font-weight="800" letter-spacing="2.6">LIVE MUSIC, REMEMBERED</text>
  <g data-section="attendance-body" data-statement-y="${statementY}" data-subtitle-y="${subtitleY || 0}" data-subtitle-lines="${subtitleLines.length}" data-artist-y="${artistY}" data-artist-lines="${artistLines.length}" clip-path="url(#attendanceBody)">
    ${svgTextLines(statementLines, { x: 88, y: statementY, lineHeight: statementLineHeight, fontSize: statementFontSize, fill: "#ddd6e8", weight: 800 })}
    ${subtitleLines.length ? `<text x="88" y="${contextY}" fill="${palette.end}" font-family="Courier New, monospace" font-size="15" font-weight="900" letter-spacing="3">TOUR / EVENT</text>${svgTextLines(subtitleLines, { x: 88, y: subtitleY, lineHeight: subtitleLineHeight, fontSize: subtitleFontSize, fill: "#c7acd9", weight: 800 })}` : ""}
    ${svgTextLines(artistLines, { x: 84, y: artistY, lineHeight: artistLineHeight, fontSize: artistFontSize, fill: "#fff8ee", weight: 900, letterSpacing: -1 })}
  </g>
  <g data-section="attendance-schedule" data-schedule-y="${scheduleY}">
  <rect x="88" y="${scheduleY}" width="330" height="158" fill="#2a1c4b" stroke="${palette.end}" stroke-width="3"/>
  <rect x="88" y="${scheduleY}" width="9" height="158" fill="url(#accent)"/>
  <text x="126" y="${scheduleY + 46}" fill="${palette.end}" font-family="Courier New, monospace" font-size="15" font-weight="900" letter-spacing="3">SHOW DATE</text>
  <g clip-path="url(#attendanceDate)">${svgTextLines(dateLines, { x: 126, y: scheduleY + 94, lineHeight: 36, fontSize: 29, fill: "#fff8ee", weight: 900 })}</g>
  <text x="470" y="${scheduleY + 34}" fill="#9e97ad" font-family="Courier New, monospace" font-size="14" font-weight="900" letter-spacing="2.4">VENUE / CITY</text>
  <g clip-path="url(#attendanceVenue)">${svgTextLines(placeLines, { x: 470, y: scheduleY + 75, lineHeight: 32, fontSize: 24, fill: "#fff8ee", weight: 800 })}</g>
  ${model.time ? `<text x="992" y="${scheduleY + 34}" text-anchor="end" fill="#9e97ad" font-family="Courier New, monospace" font-size="14" font-weight="900" letter-spacing="2.4">SHOW START</text><text x="992" y="${scheduleY + 78}" text-anchor="end" fill="#fff8ee" font-family="Arial, Helvetica, sans-serif" font-size="29" font-weight="900">${escapeXml(model.time)}</text>` : ""}
  </g>
  <line x1="78" y1="1350" x2="1002" y2="1350" stroke="#695d78" stroke-width="2" stroke-dasharray="8 10"/>
  <circle cx="40" cy="1350" r="18" fill="#0b0715"/><circle cx="1040" cy="1350" r="18" fill="#0b0715"/>
  <text x="540" y="1343" text-anchor="middle" fill="#9e97ad" font-family="Courier New, monospace" font-size="13" font-weight="900" letter-spacing="3">MSHPIT RSVP</text>
  <g transform="rotate(-3 180 1480)">
    <rect x="88" y="1410" width="250" height="132" rx="26" fill="none" stroke="${palette.end}" stroke-width="5"/>
    <text x="213" y="1488" text-anchor="middle" fill="${palette.end}" font-family="Courier New, monospace" font-size="31" font-weight="900" letter-spacing="3">RSVP</text>
  </g>
  <text x="390" y="1438" fill="#9e97ad" font-family="Courier New, monospace" font-size="14" font-weight="900" letter-spacing="2.4">SEATING</text>
  <text x="390" y="1482" fill="#fff8ee" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="900">NOT SHARED</text>
  <text x="992" y="1456" text-anchor="end" fill="${palette.end}" font-family="Courier New, monospace" font-size="18" font-weight="900" letter-spacing="3">VIEW SHOW →</text>
  <line x1="774" y1="1490" x2="992" y2="1490" stroke="${palette.end}" stroke-width="3"/>
  <text x="540" y="1800" text-anchor="middle" fill="#fff8ee" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="900" letter-spacing="9">MSHPIT</text>
  <text x="540" y="1842" text-anchor="middle" fill="#9e97ad" font-family="Courier New, monospace" font-size="16" font-weight="800" letter-spacing="3.4">OPEN THE SHOW ON MSHPIT</text>
  <text x="540" y="1882" text-anchor="middle" fill="#5f596a" font-family="Courier New, monospace" font-size="10" font-weight="700" letter-spacing="2.4">NOT VALID FOR ENTRY</text>
</svg>`;
}

export function socialShareCardSvg(model, { artworkDataUri = "" } = {}) {
  if (!model || !COPY[model.variant]) throw new TypeError("A valid social share-card model is required");
  return model.variant === "review"
    ? reviewShareSvg(model, artworkDataUri)
    : attendanceShareSvg(model, artworkDataUri);
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
    .resize(1000, 632, { fit: "cover", position: "centre", withoutEnlargement: false })
    .jpeg({ quality: 82 })
    .toBuffer();
  if (!Buffer.isBuffer(normalized) || normalized.length < 12 || normalized.length > 1_500_000) return "";
  return `data:image/jpeg;base64,${normalized.toString("base64")}`;
}

async function renderSocialShareCardResult(model, options = {}) {
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
  const svg = socialShareCardSvg(model, { artworkDataUri });
  const output = await sharpFactory(Buffer.from(svg, "utf8"), {
    limitInputPixels: CARD_WIDTH * CARD_HEIGHT,
  }).png({
    adaptiveFiltering: true,
    compressionLevel: 9,
  }).toBuffer();
  if (!Buffer.isBuffer(output) || output.length < 100 || output.length > MAX_RENDER_BYTES) {
    throw new Error("Social share card renderer returned invalid bytes");
  }
  return Object.freeze({ bytes: output, artworkApplied: !!artworkDataUri });
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
  return {
    get(key) {
      const value = rows.get(key);
      if (!value) return null;
      rows.delete(key);
      rows.set(key, value);
      return value;
    },
    set(key, value) {
      if (!Buffer.isBuffer(value) || value.length > maxBytes) return;
      const previous = rows.get(key);
      if (previous) totalBytes -= previous.length;
      rows.delete(key);
      rows.set(key, value);
      totalBytes += value.length;
      while (rows.size > maxEntries || totalBytes > maxBytes) {
        const oldest = rows.entries().next().value;
        if (!oldest) break;
        rows.delete(oldest[0]);
        totalBytes -= oldest[1].length;
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
  renderPng = renderSocialShareCardResult,
  maxConcurrentRenders = DEFAULT_MAX_CONCURRENT_RENDERS,
  maxConcurrentArtworkLoads = DEFAULT_MAX_CONCURRENT_ARTWORK_LOADS,
  cache = createLruBufferCache(),
  transientFailureCache = createExpiringKeyCache(),
  transientFailureCacheTtlMs = DEFAULT_TRANSIENT_FAILURE_CACHE_TTL_MS,
  totalWorkTimeoutMs = DEFAULT_TOTAL_WORK_TIMEOUT_MS,
  now = Date.now,
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
  const inFlight = new Map();
  let activeRenders = 0;
  let activeArtworkLoads = 0;

  const withRenderAdmission = async (task) => {
    if (activeRenders >= renderLimit) throw new SocialShareCardBusyError();
    activeRenders += 1;
    try {
      return await task();
    } finally {
      activeRenders = Math.max(0, activeRenders - 1);
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

  const renderAcceptedArtwork = async (model, bytes, signal) => withRenderAdmission(async () => {
    if (signal?.aborted) throw requestAbortReason(signal);
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
      rendered = await renderPng(model, { artworkDataUri, signal });
    } catch (error) {
      if (signal?.aborted) throw requestAbortReason(signal);
      throw new SocialShareCardRenderError(error);
    }
    if (signal?.aborted) throw requestAbortReason(signal);
    return Object.freeze({
      [PREPARED_ARTWORK_RENDER]: true,
      artworkBytes: null,
      artworkDataUri,
      rendered,
    });
  });

  const renderLoadedArtwork = async (model, loaded, signal) => {
    if (loaded?.[PREPARED_ARTWORK_RENDER] === true) return loaded;
    if (signal?.aborted) throw requestAbortReason(signal);
    const artworkBytes = Buffer.isBuffer(loaded) ? loaded : null;
    const artworkDataUri = safeArtworkDataUri(loaded);
    const rendered = await withRenderAdmission(() => renderPng(model, {
      artworkBytes,
      artworkDataUri,
      signal,
    }));
    if (signal?.aborted) throw requestAbortReason(signal);
    return { artworkBytes, artworkDataUri, rendered };
  };

  return Object.freeze({
    async render(model, { signal = null } = {}) {
      if (signal?.aborted) throw requestAbortReason(signal);
      const etag = socialShareCardEtag(model);
      const cached = cache.get(etag);
      if (cached) return { bytes: cached, etag };
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
                acceptBytes: (bytes) => renderAcceptedArtwork(model, bytes, workController.signal),
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
        .then(({ artworkBytes, artworkDataUri, rendered }) => {
          if (requiresArtwork && !artworkDataUri && rendered?.artworkApplied !== true) {
            throw new SocialShareCardArtworkUnavailableError();
          }
          const bytes = Buffer.isBuffer(rendered) ? rendered : rendered?.bytes;
          if (!Buffer.isBuffer(bytes) || bytes.length < 100 || bytes.length > MAX_RENDER_BYTES) {
            throw new Error("Invalid social share card render");
          }
          cache.set(etag, bytes);
          return { bytes, etag };
        })
        .catch((error) => {
          if (!(error instanceof ShareArtworkTransientError)
            && !(error instanceof SocialShareCardArtworkUnavailableError)) throw error;
          const failureTime = Number(now());
          const normalizedFailureTime = Number.isFinite(failureTime) ? failureTime : Date.now();
          transientFailureCache.set(etag, normalizedFailureTime + transientFailureTtl);
          throw error instanceof SocialShareCardArtworkUnavailableError
            ? error
            : new SocialShareCardArtworkUnavailableError();
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
