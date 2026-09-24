import assert from "node:assert/strict";
import test from "node:test";

import {
  VIDEO_VERIFIER_SOURCE_CONTENT_TYPES,
  VIDEO_VERIFIER_UNIVERSAL_ADMISSION,
  VIDEO_VERIFIER_UNIVERSAL_SOURCE_TYPES,
  signVideoVerifierRequest,
  signVideoVerifierResponse,
  videoVerifierSourceExtension,
  videoVerifierUniversalPosterTimeMs,
  verifyVideoVerifierRequest,
  verifyVideoVerifierResponse,
} from "./videoVerifierProtocol.js";

const SECRET = "test-video-verifier-secret-that-is-at-least-thirty-two-bytes";
const AT = 1_800_000_000_000;
const NONCE = "abcdefghijklmnopqrstuv";

test("source media types have one shared exact extension contract", () => {
  assert.deepEqual(VIDEO_VERIFIER_SOURCE_CONTENT_TYPES, ["video/mp4", "video/quicktime"]);
  assert.equal(videoVerifierSourceExtension("Video/MP4; codecs=avc1"), "mp4");
  assert.equal(videoVerifierSourceExtension("video/quicktime"), "mov");
  assert.equal(videoVerifierSourceExtension("video/webm"), "webm");
  assert.equal(videoVerifierSourceExtension("video/x-msvideo"), "avi");
  assert.equal(videoVerifierSourceExtension("video/x-unknown"), null);
});

test("universal admission covers every accepted container and keeps covers off the last frames", () => {
  assert.equal(VIDEO_VERIFIER_UNIVERSAL_ADMISSION, "universal-v1");
  for (const type of ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/x-msvideo", "video/mpeg", "video/mp2t", "video/x-ms-wmv", "video/ogg", "video/3gpp", "video/x-flv"]) {
    assert.ok(VIDEO_VERIFIER_UNIVERSAL_SOURCE_TYPES.includes(type), type);
  }
  assert.equal(videoVerifierUniversalPosterTimeMs(1_500, 60_000), 1_500);
  assert.equal(videoVerifierUniversalPosterTimeMs(59_990, 60_000), 59_750);
  assert.equal(videoVerifierUniversalPosterTimeMs(400, 100), 0);
  assert.equal(videoVerifierUniversalPosterTimeMs(-5, 60_000), 0);
});

test("video verifier protocol binds request path, timestamp, nonce, and exact body", () => {
  const signed = signVideoVerifierRequest({
    secret: SECRET,
    path: "/v2/verify",
    payload: { objectKey: "users/u1/post/example.mp4", expectedBytes: 42 },
    at: AT,
    nonce: NONCE,
  });
  assert.deepEqual(verifyVideoVerifierRequest({
    secret: SECRET,
    path: "/v2/verify",
    body: signed.body,
    headers: signed.headers,
    at: AT + 500,
  }).payload, { objectKey: "users/u1/post/example.mp4", expectedBytes: 42 });
  assert.throws(() => verifyVideoVerifierRequest({
    secret: SECRET,
    path: "/v2/verify",
    body: signed.body.replace("42", "43"),
    headers: signed.headers,
    at: AT,
  }), { code: "VIDEO_VERIFIER_AUTH_INVALID" });
  assert.throws(() => verifyVideoVerifierRequest({
    secret: SECRET,
    path: "/v2/health",
    body: signed.body,
    headers: signed.headers,
    at: AT,
  }), { code: "VIDEO_VERIFIER_AUTH_INVALID" });
  assert.throws(() => verifyVideoVerifierRequest({
    secret: SECRET,
    path: "/v2/verify",
    body: signed.body,
    headers: signed.headers,
    at: AT + 60_001,
  }), { code: "VIDEO_VERIFIER_REQUEST_EXPIRED" });
});

test("video verifier response authentication is request-bound and fail-closed", () => {
  const signed = signVideoVerifierResponse({
    secret: SECRET,
    path: "/v2/verify",
    requestNonce: NONCE,
    payload: { ok: true, width: 1920, height: 1080, durationMs: 30_000 },
    at: AT,
  });
  assert.equal(verifyVideoVerifierResponse({
    secret: SECRET,
    path: "/v2/verify",
    requestNonce: NONCE,
    body: signed.body,
    headers: signed.headers,
    at: AT,
  }).width, 1920);
  assert.throws(() => verifyVideoVerifierResponse({
    secret: SECRET,
    path: "/v2/verify",
    requestNonce: "zyxwvutsrqponmlkjihgfe",
    body: signed.body,
    headers: signed.headers,
    at: AT,
  }), { code: "VIDEO_VERIFIER_RESPONSE_INVALID" });
  assert.throws(() => signVideoVerifierRequest({
    secret: "short",
    path: "/v2/health",
    payload: {},
    at: AT,
    nonce: NONCE,
  }), { code: "VIDEO_VERIFIER_SECRET_INVALID" });
});
