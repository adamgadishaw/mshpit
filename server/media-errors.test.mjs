import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, ERROR_CATALOG, errorEnvelope } from "./errors.js";
import { createMediaPresign, getMediaConfig, presignS3Request, validateMediaRequest } from "./media.js";

const configuredEnv = {
  NODE_ENV: "production",
  MEDIA_ENDPOINT: "https://objects.example.com",
  MEDIA_BUCKET: "pit-media",
  MEDIA_REGION: "auto",
  MEDIA_ACCESS_KEY_ID: "test-access-key",
  MEDIA_SECRET_ACCESS_KEY: "test-secret-key",
  MEDIA_PUBLIC_BASE_URL: "https://media.example.com",
};

test("error envelopes retain the public message and stable diagnostics without internals", () => {
  const envelope = errorEnvelope(new ApiError(401, "Wrong email or password.", "AUTH_INVALID"), "req_test");
  assert.deepEqual(envelope, {
    error: "Wrong email or password.",
    code: "AUTH_INVALID",
    status: 401,
    requestId: "req_test",
    retryable: false,
  });
  assert.equal(ERROR_CATALOG.INTERNAL_ERROR.retryable, true);
  const unknown = errorEnvelope(new Error("database password: secret"), "req_hidden");
  assert.equal(unknown.code, "INTERNAL_ERROR");
  assert.equal(unknown.requestId, "req_hidden");
  assert.equal(JSON.stringify(unknown).includes("database password"), false);
});

test("SigV4 matches Amazon S3's published deterministic presign example", () => {
  const url = presignS3Request({
    method: "GET",
    url: "https://examplebucket.s3.amazonaws.com/test.txt",
    region: "us-east-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    expiresIn: 86400,
    now: new Date("2013-05-24T00:00:00Z"),
  });
  assert.equal(url, "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
});

test("media validation rejects unsafe or oversized uploads with stable codes", () => {
  assert.throws(
    () => validateMediaRequest({ purpose: "post", contentType: "image/svg+xml", fileSize: 100, name: "photo.svg" }),
    (error) => error instanceof ApiError && error.code === "MEDIA_TYPE_UNSUPPORTED" && error.status === 415
  );
  assert.throws(
    () => validateMediaRequest({ purpose: "avatar", contentType: "image/jpeg", fileSize: 6 * 1024 * 1024, name: "photo.jpg" }),
    (error) => error instanceof ApiError && error.code === "MEDIA_TOO_LARGE" && error.status === 413
  );
  assert.throws(
    () => validateMediaRequest({ purpose: "post", contentType: "image/jpeg", fileSize: 100, name: "../photo.jpg" }),
    (error) => error instanceof ApiError && error.code === "VALIDATION_FAILED"
  );
  assert.equal(getMediaConfig({}).configured, false);
});

test("video clips are allowed on posts with their own cap, never on avatars", () => {
  const clip = validateMediaRequest({ purpose: "post", contentType: "video/mp4", fileSize: 60 * 1024 * 1024, name: "clip.mp4" });
  assert.equal(clip.extension, "mp4");
  const mov = validateMediaRequest({ purpose: "review", contentType: "video/quicktime", fileSize: 5 * 1024 * 1024, name: "clip.mov" });
  assert.equal(mov.extension, "mov");
  // A clip larger than the video cap is refused with the stable size code.
  assert.throws(
    () => validateMediaRequest({ purpose: "post", contentType: "video/mp4", fileSize: 101 * 1024 * 1024, name: "clip.mp4" }),
    (error) => error instanceof ApiError && error.code === "MEDIA_TOO_LARGE" && error.status === 413
  );
  // The photo cap does NOT loosen: a 60MB jpeg is still too large for a post.
  assert.throws(
    () => validateMediaRequest({ purpose: "post", contentType: "image/jpeg", fileSize: 60 * 1024 * 1024, name: "photo.jpg" }),
    (error) => error instanceof ApiError && error.code === "MEDIA_TOO_LARGE"
  );
  // Avatars and banners stay image-only.
  assert.throws(
    () => validateMediaRequest({ purpose: "avatar", contentType: "video/mp4", fileSize: 1024, name: "clip.mp4" }),
    (error) => error instanceof ApiError && error.code === "MEDIA_TYPE_UNSUPPORTED" && error.status === 415
  );
});

test("media presigns a short-lived user-owned key without exposing credentials", () => {
  const result = createMediaPresign({
    userId: "u_owner",
    body: { purpose: "post", contentType: "image/jpeg", fileSize: 3456, name: "concert.jpg" },
    env: configuredEnv,
    now: new Date("2026-07-12T20:30:40Z"),
    objectId: "fixed-object",
  });
  assert.equal(result.method, "PUT");
  assert.equal(result.key, "users/u_owner/post/fixed-object.jpg");
  assert.equal(result.publicUrl, "https://media.example.com/users/u_owner/post/fixed-object.jpg");
  assert.deepEqual(result.requiredHeaders, { "Content-Type": "image/jpeg" });
  assert.match(result.uploadUrl, /^https:\/\/objects\.example\.com\/pit-media\/users\/u_owner\/post\/fixed-object\.jpg\?/);
  assert.match(result.uploadUrl, /X-Amz-SignedHeaders=content-type%3Bhost/);
  assert.equal(result.uploadUrl.includes(configuredEnv.MEDIA_SECRET_ACCESS_KEY), false);
  assert.equal(result.expiresAt, new Date("2026-07-12T20:40:40Z").getTime());
});

test("media storage fails closed when server credentials are incomplete", () => {
  assert.throws(
    () => createMediaPresign({
      userId: "u_owner",
      body: { purpose: "post", contentType: "image/jpeg", fileSize: 10, name: "photo.jpg" },
      env: {},
    }),
    (error) => error instanceof ApiError && error.code === "MEDIA_STORAGE_UNAVAILABLE" && error.status === 503
  );
});

test("video clips are accepted for posts, capped at 100MB, and image-only surfaces refuse them", () => {
  const clip = validateMediaRequest({ purpose: "post", contentType: "video/mp4", fileSize: 50 * 1024 * 1024, name: "clip.mp4" });
  assert.equal(clip.extension, "mp4");
  const mov = validateMediaRequest({ purpose: "review", contentType: "video/quicktime", fileSize: 1024, name: "clip.mov" });
  assert.equal(mov.extension, "mov");
  assert.throws(
    () => validateMediaRequest({ purpose: "post", contentType: "video/mp4", fileSize: 101 * 1024 * 1024, name: "clip.mp4" }),
    (error) => error.code === "MEDIA_TOO_LARGE" && error.status === 413,
  );
  assert.throws(
    () => validateMediaRequest({ purpose: "avatar", contentType: "video/mp4", fileSize: 1024, name: "clip.mp4" }),
    (error) => error.code === "MEDIA_TYPE_UNSUPPORTED",
  );
  // Photo caps are untouched by the video allowance.
  assert.throws(
    () => validateMediaRequest({ purpose: "post", contentType: "image/jpeg", fileSize: 13 * 1024 * 1024, name: "big.jpg" }),
    (error) => error.code === "MEDIA_TOO_LARGE",
  );
});
