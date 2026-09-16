import { readBoundedJsonResponse } from "./boundedJsonResponse.js";
import { commonsVenuePhotoLookupUrl, isRelevantCommonsVenuePhoto } from "../scripts/lib/venue-photo-backfill.mjs";
import { licensedVenuePhoto, VENUE_PHOTO_LICENSES } from "../src/domain/venuePhotoProvenance.mjs";

const licenses = new Map(Object.entries(VENUE_PHOTO_LICENSES).map(([id, value]) => [value.label.toUpperCase(), id]));
const text = value => String(value || "").replace(/<[^>]*>/gu, " ").replace(/&quot;/gu, '"')
  .replace(/&#0?39;|&apos;/gu, "'").replace(/&amp;/gu, "&").replace(/\s+/gu, " ").trim();

function providerError(response, now, code = "provider_unavailable") {
  const error = new Error("Venue photo provider is temporarily unavailable.");
  error.code = code;
  const at = now(), hint = String(response.headers?.get?.("retry-after") || "").trim();
  const retryMs = /^\d+$/u.test(hint) ? Number(hint) * 1000 : Date.parse(hint) - at;
  error.retryAt = at + Math.max(15 * 60_000, Math.min(24 * 3600_000, Number.isFinite(retryMs) ? retryMs : 0));
  return error;
}

function commonsPhotoUrls(photo) {
  if (!photo) return false;
  const image = new URL(photo.uri), source = new URL(photo.sourcePage);
  return ["upload.wikimedia.org", "thumb.wikimedia.org"].includes(image.hostname)
    && (!image.port || image.port === "443")
    && source.hostname === "commons.wikimedia.org"
    && (!source.port || source.port === "443") && source.pathname.startsWith("/wiki/File:");
}

export async function lookupVenuePhoto(venue, { signal, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
  const url = commonsVenuePhotoLookupUrl(venue);
  url.searchParams.set("maxlag", "5");
  url.searchParams.set("iiurlwidth", "1280");
  const response = await fetchImpl(url, { signal: boundedSignal, redirect: "error",
    headers: { Accept: "application/json", "User-Agent": "MshpitVenuePhotoMaintenance/1.0 (https://www.mshpit.com; support@mshpit.com)" } });
  if (!response.ok) {
    await response.body?.cancel?.().catch(() => undefined);
    throw providerError(response, now, response.status === 429 ? "rate_limited" : "provider_unavailable");
  }
  const payload = await readBoundedJsonResponse(response, { maxBytes: 512 * 1024, signal: boundedSignal });
  if (payload?.error) {
    throw providerError(response, now);
  }
  // MediaWiki generator searches with zero hits return {"batchcomplete":""}.
  // Do not mistake an absent/malformed query for a 30-day no-photo finding.
  const completedEmpty = payload && !Array.isArray(payload)
    && payload.batchcomplete === "" && !Object.hasOwn(payload, "query")
    && !payload.warnings && !payload.continue;
  if (completedEmpty) return null;
  const rawPages = payload?.query?.pages;
  if (!rawPages || typeof rawPages !== "object" || Array.isArray(rawPages)) {
    throw providerError(response, now, "invalid_response");
  }
  const pages = Object.values(rawPages);
  if (pages.length > 12) throw new Error("Venue photo provider response exceeds its page bound.");
  for (const page of pages) {
    if (!page || typeof page.title !== "string" || !Array.isArray(page.imageinfo)) {
      throw providerError(response, now, "invalid_response");
    }
    if (!isRelevantCommonsVenuePhoto(page, venue)) continue;
    const info = page.imageinfo?.[0], metadata = info?.extmetadata || {};
    const licenseName = text(metadata.LicenseShortName?.value).toUpperCase();
    const photo = licensedVenuePhoto({ uri: info?.thumburl || info?.url, sourcePage: info?.descriptionurl,
      creator: text(metadata.Artist?.value || metadata.Credit?.value), license: licenses.get(licenseName)
        || (licenseName === "PUBLIC DOMAIN MARK 1.0" ? "PDM-1.0" : null),
      licenseUrl: metadata.LicenseUrl?.value, source: "commons", title: text(page.title).slice(0, 240) });
    if (commonsPhotoUrls(photo)) return photo;
  }
  return null;
}
