import { licensedVenuePhoto, verifiedHttpsUrl } from "../../src/domain/venuePhotoProvenance.mjs";

function encodedPath(value) {
  return String(value).split("/").map((part) =>
    encodeURIComponent(part).replace(/[!'()*]/gu, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
}

function stableObjectKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  return /^venues\/licensed\/[a-z0-9._/-]{12,220}\.webp$/u.test(key)
    && !key.includes("..") ? key : null;
}

const DELIVERY_NOTICE = "Converted to WebP and resized when needed by MSHpit for delivery.";
const MAX_DELIVERY_BYTES = 8 * 1024 * 1024;

export function isStructurallyMirroredVenuePhoto(photo) {
  const licensed = licensedVenuePhoto(photo);
  const objectKey = stableObjectKey(photo?.mirror?.objectKey);
  const mirroredFrom = verifiedHttpsUrl(photo?.mirroredFrom);
  if (!licensed || !objectKey || !mirroredFrom) return false;

  let delivered;
  let source;
  try {
    delivered = new URL(licensed.uri);
    source = new URL(mirroredFrom);
  } catch { return false; }
  const digest = String(photo?.mirror?.sha256 || "").toLowerCase();
  const objectDigest = objectKey.match(/\/([a-f0-9]{48})\.webp$/u)?.[1] || "";
  const byteSize = Number(photo?.mirror?.byteSize);
  const width = Number(photo?.mirror?.width);
  const height = Number(photo?.mirror?.height);
  return !delivered.search
    && delivered.origin !== source.origin
    && delivered.pathname.endsWith(`/${encodedPath(objectKey)}`)
    && photo?.mirror?.contentType === "image/webp"
    && Number.isSafeInteger(byteSize) && byteSize >= 1 && byteSize <= MAX_DELIVERY_BYTES
    && Number.isSafeInteger(width) && width >= 1 && width <= 1_920
    && Number.isSafeInteger(height) && height >= 1 && height <= 1_440
    && /^[a-f0-9]{64}$/u.test(digest)
    && digest.startsWith(objectDigest)
    && String(licensed.modificationNotice || "").includes(DELIVERY_NOTICE);
}

export function isMirroredVenuePhoto(photo, env = process.env) {
  const licensed = licensedVenuePhoto(photo);
  const objectKey = stableObjectKey(photo?.mirror?.objectKey);
  if (!licensed || !objectKey || !isStructurallyMirroredVenuePhoto(photo)) return false;
  let base;
  try { base = new URL(String(env.MEDIA_PUBLIC_BASE_URL || "")); }
  catch { return false; }
  if (base.protocol !== "https:" || base.username || base.password) return false;
  const prefix = base.pathname.replace(/\/+$/u, "");
  const expected = `${base.origin}${prefix}/${encodedPath(objectKey)}`;
  return licensed.uri === verifiedHttpsUrl(expected);
}

function orderedEntries(entries) {
  return [...entries].sort(([left], [right]) =>
    String(left).localeCompare(String(right), "en"));
}

export function selectVenuePhotoMirrorBatch(entries, options = {}) {
  const ordered = orderedEntries(entries).filter(([, row]) =>
    (Array.isArray(row?.galleryPool) ? row.galleryPool : []).some(licensedVenuePhoto));
  const offset = Number(options.offset || 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > ordered.length) {
    throw new Error("offset must identify a verified venue-photo row.");
  }
  let start = offset;
  if (options.cursor) {
    const cursorIndex = ordered.findIndex(([key]) => key === options.cursor);
    if (cursorIndex < 0) throw new Error(`Unknown venue-photo mirror cursor: ${options.cursor}`);
    start = Math.max(start, cursorIndex + 1);
  }
  const remaining = ordered.slice(start);
  const limit = options.all ? Number.POSITIVE_INFINITY : Number(options.limit || 75);
  if (!Number.isFinite(limit) && limit !== Number.POSITIVE_INFINITY) {
    throw new Error("limit must be a positive integer.");
  }
  if (Number.isFinite(limit) && (!Number.isSafeInteger(limit) || limit < 1 || limit > 250)) {
    throw new Error("limit must be an integer from 1 to 250.");
  }
  const selected = Number.isFinite(limit) ? remaining.slice(0, limit) : remaining;
  const nextCursor = selected.at(-1)?.[0] || null;
  return {
    selected,
    nextCursor,
    totalEligible: remaining.length,
    hasMore: selected.length < remaining.length,
  };
}

export function pendingVenueMirrorCount(row, env = process.env) {
  return (Array.isArray(row?.galleryPool) ? row.galleryPool : [])
    .filter(licensedVenuePhoto)
    .filter((photo) => !isMirroredVenuePhoto(photo, env)).length;
}
