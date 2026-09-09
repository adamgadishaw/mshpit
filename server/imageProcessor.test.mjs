import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";

import sharp from "sharp";

import {
  inspectImageBytes,
  MAX_IMAGE_ANIMATION_FRAMES,
  MAX_IMAGE_PIXELS,
} from "./imageInspection.js";
import { imageProcessorHealth, sanitizeDecodedImage, validateDecodedImage } from "./imageProcessor.js";
import { MEDIA_POST_MAX_ATTACHMENTS } from "../src/domain/mediaUploadPolicy.mjs";

test("the image runtime includes the vendor fix for GHSA-rgj7-g3m4-5g8c", () => {
  const atLeast = (actual, minimum) => {
    const parts = String(actual).split(".").map(Number);
    return parts.length >= minimum.length && minimum.every((part, index) =>
      parts.slice(0, index).some((value, prior) => value > minimum[prior]) || parts[index] >= part);
  };
  // Sharp's patched prebuild includes libheif 1.23.2. Check the loaded binary,
  // not only the manifest, so a stale installation cannot pass image security CI.
  assert.equal(atLeast(sharp.versions.sharp, [0, 35, 4]), true, "Sharp must include the vendor patch");
  assert.equal(atLeast(sharp.versions.heif, [1, 23, 2]), true, "the loaded libheif must include the upstream fix");
});

function createdImage({ width = 64, height = 48, format = "jpeg" } = {}) {
  const pipeline = sharp({
    create: { width, height, channels: 4, background: { r: 100, g: 30, b: 180, alpha: 0.8 } },
  });
  return pipeline[format]().toBuffer();
}

function gifFixture({ width = 1, height = 1, frames = 1 } = {}) {
  const header = Buffer.from("47494638396101000100800000000000ffffff", "hex");
  header.writeUInt16LE(width, 6);
  header.writeUInt16LE(height, 8);
  const graphicControl = Buffer.from("21f904000a000000", "hex");
  const images = Array.from({ length: frames }, (_, index) => Buffer.from(
    `2c0000000001000100000201${index % 2 ? "44" : "4c"}00`,
    "hex",
  ));
  return Buffer.concat([
    header,
    ...images.flatMap((image) => [graphicControl, image]),
    Buffer.from([0x3b]),
  ]);
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

test("ordinary high-resolution camera JPEGs are accepted while legacy trailers are stripped and hard pixel bounds remain", async () => {
  const width = 5712;
  const height = 4284;
  assert.ok(width * height < MAX_IMAGE_PIXELS, "a normal 24 MP camera photo stays inside the 50 MP safety envelope");
  const jpeg = await createdImage({ width, height });
  const sentinel = Buffer.from("legacy-oversize-trailer-must-never-publish");
  const withTrailer = Buffer.concat([jpeg, sentinel]);

  await assert.rejects(
    sanitizeDecodedImage(withTrailer, { expectedType: "image/jpeg" }),
    (error) => error.code === "trailing_data",
  );
  const ordinary = await sanitizeDecodedImage(jpeg, {
    expectedType: "image/jpeg",
    allowLegacyJpegTrailer: true,
  });
  assert.deepEqual([ordinary.width, ordinary.height], [width, height]);

  const recovered = await sanitizeDecodedImage(withTrailer, {
    expectedType: "image/jpeg",
    outputType: "image/jpeg",
    allowLegacyJpegTrailer: true,
  });
  assert.deepEqual([recovered.width, recovered.height], [width, height]);
  assert.ok(recovered.width * recovered.height <= MAX_IMAGE_PIXELS);
  assert.equal(recovered.bytes.includes(sentinel), false);
  assert.equal(inspectImageBytes(recovered.bytes, {
    expectedType: "image/jpeg",
    sanitized: true,
  }).metadataPresent, false);

  const overLimit = Buffer.from(jpeg);
  const sof = overLimit.indexOf(Buffer.from([0xff, 0xc0]));
  assert.ok(sof > 0);
  overLimit.writeUInt16BE(8000, sof + 5);
  overLimit.writeUInt16BE(7000, sof + 7);
  assert.ok(8000 * 7000 > MAX_IMAGE_PIXELS);
  await assert.rejects(
    sanitizeDecodedImage(Buffer.concat([overLimit, sentinel]), {
      expectedType: "image/jpeg",
      allowLegacyJpegTrailer: true,
    }),
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

test("ordinary PNG photos survive the server sanitizer without retaining source density metadata", async () => {
  const source = await sharp({
    create: { width: 640, height: 480, channels: 4, background: { r: 24, g: 72, b: 120, alpha: 0.8 } },
  }).withMetadata({ density: 300 }).png().toBuffer();

  const sanitized = await sanitizeDecodedImage(source, {
    expectedType: "image/png",
    outputType: "image/png",
  });

  assert.equal(sanitized.mimeType, "image/png");
  assert.deepEqual([sanitized.width, sanitized.height], [640, 480]);
  assert.equal(inspectImageBytes(sanitized.bytes, {
    expectedType: "image/png",
    sanitized: true,
  }).metadataPresent, false);
  const outputMetadata = await sharp(sanitized.bytes).metadata();
  assert.notEqual(outputMetadata.density, 300,
    "the public rendition must not retain the camera or source-file density value");
});

test("animated GIFs remain animated after metadata-free server WebP normalization", async () => {
  const source = gifFixture({ frames: 2 });
  const sourceInspection = inspectImageBytes(source, { expectedType: "image/gif" });
  assert.deepEqual({
    width: sourceInspection.width,
    height: sourceInspection.height,
    frames: sourceInspection.frames,
    animated: sourceInspection.animated,
    totalPixels: sourceInspection.totalPixels,
  }, { width: 1, height: 1, frames: 2, animated: true, totalPixels: 2 });

  const validated = await validateDecodedImage(source, { expectedType: "image/gif" });
  assert.deepEqual([validated.width, validated.height], [1, 1]);

  const sanitized = await sanitizeDecodedImage(source, {
    expectedType: "image/gif",
    outputType: "image/webp",
  });
  const publicInspection = inspectImageBytes(sanitized.bytes, {
    expectedType: "image/webp",
    sanitized: true,
  });
  assert.deepEqual({
    width: publicInspection.width,
    height: publicInspection.height,
    frames: publicInspection.frames,
    animated: publicInspection.animated,
    totalPixels: publicInspection.totalPixels,
    metadataPresent: publicInspection.metadataPresent,
  }, {
    width: 1,
    height: 1,
    frames: 2,
    animated: true,
    totalPixels: 2,
    metadataPresent: false,
  });
  const metadata = await sharp(sanitized.bytes, { animated: true, pages: -1 }).metadata();
  assert.equal(metadata.pages, 2);
  assert.equal(metadata.pageHeight, 1);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.xmp, undefined);
  assert.equal(metadata.icc, undefined);
});

test("static GIFs remain safe still WebP renditions", async () => {
  const source = gifFixture();
  assert.equal(inspectImageBytes(source, { expectedType: "image/gif" }).frames, 1);
  const sanitized = await sanitizeDecodedImage(source, {
    expectedType: "image/gif",
    outputType: "image/webp",
  });
  const inspection = inspectImageBytes(sanitized.bytes, {
    expectedType: "image/webp",
    sanitized: true,
  });
  assert.equal(inspection.frames, 1);
  assert.equal(inspection.animated, false);
});

test("animation frame bombs, metadata flags, and trailing payloads fail closed", async () => {
  assert.throws(
    () => inspectImageBytes(gifFixture({ frames: MAX_IMAGE_ANIMATION_FRAMES + 1 }), {
      expectedType: "image/gif",
    }),
    (error) => error.code === "resource_limit",
  );
  assert.throws(
    () => inspectImageBytes(gifFixture({ width: 4096, height: 4096, frames: 4 }), {
      expectedType: "image/gif",
    }),
    (error) => error.code === "resource_limit",
  );

  const source = gifFixture({ frames: 2 });
  assert.throws(
    () => inspectImageBytes(Buffer.concat([source, Buffer.from("hidden")]), {
      expectedType: "image/gif",
    }),
    (error) => error.code === "trailing_data",
  );
  const sanitized = await sanitizeDecodedImage(source, {
    expectedType: "image/gif",
    outputType: "image/webp",
  });
  assert.throws(
    () => inspectImageBytes(Buffer.concat([sanitized.bytes, Buffer.from("hidden")]), {
      expectedType: "image/webp",
      sanitized: true,
    }),
    (error) => error.code === "trailing_data",
  );
  const metadataFlag = Buffer.from(sanitized.bytes);
  assert.equal(metadataFlag.toString("ascii", 12, 16), "VP8X");
  metadataFlag[20] |= 0x08;
  assert.throws(
    () => inspectImageBytes(metadataFlag, { expectedType: "image/webp", sanitized: true }),
    (error) => error.code === "metadata",
  );
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

test("ordinary 20-item albums remain supported through serial processing without retaining every source buffer", async () => {
  const jpeg = await createdImage({ width: 512, height: 512 });
  const results = [];
  for (let index = 0; index < MEDIA_POST_MAX_ATTACHMENTS; index += 1) {
    results.push(await validateDecodedImage(jpeg, { expectedType: "image/jpeg" }));
  }
  assert.equal(results.length, MEDIA_POST_MAX_ATTACHMENTS);
  assert.equal(results.every((result) => result.mimeType === "image/jpeg"
    && result.width === 512 && result.height === 512 && result.pixels === 512 * 512), true);
  const health = imageProcessorHealth();
  assert.equal(health.isolation, "child_process");
  assert.equal(health.active, 0);
  assert.equal(health.queued, 0);
  assert.equal(health.queueCapacity, 2);
  assert.equal(health.queueByteCapacity, 60 * 1024 * 1024);
  assert.equal(health.maxPixels, MAX_IMAGE_PIXELS);
  assert.equal(health.diskCache, false);
  assert.equal(health.untrustedOperationsBlocked, true);
});

test("image worker admission rejects pressure before forking and keeps its memory lease until an aborted child exits", async () => {
  const jpeg = await createdImage();
  await assert.rejects(validateDecodedImage(jpeg, { expectedType: "image/jpeg", acquireMemoryLease: () => null }),
    (error) => error.code === "busy");
  assert.equal(imageProcessorHealth().active, 0);
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  let admissions = 0;
  await assert.rejects(validateDecodedImage(jpeg, { expectedType: "image/jpeg", signal: alreadyAborted.signal,
    acquireMemoryLease: () => { admissions += 1; return { release() {} }; } }), (error) => error.name === "AbortError");
  assert.equal(admissions, 0, "cancelled work must not acquire memory or start a child");
  let released = 0;
  const controller = new AbortController();
  const operation = validateDecodedImage(jpeg, { expectedType: "image/jpeg", signal: controller.signal,
    acquireMemoryLease: () => ({ release() { released += 1; } }) });
  const rejected = assert.rejects(operation, (error) => error.name === "AbortError");
  controller.abort();
  assert.equal(released, 0, "a cancelled child must keep its reservation until the OS reports exit");
  assert.equal(imageProcessorHealth().active, 1);
  await rejected;
  assert.equal(released, 1);
  assert.equal(imageProcessorHealth().active, 0);
});

test("queued image cancellation immediately frees retained buffers and excess work receives bounded backpressure", async () => {
  const jpeg = await createdImage();
  const activeController = new AbortController();
  const queuedController = new AbortController();
  const options = { expectedType: "image/jpeg", acquireMemoryLease: () => ({ release() {} }) };
  const active = validateDecodedImage(jpeg, { ...options, signal: activeController.signal });
  const cancelled = validateDecodedImage(jpeg, { ...options, signal: queuedController.signal });
  const next = validateDecodedImage(jpeg, options);
  const activeRejected = assert.rejects(active, (error) => error.name === "AbortError");
  const queuedRejected = assert.rejects(cancelled, (error) => error.name === "AbortError");
  assert.equal(imageProcessorHealth().queued, 2);
  await assert.rejects(validateDecodedImage(jpeg, options), (error) => error.code === "busy");
  queuedController.abort();
  assert.equal(imageProcessorHealth().queued, 1);
  assert.equal(imageProcessorHealth().queuedBytes, jpeg.length);
  activeController.abort();
  await Promise.all([activeRejected, queuedRejected]);
  assert.equal((await next).mimeType, "image/jpeg");
  assert.equal(imageProcessorHealth().queuedBytes, 0);
});

test("a synchronous admission failure rejects its queued photo without poisoning later work", async () => {
  const jpeg = await createdImage();
  const controller = new AbortController();
  let released = 0;
  const options = { expectedType: "image/jpeg",
    acquireMemoryLease: () => ({ release() { released += 1; } }) };
  const active = validateDecodedImage(jpeg, { ...options, signal: controller.signal });
  const failure = new Error("admission sensor unavailable");
  const rejected = validateDecodedImage(jpeg, { ...options, acquireMemoryLease: () => { throw failure; } });
  const next = validateDecodedImage(jpeg, options);
  const activeRejected = assert.rejects(active, (error) => error.name === "AbortError");
  const queuedRejected = assert.rejects(rejected, (error) => error === failure);
  assert.equal(imageProcessorHealth().queued, 2);
  controller.abort();
  await Promise.all([activeRejected, queuedRejected]);
  assert.equal((await next).mimeType, "image/jpeg");
  assert.equal(released, 2);
  assert.equal(imageProcessorHealth().active, 0);
  assert.equal(imageProcessorHealth().queued, 0);
  assert.equal(imageProcessorHealth().queuedBytes, 0);
});

test("queued image work expires before retaining source bytes indefinitely", async (t) => {
  const jpeg = await createdImage();
  const controller = new AbortController();
  const options = { expectedType: "image/jpeg", acquireMemoryLease: () => ({ release() {} }) };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const active = validateDecodedImage(jpeg, { ...options, signal: controller.signal });
  const queued = validateDecodedImage(jpeg, { ...options, queueTimeoutMs: 1000 });
  const queuedRejected = assert.rejects(queued, (error) => error.code === "timeout");
  const activeRejected = assert.rejects(active, (error) => error.name === "AbortError");
  t.mock.timers.tick(1000);
  assert.equal(imageProcessorHealth().queued, 0);
  assert.equal(imageProcessorHealth().queuedBytes, 0);
  controller.abort();
  await Promise.all([queuedRejected, activeRejected]);
  t.mock.timers.reset();
});

test("an active image deadline releases reserved memory only after terminating its child", async (t) => {
  const jpeg = await createdImage();
  let releases = 0;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const operation = validateDecodedImage(jpeg, { expectedType: "image/jpeg", timeoutMs: 1000,
    acquireMemoryLease: () => ({ release() { releases += 1; } }) });
  const rejected = assert.rejects(operation, (error) => error.code === "timeout");
  t.mock.timers.tick(1000);
  assert.equal(releases, 0);
  assert.equal(imageProcessorHealth().active, 1);
  await rejected;
  assert.equal(releases, 1);
  assert.equal(imageProcessorHealth().active, 0);
  t.mock.timers.reset();
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

test("profile photos receive exact server-authored avatar and banner geometry", async () => {
  const source = await createdImage({ width: 1200, height: 800 });

  const avatar = await sanitizeDecodedImage(source, {
    expectedType: "image/jpeg",
    profileRendition: "avatar",
  });
  assert.deepEqual([avatar.width, avatar.height], [1024, 1024]);

  const banner = await sanitizeDecodedImage(source, {
    expectedType: "image/jpeg",
    profileRendition: "banner",
  });
  assert.deepEqual([banner.width, banner.height], [1800, 600]);

  await assert.rejects(
    sanitizeDecodedImage(source, {
      expectedType: "image/jpeg",
      profileRendition: "post",
    }),
    (error) => error.code === "invalid_rendition",
  );
});
