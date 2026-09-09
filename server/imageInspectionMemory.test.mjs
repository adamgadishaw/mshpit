import assert from "node:assert/strict";
import test from "node:test";
import { createDeflate, deflateSync } from "node:zlib";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { inspectImageBytes, inspectImageBytesAsync } from "./imageInspection.js";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes = Buffer.alloc(0)) {
  const label = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([label, bytes])));
  return Buffer.concat([length, label, bytes, checksum]);
}
function png(width, height, compressed, { interlace = 0, split = false } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6; header[12] = interlace;
  const body = split ? [compressed.subarray(0, 3), compressed.subarray(3)] : [compressed];
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), ...body.map((bytes) => chunk("IDAT", bytes)), chunk("IEND")]);
}
const options = { expectedType: "image/png", sanitized: true };

test("streaming PNG inspection preserves framing, CRC, scanline length and filter validation", async () => {
  const width = 200, height = 100, rowSize = width * 4 + 1;
  const validPixels = Buffer.alloc(rowSize * height);
  const normal = png(width, height, deflateSync(validPixels), { split: true });
  assert.deepEqual(await inspectImageBytesAsync(normal, options), inspectImageBytes(normal, options));
  const invalidFilter = Buffer.from(validPixels);
  invalidFilter[rowSize * 90] = 5;
  const checksumError = Buffer.from(normal);
  checksumError[29] ^= 1;
  for (const sample of [
    png(width, height, deflateSync(invalidFilter)),
    png(width, height, deflateSync(validPixels.subarray(1))),
    png(width, height, deflateSync(Buffer.concat([validPixels, Buffer.from([0])]))),
    png(width, height, deflateSync(validPixels).subarray(0, 10)),
    checksumError,
    Buffer.concat([normal, Buffer.from("hidden payload")]),
  ]) {
    assert.throws(() => inspectImageBytes(sample, options));
    await assert.rejects(inspectImageBytesAsync(sample, options));
  }
});

test("streaming PNG validation handles interlaced pass boundaries including filter bytes split across chunks", async () => {
  const width = 100, height = 100;
  const passes = [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]];
  const raw = Buffer.concat(passes.map(([x,y,dx,dy]) => {
    const columns = width > x ? Math.ceil((width-x)/dx) : 0;
    const rows = height > y ? Math.ceil((height-y)/dy) : 0;
    return Buffer.alloc(columns && rows ? rows * (columns * 4 + 1) : 0);
  }));
  const sample = png(width, height, deflateSync(raw), { interlace: 1, split: true });
  assert.deepEqual(await inspectImageBytesAsync(sample, options), inspectImageBytes(sample, options));
});

test("oversized PNG dimensions are rejected at the header before any inflation", async () => {
  const sample = png(16000, 16000, Buffer.from("not even a zlib stream"));
  assert.throws(() => inspectImageBytes(sample, options), (error) => error.code === "resource_limit");
  await assert.rejects(inspectImageBytesAsync(sample, options), (error) => error.code === "resource_limit");
});

test("48-megapixel phone PNGs remain admitted using bounded streaming scanline validation", async () => {
  const width = 8000, height = 6000, row = Buffer.alloc(width * 4 + 1);
  const compressed = [];
  await pipeline(Readable.from((function* () { for (let index = 0; index < height; index += 1) yield row; })()),
    createDeflate(), new Writable({ write(bytes, _encoding, done) { compressed.push(bytes); done(); } }));
  const sample = png(width, height, Buffer.concat(compressed));
  const result = await inspectImageBytesAsync(sample, options);
  assert.equal(result.pixels, 48_000_000);
  const controller = new AbortController();
  const operation = inspectImageBytesAsync(sample, { ...options, signal: controller.signal });
  const rejected = assert.rejects(operation, (error) => error.name === "AbortError");
  controller.abort();
  await rejected;
});
