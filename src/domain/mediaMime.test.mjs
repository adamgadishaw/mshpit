import assert from "node:assert/strict";
import test from "node:test";

import {
  detectMediaMimeType,
  looksLikeVideoContainer,
  mediaMimeFromName,
  normalizedVideoMimeType,
  resolveMediaMimeType,
  VIDEO_SOURCE_MIME_TYPES,
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

test("every common video container is recognised from its first bytes", () => {
  assert.equal(detectMediaMimeType(isoBaseMediaFile("3gp5", ["isom"])), "video/3gpp");
  assert.equal(detectMediaMimeType(isoBaseMediaFile("3g2a")), "video/3gpp2");
  assert.equal(detectMediaMimeType(isoBaseMediaFile("XAVC", ["mp42"])), "video/mp4", "camera brands are still MP4-family clips");
  assert.equal(detectMediaMimeType(isoBaseMediaFile("mp42", ["hevc"])), "video/mp4", "an HEVC clip is not a HEIC photo");
  assert.equal(detectMediaMimeType(isoBaseMediaFile("crx ")), "", "a Canon RAW photo is not a clip");
  assert.equal(detectMediaMimeType(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x84, ...textBytes("webm")])), "video/webm");
  assert.equal(detectMediaMimeType(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x88, ...textBytes("matroska")])), "video/x-matroska");
  assert.equal(detectMediaMimeType(textBytes("RIFF\u0000\u0000\u0000\u0000AVI LIST")), "video/x-msvideo");
  assert.equal(detectMediaMimeType(textBytes("OggS\u0000\u0002")), "video/ogg");
  assert.equal(detectMediaMimeType(Uint8Array.from([0x00, 0x00, 0x01, 0xba, 0x44])), "video/mpeg");
  assert.equal(detectMediaMimeType(Uint8Array.from([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6])), "video/x-ms-wmv");
  assert.equal(detectMediaMimeType(Uint8Array.from([0x46, 0x4c, 0x56, 0x01, 0x05])), "video/x-flv");
});

test("the server accepts any real video container and nothing else", () => {
  assert.equal(looksLikeVideoContainer(isoBaseMediaFile("qt  ")), true);
  assert.equal(looksLikeVideoContainer(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3])), true);
  assert.equal(looksLikeVideoContainer(Uint8Array.from([0x47, 0x40, 0x00]), "video/mp2t"), true);
  assert.equal(looksLikeVideoContainer(Uint8Array.from([0x47, 0x40, 0x00]), "video/mp4"), false);
  assert.equal(looksLikeVideoContainer(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), "video/mp4"), false, "a JPEG is not a clip");
  assert.equal(looksLikeVideoContainer(textBytes("<!doctype html><script>"), "video/mp4"), false);
  assert.equal(looksLikeVideoContainer(new Uint8Array(), "video/mp4"), false);
});

test("declared video types and file names cover every accepted container", () => {
  assert.equal(normalizedVideoMimeType("VIDEO/MATROSKA"), "video/x-matroska");
  assert.equal(normalizedVideoMimeType("video/avi"), "video/x-msvideo");
  assert.equal(normalizedVideoMimeType("video/x-unknown"), "");
  assert.equal(resolveMediaMimeType({ bytes: new Uint8Array([0]), declaredType: "video/avi", fileName: "x" }), "video/x-msvideo");
  for (const [name, type] of [["a.mkv", "video/x-matroska"], ["a.AVI", "video/x-msvideo"], ["a.m4v", "video/x-m4v"], ["a.3gp", "video/3gpp"], ["a.mts", "video/mp2t"], ["a.wmv", "video/x-ms-wmv"], ["a.ogv", "video/ogg"], ["a.mpg", "video/mpeg"], ["a.flv", "video/x-flv"]]) {
    assert.equal(mediaMimeFromName(name), type, name);
  }
  assert.ok(VIDEO_SOURCE_MIME_TYPES.includes("video/quicktime"));
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
