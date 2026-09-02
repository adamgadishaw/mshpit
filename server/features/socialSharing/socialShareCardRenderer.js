import { createHash } from "node:crypto";

import sharp from "sharp";

import { eventPath, postPath } from "../../../src/domain/urls.mjs";
import { isStrictCalendarDate } from "../seo/publicEntityPolicy.js";

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1920;
const CARD_VERSION = "mshpit-social-story-v2";
const CANONICAL_ORIGIN = "https://www.mshpit.com";
const MAX_RENDER_BYTES = 4 * 1024 * 1024;
const DEFAULT_CACHE_ENTRIES = 160;
const DEFAULT_CACHE_BYTES = 48 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT_RENDERS = 4;

const COPY = Object.freeze({
  going: Object.freeze({ label: "GOING", kicker: "A SHOW WORTH COUNTING DOWN TO" }),
  interested: Object.freeze({ label: "INTERESTED", kicker: "ONE TO KEEP ON THE CALENDAR" }),
  review: Object.freeze({ label: "FAN REVIEW", kicker: "RATED LIVE BY AN MSHPIT MEMBER" }),
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

/**
 * Only values already admitted by the public SEO projection enter the model.
 * The model has no fields for seat, order, barcode, ticket URL, attendance
 * visibility, email, or account identifiers.
 */
export function eventShareCardModel(document, intent, { postId = null, authorName = null } = {}) {
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
  return Object.freeze({
    version: CARD_VERSION,
    variant: intent,
    label: COPY[intent].label,
    kicker: author
      ? `${author} IS ${intent === "going" ? "GOING" : "INTERESTED"}`
      : COPY[intent].kicker,
    artist,
    subtitle: eventSubtitle(event),
    venue,
    place: cleanText(event.place, 180),
    date: formatDate(date),
    time: formatTime(event.localTime || event.startDateTime),
    rating: "",
    quote: "",
    canonicalUrl: shareUrl,
  });
}

export function reviewShareCardModel(document) {
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
  return Object.freeze({
    version: CARD_VERSION,
    variant: "review",
    label: COPY.review.label,
    kicker: `${author}'S LIVE TAKE`,
    artist,
    subtitle: cleanText(post.tour || post.onlineTitle, 180),
    venue: cleanText(post.venue || (post.experienceType === "online" ? "ONLINE CONCERT" : ""), 180),
    place: cleanText(post.city, 180),
    date: post.showDate ? formatDate(post.showDate) : "",
    time: "",
    rating: score,
    quote,
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

function wrapLines(value, maxCharacters, maxLines) {
  const source = cleanText(value, 420);
  if (!source) return [];
  const words = source.split(" ").flatMap((word) => {
    const points = [...word];
    if (points.length <= maxCharacters) return [word];
    const chunks = [];
    for (let index = 0; index < points.length; index += maxCharacters) {
      chunks.push(points.slice(index, index + maxCharacters).join(""));
    }
    return chunks;
  });
  const lines = [];
  let current = "";
  let cursor = 0;
  let truncated = false;
  while (cursor < words.length) {
    const word = words[cursor];
    const candidate = current ? `${current} ${word}` : word;
    if ([...candidate].length <= maxCharacters || !current) {
      current = candidate;
      cursor += 1;
      continue;
    }
    lines.push(current);
    current = "";
    if (lines.length >= maxLines) {
      truncated = true;
      break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (cursor < words.length) truncated = true;
  if (truncated && lines.length) {
    const last = lines.length - 1;
    lines[last] = `${[...lines[last].replace(/[.,;:!?\s]+$/u, "")]
      .slice(0, Math.max(1, maxCharacters - 1)).join("")}…`;
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

export function socialShareCardSvg(model) {
  if (!model || !COPY[model.variant]) throw new TypeError("A valid social share-card model is required");
  const palette = paletteFor(model);
  const artistLines = wrapLines(model.artist, 22, 3);
  const subtitleLines = wrapLines(model.subtitle, 42, 2);
  const quoteLines = model.variant === "review" ? wrapLines(model.quote, 58, 4) : [];
  const placeLine = [model.venue, model.place].filter(Boolean).join(" · ");
  const scheduleLine = [model.date, model.time].filter(Boolean).join(" · ");
  const artistY = artistLines.length === 1 ? 410 : artistLines.length === 2 ? 365 : 330;
  const subtitleY = artistY + (artistLines.length * 88) + 20;
  const quoteBlock = quoteLines.length
    ? `<rect x="78" y="806" width="924" height="246" rx="26" fill="#fffaf5" stroke="#e7d9ce" stroke-width="2"/>${svgTextLines(quoteLines, { x: 116, y: 866, lineHeight: 42, fontSize: 30, fill: palette.ink, weight: 600 })}`
    : "";
  const detailsY = quoteLines.length ? 1112 : 910;
  const ctaY = quoteLines.length ? 1232 : 1168;
  const ctaLabel = model.variant === "review"
    ? "OPEN THE REVIEW ON MSHPIT"
    : "OPEN THE SHOW ON MSHPIT";
  const ratingBlock = model.variant === "review" && model.rating
    ? `<text x="905" y="720" text-anchor="end" fill="#fff8ed" font-family="Arial, Helvetica, sans-serif" font-size="76" font-weight="900">${escapeXml(model.rating)}</text><text x="922" y="716" fill="#fff8ed" opacity="0.7" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700">/ 5</text>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  <defs>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette.start}"/><stop offset="1" stop-color="${palette.end}"/></linearGradient>
    <linearGradient id="stage" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#19151f"/><stop offset="1" stop-color="#08070a"/></linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000000" flood-opacity="0.34"/></filter>
    <clipPath id="ticket"><rect x="40" y="40" width="1000" height="1270" rx="42"/></clipPath>
  </defs>
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#08070a"/>
  <circle cx="110" cy="184" r="320" fill="${palette.start}" opacity="0.10"/>
  <circle cx="1030" cy="1690" r="430" fill="${palette.end}" opacity="0.10"/>
  ${communityMarkSvg({ x: 930, y: 164, scale: 0.3, opacity: 0.06 })}
  <text x="74" y="132" fill="#fffaf5" font-family="Courier New, monospace" font-size="18" font-weight="800" letter-spacing="4">LIVE MUSIC, REMEMBERED</text>
  <rect x="74" y="162" width="170" height="8" rx="4" fill="url(#accent)"/>
  <g transform="translate(0 285)">
  <g filter="url(#shadow)" clip-path="url(#ticket)">
    <rect x="40" y="40" width="1000" height="1270" rx="42" fill="#fbf5ee"/>
    <rect x="40" y="40" width="1000" height="126" fill="#0d0b10"/>
    <rect x="40" y="158" width="1000" height="12" fill="url(#accent)"/>
    <rect x="40" y="170" width="1000" height="610" fill="url(#stage)"/>
    <circle cx="920" cy="276" r="310" fill="${palette.end}" opacity="0.18"/>
    <circle cx="160" cy="690" r="250" fill="${palette.start}" opacity="0.15"/>
    ${communityMarkSvg({ x: 850, y: 482, scale: 0.68, opacity: 0.11 })}
    <rect x="40" y="780" width="1000" height="530" fill="#fbf5ee"/>
  </g>
  ${communityMarkSvg({ x: 94, y: 104, scale: 0.07, opacity: 1 })}
  <text x="146" y="112" fill="#fffaf5" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="800" letter-spacing="8">MSHPIT</text>
  <text x="992" y="108" text-anchor="end" fill="#fffaf5" opacity="0.7" font-family="Courier New, monospace" font-size="17" font-weight="700" letter-spacing="2">SOCIAL PASS · NOT FOR ENTRY</text>
  <rect x="78" y="218" width="218" height="48" rx="24" fill="url(#accent)"/>
  <text x="187" y="250" text-anchor="middle" fill="#fffaf5" font-family="Courier New, monospace" font-size="20" font-weight="800" letter-spacing="3">${escapeXml(model.label)}</text>
  <text x="78" y="301" fill="#fffaf5" opacity="0.65" font-family="Courier New, monospace" font-size="18" font-weight="700" letter-spacing="2.5">${escapeXml(model.kicker)}</text>
  ${svgTextLines(artistLines, { x: 78, y: artistY, lineHeight: 88, fontSize: 78, fill: "#fffaf5", weight: 900, letterSpacing: -2 })}
  ${svgTextLines(subtitleLines, { x: 82, y: subtitleY, lineHeight: 38, fontSize: 28, fill: "#fffaf5", weight: 600 })}
  ${ratingBlock}
  ${quoteBlock}
  <text x="88" y="${detailsY}" fill="${palette.end}" font-family="Courier New, monospace" font-size="16" font-weight="800" letter-spacing="2.6">DATE AND TIME</text>
  <text x="88" y="${detailsY + 42}" fill="${palette.ink}" font-family="Arial, Helvetica, sans-serif" font-size="29" font-weight="800">${escapeXml(scheduleLine || "DETAILS ON MSHPIT")}</text>
  <line x1="540" y1="${detailsY - 22}" x2="540" y2="${detailsY + 68}" stroke="#d8c9be" stroke-width="2"/>
  <text x="582" y="${detailsY}" fill="${palette.end}" font-family="Courier New, monospace" font-size="16" font-weight="800" letter-spacing="2.6">VENUE</text>
  ${svgTextLines(wrapLines(placeLine || "OPEN THE SHOW FOR DETAILS", 34, 2), { x: 582, y: detailsY + 42, lineHeight: 34, fontSize: 27, fill: palette.ink, weight: 800 })}
  <line x1="78" y1="${ctaY - 58}" x2="1002" y2="${ctaY - 58}" stroke="#d8c9be" stroke-width="2" stroke-dasharray="8 10"/>
  <circle cx="40" cy="${ctaY - 58}" r="18" fill="#08070a"/><circle cx="1040" cy="${ctaY - 58}" r="18" fill="#08070a"/>
  <rect x="78" y="${ctaY - 20}" width="924" height="74" rx="18" fill="url(#accent)"/>
  <text x="112" y="${ctaY + 28}" fill="#fffaf5" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="800">${ctaLabel}</text>
  <text x="968" y="${ctaY + 27}" text-anchor="end" fill="#fffaf5" font-family="Courier New, monospace" font-size="19" font-weight="800" letter-spacing="2">MSHPIT.COM</text>
  </g>
  <text x="540" y="1742" text-anchor="middle" fill="#fffaf5" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="900" letter-spacing="9">MSHPIT</text>
  <text x="540" y="1784" text-anchor="middle" fill="#fffaf5" opacity="0.58" font-family="Courier New, monospace" font-size="17" font-weight="700" letter-spacing="4">OPEN THE FULL NIGHT AT MSHPIT.COM</text>
</svg>`;
}

export async function renderSocialShareCardPng(model, sharpFactory = sharp) {
  const svg = socialShareCardSvg(model);
  const output = await sharpFactory(Buffer.from(svg, "utf8"), {
    limitInputPixels: CARD_WIDTH * CARD_HEIGHT,
  }).png({
    adaptiveFiltering: true,
    compressionLevel: 9,
  }).toBuffer();
  if (!Buffer.isBuffer(output) || output.length < 100 || output.length > MAX_RENDER_BYTES) {
    throw new Error("Social share card renderer returned invalid bytes");
  }
  return output;
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

export function createSocialShareCardRenderer({
  renderPng = renderSocialShareCardPng,
  maxConcurrentRenders = DEFAULT_MAX_CONCURRENT_RENDERS,
  cache = createLruBufferCache(),
} = {}) {
  if (typeof renderPng !== "function") throw new TypeError("A social share-card renderer is required");
  const inFlight = new Map();
  let activeRenders = 0;
  return Object.freeze({
    async render(model) {
      const etag = socialShareCardEtag(model);
      const cached = cache.get(etag);
      if (cached) return { bytes: cached, etag };
      const existing = inFlight.get(etag);
      if (existing) return existing;
      if (activeRenders >= Math.max(1, Number(maxConcurrentRenders) || DEFAULT_MAX_CONCURRENT_RENDERS)) {
        throw new SocialShareCardBusyError();
      }
      activeRenders += 1;
      const operation = Promise.resolve()
        .then(() => renderPng(model))
        .then((bytes) => {
          if (!Buffer.isBuffer(bytes) || bytes.length > MAX_RENDER_BYTES) {
            throw new Error("Invalid social share card render");
          }
          cache.set(etag, bytes);
          return { bytes, etag };
        })
        .finally(() => {
          activeRenders = Math.max(0, activeRenders - 1);
          inFlight.delete(etag);
        });
      inFlight.set(etag, operation);
      return operation;
    },
  });
}

export const socialShareCardConstants = Object.freeze({
  canonicalOrigin: CANONICAL_ORIGIN,
  height: CARD_HEIGHT,
  maxBytes: MAX_RENDER_BYTES,
  version: CARD_VERSION,
  width: CARD_WIDTH,
});
