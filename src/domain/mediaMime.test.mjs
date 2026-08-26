import assert from "node:assert/strict";
import test from "node:test";

import {
  detectMediaMimeType,
  mediaMimeFromName,
  resolveMediaMimeType,
} from "./mediaMime.mjs";

const textBytes = (value) => Uint8Array.from(
  [...value].map((character) => character.charCodeAt(0)),
);

function isoBaseMediaFile(majorBrand, compatibleBrands = []) {
  assert.equal(majorBrand.length, 4);
  compatibleBrands.forEach((brand) => assert.equal(brand.length, 4));
  const bytes = new Uint8Array(16 + (compatibleBrands.length * 4));
  const size = bytes.length;
  bytes.set([
    (size >>> 24) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
  ], 0);
  bytes.set(textBytes("ftyp"), 4);
  bytes.set(textBytes(majorBrand), 8);
  compatibleBrands.forEach((brand, index) => {
    bytes.set(textBytes(brand), 16 + (index * 4));
  });
  return bytes;
}

test("byte signatures identify camera photos and supported ISO media containers", () => {
  assert.equal(detectMediaMimeType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1])), "image/jpeg");
  assert.equal(detectMediaMimeType(isoBaseMediaFile("heic")), "image/heic");
  assert.equal(detectMediaMimeType(isoBaseMediaFile("mif1", ["heif"])), "image/heif");
  assert.equal(detectMediaMimeType(isoBaseMediaFile("avif", ["mif1"])), "image/avif");
  assert.equal(detectMediaMimeType(isoBaseMediaFile("avis", ["mif1"])), "image/avif");
  assert.equal(detectMediaMimeType(isoBaseMediaFile("isom", ["mp42"])), "video/mp4");
  assert.equal(detectMediaMimeType(isoBaseMediaFile("qt  ")), "video/quicktime");
});

test("compatible ISO brands select the most specific image format", () => {
  assert.equal(detectMediaMimeType(isoBaseMediaFile("mif1", ["heic"])), "image/heic");
  assert.equal(detectMediaMimeType(isoBaseMediaFile("mif1", ["avif"])), "image/avif");
});

test("verified bytes outrank picker metadata, then declared MIME outranks the filename", () => {
  assert.equal(resolveMediaMimeType({
    bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]),
    declaredType: "image/avif",
    fileName: "crowd.mov",
  }), "image/jpeg");
  assert.equal(resolveMediaMimeType({
    bytes: isoBaseMediaFile("avif"),
    declaredType: "image/jpeg",
    fileName: "crowd.jpg",
  }), "image/avif");
  assert.equal(resolveMediaMimeType({
    bytes: new Uint8Array([0]),
    declaredType: "IMAGE/HEIF; charset=binary",
    fileName: "crowd.jpg",
  }), "image/heif");
  assert.equal(resolveMediaMimeType({
    bytes: new Uint8Array([0]),
    declaredType: "application/octet-stream",
    fileName: "crowd.MOV?download=1",
  }), "video/quicktime");
  assert.equal(mediaMimeFromName("stage.AVIF#preview"), "image/avif");
});
