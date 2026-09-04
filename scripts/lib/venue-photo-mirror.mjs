import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import sharp from "sharp";
import { getMediaConfig, presignS3Request } from "../../server/media.js";
import { PUBLIC_MEDIA_CACHE_CONTROL } from "../../server/mediaDeliveryPolicy.js";
import { licensedVenuePhoto } from "../../src/domain/venuePhotoProvenance.mjs";

const SOURCE_MAX_BYTES = 12 * 1024 * 1024;
const OUTPUT_MAX_BYTES = 8 * 1024 * 1024;
const SOURCE_MAX_REDIRECTS = 3;
const SOURCE_TIMEOUT_MS = 20_000;
const STORAGE_TIMEOUT_MS = 30_000;
// Keep this exact-host allowlist narrow; Commons serves originals and generated thumbnails separately.
const DEFAULT_SOURCE_HOSTS = Object.freeze(["upload.wikimedia.org", "thumb.wikimedia.org"]);
const INPUT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DELIVERY_TYPE = "image/webp";
const DELIVERY_NOTICE = "Converted to WebP and resized when needed by MSHpit for delivery.";
const ARTIST_DELIVERY_NOTICE = "Cropped, resized and converted to WebP.";
const MODIFICATION_NOTICE_MAX = 240;

export class VenuePhotoMirrorError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "VenuePhotoMirrorError";
    this.code = code;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactHost(value) {
  const host = String(value || "").normalize("NFKC").trim().toLowerCase();
  if (!host || host.length > 253 || host.includes("*") || host.includes("/") || host.includes(":")) return null;
  if (isIP(host) || host === "localhost" || host.endsWith(".localhost")
      || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(host)) return null;
  return host;
}

export function venuePhotoMirrorSourceHosts(env = process.env) {
  const configured = String(env.VENUE_PHOTO_MIRROR_SOURCE_HOSTS || "")
    .split(",").map(exactHost).filter(Boolean).slice(0, 20);
  return new Set([...DEFAULT_SOURCE_HOSTS, ...configured]);
}

export function venuePhotoMirrorConfigured(env = process.env) {
  try { return getMediaConfig(env).configured; }
  catch { return false; }
}

function approvedSourceUrl(value, allowedHosts) {
  let url;
  try { url = new URL(value); }
  catch { throw new VenuePhotoMirrorError("SOURCE_URL_INVALID", "The licensed photo URL is invalid."); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
      || !allowedHosts.has(url.hostname.toLowerCase())) {
    throw new VenuePhotoMirrorError("SOURCE_HOST_NOT_APPROVED", "The licensed photo host has not been approved for offline mirroring.");
  }
  url.hash = "";
  return url;
}

function boundedPositiveInteger(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) return fallback;
  return Math.min(number, maximum);
}

function withTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function boundedResponseBytes(response, maximum, code) {
  const declared = Number(response?.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maximum) {
    throw new VenuePhotoMirrorError(code, "The image exceeds the offline mirror byte limit.");
  }
  const reader = response?.body?.getReader?.();
  if (!reader) {
    if (!Number.isFinite(declared) || declared < 0 || typeof response?.arrayBuffer !== "function") {
      throw new VenuePhotoMirrorError("SOURCE_BODY_UNREADABLE", "The image response could not be read safely.");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maximum) throw new VenuePhotoMirrorError(code, "The image exceeds the offline mirror byte limit.");
    return bytes;
  }
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value?.byteLength || 0;
      if (total > maximum) {
        await reader.cancel().catch(() => {});
        throw new VenuePhotoMirrorError(code, "The image exceeds the offline mirror byte limit.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks, total);
}

function normalizedContentType(value) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

function detectedImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF"
      && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

async function fetchLicensedSource(photo, { fetchImpl, env, sourceMaxBytes, sourceTimeoutMs }) {
  const allowedHosts = venuePhotoMirrorSourceHosts(env);
  let target = approvedSourceUrl(photo.uri, allowedHosts);
  const timeout = withTimeout(sourceTimeoutMs);
  try {
    for (let redirects = 0; redirects <= SOURCE_MAX_REDIRECTS; redirects += 1) {
      let response;
      try {
        response = await fetchImpl(target, {
          method: "GET",
          redirect: "manual",
          signal: timeout.signal,
          headers: {
            Accept: "image/webp,image/png,image/jpeg",
            "User-Agent": "MSHpitVenuePhotoMirror/1.0 (https://mshpit.com; founder@mshpit.com)",
          },
        });
      } catch (error) {
        throw new VenuePhotoMirrorError(timeout.signal.aborted ? "SOURCE_TIMEOUT" : "SOURCE_FETCH_FAILED",
          "The licensed photo could not be downloaded.", error);
      }
      if (response.status >= 300 && response.status < 400) {
        if (redirects === SOURCE_MAX_REDIRECTS) {
          throw new VenuePhotoMirrorError("SOURCE_REDIRECT_LIMIT", "The licensed photo redirected too many times.");
        }
        const location = response.headers.get("location");
        if (!location) throw new VenuePhotoMirrorError("SOURCE_REDIRECT_INVALID", "The licensed photo returned an invalid redirect.");
        target = approvedSourceUrl(new URL(location, target).toString(), allowedHosts);
        continue;
      }
      if (response.status !== 200) {
        throw new VenuePhotoMirrorError("SOURCE_HTTP_ERROR", `The licensed photo returned HTTP ${response.status}.`);
      }
      const statedType = normalizedContentType(response.headers.get("content-type"));
      if (!INPUT_TYPES.has(statedType)) {
        throw new VenuePhotoMirrorError("SOURCE_TYPE_UNSUPPORTED", "The licensed photo response is not a supported still-image type.");
      }
      const bytes = await boundedResponseBytes(response, sourceMaxBytes, "SOURCE_TOO_LARGE");
      const detectedType = detectedImageType(bytes);
      if (!detectedType || detectedType !== statedType) {
        throw new VenuePhotoMirrorError("SOURCE_TYPE_MISMATCH", "The licensed photo bytes do not match the declared image type.");
      }
      return bytes;
    }
  } finally {
    timeout.clear();
  }
  throw new VenuePhotoMirrorError("SOURCE_FETCH_FAILED", "The licensed photo could not be downloaded.");
}

async function sanitizedDelivery(sourceBytes, outputMaxBytes, photoKind = "venue") {
  let result;
  try {
    result = await sharp(sourceBytes, { failOn: "warning", limitInputPixels: 40_000_000, animated: false })
      .rotate()
      .resize({ width: 1_920, height: 1_440, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84, effort: 4 })
      .toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw new VenuePhotoMirrorError("SOURCE_DECODE_FAILED", "The licensed photo could not be decoded safely.", error);
  }
  const width = Number(result.info?.width);
  const height = Number(result.info?.height);
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1
      || result.data.byteLength < 1 || result.data.byteLength > outputMaxBytes) {
    throw new VenuePhotoMirrorError("DELIVERY_INVALID", `The sanitized ${photoKind} photo exceeds the delivery limits.`);
  }
  return { bytes: result.data, width, height, contentType: DELIVERY_TYPE, digest: sha256(result.data) };
}

function licensedPhotoObjectSegment(value, {
  errorCode = "VENUE_KEY_INVALID",
  errorMessage = "A stable venue key is required for mirroring.",
  fallback = "venue",
} = {}) {
  const identity = String(value || "").normalize("NFKC").trim();
  if (!identity || identity.length > 300 || /[\u0000-\u001f\u007f]/u.test(identity)) {
    throw new VenuePhotoMirrorError(errorCode, errorMessage);
  }
  const slug = identity.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 48) || fallback;
  return `${slug}-${sha256(identity).slice(0, 12)}`;
}

function encodePathPart(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function objectUrl(base, bucket, objectKey) {
  const prefix = base.pathname.replace(/\/+$/u, "");
  const suffix = [bucket, ...objectKey.split("/")].map(encodePathPart).join("/");
  return `${base.origin}${prefix}/${suffix}`;
}

function publicObjectUrl(base, objectKey) {
  const prefix = base.pathname.replace(/\/+$/u, "");
  return `${base.origin}${prefix}/${objectKey.split("/").map(encodePathPart).join("/")}`;
}

function storageUpload(delivery, entityKey, {
  env,
  now,
  namespace = "venues",
  photoKind = "venue",
  identityOptions,
}) {
  const config = getMediaConfig(env);
  if (!config.configured) {
    throw new VenuePhotoMirrorError("STORAGE_UNCONFIGURED", `Public media storage is not configured for ${photoKind}-photo mirroring.`);
  }
  const key = `${namespace}/licensed/${licensedPhotoObjectSegment(entityKey, identityOptions)}/${delivery.digest.slice(0, 48)}.webp`;
  const headers = {
    "Cache-Control": PUBLIC_MEDIA_CACHE_CONTROL,
    "Content-Length": String(delivery.bytes.byteLength),
    "Content-Type": delivery.contentType,
    "If-None-Match": "*",
  };
  const endpointUrl = objectUrl(config.endpoint, config.bucket, key);
  const uploadUrl = presignS3Request({
    method: "PUT", url: endpointUrl, region: config.region, accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey, headers, expiresIn: 300, now,
  });
  return {
    key,
    publicUrl: publicObjectUrl(config.publicBase, key),
    uploadUrl,
    endpointUrl,
    headers,
    config,
  };
}

async function verifyExistingObject(upload, delivery, { fetchImpl, now, storageTimeoutMs }) {
  const downloadUrl = presignS3Request({
    method: "GET", url: upload.endpointUrl, region: upload.config.region,
    accessKeyId: upload.config.accessKeyId, secretAccessKey: upload.config.secretAccessKey,
    expiresIn: 120, now,
  });
  const timeout = withTimeout(storageTimeoutMs);
  try {
    const response = await fetchImpl(downloadUrl, { method: "GET", redirect: "error", signal: timeout.signal });
    if (response.status !== 200 || normalizedContentType(response.headers.get("content-type")) !== DELIVERY_TYPE) return false;
    const bytes = await boundedResponseBytes(response, OUTPUT_MAX_BYTES, "STORAGE_OBJECT_TOO_LARGE");
    const actual = Buffer.from(sha256(bytes), "hex");
    const expected = Buffer.from(delivery.digest, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  } finally {
    timeout.clear();
  }
}

function mirroredModificationNotice(photo, deliveryNotice = DELIVERY_NOTICE) {
  const prior = String(photo.modificationNotice || "").trim();
  if (!prior) return deliveryNotice;
  if (prior.endsWith(deliveryNotice)) return prior;
  const prefixLimit = MODIFICATION_NOTICE_MAX - deliveryNotice.length - 1;
  if (prior.length <= prefixLimit) return `${prior} ${deliveryNotice}`;
  let prefix = prior.slice(0, Math.max(0, prefixLimit - 1));
  // Do not leave a dangling UTF-16 high surrogate when truncating a creator-
  // supplied notice. The validator applies the same 240-code-unit ceiling.
  if (/[\uD800-\uDBFF]$/u.test(prefix)) prefix = prefix.slice(0, -1);
  prefix = prefix.trimEnd();
  return prefix ? `${prefix}… ${deliveryNotice}` : deliveryNotice;
}

async function mirrorLicensedEntityPhoto({
  entityKey,
  namespace,
  photoKind,
  identityOptions,
  photo,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = new Date(),
  sourceMaxBytes = SOURCE_MAX_BYTES,
  outputMaxBytes = OUTPUT_MAX_BYTES,
  sourceTimeoutMs = SOURCE_TIMEOUT_MS,
  storageTimeoutMs = STORAGE_TIMEOUT_MS,
  deliveryNotice = DELIVERY_NOTICE,
} = {}) {
  const licensed = licensedVenuePhoto(photo);
  if (!licensed) {
    throw new VenuePhotoMirrorError("PROVENANCE_INVALID", "Only complete, validator-approved licensed photos can be mirrored.");
  }
  if (typeof fetchImpl !== "function") {
    throw new VenuePhotoMirrorError("FETCH_UNAVAILABLE", `${photoKind[0].toUpperCase()}${photoKind.slice(1)}-photo mirroring requires a fetch implementation.`);
  }
  if (!venuePhotoMirrorConfigured(env)) {
    throw new VenuePhotoMirrorError("STORAGE_UNCONFIGURED", `Public media storage is not configured for ${photoKind}-photo mirroring.`);
  }
  const boundedSourceBytes = boundedPositiveInteger(sourceMaxBytes, SOURCE_MAX_BYTES, SOURCE_MAX_BYTES);
  const boundedOutputBytes = boundedPositiveInteger(outputMaxBytes, OUTPUT_MAX_BYTES, OUTPUT_MAX_BYTES);
  const boundedSourceTimeout = boundedPositiveInteger(sourceTimeoutMs, SOURCE_TIMEOUT_MS, 60_000);
  const boundedStorageTimeout = boundedPositiveInteger(storageTimeoutMs, STORAGE_TIMEOUT_MS, 60_000);
  const sourceBytes = await fetchLicensedSource(licensed, {
    fetchImpl, env, sourceMaxBytes: boundedSourceBytes, sourceTimeoutMs: boundedSourceTimeout,
  });
  const delivery = await sanitizedDelivery(sourceBytes, boundedOutputBytes, photoKind);
  const upload = storageUpload(delivery, entityKey, {
    env, now, namespace, photoKind, identityOptions,
  });
  const timeout = withTimeout(boundedStorageTimeout);
  let response;
  try {
    response = await fetchImpl(upload.uploadUrl, {
      method: "PUT", redirect: "error", signal: timeout.signal,
      headers: upload.headers, body: delivery.bytes,
    });
  } catch (error) {
    throw new VenuePhotoMirrorError(timeout.signal.aborted ? "STORAGE_TIMEOUT" : "STORAGE_UPLOAD_FAILED",
      `The sanitized ${photoKind} photo could not be stored.`, error);
  } finally {
    timeout.clear();
  }
  let reused = false;
  if (response.status === 409 || response.status === 412) {
    reused = await verifyExistingObject(upload, delivery, {
      fetchImpl, now, storageTimeoutMs: boundedStorageTimeout,
    });
    if (!reused) {
      throw new VenuePhotoMirrorError("STORAGE_CONFLICT", `An existing ${photoKind}-photo object did not match the sanitized source.`);
    }
  } else if (![200, 201, 204].includes(response.status)) {
    throw new VenuePhotoMirrorError("STORAGE_HTTP_ERROR", `Public media storage returned HTTP ${response.status}.`);
  }

  return {
    ...licensed,
    uri: upload.publicUrl,
    modificationNotice: mirroredModificationNotice(licensed, deliveryNotice),
    mirroredFrom: licensed.uri,
    mirror: {
      objectKey: upload.key,
      contentType: delivery.contentType,
      byteSize: delivery.bytes.byteLength,
      sha256: delivery.digest,
      width: delivery.width,
      height: delivery.height,
      reused,
    },
  };
}

export async function mirrorLicensedVenuePhoto(options = {}) {
  const { venueKey, ...rest } = options;
  return mirrorLicensedEntityPhoto({
    ...rest,
    entityKey: venueKey,
    namespace: "venues",
    photoKind: "venue",
    identityOptions: {
      errorCode: "VENUE_KEY_INVALID",
      errorMessage: "A stable venue key is required for mirroring.",
      fallback: "venue",
    },
  });
}

export async function mirrorLicensedArtistPhoto(options = {}) {
  const { artistKey, ...rest } = options;
  return mirrorLicensedEntityPhoto({
    ...rest,
    entityKey: artistKey,
    namespace: "artists",
    photoKind: "artist",
    identityOptions: {
      errorCode: "ARTIST_KEY_INVALID",
      errorMessage: "A stable artist key is required for mirroring.",
      fallback: "artist",
    },
    deliveryNotice: ARTIST_DELIVERY_NOTICE,
  });
}
