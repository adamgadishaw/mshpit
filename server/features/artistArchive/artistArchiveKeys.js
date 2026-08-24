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
  const explicit = normalizeArchivePart(row.tour);
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
  return encodeKey("tour", [archiveIdentityPart(artistIdentity), cleanPart(tourIdentity), ""]);
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
