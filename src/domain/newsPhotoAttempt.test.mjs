import assert from "node:assert/strict";
import test from "node:test";
import { initialNewsPhotoAttempt, failNewsPhotoAttempt, retryNewsPhotoAttempt } from "./newsPhotoAttempt.mjs";

test("photo delivery retries once and stale callbacks cannot exhaust its replacement", () => {
  const first = initialNewsPhotoAttempt();
  const second = failNewsPhotoAttempt(first, 0);
  assert.deepEqual(second, { attempt: 1, retried: true, failed: false });
  assert.equal(failNewsPhotoAttempt(second, 0), second);
  const failed = failNewsPhotoAttempt(second, 1);
  assert.equal(failed.failed, true);
  assert.equal(failNewsPhotoAttempt(failed, 1), failed);
  const manual = retryNewsPhotoAttempt(failed);
  assert.deepEqual(manual, { attempt: 2, retried: false, failed: false });
  assert.equal(failNewsPhotoAttempt(manual, 1), manual);
  assert.equal(failNewsPhotoAttempt(manual, 2).attempt, 3);
});
