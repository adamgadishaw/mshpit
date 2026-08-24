import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";

import sharp from "sharp";

import { inspectImageBytes, MAX_IMAGE_PIXELS } from "./imageInspection.js";
import { imageProcessorHealth, sanitizeDecodedImage, validateDecodedImage } from "./imageProcessor.js";

function createdImage({ width = 64, height = 48, format = "jpeg" } = {}) {
  const pipeline = sharp({
    create: { width, height, channels: 4, background: { r: 100, g: 30, b: 180, alpha: 0.8 } },
  });
  return pipeline[format]().toBuffer();
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const label = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([label, data])));
  return Buffer.concat([length, label, data, checksum]);
}

function sixteenBitPng(width = 32, height = 32) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 16;
  header[9] = 6;
  const rowBytes = width * 4 * 2;
  const pixels = Buffer.alloc(height * (rowBytes + 1));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND"),
  ]);
}

test("full pixel decode rejects malformed JPEG entropy that passes structural framing", async () => {
  const valid = await createdImage({ width: 64, height: 64 });
  const scan = valid.indexOf(Buffer.from([0xff, 0xda]));
  assert.ok(scan > 0);
  const malformed = Buffer.concat([valid.subarray(0, scan + 20), Buffer.from([0xff, 0xd9])]);
  assert.equal(inspectImageBytes(malformed, { expectedType: "image/jpeg" }).width, 64,
    "the threat fixture reaches the real decoder instead of failing only a marker check");
  await assert.rejects(
    validateDecodedImage(malformed, { expectedType: "image/jpeg" }),
    (error) => error.code === "decode",
  );
});

test("sanitization applies orientation and strips EXIF/GPS instead of publishing the camera file", async () => {
  const source = await sharp({
    create: { width: 8, height: 6, channels: 3, background: "#c02080" },
  }).jpeg().withMetadata({ orientation: 6 }).withExifMerge({
    IFD0: { Artist: "private-owner" },
    IFD3: { GPSLatitudeRef: "N", GPSLatitude: "43/1 39/1 0/1" },
  }).toBuffer();
  const sourceMetadata = await sharp(source).metadata();
  assert.ok(sourceMetadata.exif);
  assert.equal(source.includes(Buffer.from("private-owner")), true);

  const sanitized = await sanitizeDecodedImage(source, { expectedType: "image/jpeg" });
  const outputMetadata = await sharp(sanitized.bytes).metadata();
  assert.equal(outputMetadata.exif, undefined);
  assert.equal(outputMetadata.xmp, undefined);
  assert.equal(outputMetadata.icc, undefined);
  assert.equal(sanitized.bytes.includes(Buffer.from("private-owner")), false);
  assert.deepEqual([sanitized.width, sanitized.height], [6, 8]);
  assert.equal(inspectImageBytes(sanitized.bytes, {
    expectedType: "image/jpeg",
    sanitized: true,
  }).metadataPresent, false);
});

test("claimed MIME, truncation, trailing payload, and oversized dimensions all fail closed", async () => {
  const png = await createdImage({ format: "png" });
  await assert.rejects(
    validateDecodedImage(png, { expectedType: "image/jpeg" }),
    (error) => error.code === "mime_mismatch",
  );

  const jpeg = await createdImage();
  assert.throws(
    () => inspectImageBytes(jpeg.subarray(0, jpeg.length - 1), { expectedType: "image/jpeg" }),
    (error) => new Set(["truncated", "malformed"]).has(error.code),
  );
  assert.throws(
    () => inspectImageBytes(Buffer.concat([jpeg, Buffer.from("<script>owned()</script>")]), {
      expectedType: "image/jpeg",
    }),
    (error) => error.code === "trailing_data",
  );

  const oversized = Buffer.from(jpeg);
  const sof = oversized.indexOf(Buffer.from([0xff, 0xc0]));
  assert.ok(sof > 0);
  oversized.writeUInt16BE(32_768, sof + 5);
  oversized.writeUInt16BE(32_768, sof + 7);
  assert.ok(32_768 * 32_768 > MAX_IMAGE_PIXELS);
  assert.throws(
    () => inspectImageBytes(oversized, { expectedType: "image/jpeg" }),
    (error) => error.code === "resource_limit",
  );
});

test("private HEIF/GIF-style sources can select a safe public output codec", async () => {
  const png = await createdImage({ width: 10, height: 7, format: "png" });
  const sanitized = await sanitizeDecodedImage(png, {
    expectedType: "image/png",
    outputType: "image/webp",
  });
  assert.equal(sanitized.mimeType, "image/webp");
  assert.deepEqual([sanitized.width, sanitized.height], [10, 7]);
  assert.equal(inspectImageBytes(sanitized.bytes, {
    expectedType: "image/webp",
    sanitized: true,
  }).metadataPresent, false);
});

test("untrusted decode work is admitted before a one-shot isolated child process starts", async () => {
  const jpeg = await createdImage({ width: 512, height: 512 });
  const first = validateDecodedImage(jpeg, { expectedType: "image/jpeg" });
  await assert.rejects(
    validateDecodedImage(jpeg, { expectedType: "image/jpeg" }),
    (error) => error.code === "busy",
  );
  assert.deepEqual(await first, {
    mimeType: "image/jpeg",
    width: 512,
    height: 512,
    pixels: 512 * 512,
  });
  const health = imageProcessorHealth();
  assert.equal(health.isolation, "child_process");
  assert.equal(health.capacity, 1);
  assert.equal(health.active, 0);
  assert.equal(health.maxPixels, MAX_IMAGE_PIXELS);
  assert.equal(health.diskCache, false);
  assert.equal(health.untrustedOperationsBlocked, true);
});

test("high-bit-depth PNGs are rejected before their expanded pixels reach libvips", async () => {
  const sixteenBit = sixteenBitPng();
  assert.throws(
    () => inspectImageBytes(sixteenBit, { expectedType: "image/png" }),
    (error) => error.code === "resource_limit",
  );
  await assert.rejects(
    validateDecodedImage(sixteenBit, { expectedType: "image/png" }),
    (error) => error.code === "resource_limit",
  );
});
