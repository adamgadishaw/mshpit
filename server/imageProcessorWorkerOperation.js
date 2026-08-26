import sharp from "sharp";

import {
  canonicalLegacyRecoveryJpegPrefix,
  ImageInspectionError,
  inspectImageBytes,
  MAX_IMAGE_EDGE,
  MAX_IMAGE_PIXELS,
  MAX_LEGACY_RECOVERY_JPEG_PIXELS,
} from "./imageInspection.js";
import { profileImageContract } from "../src/domain/profileImagePolicy.mjs";
import { MEDIA_PHOTO_SOURCE_MAX_BYTES } from "../src/domain/mediaUploadPolicy.mjs";

export const MAX_IMAGE_INPUT_BYTES = MEDIA_PHOTO_SOURCE_MAX_BYTES;
export const MAX_IMAGE_OUTPUT_BYTES = 12 * 1024 * 1024;

const SOURCE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/avif",
]);
const OUTPUT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const HEIC_TYPES = new Set(["image/heic", "image/heif"]);
const HEIF_TYPES = new Set(["image/heic", "image/heif", "image/avif"]);
const HEIC_FALLBACK_OUTPUT_TYPES = new Set(["image/jpeg", "image/webp"]);
const FORMAT_MIME = Object.freeze({
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heif: "image/heif",
});

// Each child handles exactly one image. Keep libvips' own cache small so the
// pixel ceiling, rather than a process-global cache, controls resident memory.
sharp.cache({ memory: 32, files: 0, items: 8 });
sharp.concurrency(1);

function processorError(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = "ImageProcessorWorkerError";
  error.code = code;
  return error;
}

function asBoundedBuffer(value) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : value instanceof Uint8Array
      ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
      : null;
  if (!bytes || bytes.byteLength < 12 || bytes.byteLength > MAX_IMAGE_INPUT_BYTES) {
    throw processorError("resource_limit", "Image input exceeds the safe processing limit.");
  }
  return bytes;
}

function sourceType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (!SOURCE_TYPES.has(type)) throw processorError("mime_mismatch", "Image media type is unsupported.");
  return type;
}

function outputType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (!OUTPUT_TYPES.has(type)) throw processorError("output_type", "Choose JPEG, PNG, or WebP for a public rendition.");
  return type;
}

function requestedProfileRendition(value) {
  if (value == null || value === "") return null;
  const contract = profileImageContract(value);
  if (!contract) throw processorError("invalid_rendition", "Profile image rendition is invalid.");
  return contract;
}

function sharpOptions(limitInputPixels = MAX_IMAGE_PIXELS) {
  return {
    failOn: "warning",
    limitInputPixels,
    limitInputChannels: 4,
    unlimited: false,
    sequentialRead: true,
    pages: 1,
    animated: false,
  };
}

function assertDecodedMetadata(metadata, expectedType, {
  maxPixels = MAX_IMAGE_PIXELS,
} = {}) {
  const actualType = FORMAT_MIME[String(metadata?.format || "")];
  const compatibleHeif = HEIF_TYPES.has(expectedType) && actualType === "image/heif";
  const width = Number(metadata?.width);
  const height = Number(metadata?.height);
  const channels = Number(metadata?.channels);
  if ((!actualType || (actualType !== expectedType && !compatibleHeif))
      || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
      || width < 1 || height < 1 || width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE
      || width * height > maxPixels
      || !Number.isSafeInteger(channels) || channels < 1 || channels > 4
      || String(metadata?.depth || "") !== "uchar"
      || Number(metadata?.pages || 1) !== 1) {
    throw processorError("decode", "Decoded image metadata is invalid or exceeds the safe processing limit.");
  }
  return { mimeType: expectedType, width, height };
}

function outputPipeline(pipeline, type, { maxEdge = null, profileRendition = null } = {}) {
  let oriented = pipeline.autoOrient();
  if (profileRendition) {
    oriented = oriented.resize({
      width: profileRendition.outputWidth,
      height: profileRendition.outputHeight,
      fit: "cover",
      position: "centre",
      kernel: "lanczos3",
    });
  } else if (Number.isSafeInteger(maxEdge) && maxEdge > 0) {
    // Keeping resize in the Sharp pipeline lets JPEG shrink-on-load reduce
    // native decoder memory before the fully decoded image is materialized.
    oriented = oriented.resize({
      width: maxEdge,
      height: maxEdge,
      fit: "inside",
      withoutEnlargement: true,
      kernel: "lanczos3",
    });
  }
  oriented = oriented.toColourspace("srgb");
  if (type === "image/jpeg") {
    return oriented.jpeg({ quality: 90, progressive: false, optimiseCoding: true, force: true });
  }
  if (type === "image/png") {
    return oriented.png({ compressionLevel: 9, adaptiveFiltering: true, palette: false, force: true });
  }
  return oriented.webp({ quality: 90, alphaQuality: 100, smartSubsample: true, force: true });
}

function assertFallbackDimensions(value, structural) {
  const width = Number(value?.width);
  const height = Number(value?.height);
  const exact = width === structural.width && height === structural.height;
  const oriented = width === structural.height && height === structural.width;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
      || width < 1 || height < 1 || width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE
      || width * height > MAX_IMAGE_PIXELS || (!exact && !oriented)) {
    throw processorError("dimensions", "Decoded HEIC dimensions are invalid or disagree with its structure.");
  }
  return { width, height, pixels: width * height };
}

async function sanitizeDecodedPixels(pipeline, type, requestedMaxOutputBytes, {
  maxEdge = null,
  profileRendition = null,
} = {}) {
  const { data, info } = await outputPipeline(pipeline, type, { maxEdge, profileRendition })
    .toBuffer({ resolveWithObject: true });
  const maxOutputBytes = Math.max(1, Math.min(
    MAX_IMAGE_OUTPUT_BYTES,
    Math.trunc(Number(requestedMaxOutputBytes) || MAX_IMAGE_OUTPUT_BYTES),
  ));
  if (!Buffer.isBuffer(data) || data.byteLength < 1 || data.byteLength > maxOutputBytes) {
    throw processorError("output_size", "Sanitized image exceeds the safe delivery size.");
  }
  const inspection = inspectImageBytes(data, { expectedType: type, sanitized: true });
  if (inspection.width !== Number(info?.width) || inspection.height !== Number(info?.height)) {
    throw processorError("dimensions", "Sanitized image dimensions could not be verified.");
  }
  if (Number.isSafeInteger(maxEdge) && maxEdge > 0
      && (inspection.width > maxEdge || inspection.height > maxEdge)) {
    throw processorError("dimensions", "Recovered image exceeds its safe delivery dimensions.");
  }
  if (profileRendition
      && (inspection.width !== profileRendition.outputWidth
        || inspection.height !== profileRendition.outputHeight)) {
    throw processorError("dimensions", "Profile image rendition dimensions are invalid.");
  }
  return Object.freeze({
    bytes: data,
    byteSize: data.byteLength,
    mimeType: type,
    width: inspection.width,
    height: inspection.height,
    pixels: inspection.pixels,
  });
}

async function sanitizeHeicFallback(bytes, structural, type, requestedMaxOutputBytes, profileRendition) {
  if (!HEIC_FALLBACK_OUTPUT_TYPES.has(type)) {
    throw processorError("output_type", "Recovered HEIC photos must be converted to JPEG or WebP.");
  }
  let images;
  try {
    // Loaded only inside this one-shot child and only for the explicit legacy
    // recovery path. decode.all lets us bound dimensions before allocating the
    // RGBA display buffer; decode() would allocate before callers can inspect.
    const imported = await import("heic-decode");
    const decode = imported.default || imported;
    if (typeof decode?.all !== "function") {
      throw processorError("worker_unavailable", "The recovery HEIC decoder is unavailable.");
    }
    images = await decode.all({ buffer: bytes });
    if (!Array.isArray(images) || images.length < 1 || images.length > 32) {
      throw processorError("resource_limit", "The HEIC image collection exceeds the safe processing limit.");
    }
    const primary = images[0];
    const dimensions = assertFallbackDimensions(primary, structural);
    const decoded = await primary.decode();
    const decodedDimensions = assertFallbackDimensions(decoded, structural);
    if (decodedDimensions.width !== dimensions.width || decodedDimensions.height !== dimensions.height) {
      throw processorError("dimensions", "Decoded HEIC dimensions changed during processing.");
    }
    const pixels = decoded?.data;
    if (!ArrayBuffer.isView(pixels) || Number(pixels?.BYTES_PER_ELEMENT) !== 1
        || !Number.isSafeInteger(pixels.byteOffset) || !Number.isSafeInteger(pixels.byteLength)
        || pixels.byteLength !== dimensions.pixels * 4) {
      throw processorError("decode", "Decoded HEIC pixels are invalid.");
    }
    // Keep a zero-copy view over the JS-owned display buffer while Sharp
    // encodes it. The decoder is disposed only after this await completes,
    // avoiding a second up-to-96 MiB RGBA allocation in the bounded child.
    const rgba = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    return await sanitizeDecodedPixels(sharp(rgba, {
      raw: { width: dimensions.width, height: dimensions.height, channels: 4 },
      failOn: "warning",
      limitInputPixels: MAX_IMAGE_PIXELS,
      sequentialRead: true,
    }), type, requestedMaxOutputBytes, { profileRendition });
  } catch (error) {
    if (error?.code) throw error;
    throw processorError("heic_decode", "HEIC pixels could not be decoded safely.", error);
  } finally {
    try { images?.dispose?.(); }
    catch { /* architecture: allow-empty-catch -- one-shot worker exit reclaims decoder state if best-effort disposal fails */ }
  }
}

async function validate(bytes, expectedType, allowHeicFallback, allowLegacyJpegTrailer) {
  const source = sanitizationSource(bytes, expectedType, allowLegacyJpegTrailer);
  const pipeline = sharp(source.bytes, sharpOptions());
  try {
    const metadata = await pipeline.metadata();
    const decoded = assertDecodedMetadata(metadata, expectedType);
    await pipeline.stats();
    if (decoded.width !== source.structural.width || decoded.height !== source.structural.height) {
      throw processorError("dimensions", "Structural and decoded image dimensions disagree.");
    }
    return Object.freeze({ ...decoded, pixels: decoded.width * decoded.height });
  } catch (error) {
    if (allowHeicFallback === true && HEIC_TYPES.has(expectedType)) {
      const decoded = await sanitizeHeicFallback(
        source.bytes, source.structural, "image/jpeg", MAX_IMAGE_OUTPUT_BYTES, null,
      );
      return Object.freeze({
        mimeType: expectedType, width: decoded.width, height: decoded.height, pixels: decoded.pixels,
      });
    }
    throw error;
  }
}

function sanitizationSource(bytes, expectedType, allowLegacyJpegTrailer) {
  try {
    return {
      bytes,
      structural: inspectImageBytes(bytes, { expectedType, sanitized: false }),
    };
  } catch (error) {
    if (!(allowLegacyJpegTrailer === true && expectedType === "image/jpeg"
        && error instanceof ImageInspectionError && error.code === "trailing_data")) {
      throw error;
    }
    const canonical = canonicalLegacyRecoveryJpegPrefix(bytes);
    const structural = inspectImageBytes(canonical, {
      expectedType: "image/jpeg",
      sanitized: false,
      maxPixels: MAX_LEGACY_RECOVERY_JPEG_PIXELS,
    });
    return {
      bytes: canonical,
      structural,
      oversizedLegacyJpeg: structural.pixels > MAX_IMAGE_PIXELS,
    };
  }
}

async function sanitize(bytes, expectedType, requestedOutputType, requestedMaxOutputBytes,
  allowHeicFallback, allowLegacyJpegTrailer, profileRenditionValue) {
  const source = sanitizationSource(bytes, expectedType, allowLegacyJpegTrailer);
  const type = outputType(requestedOutputType || expectedType);
  const profileRendition = requestedProfileRendition(profileRenditionValue);
  const sourcePixelLimit = source.oversizedLegacyJpeg
    ? MAX_LEGACY_RECOVERY_JPEG_PIXELS
    : MAX_IMAGE_PIXELS;
  const pipeline = sharp(source.bytes, sharpOptions(sourcePixelLimit));
  try {
    const metadata = await pipeline.metadata();
    assertDecodedMetadata(metadata, expectedType, { maxPixels: sourcePixelLimit });
    return await sanitizeDecodedPixels(pipeline, type, requestedMaxOutputBytes, {
      maxEdge: source.oversizedLegacyJpeg ? 4096 : null,
      profileRendition,
    });
  } catch (error) {
    if (allowHeicFallback === true && HEIC_TYPES.has(expectedType)) {
      return sanitizeHeicFallback(source.bytes, source.structural, type, requestedMaxOutputBytes,
        profileRendition);
    }
    throw error;
  }
}

export async function runImageProcessorWorkerOperation(message) {
  try {
    const operation = message?.operation === "validate" || message?.operation === "sanitize"
      ? message.operation
      : "";
    if (!operation) throw processorError("invalid_operation", "Image processor operation is invalid.");
    const bytes = asBoundedBuffer(message?.bytes);
    const expectedType = sourceType(message?.expectedType);
    if (operation === "validate") return await validate(bytes, expectedType,
      message?.allowHeicFallback === true,
      message?.allowLegacyJpegTrailer === true);
    return await sanitize(bytes, expectedType, message?.outputType, message?.maxOutputBytes,
      message?.allowHeicFallback === true, message?.allowLegacyJpegTrailer === true,
      message?.profileRendition);
  } catch (error) {
    if (error instanceof ImageInspectionError || error?.code) throw error;
    throw processorError("decode", "Image pixels could not be decoded safely.", error);
  }
}
