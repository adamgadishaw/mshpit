import assert from "node:assert/strict";
import test from "node:test";

import {
  createMediaDownloadCapability,
  createMediaProcessorUploadCapability,
  verifyPrivateMediaBucketIsolation,
} from "./media.js";

const ENV = {
  NODE_ENV: "production",
  MEDIA_ENDPOINT: "https://account.r2.example.invalid",
  MEDIA_BUCKET: "pit-media",
  MEDIA_SOURCE_BUCKET: "pit-media-private",
  MEDIA_REGION: "auto",
  MEDIA_ACCESS_KEY_ID: "test-access-key",
  MEDIA_SECRET_ACCESS_KEY: "test-secret-key",
  MEDIA_PUBLIC_BASE_URL: "https://media.example.invalid",
};

await verifyPrivateMediaBucketIsolation({
  env: ENV,
  fetchImpl: async () => ({ status: 403 }),
});

test("authoritative processors receive an exact short-lived ETag-bound GET capability", () => {
  const now = new Date("2026-08-23T12:00:00.000Z");
  const ticket = createMediaDownloadCapability({
    objectKey: "users/u_owner/post/ma_source.mp4",
    ifMatch: '"strong-etag"',
    env: ENV,
    now,
    expiresIn: 90,
    storageScope: "private",
  });
  const url = new URL(ticket.downloadUrl);
  assert.equal(ticket.method, "GET");
  assert.deepEqual(ticket.requiredHeaders, { "If-Match": '"strong-etag"' });
  assert.equal(ticket.expiresAt, now.getTime() + 90_000);
  assert.equal(url.origin, ENV.MEDIA_ENDPOINT);
  assert.equal(url.pathname, "/pit-media-private/users/u_owner/post/ma_source.mp4");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "90");
  assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "host;if-match");
  assert.match(url.searchParams.get("X-Amz-Signature"), /^[a-f0-9]{64}$/);
});

test("authoritative processors receive create-only public delivery capability without credentials", () => {
  const now = new Date("2026-08-23T12:00:00.000Z");
  const ticket = createMediaProcessorUploadCapability({
    objectKey: "users/u_owner/post/ma_delivery.mp4",
    env: ENV,
    now,
    expiresIn: 120,
  });
  const url = new URL(ticket.uploadUrl);
  assert.equal(ticket.method, "PUT");
  assert.equal(ticket.storageScope, "public");
  assert.equal(ticket.publicUrl, "https://media.example.invalid/users/u_owner/post/ma_delivery.mp4");
  assert.deepEqual(ticket.requiredHeaders, { "Content-Type": "video/mp4", "If-None-Match": "*" });
  assert.equal(url.pathname, "/pit-media/users/u_owner/post/ma_delivery.mp4");
  assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "content-type;host;if-none-match");
  assert.equal(url.toString().includes(ENV.MEDIA_SECRET_ACCESS_KEY), false);
});

test("download capabilities reject traversal, weak generations, and broad lifetimes", () => {
  assert.throws(() => createMediaDownloadCapability({
    objectKey: "users/u_owner/post/../escape.mp4",
    ifMatch: '"etag"',
    env: ENV,
  }), { code: "INTERNAL_ERROR" });
  assert.throws(() => createMediaDownloadCapability({
    objectKey: "users/u_owner/post/source.mp4",
    ifMatch: "W/\"etag\"",
    env: ENV,
  }), { code: "INTERNAL_ERROR" });
  assert.throws(() => createMediaDownloadCapability({
    objectKey: "users/u_owner/post/source.mp4",
    ifMatch: '"etag"',
    expiresIn: 301,
    env: ENV,
  }), { code: "INTERNAL_ERROR" });
});
