import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { licensedVenuePhoto } from "../../src/domain/venuePhotoProvenance.mjs";
import {
  mirrorLicensedArtistPhoto,
  mirrorLicensedVenuePhoto,
  venuePhotoMirrorConfigured,
  venuePhotoMirrorSourceHosts,
  VenuePhotoMirrorError,
} from "./venue-photo-mirror.mjs";

const ENV = Object.freeze({
  MEDIA_ENDPOINT: "https://example-account.r2.cloudflarestorage.com",
  MEDIA_BUCKET: "mshpit-public-media",
  MEDIA_REGION: "auto",
  MEDIA_ACCESS_KEY_ID: "test-access",
  MEDIA_SECRET_ACCESS_KEY: "test-secret",
  MEDIA_PUBLIC_BASE_URL: "https://media.mshpit.example",
});

const PHOTO = Object.freeze({
  title: "Test_Hall.jpg",
  uri: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Test_Hall.jpg",
  sourcePage: "https://commons.wikimedia.org/wiki/File:Test_Hall.jpg",
  creator: "Example Photographer",
  license: "CC-BY-SA-4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  source: "commons",
});

const sourceImage = await sharp({
  create: { width: 16, height: 12, channels: 3, background: { r: 40, g: 70, b: 100 } },
}).jpeg().toBuffer();

function imageResponse(bytes = sourceImage, init = {}) {
  return new Response(bytes, {
    status: init.status || 200,
    headers: { "Content-Type": init.contentType || "image/jpeg", "Content-Length": String(bytes.length), ...(init.headers || {}) },
  });
}

test("venue-photo mirror source overrides accept exact public hosts only", () => {
  const hosts = venuePhotoMirrorSourceHosts({
    VENUE_PHOTO_MIRROR_SOURCE_HOSTS: "images.reviewed.example,*.example,127.0.0.1,localhost,service.internal",
  });
  assert.deepEqual([...hosts], ["upload.wikimedia.org", "thumb.wikimedia.org", "images.reviewed.example"]);
  assert.equal(venuePhotoMirrorConfigured(ENV), true);
});

test("venue-photo mirroring fails before downloading when storage is unconfigured", async () => {
  let calls = 0;
  await assert.rejects(() => mirrorLicensedVenuePhoto({
    venueKey: "test hall", photo: PHOTO, env: {},
    fetchImpl: async () => { calls += 1; return imageResponse(); },
  }), (error) => error.code === "STORAGE_UNCONFIGURED");
  assert.equal(calls, 0);
});

test("venue-photo mirroring fails before network access when provenance is incomplete", async () => {
  let calls = 0;
  await assert.rejects(() => mirrorLicensedVenuePhoto({
    venueKey: "test hall",
    photo: { ...PHOTO, licenseUrl: null },
    env: ENV,
    fetchImpl: async () => { calls += 1; return imageResponse(); },
  }), (error) => error instanceof VenuePhotoMirrorError && error.code === "PROVENANCE_INVALID");
  assert.equal(calls, 0);
});

test("venue-photo mirroring rejects non-allowlisted image hosts and redirect escapes", async () => {
  await assert.rejects(() => mirrorLicensedVenuePhoto({
    venueKey: "test hall",
    photo: { ...PHOTO, uri: "https://images.unreviewed.example/venue.jpg" },
    env: ENV,
    fetchImpl: async () => imageResponse(),
  }), (error) => error.code === "SOURCE_HOST_NOT_APPROVED");

  await assert.rejects(() => mirrorLicensedVenuePhoto({
    venueKey: "test hall",
    photo: PHOTO,
    env: ENV,
    fetchImpl: async (url) => String(url).startsWith(PHOTO.uri)
      ? new Response(null, { status: 302, headers: { Location: "https://127.0.0.1/private.jpg" } })
      : imageResponse(),
  }), (error) => error.code === "SOURCE_HOST_NOT_APPROVED");
});

test("venue-photo mirroring accepts Commons thumbnail URLs without allowing redirect escapes", async () => {
  const thumbnailUri = "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Test_Hall.jpg/800px-Test_Hall.jpg";
  let sourceCalls = 0;
  const mirrored = await mirrorLicensedVenuePhoto({
    venueKey: "test hall",
    photo: { ...PHOTO, uri: thumbnailUri },
    env: ENV,
    fetchImpl: async (url, options = {}) => {
      if (String(url) === thumbnailUri) {
        sourceCalls += 1;
        return imageResponse();
      }
      assert.equal(options.method, "PUT");
      return new Response(null, { status: 201 });
    },
  });
  assert.equal(sourceCalls, 1);
  assert.equal(mirrored.mirroredFrom, thumbnailUri);

  await assert.rejects(() => mirrorLicensedVenuePhoto({
    venueKey: "test hall",
    photo: { ...PHOTO, uri: thumbnailUri },
    env: ENV,
    fetchImpl: async () => new Response(null, {
      status: 302,
      headers: { Location: "https://images.unreviewed.example/redirected.jpg" },
    }),
  }), (error) => error.code === "SOURCE_HOST_NOT_APPROVED");
});

test("venue-photo mirroring writes a bounded create-only derivative and retains attribution", async () => {
  let uploaded = null;
  const priorNotice = "P".repeat(240);
  const mirrored = await mirrorLicensedVenuePhoto({
    venueKey: "Test Hall, Toronto",
    photo: { ...PHOTO, modificationNotice: priorNotice },
    env: ENV,
    now: new Date("2026-08-27T12:00:00.000Z"),
    fetchImpl: async (url, options = {}) => {
      if (String(url).startsWith(PHOTO.uri)) return imageResponse();
      assert.equal(options.method, "PUT");
      assert.match(String(url), /example-account\.r2\.cloudflarestorage\.com\/mshpit-public-media\/venues\/licensed\//u);
      assert.equal(options.headers["Content-Type"], "image/webp");
      assert.equal(options.headers["If-None-Match"], "*");
      assert.equal(Number(options.headers["Content-Length"]), options.body.byteLength);
      assert.equal(options.headers["Cache-Control"], "public, max-age=300, must-revalidate");
      uploaded = Buffer.from(options.body);
      return new Response(null, { status: 201 });
    },
  });
  assert.ok(uploaded?.length > 0);
  assert.equal(mirrored.creator, PHOTO.creator);
  assert.equal(mirrored.title, PHOTO.title);
  assert.equal(mirrored.license, PHOTO.license);
  assert.equal(mirrored.licenseUrl, PHOTO.licenseUrl);
  assert.equal(mirrored.sourcePage, PHOTO.sourcePage);
  assert.equal(mirrored.provenanceSource, "commons");
  assert.equal(mirrored.mirroredFrom, PHOTO.uri);
  assert.match(mirrored.uri, /^https:\/\/media\.mshpit\.example\/venues\/licensed\/.+\.webp$/u);
  assert.match(mirrored.modificationNotice, /Converted to WebP and resized when needed by MSHpit for delivery\.$/u);
  assert.ok(mirrored.modificationNotice.length <= 240);
  assert.notEqual(mirrored.modificationNotice, priorNotice, "the derivative notice must replace, not lose to, an overlong prior notice");
  assert.equal(mirrored.mirror.contentType, "image/webp");
  assert.equal(mirrored.mirror.reused, false);
  assert.ok(licensedVenuePhoto(mirrored), "the stored record remains acceptable to the publication validator");
});

test("artist-photo mirroring uses the hardened pipeline with an artist-only object namespace", async () => {
  let uploadedObject = null;
  const mirrored = await mirrorLicensedArtistPhoto({
    artistKey: "Bryson Tiller",
    photo: PHOTO,
    env: ENV,
    now: new Date("2026-09-04T12:00:00.000Z"),
    fetchImpl: async (url, options = {}) => {
      if (String(url).startsWith(PHOTO.uri)) return imageResponse();
      assert.equal(options.method, "PUT");
      uploadedObject = String(url);
      return new Response(null, { status: 201 });
    },
  });

  assert.match(uploadedObject, /\/mshpit-public-media\/artists\/licensed\/bryson-tiller-[a-f0-9]{12}\/[a-f0-9]{48}\.webp(?:\?|$)/u);
  assert.match(mirrored.uri, /^https:\/\/media\.mshpit\.example\/artists\/licensed\/bryson-tiller-[a-f0-9]{12}\/[a-f0-9]{48}\.webp$/u);
  assert.equal(mirrored.creator, PHOTO.creator);
  assert.equal(mirrored.title, PHOTO.title);
  assert.equal(mirrored.license, PHOTO.license);
  assert.equal(mirrored.provenanceSource, "commons");
  assert.equal(mirrored.mirror.reused, false);
  assert.equal(
    mirrored.modificationNotice,
    "Resized and converted to WebP by MSHpit.",
  );
  assert.ok(licensedVenuePhoto(mirrored), "the artist derivative retains the shared licensed-photo provenance contract");
});

test("venue-photo mirroring accepts an idempotent conflict only after byte verification", async () => {
  let deliveryBytes = null;
  const mirrored = await mirrorLicensedVenuePhoto({
    venueKey: "Test Hall",
    photo: PHOTO,
    env: ENV,
    fetchImpl: async (url, options = {}) => {
      if (String(url).startsWith(PHOTO.uri)) return imageResponse();
      if (options.method === "PUT") {
        deliveryBytes = Buffer.from(options.body);
        return new Response(null, { status: 412 });
      }
      assert.equal(options.method, "GET");
      return new Response(deliveryBytes, {
        status: 200,
        headers: { "Content-Type": "image/webp", "Content-Length": String(deliveryBytes.length) },
      });
    },
  });
  assert.equal(mirrored.mirror.reused, true);
});

test("venue-photo mirroring rejects oversized sources without uploading", async () => {
  let uploadCalls = 0;
  await assert.rejects(() => mirrorLicensedVenuePhoto({
    venueKey: "Test Hall",
    photo: PHOTO,
    env: ENV,
    sourceMaxBytes: 32,
    fetchImpl: async (url) => {
      if (String(url).startsWith(PHOTO.uri)) return imageResponse();
      uploadCalls += 1;
      return new Response(null, { status: 201 });
    },
  }), (error) => error.code === "SOURCE_TOO_LARGE");
  assert.equal(uploadCalls, 0);
});
