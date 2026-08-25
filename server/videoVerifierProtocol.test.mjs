import assert from "node:assert/strict";
import test from "node:test";

import {
  VIDEO_VERIFIER_SOURCE_CONTENT_TYPES,
  signVideoVerifierRequest,
  signVideoVerifierResponse,
  videoVerifierSourceExtension,
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
  assert.equal(videoVerifierSourceExtension("video/webm"), null);
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
