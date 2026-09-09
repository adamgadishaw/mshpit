import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, errorEnvelope } from "./errors.js";
import { createMediaPresign, getMediaConfig, mediaBucketForScope } from "./media.js";
import { mediaStorageUnavailable } from "./mediaStorageFailure.js";
import { safeRequestFailureContext } from "./safeLogging.js";

const env = Object.freeze({
  NODE_ENV: "production",
  MEDIA_ENDPOINT: "https://objects.example.com",
  MEDIA_BUCKET: "diagnostic-public",
  MEDIA_SOURCE_BUCKET: "diagnostic-private",
  MEDIA_REGION: "auto",
  MEDIA_ACCESS_KEY_ID: "fixture-access",
  MEDIA_SECRET_ACCESS_KEY: "fixture-secret",
  MEDIA_PUBLIC_BASE_URL: "https://media.example.com",
});
const body = { purpose: "post", contentType: "image/jpeg", fileSize: 100, name: "private-photo.jpg" };
const context = (error) => safeRequestFailureContext({
  method: "POST", routePattern: "/api/media/assets", error,
});

test("upload preparation reasons stay distinct privately without changing the public contract", () => {
  const reasons = ["configuration_invalid", "privacy_not_ready", "service_capacity"];
  const causes = new Set();
  for (const reason of reasons) {
    const error = mediaStorageUnavailable("Uploads are temporarily unavailable.", reason);
    assert.ok(error instanceof ApiError);
    assert.deepEqual(errorEnvelope(error, "fixture-request"), {
      error: "Uploads are temporarily unavailable.",
      code: "MEDIA_STORAGE_UNAVAILABLE", status: 503, requestId: "fixture-request", retryable: true,
    });
    assert.equal(context(error).cause, `MediaStorageFailure/${reason}`);
    // Matches errorLog's strictly bounded cause schema, including its lengths.
    assert.match(context(error).cause, /^[A-Za-z][A-Za-z0-9_.]{0,38}(\/[A-Za-z0-9_.]{1,38})?$/);
    causes.add(context(error).cause);
  }
  assert.equal(causes.size, 3);
  assert.throws(() => mediaStorageUnavailable("No", "https://secret.example/bucket?token=secret"), TypeError);
});

test("missing and invalid configuration are classified before any upload capability is issued", () => {
  for (const overrides of [
    { MEDIA_ACCESS_KEY_ID: "" },
    { MEDIA_ENDPOINT: "not a url" },
    { MEDIA_ENDPOINT: "http://objects.example.com" },
    { MEDIA_PUBLIC_BASE_URL: "https://user:secret@media.example.com" },
  ]) {
    assert.throws(() => createMediaPresign({ userId: "private_member", body, env: { ...env, ...overrides } }), (error) => {
      assert.equal(error.status, 503);
      assert.equal(context(error).cause, "MediaStorageFailure/configuration_invalid");
      const exposed = JSON.stringify([context(error), errorEnvelope(error, "fixture-request")]);
      assert.doesNotMatch(exposed, /fixture-secret|private_member|private-photo|objects\.example|diagnostic-private|user:secret/);
      return true;
    });
  }
  assert.throws(() => mediaBucketForScope(getMediaConfig({ ...env, MEDIA_SOURCE_BUCKET: "" }), "private"),
    (error) => context(error).cause === "MediaStorageFailure/configuration_invalid");
});

test("unproven private storage still refuses upload capabilities with an actionable private cause", () => {
  assert.throws(() => createMediaPresign({ userId: "private_member", body, env, storageScope: "private" }), (error) => {
    assert.equal(error.status, 503);
    assert.equal(error.code, "MEDIA_STORAGE_UNAVAILABLE");
    assert.equal(context(error).cause, "MediaStorageFailure/privacy_not_ready");
    assert.doesNotMatch(JSON.stringify(context(error)), /private_member|diagnostic-private|fixture-secret|https:/);
    return true;
  });
});

test("missing, malformed and public-only source buckets are configuration failures, not probe failures", () => {
  for (const sourceBucket of ["", "bad/bucket", env.MEDIA_BUCKET]) {
    assert.throws(() => createMediaPresign({
      userId: "private_member", body, env: { ...env, MEDIA_SOURCE_BUCKET: sourceBucket }, storageScope: "private",
    }), (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, "MEDIA_STORAGE_UNAVAILABLE");
      assert.equal(context(error).cause, "MediaStorageFailure/configuration_invalid");
      return true;
    });
  }
});
