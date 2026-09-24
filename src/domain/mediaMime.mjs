const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx"]);
const HEIF_BRANDS = new Set(["heif", "heim", "heis", "mif1", "msf1"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);
const MP4_BRANDS = new Set([
  "avc1", "dash", "iso2", "iso3", "iso4", "iso5", "iso6", "isom",
  "m4v ", "mp41", "mp42", "msdh", "msix",
]);
// ISO files that are photos, not clips (Canon RAW uses an ftyp box too).
const NON_VIDEO_BRANDS = new Set(["crx "]);

// Every video container people commonly have on a phone or computer. Clips are
// published exactly as uploaded, so a format a browser cannot decode still
// posts; the player offers the file instead of an inline preview.
export const VIDEO_EXTENSION_BY_MIME = Object.freeze({
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-m4v": "m4v",
  "video/3gpp": "3gp",
  "video/3gpp2": "3g2",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/ogg": "ogv",
  "video/x-msvideo": "avi",
  "video/mpeg": "mpg",
  "video/mp2t": "ts",
  "video/x-ms-wmv": "wmv",
  "video/x-flv": "flv",
});
export const VIDEO_SOURCE_MIME_TYPES = Object.freeze(Object.keys(VIDEO_EXTENSION_BY_MIME));

// Names some systems use for the same containers.
const VIDEO_MIME_ALIASES = Object.freeze({
  "video/matroska": "video/x-matroska",
  "video/mkv": "video/x-matroska",
  "video/avi": "video/x-msvideo",
  "video/msvideo": "video/x-msvideo",
  "video/x-mpeg": "video/mpeg",
  "video/mpg": "video/mpeg",
  "video/wmv": "video/x-ms-wmv",
  "video/x-ms-asf": "video/x-ms-wmv",
  "video/flv": "video/x-flv",
  "video/m4v": "video/x-m4v",
  "video/3gp": "video/3gpp",
  "video/vnd.dlna.mpeg-tts": "video/mp2t",
});

const MIME_BY_EXTENSION = Object.freeze({
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  qt: "video/quicktime",
  m4v: "video/x-m4v",
  "3gp": "video/3gpp",
  "3g2": "video/3gpp2",
  mkv: "video/x-matroska",
  ogv: "video/ogg",
  avi: "video/x-msvideo",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  ts: "video/mp2t",
  mts: "video/mp2t",
  m2ts: "video/mp2t",
  wmv: "video/x-ms-wmv",
  flv: "video/x-flv",
});

const SUPPORTED_MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION));

export function normalizedVideoMimeType(value) {
  const type = String(value || "").split(";", 1)[0].trim().toLowerCase();
  const canonical = VIDEO_MIME_ALIASES[type] || type;
  return VIDEO_EXTENSION_BY_MIME[canonical] ? canonical : "";
}

function bytesView(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function matches(bytes, signature) {
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes, start, end) {
  let value = "";
  for (let index = start; index < end && index < bytes.length; index += 1) {
    value += String.fromCharCode(bytes[index]);
  }
  return value;
}

function isoBrands(bytes) {
  if (bytes.length < 12 || ascii(bytes, 4, 8) !== "ftyp") return [];
  const declaredSize = (((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3]) >>> 0;
  const end = Math.min(bytes.length, declaredSize >= 16 ? declaredSize : bytes.length);
  const brands = [];
  for (let offset = 8; offset + 4 <= end; offset += 4) {
    if (offset !== 12) brands.push(ascii(bytes, offset, offset + 4).toLowerCase());
  }
  return brands;
}

export function detectMediaMimeType(value) {
  const bytes = bytesView(value);
  if (!bytes) return "";
  if (matches(bytes, JPEG)) return "image/jpeg";
  if (matches(bytes, PNG)) return "image/png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  const gif = ascii(bytes, 0, 6);
  if (gif === "GIF87a" || gif === "GIF89a") return "image/gif";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    // WebM and Matroska share EBML; the DocType string sits in the header.
    return ascii(bytes, 0, Math.min(bytes.length, 64)).includes("matroska") ? "video/x-matroska" : "video/webm";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "AVI ") return "video/x-msvideo";
  if (ascii(bytes, 0, 4) === "OggS") return "video/ogg";
  if (matches(bytes, [0x00, 0x00, 0x01, 0xba]) || matches(bytes, [0x00, 0x00, 0x01, 0xb3])) return "video/mpeg";
  if (matches(bytes, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11])) return "video/x-ms-wmv";
  if (ascii(bytes, 0, 3) === "FLV" && bytes[3] === 0x01) return "video/x-flv";
  const brands = isoBrands(bytes);
  if (!brands.length) return "";
  const major = brands[0];
  const videoMajor = major === "qt  " || MP4_BRANDS.has(major) || /^3g[p2gse]/u.test(major);
  if (!videoMajor) {
    if (brands.some((brand) => HEIC_BRANDS.has(brand))) return "image/heic";
    if (brands.some((brand) => AVIF_BRANDS.has(brand))) return "image/avif";
    if (brands.some((brand) => HEIF_BRANDS.has(brand))) return "image/heif";
    if (NON_VIDEO_BRANDS.has(major)) return "";
  }
  if (brands.includes("qt  ")) return "video/quicktime";
  if (major.startsWith("3g2")) return "video/3gpp2";
  if (/^3g[pgse]/u.test(major)) return "video/3gpp";
  // Any other ISO base media file is a clip in the MP4 family (camera brands
  // such as XAVC or MSNV included).
  return "video/mp4";
}

// The server's check that an uploaded "video" really is one. Any recognised
// video container passes; images, HTML and unknown bytes do not. MPEG transport
// streams have no header, only a 0x47 sync byte every 188 bytes.
export function looksLikeVideoContainer(value, declaredType = "") {
  const bytes = bytesView(value);
  if (!bytes?.length) return false;
  const detected = detectMediaMimeType(bytes);
  if (detected) return detected.startsWith("video/");
  return normalizedVideoMimeType(declaredType) === "video/mp2t" && bytes[0] === 0x47;
}

export function mediaMimeFromName(value) {
  const clean = String(value || "").split(/[?#]/, 1)[0];
  const match = clean.match(/\.([a-z0-9]+)$/i);
  return match ? MIME_BY_EXTENSION[match[1].toLowerCase()] || "" : "";
}

export function resolveMediaMimeType({ bytes, declaredType, fileName } = {}) {
  const detected = detectMediaMimeType(bytes);
  if (detected) return detected;
  const declared = String(declaredType || "").split(";", 1)[0].trim().toLowerCase();
  if (SUPPORTED_MIME_TYPES.has(declared)) return declared;
  const video = normalizedVideoMimeType(declared);
  if (video) return video;
  return mediaMimeFromName(fileName);
}
