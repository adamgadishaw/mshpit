import { readFileSync } from "node:fs";
import { licensedVenuePhoto } from "../src/domain/venuePhotoProvenance.mjs";
import { photoCreditPath } from "./photoCredits.js";

const ARTIST_PHOTO_SOURCE = new URL(
  "../src/seed/catalog.artist-photos.verified.json",
  import.meta.url,
);
const MUSICBRAINZ_ARTIST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

let cachedCatalog;

function normalizedArtistKey(value) {
  const key = typeof value === "string"
    ? value.normalize("NFKC").trim().toLocaleLowerCase("en").replace(/\s+/gu, " ")
    : "";
  return key && key.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(key) ? key : null;
}

function normalizedArtistMbid(value) {
  if (value == null || value === "") return null;
  const mbid = typeof value === "string" ? value.trim().toLowerCase() : "";
  return MUSICBRAINZ_ARTIST_ID.test(mbid) ? mbid : false;
}

function normalizedFocalPoint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return Object.freeze({ x, y });
}

const MIRRORED_ARTIST_OBJECT_KEY = /^artists\/licensed\/[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?\/[a-f0-9]{48}\.webp$/u;

function safeDeliveryUrl(value) {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.search && !url.hash
      ? url : null;
  } catch {
    return null;
  }
}

function mirroredArtistObjectKey(photo) {
  const key = typeof photo?.mirror?.objectKey === "string" ? photo.mirror.objectKey : "";
  return key.length <= 240 && MIRRORED_ARTIST_OBJECT_KEY.test(key) ? key : null;
}

function deliveryUri(photo, mediaPublicBaseUrl) {
  const objectKey = mirroredArtistObjectKey(photo);
  if (!objectKey) return null;
  const configured = typeof mediaPublicBaseUrl === "string" ? mediaPublicBaseUrl.trim() : "";
  if (!configured) return safeDeliveryUrl(photo.uri)?.toString() || null;
  const base = safeDeliveryUrl(configured);
  if (!base) return null;
  const prefix = base.pathname.replace(/\/+$/u, "");
  const encodedKey = objectKey.split("/").map(encodeURIComponent).join("/");
  return `${base.origin}${prefix}/${encodedKey}`;
}

function artistPhotoCatalog() {
  if (cachedCatalog !== undefined) return cachedCatalog;
  try {
    const parsed = JSON.parse(readFileSync(ARTIST_PHOTO_SOURCE, "utf8"));
    cachedCatalog = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed : Object.freeze({});
  } catch {
    // The verified inventory is optional. A damaged or missing artifact removes
    // the fallback instead of breaking an artist/share page.
    cachedCatalog = Object.freeze({});
  }
  return cachedCatalog;
}

/**
 * Resolve one rights-reviewed photo by the artist table's exact normalized key.
 * No name, alias, fuzzy, or provider fallback crosses this boundary. A supplied
 * MusicBrainz identity is an additional required match.
 */
export function publicArtistPhoto(artistKey, {
  artistMbid = null,
  catalog = null,
  mediaPublicBaseUrl = process.env.MEDIA_PUBLIC_BASE_URL,
} = {}) {
  const key = normalizedArtistKey(artistKey);
  if (!key) return null;
  const inventory = catalog && typeof catalog === "object" && !Array.isArray(catalog)
    ? catalog : artistPhotoCatalog();
  const row = inventory[key];
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  if (normalizedArtistKey(row.artistKey) !== key) return null;

  const storedMbid = normalizedArtistMbid(row.mbid);
  if (storedMbid === false) return null;
  const expectedMbid = normalizedArtistMbid(artistMbid);
  if (expectedMbid === false || (expectedMbid && storedMbid !== expectedMbid)) return null;

  const photo = licensedVenuePhoto(row.photo);
  // Artist derivatives require a source title in addition to the shared
  // licensed-photo provenance so exported cards can provide complete TASL.
  if (!photo?.title) return null;
  const uri = deliveryUri(row.photo, mediaPublicBaseUrl);
  const objectKey = mirroredArtistObjectKey(row.photo);
  const creditId = objectKey?.match(/\/([a-f0-9]{48})\.webp$/u)?.[1] || null;
  const creditPath = creditId ? photoCreditPath(creditId) : null;
  const focalPoint = normalizedFocalPoint(row.photo?.focalPoint);
  return uri ? Object.freeze({
    ...photo,
    uri,
    ...(creditPath ? { creditId, creditPath } : {}),
    ...(focalPoint ? { focalPoint } : {}),
  }) : null;
}
