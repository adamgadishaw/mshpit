import assert from "node:assert/strict";
import test from "node:test";

import { shouldContinueMediaBatch } from "./mediaBatchPolicy.mjs";

test("a bad individual file is skipped without cancelling later selections", () => {
  assert.equal(shouldContinueMediaBatch({ status: 413, serverCode: "MEDIA_TOO_LARGE" }), true);
  assert.equal(shouldContinueMediaBatch({ status: 415, serverCode: "MEDIA_TYPE_UNSUPPORTED" }), true);
  assert.equal(shouldContinueMediaBatch({ code: "PIT-UPLOAD-002" }), true);
});

test("network and service-wide failures stop a media batch immediately", () => {
  for (const error of [
    { code: "PIT-NET-001", status: 0 },
    { code: "PIT-UPLOAD-004" },
    { serverCode: "RATE_LIMITED", status: 429 },
    { serverCode: "MEDIA_STORAGE_UNAVAILABLE", status: 503 },
    { code: "PIT-NET-002", status: 0 },
  ]) assert.equal(shouldContinueMediaBatch(error), false);
});
