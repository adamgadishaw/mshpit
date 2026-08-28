import { projectedTourDateTicketUrl } from "../src/domain/ticketLinks.mjs";

export const MAX_TICKETMASTER_EVENT_IMAGES = 40;

const MAX_IMAGE_URL_LENGTH = 2_048;
const MAX_ATTRIBUTION_LENGTH = 500;
const MAX_IMAGE_DIMENSION = 16_384;
const USEFUL_IMAGE_WIDTH = 1_024;
const USEFUL_IMAGE_HEIGHT = 576;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SPECIAL_USE_HOSTS = Object.freeze([
  "localhost",
  "local",
  "localdomain",
  "internal",
  "lan",
  "home",
  "corp",
  "test",
  "example",
  "invalid",
  "home.arpa",
  "onion",
]);

function hostMatches(hostname, base) {
  return hostname === base || hostname.endsWith(`.${base}`);
}

function validPublicHostname(hostname) {
  if (!hostname || hostname.length > 253 || hostname.endsWith(".") || hostname.includes(":")) return false;
  if (/^\d+(?:\.\d+){3}$/.test(hostname)) return false;
  if (SPECIAL_USE_HOSTS.some((special) => hostMatches(hostname, special))) return false;
  const labels = hostname.split(".");
  if (labels.length < 2) return false;
  if (labels.some((label) => !label || label.length > 63 || !/^[a-z0-9-]+$/.test(label)
    || label.startsWith("-") || label.endsWith("-"))) return false;
  const suffix = labels.at(-1);
  return /^[a-z]{2,63}$/.test(suffix) || /^xn--[a-z0-9-]{2,59}$/.test(suffix);
}

function normalizedHttpsImageUrl(value) {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw || raw.length > MAX_IMAGE_URL_LENGTH || CONTROL_CHARACTERS.test(raw)) return "";

  let parsed;
  try { parsed = new URL(raw); }
  catch { return ""; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return "";
  if (!validPublicHostname(parsed.hostname.toLowerCase())) return "";

  parsed.hash = "";
  const normalized = parsed.toString();
  return normalized.length <= MAX_IMAGE_URL_LENGTH ? normalized : "";
}

function normalizedAttribution(value) {
  if (typeof value !== "string") return "";
  const attribution = value.trim();
  if (!attribution || attribution.length > MAX_ATTRIBUTION_LENGTH || CONTROL_CHARACTERS.test(attribution)) return "";
  return attribution;
}

function normalizedDimension(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_IMAGE_DIMENSION ? value : null;
}

function normalizedCandidate(image, index) {
  if (!image || typeof image !== "object" || Array.isArray(image)) return null;
  const uri = normalizedHttpsImageUrl(image.url);
  const attribution = normalizedAttribution(image.attribution);
  const width = normalizedDimension(image.width);
  const height = normalizedDimension(image.height);
  if (!uri || !attribution || width == null || height == null) return null;

  return {
    uri,
    attribution,
    width,
    height,
    fallback: image.fallback === true,
    sixteenNine: String(image.ratio || "").trim().toLowerCase() === "16_9",
    useful: width >= USEFUL_IMAGE_WIDTH && height >= USEFUL_IMAGE_HEIGHT,
    area: width * height,
    index,
  };
}

function compareCandidates(left, right) {
  if (left.fallback !== right.fallback) return left.fallback ? 1 : -1;
  if (left.sixteenNine !== right.sixteenNine) return left.sixteenNine ? -1 : 1;
  if (left.useful !== right.useful) return left.useful ? -1 : 1;
  if (left.area !== right.area) return right.area - left.area;
  if (left.width !== right.width) return right.width - left.width;
  if (left.height !== right.height) return right.height - left.height;
  return left.index - right.index;
}

/**
 * Select one documented Ticketmaster Discovery API event image without fetching it.
 * The bounded scan keeps hostile or unexpectedly large provider payloads cheap.
 */
export function selectTicketmasterEventImage(event) {
  if (!Array.isArray(event?.images)) return null;
  const candidates = event.images
    .slice(0, MAX_TICKETMASTER_EVENT_IMAGES)
    .map(normalizedCandidate)
    .filter(Boolean)
    .sort(compareCandidates);
  const selected = candidates[0];
  if (!selected) return null;
  return Object.freeze({
    uri: selected.uri,
    attribution: selected.attribution,
    width: selected.width,
    height: selected.height,
  });
}

/** Revalidate persisted provider image data at every public projection boundary. */
export function publicTicketmasterEventImage(row) {
  if (String(row?.source || "").trim().toLowerCase() !== "ticketmaster") return null;
  const sourcePage = projectedTourDateTicketUrl(row);
  if (!sourcePage) return null;

  const uri = normalizedHttpsImageUrl(row?.event_image_url ?? row?.eventImageUrl);
  const attribution = normalizedAttribution(row?.event_image_attribution ?? row?.eventImageAttribution);
  const width = normalizedDimension(row?.event_image_width ?? row?.eventImageWidth);
  const height = normalizedDimension(row?.event_image_height ?? row?.eventImageHeight);
  if (!uri || !attribution || width == null || height == null) return null;

  return Object.freeze({ uri, attribution, width, height, sourcePage });
}
