import { absolutePhotoCreditUrl } from "./photoCredits.js";

const MAX_BINARY_API_BYTES = 4 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const registeredResponses = new WeakSet();

function isBoundedPng(value) {
  return Buffer.isBuffer(value) && value.length >= 100 && value.length <= MAX_BINARY_API_BYTES
    && value.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function safeCanonicalLink(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.origin !== "https://www.mshpit.com" || parsed.username || parsed.password
      || parsed.search || parsed.hash) return null;
    return `<${parsed.toString()}>; rel="canonical"`;
  } catch {
    return null;
  }
}

function safePhotoCreditLink(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.origin !== "https://www.mshpit.com" || parsed.username || parsed.password
      || parsed.search || parsed.hash || absolutePhotoCreditUrl(parsed.pathname) !== parsed.toString()) return null;
    return `<${parsed.toString()}>; rel="license"`;
  } catch {
    return null;
  }
}

/**
 * Register a bounded binary response that the HTTP boundary may send without
 * JSON encoding. The WeakSet prevents a route from accidentally activating
 * this path by returning an object with similarly named fields.
 */
export function createPngApiResponse(bytes, {
  canonicalUrl = null,
  filename = "mshpit-share.png",
  photoCreditUrl = null,
} = {}) {
  if (!isBoundedPng(bytes)) {
    throw new TypeError("PNG API response bytes are invalid");
  }
  const safeFilename = /^[a-z0-9][a-z0-9._-]{0,79}\.png$/iu.test(String(filename || ""))
    ? String(filename)
    : "mshpit-share.png";
  const canonicalLink = safeCanonicalLink(canonicalUrl);
  if (!canonicalLink) throw new TypeError("PNG API response requires a canonical Mshpit URL");
  const photoCreditLink = photoCreditUrl ? safePhotoCreditLink(photoCreditUrl) : null;
  if (photoCreditUrl && !photoCreditLink) throw new TypeError("PNG API response photo credit URL is invalid");
  const response = Object.freeze({
    bytes: Buffer.from(bytes),
    headers: Object.freeze({
      "Content-Type": "image/png",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
      "Cache-Control": "private, no-store",
      Link: [canonicalLink, photoCreditLink].filter(Boolean).join(", "),
    }),
  });
  registeredResponses.add(response);
  return response;
}

export function binaryApiResponsePayload(value) {
  // Buffers remain mutable even when their containing object is frozen.
  // Recheck the trusted format at the final HTTP boundary so a registered
  // response cannot be changed into arbitrary bytes after construction.
  return value && typeof value === "object" && registeredResponses.has(value)
    && isBoundedPng(value.bytes) ? value : null;
}

export const binaryApiResponseConstants = Object.freeze({ maxBytes: MAX_BINARY_API_BYTES });
