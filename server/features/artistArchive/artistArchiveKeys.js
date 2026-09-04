const MAX_KEY_LENGTH = 1_800;

const cleanPart = (value) => String(value ?? "").trim().slice(0, 240);

export function archiveIdentityPart(value) {
  return cleanPart(value).normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/g, " ");
}

export function normalizeArchivePart(value) {
  return cleanPart(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const TOUR_SUFFIX_VARIANTS = new Set(["tour", "tours", "tourr", "tuor", "toru"]);

// A tour name is entered independently by every fan. Keep the meaningful title
// exact while folding presentation-only differences: punctuation/spacing, an
// optional leading artist or "The", and common terminal "(World) Tour" text.
// Joining the remaining tokens also makes "Fall-Off" and "Falloff" agree.
export function archiveTourNameIdentity(value, artist = null) {
  let tokens = normalizeArchivePart(value).split(" ").filter(Boolean);
  if (!tokens.length) return "";
  const artistTokens = normalizeArchivePart(artist).split(" ").filter(Boolean);
  if (artistTokens.length && tokens.length > artistTokens.length
    && artistTokens.every((token, index) => tokens[index] === token)) {
    tokens = tokens.slice(artistTokens.length);
  }
  if (tokens.length > 1 && tokens[0] === "the") tokens = tokens.slice(1);
  if (TOUR_SUFFIX_VARIANTS.has(tokens.at(-1))) tokens[tokens.length - 1] = "tour";
  const fallback = tokens.join("");
  if (tokens.at(-1) === "tour") tokens = tokens.slice(0, -1);
  if (tokens.length > 1 && tokens.at(-1) === "world") tokens = tokens.slice(0, -1);
  return tokens.join("") || fallback;
}

export function canonicalArchiveTourIdentity(value, artist = null) {
  const raw = String(value ?? "").trim().replace(/^tour:/iu, "");
  const identity = archiveTourNameIdentity(raw, artist);
  return identity ? `tour:${identity}` : "";
}

function encodeKey(kind, parts) {
  const payload = Buffer.from(JSON.stringify(parts.map(cleanPart)), "utf8").toString("base64url");
  return `${kind}.${payload}`;
}

function decodeKey(value, kind, length) {
  const key = String(value ?? "").trim();
  if (!key.startsWith(`${kind}.`) || key.length > MAX_KEY_LENGTH) return null;
  try {
    const parsed = JSON.parse(Buffer.from(key.slice(kind.length + 1), "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== length || parsed.some((part) => typeof part !== "string" || part.length > 240)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function archiveShowKey({ artistIdentity, venueIdentity, date } = {}) {
  // A performance is the artist at one venue on one local date. City is useful
  // display metadata, but aliases such as "SF" and "San Francisco" must not
  // split fan ratings for the same night. Retain the empty third field so older
  // four-part keys continue to decode during a rolling deployment.
  return encodeKey("show", [archiveIdentityPart(artistIdentity), archiveIdentityPart(venueIdentity), "", cleanPart(date)]);
}

export function decodeArchiveShowKey(value) {
  const parts = decodeKey(value, "show", 4);
  return parts ? Object.freeze({ artistIdentity: parts[0], venueIdentity: parts[1], city: parts[2], date: parts[3] }) : null;
}

export function archiveTourIdentity(row = {}) {
  const explicit = archiveTourNameIdentity(row.tour, row.artist);
  if (explicit) return Object.freeze({ identity: `tour:${explicit}`, label: cleanPart(row.tour) });
  const year = /^\d{4}/.test(String(row.date || "")) ? String(row.date).slice(0, 4) : "Undated";
  return Object.freeze({ identity: `year:${year}`, label: `Other shows · ${year}` });
}

export function archiveTourKey({ artistIdentity, tourIdentity } = {}) {
  // The display label is deliberately not part of the selection identity.
  // Fans can type the same tour with different case or punctuation; encoding a
  // raw label here would split one normalized tour into several archive cards.
  // Keep the third field for backwards-compatible decoding of already-issued
  // keys while new keys derive solely from the stable normalized identity.
  const identity = String(tourIdentity || "").startsWith("year:")
    ? cleanPart(tourIdentity)
    : canonicalArchiveTourIdentity(tourIdentity);
  return encodeKey("tour", [archiveIdentityPart(artistIdentity), identity, ""]);
}

export function decodeArchiveTourKey(value) {
  const parts = decodeKey(value, "tour", 3);
  return parts ? Object.freeze({ artistIdentity: parts[0], tourIdentity: parts[1], tourLabel: parts[2] }) : null;
}

export function archiveReviewCursor(row = {}) {
  const date = cleanPart(row.date);
  const createdAt = Number(row.created_at ?? row.createdAt);
  const id = cleanPart(row.id);
  if (!isArchiveDate(date) || !Number.isSafeInteger(createdAt) || createdAt < 0 || !id) return null;
  return encodeKey("cursor", [date, String(createdAt), id]);
}

export function decodeArchiveReviewCursor(value) {
  if (value == null || value === "") return null;
  const parts = decodeKey(value, "cursor", 3);
  const createdAt = Number(parts?.[1]);
  if (!parts || !isArchiveDate(parts[0]) || !Number.isSafeInteger(createdAt) || createdAt < 0 || !parts[2]) return false;
  return Object.freeze({ date: parts[0], createdAt, id: parts[2] });
}

export function isArchiveDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}
