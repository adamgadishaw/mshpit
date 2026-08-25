import { inflateSync } from "node:zlib";

// These limits are enforced before libvips visits pixels. Twenty-four
// megapixels still covers ordinary phone-camera uploads while bounding an
// isolated decoder job to roughly 96 MiB of 8-bit RGBA pixels.
export const MAX_IMAGE_PIXELS = 24_000_000;
export const MAX_IMAGE_EDGE = 16_384;
export const MAX_PNG_BIT_DEPTH = 8;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SAFE_PNG_CHUNKS = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "cHRM", "gAMA", "sRGB"]);
const HEIF_BRANDS = new Set(["avif", "heic", "heif", "heix", "hevc", "hevx", "mif1", "msf1"]);
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx"]);
const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export class ImageInspectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ImageInspectionError";
    this.code = code;
  }
}

function invalid(code = "malformed", message = "Image bytes are malformed.") {
  throw new ImageInspectionError(code, message);
}

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  invalid("invalid_input", "Image bytes are missing.");
}

function assertResourceBounds(width, height, limits) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
      || width > limits.maxEdge || height > limits.maxEdge || width * height > limits.maxPixels) {
    invalid("resource_limit", "Image dimensions exceed the safe processing limit.");
  }
}

function detectedMimeType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= PNG_SIGNATURE.length && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return "image/png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) return "image/gif";
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") return "image/heif";
  return null;
}

function expectedTypeMatches(actual, expected, bytes) {
  if (actual !== "image/heif") return actual === expected;
  if (!new Set(["image/heic", "image/heif"]).has(expected)) return false;
  const boxSize = bytes.readUInt32BE(0);
  if (boxSize < 16 || boxSize > bytes.length) return false;
  const brands = [];
  for (let offset = 8; offset + 4 <= boxSize; offset += 4) {
    if (offset === 12) continue; // ftyp minor version
    brands.push(bytes.toString("ascii", offset, offset + 4));
  }
  return expected === "image/heic"
    ? brands.some((brand) => HEIC_BRANDS.has(brand))
    : brands.some((brand) => HEIF_BRANDS.has(brand));
}

function inspectJpeg(bytes, { sanitized, allowTrailing = false }) {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) invalid();
  let offset = 2;
  let width = null;
  let height = null;
  let scans = 0;
  let metadataPresent = false;
  let inEntropy = false;
  while (offset < bytes.length) {
    if (inEntropy) {
      while (offset < bytes.length) {
        if (bytes[offset++] !== 0xff) continue;
        while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
        if (offset >= bytes.length) invalid();
        const marker = bytes[offset];
        if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
          offset += 1;
          continue;
        }
        offset -= 1;
        inEntropy = false;
        break;
      }
      if (inEntropy) invalid();
    }
    if (bytes[offset++] !== 0xff) invalid();
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) invalid();
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!width || !height || scans < 1) invalid();
      if (offset !== bytes.length && !allowTrailing) {
        invalid("trailing_data", "JPEG contains bytes after its end marker.");
      }
      return { width, height, metadataPresent, endOffset: offset };
    }
    if (marker === 0xd8 || marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) invalid();
    if (offset + 2 > bytes.length) invalid();
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) invalid();
    const payloadStart = offset + 2;
    const payloadEnd = offset + segmentLength;
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 8) invalid();
      const candidateHeight = bytes.readUInt16BE(payloadStart + 1);
      const candidateWidth = bytes.readUInt16BE(payloadStart + 3);
      if (!candidateWidth || !candidateHeight || (width && (width !== candidateWidth || height !== candidateHeight))) invalid();
      width = candidateWidth;
      height = candidateHeight;
    }
    if (marker === 0xda) {
      scans += 1;
      inEntropy = true;
    }
    if (marker === 0xfe || (marker >= 0xe1 && marker <= 0xed) || marker === 0xef) metadataPresent = true;
    if (sanitized && marker === 0xe0) {
      const label = bytes.toString("ascii", payloadStart, Math.min(payloadEnd, payloadStart + 5));
      if (label !== "JFIF\0" && label !== "JFXX\0") invalid("metadata", "Public JPEG contains an unapproved application segment.");
    }
    if (sanitized && marker === 0xee) {
      if (payloadEnd - payloadStart < 5 || bytes.toString("ascii", payloadStart, payloadStart + 5) !== "Adobe") {
        invalid("metadata", "Public JPEG contains an unapproved application segment.");
      }
    }
    if (sanitized && (marker === 0xfe || (marker >= 0xe1 && marker <= 0xed) || marker === 0xef)) {
      invalid("metadata", "Public JPEG contains metadata.");
    }
    offset = payloadEnd;
  }
  invalid();
}

let crcTable;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      crcTable[index] = value >>> 0;
    }
  }
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngPasses(width, height, interlace) {
  if (!interlace) return [[width, height]];
  const layout = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
  return layout.map(([x, y, dx, dy]) => [
    width > x ? Math.ceil((width - x) / dx) : 0,
    height > y ? Math.ceil((height - y) / dy) : 0,
  ]).filter(([columns, rows]) => columns && rows);
}

function validatePngInflate(idat, { width, height, bitDepth, colorType, interlace }) {
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType];
  if (!channels) invalid();
  const passes = pngPasses(width, height, interlace);
  const layouts = passes.map(([columns, rows]) => ({ rows, rowBytes: Math.ceil(columns * channels * bitDepth / 8) }));
  const expected = layouts.reduce((total, pass) => total + pass.rows * (pass.rowBytes + 1), 0);
  let inflated;
  try { inflated = inflateSync(Buffer.concat(idat), { maxOutputLength: expected }); }
  catch { invalid("decode", "PNG compressed pixels are malformed or exceed their declared dimensions."); }
  if (inflated.length !== expected) invalid("decode", "PNG pixel data does not match its declared dimensions.");
  let offset = 0;
  for (const pass of layouts) {
    for (let row = 0; row < pass.rows; row += 1) {
      if (inflated[offset] > 4) invalid("decode", "PNG contains an invalid row filter.");
      offset += pass.rowBytes + 1;
    }
  }
}

function inspectPng(bytes, { sanitized }) {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) invalid();
  let offset = 8;
  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  let sawIhdr = false;
  let sawIdat = false;
  let idatEnded = false;
  let sawIend = false;
  let metadataPresent = false;
  const idat = [];
  let chunks = 0;
  while (offset < bytes.length) {
    if (++chunks > 4096 || offset + 12 > bytes.length) invalid();
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (!/^[A-Za-z]{4}$/.test(type) || dataEnd < dataStart || chunkEnd > bytes.length) invalid();
    if (crc32(bytes.subarray(offset + 4, dataEnd)) !== bytes.readUInt32BE(dataEnd)) invalid("checksum", "PNG chunk checksum is invalid.");
    if (!sawIhdr && type !== "IHDR") invalid();
    if (sawIend) invalid("trailing_data", "PNG contains bytes after IEND.");
    if (type === "IHDR") {
      if (sawIhdr || length !== 13) invalid();
      sawIhdr = true;
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      interlace = bytes[dataStart + 12];
      const validDepths = ({ 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] })[colorType];
      if (!validDepths?.includes(bitDepth) || bytes[dataStart + 10] !== 0 || bytes[dataStart + 11] !== 0 || ![0, 1].includes(interlace)) invalid();
      if (bitDepth > MAX_PNG_BIT_DEPTH) {
        invalid("resource_limit", "PNG precision exceeds the safe processing limit.");
      }
    } else if (type === "IDAT") {
      if (idatEnded || !length) invalid();
      sawIdat = true;
      idat.push(bytes.subarray(dataStart, dataEnd));
    } else {
      if (sawIdat) idatEnded = true;
      if (new Set(["acTL", "fcTL", "fdAT"]).has(type)) {
        invalid("animation", "Animated PNG is not supported for a stable photo.");
      }
      if (type === "IEND") {
        if (length !== 0 || !sawIdat) invalid();
        sawIend = true;
      }
      const ancillary = (bytes[offset + 4] & 0x20) !== 0;
      if (!ancillary && !new Set(["IHDR", "PLTE", "IDAT", "IEND"]).has(type)) invalid("unsupported", "PNG contains an unknown critical chunk.");
      if (ancillary && !new Set(["tRNS", "cHRM", "gAMA", "sRGB"]).has(type)) metadataPresent = true;
      if (sanitized && !SAFE_PNG_CHUNKS.has(type)) invalid("metadata", "Public PNG contains metadata or an unapproved chunk.");
    }
    offset = chunkEnd;
  }
  if (!sawIhdr || !sawIdat || !sawIend || offset !== bytes.length) invalid();
  validatePngInflate(idat, { width, height, bitDepth, colorType, interlace });
  return { width, height, metadataPresent };
}

function readUInt24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function inspectWebp(bytes, { sanitized }) {
  if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP"
      || bytes.readUInt32LE(4) + 8 !== bytes.length) invalid(bytes.readUInt32LE(4) + 8 === bytes.length ? "malformed" : "trailing_data");
  let offset = 12;
  let width;
  let height;
  let canvas;
  let imageChunks = 0;
  let metadataPresent = false;
  let sawAlpha = false;
  let chunks = 0;
  while (offset < bytes.length) {
    if (++chunks > 1024 || offset + 8 > bytes.length) invalid();
    const type = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + (length & 1);
    if (dataEnd < dataStart || chunkEnd > bytes.length) invalid();
    if (type === "VP8X") {
      if (canvas || length !== 10 || bytes[dataStart + 1] || bytes[dataStart + 2] || bytes[dataStart + 3]) invalid();
      const flags = bytes[dataStart];
      if ((flags & ~0x3e) !== 0 || (flags & 0x02) !== 0) invalid("animation", "Animated WebP is not supported for a stable photo.");
      if (flags & (0x20 | 0x08 | 0x04)) metadataPresent = true;
      canvas = { width: readUInt24LE(bytes, dataStart + 4) + 1, height: readUInt24LE(bytes, dataStart + 7) + 1 };
    } else if (type === "VP8 ") {
      imageChunks += 1;
      if (length < 10 || (bytes[dataStart] & 1) !== 0 || !bytes.subarray(dataStart + 3, dataStart + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) invalid("decode", "WebP lossy frame header is malformed.");
      width = bytes.readUInt16LE(dataStart + 6) & 0x3fff;
      height = bytes.readUInt16LE(dataStart + 8) & 0x3fff;
    } else if (type === "VP8L") {
      imageChunks += 1;
      if (length < 5 || bytes[dataStart] !== 0x2f) invalid("decode", "WebP lossless frame header is malformed.");
      const bits = bytes.readUInt32LE(dataStart + 1);
      if ((bits >>> 29) !== 0) invalid("decode", "WebP lossless version is unsupported.");
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (type === "ALPH") {
      sawAlpha = true;
    } else if (type === "ANIM" || type === "ANMF") {
      invalid("animation", "Animated WebP is not supported for a stable photo.");
    } else if (new Set(["EXIF", "XMP ", "ICCP"]).has(type)) {
      metadataPresent = true;
    } else if (sanitized) {
      invalid("metadata", "Public WebP contains metadata or an unapproved chunk.");
    }
    offset = chunkEnd;
  }
  if (offset !== bytes.length || imageChunks !== 1 || !width || !height || (sawAlpha && !canvas)) invalid();
  if (canvas && (canvas.width !== width || canvas.height !== height)) invalid("dimensions", "WebP canvas and frame dimensions disagree.");
  if (sanitized && metadataPresent) invalid("metadata", "Public WebP contains metadata.");
  return { width, height, metadataPresent };
}

function skipGifSubBlocks(bytes, offset) {
  while (offset < bytes.length) {
    const length = bytes[offset++];
    if (length === 0) return offset;
    if (offset + length > bytes.length) invalid();
    offset += length;
  }
  invalid();
}

function inspectGif(bytes) {
  if (bytes.length < 14 || !["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) invalid();
  const width = bytes.readUInt16LE(6);
  const height = bytes.readUInt16LE(8);
  let offset = 13;
  if (bytes[10] & 0x80) offset += 3 * (2 ** ((bytes[10] & 0x07) + 1));
  let frames = 0;
  while (offset < bytes.length) {
    const introducer = bytes[offset++];
    if (introducer === 0x3b) {
      if (offset !== bytes.length || frames !== 1) invalid(frames > 1 ? "animation" : "trailing_data");
      return { width, height, metadataPresent: false };
    }
    if (introducer === 0x21) {
      if (offset >= bytes.length) invalid();
      offset += 1;
      offset = skipGifSubBlocks(bytes, offset);
      continue;
    }
    if (introducer !== 0x2c || offset + 9 > bytes.length) invalid();
    frames += 1;
    const packed = bytes[offset + 8];
    offset += 9;
    if (packed & 0x80) offset += 3 * (2 ** ((packed & 0x07) + 1));
    if (offset >= bytes.length) invalid();
    offset += 1; // LZW minimum code size
    offset = skipGifSubBlocks(bytes, offset);
  }
  invalid();
}

function bmffBox(bytes, offset, limit) {
  if (offset + 8 > limit) invalid();
  const size32 = bytes.readUInt32BE(offset);
  const type = bytes.toString("ascii", offset + 4, offset + 8);
  let header = 8;
  let size = size32;
  if (size32 === 1) {
    if (offset + 16 > limit) invalid();
    const large = bytes.readBigUInt64BE(offset + 8);
    if (large > BigInt(Number.MAX_SAFE_INTEGER)) invalid("resource_limit");
    size = Number(large);
    header = 16;
  } else if (size32 === 0) {
    size = limit - offset;
  }
  if (size < header || offset + size > limit) invalid();
  return { type, start: offset, dataStart: offset + header, end: offset + size, size };
}

function inspectHeif(bytes) {
  let offset = 0;
  let ftyp = null;
  let sawMeta = false;
  let sawMdat = false;
  const dimensions = [];
  let boxes = 0;
  const walk = (start, end, depth, parent = "") => {
    if (depth > 8) invalid("resource_limit");
    let cursor = start;
    while (cursor < end) {
      if (++boxes > 4096) invalid("resource_limit");
      const box = bmffBox(bytes, cursor, end);
      if (depth === 0 && box.type === "ftyp") ftyp = box;
      if (depth === 0 && box.type === "meta") sawMeta = true;
      if (depth === 0 && box.type === "mdat") sawMdat = true;
      if (box.type === "ispe") {
        if (box.end - box.dataStart !== 12) invalid();
        dimensions.push({ width: bytes.readUInt32BE(box.dataStart + 4), height: bytes.readUInt32BE(box.dataStart + 8) });
      }
      const containers = new Set(["meta", "iprp", "ipco", "iinf", "iref", "dinf"]);
      if (containers.has(box.type)) {
        let childStart = box.dataStart + (new Set(["meta", "iref"]).has(box.type) ? 4 : 0);
        // iinf is a FullBox followed by its declared entry_count (16-bit in
        // version 0, 32-bit in later versions) before the child infe boxes.
        // Treating that count as a BMFF box header rejects ordinary HEIC files.
        if (box.type === "iinf") {
          if (box.dataStart + 6 > box.end) invalid();
          const version = bytes[box.dataStart];
          const countBytes = version === 0 ? 2 : 4;
          if (box.dataStart + 4 + countBytes > box.end) invalid();
          const declaredEntries = countBytes === 2
            ? bytes.readUInt16BE(box.dataStart + 4)
            : bytes.readUInt32BE(box.dataStart + 4);
          if (declaredEntries > 4096) invalid("resource_limit");
          childStart = box.dataStart + 4 + countBytes;
        }
        if (childStart > box.end) invalid();
        walk(childStart, box.end, depth + 1, box.type);
      }
      cursor = box.end;
      if (box.size === 0) invalid();
    }
    if (cursor !== end) invalid();
  };
  walk(offset, bytes.length, 0);
  if (!ftyp || !sawMeta || !sawMdat || ftyp.dataStart + 8 > ftyp.end || !dimensions.length) invalid();
  const brands = [];
  brands.push(bytes.toString("ascii", ftyp.dataStart, ftyp.dataStart + 4));
  for (let cursor = ftyp.dataStart + 8; cursor + 4 <= ftyp.end; cursor += 4) brands.push(bytes.toString("ascii", cursor, cursor + 4));
  if (!brands.some((brand) => HEIF_BRANDS.has(brand))) invalid("unsupported", "ISO-BMFF file is not a supported HEIF image.");
  const largest = dimensions.reduce((best, candidate) => candidate.width * candidate.height > best.width * best.height ? candidate : best);
  return { ...largest, metadataPresent: true };
}

export function inspectImageBytes(value, {
  expectedType,
  sanitized = false,
  maxPixels = MAX_IMAGE_PIXELS,
  maxEdge = MAX_IMAGE_EDGE,
} = {}) {
  const bytes = asBuffer(value);
  if (bytes.length < 12) invalid();
  const actualType = detectedMimeType(bytes);
  if (!actualType || (expectedType && !expectedTypeMatches(actualType, expectedType, bytes))) {
    invalid("mime_mismatch", "Image bytes do not match the declared media type.");
  }
  let result;
  if (actualType === "image/jpeg") result = inspectJpeg(bytes, { sanitized });
  else if (actualType === "image/png") result = inspectPng(bytes, { sanitized });
  else if (actualType === "image/webp") result = inspectWebp(bytes, { sanitized });
  else if (actualType === "image/gif") result = inspectGif(bytes);
  else result = inspectHeif(bytes);
  assertResourceBounds(result.width, result.height, { maxPixels, maxEdge });
  if (sanitized && result.metadataPresent) invalid("metadata", "Public image contains metadata.");
  return Object.freeze({
    mimeType: expectedType || actualType,
    width: result.width,
    height: result.height,
    pixels: result.width * result.height,
    metadataPresent: !!result.metadataPresent,
    sanitized: !!sanitized,
  });
}

// A small set of pre-hardening phone-camera objects contain an otherwise valid
// primary JPEG followed by an MPO/gain-map trailer. Ordinary uploads remain
// byte-for-byte strict. The isolated recovery worker alone may use this helper
// to select the marker-validated primary image, which it then fully decodes and
// re-encodes before any bytes can become public.
export function canonicalLegacyRecoveryJpegPrefix(value) {
  const bytes = asBuffer(value);
  if (detectedMimeType(bytes) !== "image/jpeg") {
    invalid("mime_mismatch", "Legacy JPEG recovery accepts JPEG bytes only.");
  }
  const result = inspectJpeg(bytes, { sanitized: false, allowTrailing: true });
  assertResourceBounds(result.width, result.height, {
    maxPixels: MAX_IMAGE_PIXELS,
    maxEdge: MAX_IMAGE_EDGE,
  });
  if (!Number.isSafeInteger(result.endOffset) || result.endOffset < 12 || result.endOffset > bytes.length) {
    invalid();
  }
  const prefix = bytes.subarray(0, result.endOffset);
  // Re-enter the ordinary strict parser so a future parser change cannot make
  // this recovery boundary less strict than normal standalone JPEG validation.
  inspectImageBytes(prefix, { expectedType: "image/jpeg", sanitized: false });
  return prefix;
}
