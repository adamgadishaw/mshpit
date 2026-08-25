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

function bmffBox(type, payload = Buffer.alloc(0)) {
  const box = Buffer.alloc(8 + payload.byteLength);
  box.writeUInt32BE(box.byteLength, 0);
  box.write(type, 4, 4, "ascii");
  payload.copy(box, 8);
  return box;
}

function structurallyAdmittedUndecodableHeic(width = 8, height = 6) {
  const ftyp = bmffBox("ftyp", Buffer.concat([
    Buffer.from("heic", "ascii"),
    Buffer.alloc(4),
    Buffer.from("mif1heic", "ascii"),
  ]));
  const ispe = Buffer.alloc(12);
  ispe.writeUInt32BE(width, 4);
  ispe.writeUInt32BE(height, 8);
  const entryCount = Buffer.alloc(2);
  entryCount.writeUInt16BE(1);
  const iinf = bmffBox("iinf", Buffer.concat([
    Buffer.alloc(4),
    entryCount,
    bmffBox("infe", Buffer.alloc(8)),
  ]));
  const meta = bmffBox("meta", Buffer.concat([
    Buffer.alloc(4),
    iinf,
    bmffBox("iprp", bmffBox("ipco", bmffBox("ispe", ispe))),
  ]));
  return Buffer.concat([ftyp, meta, bmffBox("mdat", Buffer.alloc(16))]);
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

test("legacy recovery strips only a marker-validated JPEG trailer before isolated re-encoding", async () => {
  const jpeg = await createdImage({ width: 37, height: 29 });
  const secondJpeg = await createdImage({ width: 9, height: 7 });
  const sentinel = Buffer.from("<script>legacy-trailer-must-never-publish</script>");
  const withTrailer = Buffer.concat([jpeg, sentinel, secondJpeg]);

  await assert.rejects(
    validateDecodedImage(withTrailer, { expectedType: "image/jpeg" }),
    (error) => error.code === "trailing_data",
  );
  await assert.rejects(
    sanitizeDecodedImage(withTrailer, { expectedType: "image/jpeg" }),
    (error) => error.code === "trailing_data",
  );
  await assert.rejects(
    sanitizeDecodedImage(withTrailer, {
      expectedType: "image/jpeg",
      allowLegacyJpegTrailer: "true",
    }),
    (error) => error.code === "trailing_data",
  );

  const recovered = await sanitizeDecodedImage(withTrailer, {
    expectedType: "image/jpeg",
    outputType: "image/jpeg",
    allowLegacyJpegTrailer: true,
  });
  assert.deepEqual([recovered.width, recovered.height], [37, 29]);
  assert.equal(recovered.bytes.includes(sentinel), false);
  assert.equal(recovered.bytes.includes(secondJpeg), false);
  assert.equal(inspectImageBytes(recovered.bytes, {
    expectedType: "image/jpeg",
    sanitized: true,
  }).metadataPresent, false);

  const scan = jpeg.indexOf(Buffer.from([0xff, 0xda]));
  assert.ok(scan > 0);
  const malformedEntropy = Buffer.concat([
    jpeg.subarray(0, scan + 20),
    Buffer.from([0xff, 0xd9]),
    sentinel,
  ]);
  await assert.rejects(
    sanitizeDecodedImage(malformedEntropy, {
      expectedType: "image/jpeg",
      allowLegacyJpegTrailer: true,
    }),
    (error) => error.code === "decode",
  );

  const missingEnd = Buffer.concat([jpeg.subarray(0, jpeg.length - 2), sentinel]);
  await assert.rejects(
    sanitizeDecodedImage(missingEnd, {
      expectedType: "image/jpeg",
      allowLegacyJpegTrailer: true,
    }),
    (error) => error.code !== "trailing_data",
  );

  const pngWithTrailer = Buffer.concat([await createdImage({ format: "png" }), sentinel]);
  await assert.rejects(
    sanitizeDecodedImage(pngWithTrailer, {
      expectedType: "image/png",
      allowLegacyJpegTrailer: true,
    }),
    (error) => new Set(["malformed", "trailing_data"]).has(error.code),
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

test("the real HEIC decoder fallback is explicit and remains unavailable to ordinary sanitization", async () => {
  const heic = structurallyAdmittedUndecodableHeic();
  assert.equal(inspectImageBytes(heic, { expectedType: "image/heic" }).mimeType, "image/heic");

  await assert.rejects(
    sanitizeDecodedImage(heic, {
      expectedType: "image/heic",
      outputType: "image/jpeg",
    }),
    (error) => error.code === "decode",
  );
  await assert.rejects(
    sanitizeDecodedImage(heic, {
      expectedType: "image/heic",
      outputType: "image/jpeg",
      allowHeicFallback: true,
    }),
    (error) => error.code === "heic_decode",
  );
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
