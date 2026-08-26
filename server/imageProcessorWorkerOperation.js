import sharp from "sharp";

import {
  canonicalLegacyRecoveryJpegPrefix,
  ImageInspectionError,
  inspectImageBytes,
  MAX_IMAGE_ANIMATION_FRAMES,
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

function requestedMaxEdge(value) {
  if (value == null || value === "") return null;
  const edge = Number(value);
  if (!Number.isSafeInteger(edge) || edge < 1 || edge > MAX_IMAGE_EDGE) {
    throw processorError("resource_limit", "Image delivery dimensions exceed the safe processing limit.");
  }
  return edge;
}

function sharpOptions(limitInputPixels = MAX_IMAGE_PIXELS, animated = false) {
  return {
    failOn: "warning",
    limitInputPixels,
    limitInputChannels: 4,
    unlimited: false,
    sequentialRead: true,
    pages: animated ? -1 : 1,
    animated,
  };
}

function assertDecodedMetadata(metadata, expectedType, {
  maxPixels = MAX_IMAGE_PIXELS,
  structural = null,
} = {}) {
  const actualType = FORMAT_MIME[String(metadata?.format || "")];
  const compatibleHeif = HEIF_TYPES.has(expectedType) && actualType === "image/heif";
  const width = Number(metadata?.width);
  const stackedHeight = Number(metadata?.height);
  const channels = Number(metadata?.channels);
  const pages = Number(metadata?.pages || 1);
  const canvasHeight = pages > 1 ? Number(metadata?.pageHeight) : stackedHeight;
  const expectedFrames = Number(structural?.frames || 1);
  if ((!actualType || (actualType !== expectedType && !compatibleHeif))
      || !Number.isSafeInteger(width) || !Number.isSafeInteger(stackedHeight)
      || !Number.isSafeInteger(canvasHeight) || !Number.isSafeInteger(pages)
      || width < 1 || canvasHeight < 1 || width > MAX_IMAGE_EDGE || canvasHeight > MAX_IMAGE_EDGE
      || pages < 1 || pages > MAX_IMAGE_ANIMATION_FRAMES || pages !== expectedFrames
      || stackedHeight !== canvasHeight * pages || width * stackedHeight > maxPixels
      || !Number.isSafeInteger(channels) || channels < 1 || channels > 4
      || String(metadata?.depth || "") !== "uchar") {
    throw processorError("decode", "Decoded image metadata is invalid or exceeds the safe processing limit.");
  }
  if (structural && (width !== structural.width || canvasHeight !== structural.height
      || pages !== structural.frames)) {
    throw processorError("dimensions", "Structural and decoded image dimensions disagree.");
  }
  const delays = Array.isArray(metadata?.delay)
    && metadata.delay.length === pages
    && metadata.delay.every((delay) => Number.isSafeInteger(delay) && delay >= 0 && delay <= 65_535)
    ? [...metadata.delay]
    : null;
  const loop = Number.isSafeInteger(Number(metadata?.loop))
    && Number(metadata.loop) >= 0 && Number(metadata.loop) <= 65_535
    ? Number(metadata.loop)
    : 0;
  return {
    mimeType: expectedType,
    width,
    height: canvasHeight,
    pixels: width * canvasHeight,
    frames: pages,
    totalPixels: width * stackedHeight,
    animation: pages > 1 ? { delay: delays, loop } : null,
  };
}

function outputPipeline(pipeline, type, {
  maxEdge = null,
  profileRendition = null,
  animation = null,
} = {}) {
  if (animation && type !== "image/webp") {
    throw processorError("output_type", "Animated images must use WebP for the public rendition.");
  }
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
  const options = { quality: 90, alphaQuality: 100, smartSubsample: true, force: true };
  if (animation) {
    options.loop = animation.loop;
    if (animation.delay) options.delay = animation.delay;
  }
  return oriented.webp(options);
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

function stripPngPhysicalMetadata(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength < 20) return bytes;
  const chunks = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= bytes.byteLength) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.byteLength) return bytes;
    if (bytes.toString("ascii", offset + 4, offset + 8) !== "pHYs") {
      chunks.push(bytes.subarray(offset, end));
    }
    offset = end;
  }
  return offset === bytes.byteLength ? Buffer.concat(chunks) : bytes;
}

async function sanitizeDecodedPixels(pipeline, type, requestedMaxOutputBytes, {
  maxEdge = null,
  profileRendition = null,
  animation = null,
} = {}) {
  const encoded = await outputPipeline(pipeline, type, { maxEdge, profileRendition, animation })
    .toBuffer({ resolveWithObject: true });
  const info = encoded.info;
  const data = type === "image/png" ? stripPngPhysicalMetadata(encoded.data) : encoded.data;
  const maxOutputBytes = Math.max(1, Math.min(
    MAX_IMAGE_OUTPUT_BYTES,
    Math.trunc(Number(requestedMaxOutputBytes) || MAX_IMAGE_OUTPUT_BYTES),
  ));
  if (!Buffer.isBuffer(data) || data.byteLength < 1 || data.byteLength > maxOutputBytes) {
    throw processorError("output_size", "Sanitized image exceeds the safe delivery size.");
  }
  const inspection = inspectImageBytes(data, { expectedType: type, sanitized: true });
  const outputFrames = Number(info?.pages || 1);
  const outputHeight = outputFrames > 1 ? Number(info?.pageHeight) : Number(info?.height);
  if (inspection.width !== Number(info?.width) || inspection.height !== outputHeight
      || inspection.frames !== outputFrames
      || (animation && inspection.frames !== animation.frames)) {
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

async function sanitizeHeicFallback(bytes, structural, type, requestedMaxOutputBytes, profileRendition, maxEdge) {
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
    }), type, requestedMaxOutputBytes, { profileRendition, maxEdge });
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
  const animated = source.structural.frames > 1;
  const pipeline = sharp(source.bytes, sharpOptions(MAX_IMAGE_PIXELS, animated));
  try {
    const metadata = await pipeline.metadata();
    const decoded = assertDecodedMetadata(metadata, expectedType, { structural: source.structural });
    await pipeline.stats();
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
  allowHeicFallback, allowLegacyJpegTrailer, profileRenditionValue, maxEdgeValue) {
  const source = sanitizationSource(bytes, expectedType, allowLegacyJpegTrailer);
  const type = outputType(requestedOutputType || expectedType);
  const profileRendition = requestedProfileRendition(profileRenditionValue);
  const maxEdge = requestedMaxEdge(maxEdgeValue);
  const sourcePixelLimit = source.oversizedLegacyJpeg
    ? MAX_LEGACY_RECOVERY_JPEG_PIXELS
    : MAX_IMAGE_PIXELS;
  const animated = source.structural.frames > 1;
  if (animated && type !== "image/webp") {
    throw processorError("output_type", "Animated images must use WebP for the public rendition.");
  }
  const pipeline = sharp(source.bytes, sharpOptions(sourcePixelLimit, animated));
  try {
    const metadata = await pipeline.metadata();
    const decoded = assertDecodedMetadata(metadata, expectedType, {
      maxPixels: sourcePixelLimit,
      structural: source.structural,
    });
    const output = await sanitizeDecodedPixels(pipeline, type, requestedMaxOutputBytes, {
      maxEdge: source.oversizedLegacyJpeg ? Math.min(4096, maxEdge || 4096) : maxEdge,
      profileRendition,
      animation: decoded.animation ? { ...decoded.animation, frames: decoded.frames } : null,
    });
    return { ...output, sourceWidth: decoded.width, sourceHeight: decoded.height };
  } catch (error) {
    if (allowHeicFallback === true && HEIC_TYPES.has(expectedType)) {
      const output = await sanitizeHeicFallback(source.bytes, source.structural, type, requestedMaxOutputBytes,
        profileRendition, maxEdge);
      return {
        ...output,
        sourceWidth: source.structural.width,
        sourceHeight: source.structural.height,
      };
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
      message?.profileRendition, message?.maxEdge);
  } catch (error) {
    if (error instanceof ImageInspectionError || error?.code) throw error;
    throw processorError("decode", "Image pixels could not be decoded safely.", error);
  }
}
