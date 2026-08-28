import { needsLicensedVenuePhotoAcross } from "./venue-photo-record.mjs";

const DEFAULT_LIMIT = 75;
const MAX_BATCH_LIMIT = 250;
const STOP_WORDS = new Set([
  "the", "arena", "centre", "center", "hall", "theatre", "theater", "club",
  "venue", "stadium",
]);
const VENUE_CONTEXT = /\b(?:arena|auditorium|ballroom|cabaret|club|concert|festival|gig|hall|live|music|musical|nightclub|performance|performing|pavilion|restaurant|stage|stadium|theatre|theater|venue)\b/iu;
const WRONG_ENTITY_CONTEXT = /\b(?:brig|bronze|faculty|law school|museum|school|sculptor|sculpture|ship|statue|university)\b/iu;
const NON_PHOTO = /\b(?:atlas|cartograph\w*|diagram|drawing|floor\s*plan|illustration|logo|map|plan|route\s*map|seating\s*chart|site\s*plan)\b|\b\w*karte\b/iu;
const PHOTO_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function commonsVenuePhotoLookupUrl(venue) {
  const city = String(venue?.place || "").split(",")[0].trim();
  const query = `"${String(venue?.name || "").trim()}" ${city}`.trim();
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  for (const [key, value] of Object.entries({
    action: "query", format: "json", generator: "search", gsrnamespace: "6",
    gsrsearch: query, gsrlimit: "12", prop: "imageinfo",
    iiprop: "url|mime|extmetadata", iiurlwidth: "1600",
  })) url.searchParams.set(key, value);
  return url;
}

export const normalizeVenueEvidence = (value) => String(value || "")
  .replace(/<[^>]*>/gu, " ")
  .replace(/&quot;/gu, '"')
  .replace(/&#0?39;|&apos;/gu, "'")
  .replace(/&amp;/gu, "&")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/gu, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/gu, " ")
  .trim();

const radians = (value) => value * Math.PI / 180;

export function venueDistanceKm(a, b) {
  if (![a?.lat, a?.lng, b?.lat, b?.lng].every(Number.isFinite)) return null;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function containsPhrase(haystack, phrase) {
  return Boolean(phrase) && ` ${haystack} `.includes(` ${phrase} `);
}

export function isRelevantCommonsVenuePhoto(page, venue) {
  const info = page?.imageinfo?.[0];
  const meta = info?.extmetadata || {};
  const rawProviderEvidence = [
    page?.title,
    meta.ObjectName?.value,
    meta.ImageDescription?.value,
  ].join(" ");
  if (!PHOTO_MIMES.has(info?.mime) || NON_PHOTO.test(rawProviderEvidence)) return false;

  const venueName = normalizeVenueEvidence(venue?.name);
  const venueWords = venueName.split(" ").filter(Boolean);
  const meaningfulWords = venueWords.filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  if (!venueName || !meaningfulWords.length) return false;

  const title = normalizeVenueEvidence(page?.title).replace(/^file\s+/u, "");
  if (!containsPhrase(title, venueName)) return false;

  const evidence = normalizeVenueEvidence(rawProviderEvidence);
  // A same-named museum, ship, school, sculpture, or similar landmark is not
  // evidence of the live venue unless that entity type is part of the venue's
  // own name. This catches confident-but-wrong Commons title matches such as
  // Boston Tea Party Museum for the former Boston Tea Party music club.
  if (WRONG_ENTITY_CONTEXT.test(evidence) && !WRONG_ENTITY_CONTEXT.test(venueName)) return false;
  const city = normalizeVenueEvidence(String(venue?.place || "").split(",")[0]);
  const cityMatch = Boolean(city && containsPhrase(evidence, city));
  const gps = {
    lat: Number(meta.GPSLatitude?.value),
    lng: Number(meta.GPSLongitude?.value),
  };
  const nearby = venueDistanceKm(
    { lat: Number(venue?.lat), lng: Number(venue?.lng) },
    Number.isFinite(gps.lat) && Number.isFinite(gps.lng) ? gps : null,
  );

  // Leading articles do not make an otherwise ambiguous one-word identity
  // safe. "The Well" and "The Bayou" still require explicit venue context.
  if (meaningfulWords.length > 1) return cityMatch || (nearby != null && nearby <= 10);

  // A one-word name such as History, SOMA, or Littlefield is ambiguous even at
  // the right coordinates in a dense city. Location is only a corroborating
  // signal: provider metadata must also identify a live-performance venue and
  // must not identify a school, sculpture, or other namesake instead.
  const explicitVenueContext = VENUE_CONTEXT.test(evidence)
    && !WRONG_ENTITY_CONTEXT.test(evidence);
  const locationMatch = cityMatch || (nearby != null && nearby <= 5);
  return explicitVenueContext && locationMatch;
}

export function sortVenueEntries(entries) {
  return [...entries].sort(([, a], [, b]) =>
    Number(Boolean(b?.major)) - Number(Boolean(a?.major))
    || Number(b?.capacity || 0) - Number(a?.capacity || 0)
    || String(a?.name || "").localeCompare(String(b?.name || "")));
}

function safeInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  }
  return number;
}

export function parseVenuePhotoBackfillArgs(args = []) {
  const valueOf = (flag) => args.find((value) => value.startsWith(`--${flag}=`))?.slice(flag.length + 3);
  const all = args.includes("--all");
  const limitText = valueOf("limit");
  const offsetText = valueOf("offset");
  const cursor = valueOf("cursor") || null;
  const delayText = valueOf("delay-ms");
  const checkpointText = valueOf("checkpoint-every");
  return {
    all,
    limit: all ? Number.POSITIVE_INFINITY
      : limitText == null ? DEFAULT_LIMIT : safeInteger(limitText, "--limit", { min: 1, max: MAX_BATCH_LIMIT }),
    offset: offsetText == null ? 0 : safeInteger(offsetText, "--offset"),
    cursor,
    replace: args.includes("--replace"),
    dryRun: args.includes("--dry-run") || args.includes("--list"),
    delayMs: delayText == null ? 250
      : safeInteger(delayText, "--delay-ms", { max: 5000 }),
    checkpointEvery: checkpointText == null ? 10
      : safeInteger(checkpointText, "--checkpoint-every", { min: 1, max: 250 }),
  };
}

export function selectVenuePhotoBackfillBatch(entries, existing = {}, options = {}) {
  const ordered = sortVenueEntries(entries);
  const limit = options.limit ?? DEFAULT_LIMIT;
  const offset = options.offset ?? 0;
  let start = safeInteger(offset, "offset", { max: ordered.length });

  if (options.cursor) {
    const cursorIndex = ordered.findIndex(([key]) => key === options.cursor);
    if (cursorIndex < 0) throw new Error(`Unknown venue-photo cursor: ${options.cursor}`);
    start = Math.max(start, cursorIndex + 1);
  }

  const eligible = ([key, venue]) => options.replace
    || needsLicensedVenuePhotoAcross(existing[key], venue);
  const remaining = ordered.slice(start).filter(eligible);
  const selected = Number.isFinite(limit) ? remaining.slice(0, limit) : remaining;
  const nextCursor = selected.at(-1)?.[0] || null;
  const lastIndex = nextCursor == null ? start - 1
    : ordered.findIndex(([key]) => key === nextCursor);
  const hasMore = nextCursor != null && ordered.slice(lastIndex + 1).some(eligible);

  return { selected, nextCursor, hasMore, totalEligible: remaining.length };
}
