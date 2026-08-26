const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx"]);
const HEIF_BRANDS = new Set(["heif", "heim", "heis", "mif1", "msf1"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);
const MP4_BRANDS = new Set([
  "avc1", "dash", "iso2", "iso3", "iso4", "iso5", "iso6", "isom",
  "m4v ", "mp41", "mp42", "msdh", "msix",
]);

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
});

const SUPPORTED_MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION));

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
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  const brands = isoBrands(bytes);
  if (brands.some((brand) => HEIC_BRANDS.has(brand))) return "image/heic";
  if (brands.some((brand) => AVIF_BRANDS.has(brand))) return "image/avif";
  if (brands.some((brand) => HEIF_BRANDS.has(brand))) return "image/heif";
  if (brands.includes("qt  ")) return "video/quicktime";
  if (brands.some((brand) => MP4_BRANDS.has(brand))) return "video/mp4";
  return "";
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
  return mediaMimeFromName(fileName);
}
