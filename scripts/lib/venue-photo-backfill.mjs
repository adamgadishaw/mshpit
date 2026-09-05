import { hasLicensedVenuePhoto, needsLicensedVenuePhotoAcross } from "./venue-photo-record.mjs";

const DEFAULT_LIMIT = 75;
const MAX_BATCH_LIMIT = 250;
const STOP_WORDS = new Set([
  "the", "arena", "centre", "center", "hall", "theatre", "theater", "club",
  "venue", "stadium",
]);
const VENUE_CONTEXT = /\b(?:arena|auditorium|ballroom|cabaret|club|concert|festival|gig|hall|live|music|musical|nightclub|performance|performing|pavilion|restaurant|stage|stadium|theatre|theater|venue)\b/iu;
const WRONG_ENTITY_CONTEXT = /\b(?:brig|bronze|faculty|law school|museum|school|sculptor|sculpture|ship|statue|university)\b/iu;
const NON_PHOTO = /\b(?:atlas|cartograph\w*|diagram|drawing|floor\s*plan|illustration|logo|map|plan|route\s*map|seating\s*chart|site\s*plan)\b|\b\w*karte\b/iu;
const STRUCTURAL_VENUE_SUBJECT = /\b(?:amphitheat(?:er|re)|architecture|architectural|arena|auditorium|ballroom|building|concert\s+hall|entrance|exterior|facade|facades|frontage|grandstand|hall|interior|palace|pavilion|seating|stands|stadium|theatre|theater|venue)\b/iu;
const NON_STRUCTURAL_EVENT_SUBJECT = /\b(?:audience|band|concert|crowd|festival|fans?|game|gig|match|musician|onstage|performer|performing|performance|rapper|show|singer|stage|tour)\b/iu;
const NON_STRUCTURAL_SCENIC_SUBJECT = /\b(?:cityscape|flower\s*beds?|flowerbeds?|garden|gardens|landscape|panorama|panoramic|skyline)\b|\b(?:view|views)\s+(?:across|from|of|over|towards?)\b|\bcity\s+of\b.{0,80}\bfrom\b/iu;
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

function coordinate(value, minimum, maximum) {
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

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

function evidenceWithoutVenuePhrases(evidence) {
  return evidence
    // These phrases describe a building type, not a concert in progress.
    .replace(/\bconcert\s+(?:arena|building|hall|stadium|theatre|theater|venue)\b/gu, " ")
    .replace(/\bfestival\s+hall\b/gu, " ")
    .replace(/\bperformance\s+(?:hall|space|venue)\b/gu, " ")
    .replace(/\bperforming\s+arts\s+(?:center|centre|hall|theatre|theater|venue)\b/gu, " ")
    .replace(/\blive\s+music\s+venue\b/gu, " ");
}

function prefixIsFullySupportedByLocation(prefix, venuePlace) {
  const prefixTokens = prefix.split(" ").filter(Boolean);
  const locationTokens = new Set(normalizeVenueEvidence(venuePlace).split(" ").filter(Boolean));
  return prefixTokens.length > 0
    && prefixTokens.every((token) => locationTokens.has(token));
}

function depictsNonStructuralEvent(rawTitle, normalizedTitle, evidence, venueName, venuePlace) {
  if (/@/u.test(rawTitle)) return true;

  // Commons concert files commonly use "Artist at Venue". Keep structural
  // subjects such as "Entrance at Venue", but fail closed on a person or act.
  const atVenue = ` at ${venueName}`;
  const atIndex = normalizedTitle.indexOf(atVenue);
  if (atIndex > 0) {
    const prefix = normalizedTitle.slice(0, atIndex).trim();
    if (!STRUCTURAL_VENUE_SUBJECT.test(prefix)) return true;
  }

  const venueIndex = normalizedTitle.indexOf(venueName);
  const beforeVenue = venueIndex > 0 ? normalizedTitle.slice(0, venueIndex).trim() : "";
  if (beforeVenue && /\b(?:v|vs|versus|x)\b/iu.test(beforeVenue)) return true;
  if (beforeVenue
    && !STRUCTURAL_VENUE_SUBJECT.test(beforeVenue)
    && !prefixIsFullySupportedByLocation(beforeVenue, venuePlace)) return true;

  // Do not let an official name such as "RBC Stage", "Band on the Wall", or
  // "Performance Hall" condemn its own structural photo. Event terms outside
  // the exact venue identity remain subject to the negative gate.
  const evidenceOutsideVenueName = evidence.split(venueName).join(" ");
  return NON_STRUCTURAL_EVENT_SUBJECT.test(
    evidenceWithoutVenuePhrases(evidenceOutsideVenueName),
  );
}

export function isRelevantCommonsVenuePhoto(page, venue) {
  const info = page?.imageinfo?.[0];
  const meta = info?.extmetadata || {};
  const rawTitle = String(page?.title || "");
  const rawProviderEvidence = [
    rawTitle,
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
  // A licensed photo is not automatically a venue photo. Require affirmative
  // architectural/building evidence, then reject common search-result traps
  // where the venue name only appears because an act performed there or the
  // camera was standing on its grounds.
  if (!STRUCTURAL_VENUE_SUBJECT.test(evidence)) return false;
  if (NON_STRUCTURAL_SCENIC_SUBJECT.test(evidence)) return false;
  if (depictsNonStructuralEvent(rawTitle, title, evidence, venueName, venue?.place)) return false;
  // A same-named museum, ship, school, sculpture, or similar landmark is not
  // evidence of the live venue unless that entity type is part of the venue's
  // own name. This catches confident-but-wrong Commons title matches such as
  // Boston Tea Party Museum for the former Boston Tea Party music club.
  if (WRONG_ENTITY_CONTEXT.test(evidence) && !WRONG_ENTITY_CONTEXT.test(venueName)) return false;
  const city = normalizeVenueEvidence(String(venue?.place || "").split(",")[0]);
  const cityMatch = Boolean(city && containsPhrase(evidence, city));
  const gps = {
    lat: coordinate(meta.GPSLatitude?.value, -90, 90),
    lng: coordinate(meta.GPSLongitude?.value, -180, 180),
  };
  const nearby = venueDistanceKm(
    {
      lat: coordinate(venue?.lat, -90, 90),
      lng: coordinate(venue?.lng, -180, 180),
    },
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
  const databasePath = valueOf("database") || valueOf("db") || null;
  const inventoryLimitText = valueOf("inventory-limit");
  const delayText = valueOf("delay-ms");
  const checkpointText = valueOf("checkpoint-every");
  const statePath = valueOf("state-path") || null;
  const coverageOnly = args.includes("--coverage");
  return {
    all,
    limit: all ? Number.POSITIVE_INFINITY
      : limitText == null ? DEFAULT_LIMIT : safeInteger(limitText, "--limit", { min: 1, max: MAX_BATCH_LIMIT }),
    offset: offsetText == null ? 0 : safeInteger(offsetText, "--offset"),
    cursor,
    databasePath,
    catalogOnly: args.includes("--catalog-only"),
    coverageOnly,
    inventoryLimit: inventoryLimitText == null ? 100_000
      : safeInteger(inventoryLimitText, "--inventory-limit", { min: 1, max: 250_000 }),
    replace: args.includes("--replace"),
    useProgressState: !args.includes("--no-state"),
    statePath,
    dryRun: args.includes("--dry-run") || args.includes("--list") || coverageOnly,
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
    if (cursorIndex < 0) {
      if (!options.allowStaleCursor) throw new Error(`Unknown venue-photo cursor: ${options.cursor}`);
      start = 0;
    } else {
      start = Math.max(start, cursorIndex + 1);
    }
  }

  const eligible = ([key, venue]) => {
    const explicitProviderTombstone = String(key || "").startsWith("provider:")
      && Object.prototype.hasOwnProperty.call(existing || {}, key)
      && !hasLicensedVenuePhoto(existing[key]);
    if (explicitProviderTombstone) return false;
    return options.replace || needsLicensedVenuePhotoAcross(existing[key], venue);
  };
  const traversal = options.wrap && start > 0
    ? [...ordered.slice(start), ...ordered.slice(0, start)]
    : ordered.slice(start);
  const remaining = traversal.filter(eligible);
  const selected = Number.isFinite(limit) ? remaining.slice(0, limit) : remaining;
  const nextCursor = selected.at(-1)?.[0] || null;
  const hasMore = selected.length > 0 && remaining.length > selected.length;

  return { selected, nextCursor, hasMore, totalEligible: remaining.length };
}
