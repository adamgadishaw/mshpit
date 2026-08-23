import assert from "node:assert/strict";
import test from "node:test";

import { mediaSourceClientAssetId, stableMediaUploadToken } from "./mediaUploadIdentity.mjs";

test("lost-response source retries reproduce the exact server idempotency key", () => {
  const selected = {
    localId: "local:post_abc:1",
    fileSize: 82_345_678,
    contentType: "video/mp4",
    name: "front-row.mp4",
  };
  const beforeLostResponse = mediaSourceClientAssetId(selected);
  const afterRetry = mediaSourceClientAssetId({ ...selected });
  assert.equal(afterRetry, beforeLostResponse);
  assert.match(afterRetry, /^[A-Za-z0-9._:-]{8,120}$/);
  assert.notEqual(mediaSourceClientAssetId({ ...selected, fileSize: selected.fileSize + 1 }), beforeLostResponse);
});

test("variant tokens remain deterministic and bounded", () => {
  const value = "local:post/unsafe cover".repeat(20);
  const token = stableMediaUploadToken(value, "studio-poster");
  assert.equal(token, stableMediaUploadToken(value, "studio-poster"));
  assert.ok(token.length <= 120);
  assert.doesNotMatch(token, /[\/\s]/);
});
