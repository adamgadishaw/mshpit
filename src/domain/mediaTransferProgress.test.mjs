import assert from "node:assert/strict";
import test from "node:test";

import { mediaUploadProgressCopy, normalizeMediaTransferProgress } from "./mediaTransferProgress.mjs";

test("transfer progress clamps provider data against the measured upload size", () => {
  assert.deepEqual(normalizeMediaTransferProgress({ bytesSent: 25, totalBytes: 100 }), {
    bytesSent: 25,
    totalBytes: 100,
    fraction: 0.25,
  });
  assert.deepEqual(normalizeMediaTransferProgress({ bytesSent: 200, totalBytes: 0 }, 80), {
    bytesSent: 80,
    totalBytes: 80,
    fraction: 1,
  });
  assert.equal(normalizeMediaTransferProgress({ bytesSent: -4, totalBytes: NaN }).fraction, 0);
});

test("upload copy is stage-specific and shows percentages only for byte transfers", () => {
  assert.equal(mediaUploadProgressCopy({ stage: "uploading-source", fraction: 0.421, current: 2, total: 3 }), "Uploading original · 42% · 2 of 3");
  assert.equal(mediaUploadProgressCopy({ stage: "verifying-source", fraction: 1, current: 2, total: 3 }), "Verifying original · 2 of 3");
  assert.equal(mediaUploadProgressCopy({ stage: "uploading-poster", fraction: 0, current: 1, total: 1 }), "Uploading video cover · 1 of 1");
});
