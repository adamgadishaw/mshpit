import assert from "node:assert/strict";
import test from "node:test";

import {
  createMediaPresign,
  privateMediaIsolationStatus,
  verifyPrivateMediaBucketIsolation,
} from "./media.js";

const BASE_ENV = Object.freeze({
  NODE_ENV: "production",
  MEDIA_ENDPOINT: "https://objects.example.com/s3",
  MEDIA_BUCKET: "pit-public",
  MEDIA_SOURCE_BUCKET: "pit-private-a",
  MEDIA_REGION: "auto",
  MEDIA_ACCESS_KEY_ID: "privacy-access",
  MEDIA_SECRET_ACCESS_KEY: "privacy-secret",
  MEDIA_PUBLIC_BASE_URL: "https://media.example.com/cdn",
});

const photoBody = Object.freeze({
  purpose: "avatar",
  contentType: "image/jpeg",
  fileSize: 1_024,
  name: "avatar.jpg",
});

test("production private capabilities require anonymous list and object GET denial", async () => {
  assert.throws(
    () => createMediaPresign({
      userId: "privacy_owner",
      body: photoBody,
      env: BASE_ENV,
      objectId: "private-before-check",
      storageScope: "private",
    }),
    (error) => error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE",
  );

  const probes = [];
  const ready = await verifyPrivateMediaBucketIsolation({
    env: BASE_ENV,
    clock: () => 12_345,
    fetchImpl: async (url, options) => {
      probes.push({ url, options });
      return { status: probes.length === 1 ? 401 : 403 };
    },
  });
  assert.deepEqual(ready, {
    configured: true,
    ready: true,
    checkedAt: 12_345,
    listStatus: 401,
    objectStatus: 403,
    errorCode: null,
  });
  assert.equal(probes.length, 2);
  assert.equal(probes.every((probe) => probe.options.method === "GET" && probe.options.redirect === "error"), true);
  assert.equal(probes.every((probe) => !new URL(probe.url).searchParams.has("X-Amz-Signature")), true,
    "the privacy canary is intentionally anonymous");

  const ticket = createMediaPresign({
    userId: "privacy_owner",
    body: photoBody,
    env: BASE_ENV,
    objectId: "private-after-check",
    storageScope: "private",
  });
  assert.equal(ticket.publicUrl, null);
  assert.equal(ticket.storageScope, "private");
  assert.equal(ticket.storageLocator, "pit-private:users/privacy_owner/avatar/private-after-check.jpg");

  const changedEnv = { ...BASE_ENV, MEDIA_SOURCE_BUCKET: "pit-private-b" };
  assert.deepEqual(privateMediaIsolationStatus(changedEnv), {
    configured: true,
    ready: false,
    checkedAt: null,
    listStatus: null,
    objectStatus: null,
    errorCode: "not_checked",
  }, "changing the configured bucket invalidates an earlier canary result");
  assert.throws(
    () => createMediaPresign({
      userId: "privacy_owner",
      body: photoBody,
      env: changedEnv,
      objectId: "private-new-bucket",
      storageScope: "private",
    }),
    (error) => error.status === 503,
  );

  const exposed = await verifyPrivateMediaBucketIsolation({
    env: changedEnv,
    fetchImpl: async (url) => ({ status: new URL(url).searchParams.has("list-type") ? 403 : 404 }),
  });
  assert.equal(exposed.ready, false, "even an anonymous 404 is not proof that object reads are denied");
  assert.equal(exposed.errorCode, "anonymous_access_not_denied");
  assert.deepEqual(Object.keys(exposed).sort(), [
    "checkedAt", "configured", "errorCode", "listStatus", "objectStatus", "ready",
  ], "health diagnostics do not expose bucket names or credentials");

  const publiclyListableEnv = { ...BASE_ENV, MEDIA_SOURCE_BUCKET: "pit-private-c" };
  const publiclyListable = await verifyPrivateMediaBucketIsolation({
    env: publiclyListableEnv,
    fetchImpl: async (url) => ({ status: new URL(url).searchParams.has("list-type") ? 200 : 403 }),
  });
  assert.equal(publiclyListable.ready, false);
  assert.equal(publiclyListable.errorCode, "anonymous_access_not_denied");
});
