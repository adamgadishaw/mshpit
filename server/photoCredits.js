import { readFileSync } from "node:fs";

import { licensedVenuePhoto, VENUE_PHOTO_LICENSES } from "../src/domain/venuePhotoProvenance.mjs";

const HISTORICAL_CREDITS_SOURCE = new URL("../src/seed/catalog.photo-credits.json", import.meta.url);
const CURRENT_ARTIST_PHOTOS_SOURCE = new URL("../src/seed/catalog.artist-photos.verified.json", import.meta.url);
const CREDIT_ID = /^[a-f0-9]{48}$/u;
const MIRRORED_ARTIST_OBJECT_KEY = /^(artists\/licensed\/[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?\/([a-f0-9]{48})\.webp)$/u;
const PUBLIC_CREDIT_PREFIX = "/photo-credits/";
const PUBLIC_ORIGIN = "https://www.mshpit.com";

let cachedRegistry;

function jsonObject(source) {
  try {
    const parsed = JSON.parse(readFileSync(source, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function cleanText(value, max) {
  const text = typeof value === "string"
    ? value.normalize("NFKC").replace(/\s+/gu, " ").trim()
    : "";
  return text && text.length <= max && !/[\u0000-\u001f\u007f]/u.test(text) ? text : null;
}

function exactHttpsUrl(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2_048) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function creditIdFromObjectKey(value) {
  const match = typeof value === "string" && value.length <= 240
    ? MIRRORED_ARTIST_OBJECT_KEY.exec(value)
    : null;
  return match ? match[2] : null;
}

function objectKeyFromDeliveryUrl(value) {
  const url = exactHttpsUrl(value);
  if (!url) return null;
  try {
    const pathname = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, "");
    const marker = pathname.indexOf("artists/licensed/");
    if (marker < 0) return null;
    const objectKey = pathname.slice(marker);
    return MIRRORED_ARTIST_OBJECT_KEY.test(objectKey) ? objectKey : null;
  } catch {
    return null;
  }
}

function normalizedRecord(rawId, row) {
  const id = typeof rawId === "string" ? rawId.trim().toLowerCase() : "";
  const artistKey = cleanText(row?.artistKey, 200)?.toLocaleLowerCase("en") || null;
  const photo = licensedVenuePhoto(row?.photo);
  const title = cleanText(row?.photo?.title, 240);
  const objectKey = typeof row?.photo?.mirror?.objectKey === "string"
    ? row.photo.mirror.objectKey
    : null;
  const objectId = creditIdFromObjectKey(objectKey);
  const uriObjectKey = objectKeyFromDeliveryUrl(row?.photo?.uri);
  const fullSha = typeof row?.photo?.mirror?.sha256 === "string"
    ? row.photo.mirror.sha256.trim().toLowerCase()
    : null;
  if (!CREDIT_ID.test(id) || !artistKey || !photo || !title || objectId !== id
    || uriObjectKey !== objectKey
    || (fullSha && (!/^[a-f0-9]{64}$/u.test(fullSha) || !fullSha.startsWith(id)))) return null;
  const licenseLabel = VENUE_PHOTO_LICENSES[photo.license]?.label || photo.license;
  return Object.freeze({
    id,
    artistKey,
    path: `${PUBLIC_CREDIT_PREFIX}${id}`,
    photo: Object.freeze({ ...photo, title }),
    objectKey,
    licenseLabel,
  });
}

function registryFromSources() {
  const historical = jsonObject(HISTORICAL_CREDITS_SOURCE);
  const current = jsonObject(CURRENT_ARTIST_PHOTOS_SOURCE);
  const candidates = [
    ...Object.entries(historical),
    ...Object.values(current).map((row) => [creditIdFromObjectKey(row?.photo?.mirror?.objectKey), row]),
  ];
  const registry = new Map();
  const conflicts = new Set();
  for (const [id, row] of candidates) {
    const record = normalizedRecord(id, row);
    if (!record || conflicts.has(record.id)) continue;
    const previous = registry.get(record.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(record)) {
      registry.delete(record.id);
      conflicts.add(record.id);
    } else if (!previous) {
      registry.set(record.id, record);
    }
  }
  return registry;
}

function photoCreditRegistry() {
  if (!cachedRegistry) cachedRegistry = registryFromSources();
  return cachedRegistry;
}

export function photoCreditPath(id) {
  const normalized = typeof id === "string" ? id.trim().toLowerCase() : "";
  return CREDIT_ID.test(normalized) && photoCreditRegistry().has(normalized)
    ? `${PUBLIC_CREDIT_PREFIX}${normalized}`
    : null;
}

export function photoCreditForId(id) {
  const path = photoCreditPath(id);
  return path ? photoCreditRegistry().get(path.slice(PUBLIC_CREDIT_PREFIX.length)) || null : null;
}

export function photoCreditPathFromArtwork(artwork) {
  if (!artwork || typeof artwork !== "object" || Array.isArray(artwork)) return null;
  const objectKey = objectKeyFromDeliveryUrl(artwork.url || artwork.uri);
  const id = creditIdFromObjectKey(objectKey);
  const record = id ? photoCreditForId(id) : null;
  if (!record || record.objectKey !== objectKey) return null;
  const fields = ["title", "creator", "license", "licenseUrl", "sourcePage", "modificationNotice"];
  if (fields.some((field) => String(artwork[field] || "") !== String(record.photo[field] || ""))) return null;
  return record.path;
}

export function absolutePhotoCreditUrl(path) {
  const normalized = typeof path === "string" ? path.trim().toLowerCase() : "";
  const id = normalized.startsWith(PUBLIC_CREDIT_PREFIX)
    ? normalized.slice(PUBLIC_CREDIT_PREFIX.length)
    : "";
  const verified = photoCreditPath(id);
  return verified === normalized ? `${PUBLIC_ORIGIN}${verified}` : null;
}

export function photoCreditPageForPath(pathname) {
  const normalized = typeof pathname === "string"
    ? pathname.split(/[?#]/u, 1)[0].replace(/\/+$/u, "").toLowerCase()
    : "";
  const id = normalized.startsWith(PUBLIC_CREDIT_PREFIX)
    ? normalized.slice(PUBLIC_CREDIT_PREFIX.length)
    : "";
  const record = photoCreditForId(id);
  if (!record || normalized !== record.path) return null;
  const artistName = record.artistKey.replace(/(^|\s)\S/gu, (letter) => letter.toUpperCase());
  return Object.freeze({
    path: record.path,
    indexable: false,
    title: `Photo source: ${artistName}`,
    description: `Source and reuse information for a photo used in a Mshpit share card featuring ${artistName}.`,
    intro: `This page records the source and reuse terms for the ${artistName} photo used in a Mshpit share card.`,
    note: "The share card itself stays uncluttered; the permanent source record remains here.",
    heroImage: record.photo.uri,
    heroImageAlt: `${artistName} - ${record.photo.title}`,
    licenseUrl: record.photo.licenseUrl,
    sections: [
      {
        heading: "Photo details",
        paragraphs: [
          `Title: ${record.photo.title}`,
          `Creator: ${record.photo.creator}`,
          `License: ${record.licenseLabel}`,
          ...(record.photo.modificationNotice ? [`Changes: ${record.photo.modificationNotice}`] : []),
        ],
        links: [
          { label: "View original source", href: record.photo.sourcePage },
          { label: "Read the license", href: record.photo.licenseUrl },
        ],
      },
    ],
  });
}

function xml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

export function licensedArtworkXmp({ artwork, creditUrl }) {
  const creditPath = photoCreditPathFromArtwork(artwork);
  const verifiedCreditUrl = absolutePhotoCreditUrl(creditPath);
  if (!verifiedCreditUrl || creditUrl !== verifiedCreditUrl) return null;
  const record = photoCreditForId(creditPath.slice(PUBLIC_CREDIT_PREFIX.length));
  if (!record) return null;
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:cc="http://creativecommons.org/ns#" xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/">
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xml(record.photo.title)}</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>${xml(record.photo.creator)}</rdf:li></rdf:Seq></dc:creator>
   <dc:source>${xml(record.photo.sourcePage)}</dc:source>
   <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${xml(`${record.licenseLabel}. ${record.photo.modificationNotice || "No changes stated."}`)}</rdf:li></rdf:Alt></dc:rights>
   <cc:license rdf:resource="${xml(record.photo.licenseUrl)}" />
   <xmpRights:Marked>True</xmpRights:Marked>
   <xmpRights:WebStatement>${xml(verifiedCreditUrl)}</xmpRights:WebStatement>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

export const photoCreditConstants = Object.freeze({
  pathPrefix: PUBLIC_CREDIT_PREFIX,
  publicOrigin: PUBLIC_ORIGIN,
});
