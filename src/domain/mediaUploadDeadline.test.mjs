import assert from "node:assert/strict";
import test from "node:test";

import {
  MEDIA_UPLOAD_TIMEOUT_MAX_MS,
  createMediaUploadDeadline,
  mediaUploadTimeoutMs,
  normalizeMediaUploadTimeoutMs,
} from "./mediaUploadDeadline.mjs";

test("a legal large clip receives a deadline well beyond the old 45-second photo timeout", () => {
  const timeoutMs = mediaUploadTimeoutMs({ kind: "video", fileSize: 100 * 1024 * 1024 });
  assert.ok(timeoutMs > 45_000);
  assert.ok(timeoutMs > 300_000, "measured size, not only the old flat video override, controls the allowance");

  let elapsed = 0;
  let scheduled = null;
  const deadline = createMediaUploadDeadline(timeoutMs, {
    setTimeoutFn: (callback, delay) => { scheduled = { callback, delay, dueAt: elapsed + delay, fired: false }; return 1; },
    clearTimeoutFn: () => {},
  });
  const advance = (duration) => {
    elapsed += duration;
    if (!scheduled.fired && elapsed >= scheduled.dueAt) {
      scheduled.fired = true;
      scheduled.callback();
    }
  };
  advance(45_001);
  assert.equal(deadline.signal.aborted, false, "a legal delayed transport can pass 45 seconds without being cancelled");
  assert.equal(scheduled.delay, timeoutMs);
  advance(timeoutMs - 45_001);
  assert.equal(deadline.signal.aborted, true);
  assert.equal(deadline.timedOut, true);
  deadline.dispose();
});

test("default and caller-supplied upload deadlines remain bounded", () => {
  assert.equal(mediaUploadTimeoutMs({ kind: "video", fileSize: Number.MAX_SAFE_INTEGER }), MEDIA_UPLOAD_TIMEOUT_MAX_MS);
  assert.equal(mediaUploadTimeoutMs({ kind: "image", fileSize: 1 }), 45_000);
  assert.equal(normalizeMediaUploadTimeoutMs(Number.POSITIVE_INFINITY), MEDIA_UPLOAD_TIMEOUT_MAX_MS);
  assert.equal(normalizeMediaUploadTimeoutMs(60 * 60_000), MEDIA_UPLOAD_TIMEOUT_MAX_MS);
});

test("explicit cancellation is immediate and never misreported as a timeout", () => {
  const controller = new AbortController();
  let cleared = false;
  const deadline = createMediaUploadDeadline(120_000, {
    signal: controller.signal,
    setTimeoutFn: () => 7,
    clearTimeoutFn: (timer) => { assert.equal(timer, 7); cleared = true; },
  });
  controller.abort();
  assert.equal(deadline.signal.aborted, true);
  assert.equal(deadline.timedOut, false);
  deadline.dispose();
  assert.equal(cleared, true);
});
