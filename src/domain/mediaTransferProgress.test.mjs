import assert from "node:assert/strict";
import test from "node:test";

import {
  createMediaTransferProgressPublisher,
  MEDIA_TRANSFER_PROGRESS_INTERVAL_MS,
  mediaUploadProgressCopy,
  normalizeMediaTransferProgress,
} from "./mediaTransferProgress.mjs";

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
  assert.equal(mediaUploadProgressCopy({ stage: "starting-source", current: 1, total: 1 }), "Starting media check · 1 of 1");
  assert.equal(mediaUploadProgressCopy({ stage: "processing-source", current: 1, total: 1 }), "Processing original · 1 of 1");
  assert.equal(mediaUploadProgressCopy({ stage: "reconnecting-source", current: 1, total: 1 }), "Reconnecting to media check · 1 of 1");
});

test("transfer progress coalesces byte events to about eight updates per second", () => {
  let clock = 0;
  let timerId = 0;
  const timers = new Map();
  const published = [];
  const publisher = createMediaTransferProgressPublisher({
    publish: (value) => published.push(value),
    now: () => clock,
    schedule: (callback, delay) => {
      const id = ++timerId;
      timers.set(id, { callback, at: clock + delay });
      return id;
    },
    cancelSchedule: (id) => timers.delete(id),
  });
  const runDue = () => {
    for (const [id, timer] of [...timers]) {
      if (timer.at <= clock) {
        timers.delete(id);
        timer.callback();
      }
    }
  };

  publisher.publish({ stage: "uploading-source", bytesSent: 0, totalBytes: 1_000, fraction: 0 });
  for (let second = 0; second < 1_000; second += MEDIA_TRANSFER_PROGRESS_INTERVAL_MS) {
    for (let offset = 1; offset <= 50; offset += 1) {
      const sent = Math.min(999, second + offset);
      publisher.publish({ stage: "uploading-source", bytesSent: sent, totalBytes: 1_000, fraction: sent / 1_000 });
    }
    clock += MEDIA_TRANSFER_PROGRESS_INTERVAL_MS;
    runDue();
  }

  assert.ok(published.length <= 9, `expected no more than an initial update plus eight timed updates, received ${published.length}`);
  assert.equal(published.at(-1).bytesSent, 925);
  publisher.cancel();
});

test("stage changes and final transfer state flush immediately while duplicates are ignored", () => {
  let clock = 0;
  let pendingTimer = null;
  const published = [];
  const publisher = createMediaTransferProgressPublisher({
    publish: (value) => published.push(value),
    now: () => clock,
    schedule: (callback) => { pendingTimer = callback; return 1; },
    cancelSchedule: () => { pendingTimer = null; },
  });

  publisher.publish({ stage: "preparing-source", fraction: 0 });
  publisher.publish({ stage: "preparing-source", fraction: 0 });
  publisher.publish({ stage: "uploading-source", bytesSent: 1, totalBytes: 10, fraction: 0.1 });
  publisher.publish({ stage: "uploading-source", bytesSent: 2, totalBytes: 10, fraction: 0.2 });
  assert.equal(typeof pendingTimer, "function");
  publisher.publish({ stage: "verifying-source", fraction: 0 });
  publisher.publish({ stage: "ready", fraction: 1 });

  assert.deepEqual(published.map((item) => item.stage), ["preparing-source", "uploading-source", "verifying-source", "ready"]);
  assert.equal(pendingTimer, null);
  publisher.cancel();
  clock += MEDIA_TRANSFER_PROGRESS_INTERVAL_MS;
  publisher.publish({ stage: "uploading-source", fraction: 0.5 });
  assert.equal(published.length, 4);
});
