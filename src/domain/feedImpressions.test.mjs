import assert from "node:assert/strict";
import test from "node:test";
import {
  createFeedImpressionQueue,
  FEED_IMPRESSION_BATCH_MAX,
  FEED_IMPRESSION_QUEUE_MAX,
  isFeedImpressionPostId,
} from "./feedImpressions.mjs";

function fakeTimers() {
  let id = 0;
  const tasks = new Map();
  return {
    schedule(fn, delay) {
      const token = ++id;
      tasks.set(token, { fn, delay });
      return token;
    },
    cancel(token) {
      tasks.delete(token);
    },
    runNext() {
      const next = [...tasks.entries()][0];
      if (!next) return false;
      tasks.delete(next[0]);
      next[1].fn();
      return true;
    },
    tasks,
  };
}

test("feed impression ids and account boundaries reject unsafe input", async () => {
  assert.equal(isFeedImpressionPostId("p_safe_123"), true);
  assert.equal(isFeedImpressionPostId("other"), false);
  const timers = fakeTimers();
  const sent = [];
  const queue = createFeedImpressionQueue({
    send: async (batch, options) => sent.push({ batch, options }),
    schedule: timers.schedule,
    cancel: timers.cancel,
    now: () => 100,
    random: () => 0.25,
  });
  assert.equal(queue.record({ postId: "p_safe_123", surface: "for_you" }), false, "guests are not fingerprinted");
  queue.configure("u_a");
  assert.equal(queue.record({ postId: "p_safe_123", surface: "for_you" }), true);
  assert.equal(queue.record({ postId: "p_safe_123", surface: "clips" }), false, "one post counts once per account session");
  queue.configure("u_b");
  assert.equal(queue.snapshot().pending.length, 0, "A's pending history is erased before B is configured");
  assert.equal(queue.record({ postId: "p_safe_123", surface: "clips" }), true);
  timers.runNext();
  await queue.flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].options.accountId, "u_b");
  assert.equal(sent[0].batch[0].surface, "clips");
});

test("bounded batches acknowledge on success and retry without changing event ids", async () => {
  const timers = fakeTimers();
  const calls = [];
  let fail = true;
  const queue = createFeedImpressionQueue({
    send: async (batch) => {
      calls.push(batch.map((entry) => entry.eventId));
      if (fail) throw new Error("offline");
    },
    schedule: timers.schedule,
    cancel: timers.cancel,
    now: () => 200,
    random: () => 0.5,
  });
  queue.configure("u_retry");
  queue.record({ postId: "p_retry_1", surface: "for_you" });
  await queue.flush();
  assert.equal(queue.snapshot().pending.length, 1);
  assert.equal(queue.snapshot().retryDelayMs, 4_000);
  fail = false;
  timers.runNext();
  await queue.flush();
  assert.equal(queue.snapshot().pending.length, 0);
  assert.deepEqual(calls[1], calls[0], "a retry keeps its idempotency token");
});

test("queue and network batches remain bounded", async () => {
  const timers = fakeTimers();
  const sizes = [];
  const queue = createFeedImpressionQueue({
    send: async (batch) => sizes.push(batch.length),
    schedule: timers.schedule,
    cancel: timers.cancel,
    now: () => 300,
    random: () => 0.75,
  });
  queue.configure("u_bounds");
  for (let index = 0; index < FEED_IMPRESSION_QUEUE_MAX + 25; index++) {
    queue.record({ postId: `p_bound_${index}`, surface: "for_you" });
  }
  assert.ok(queue.snapshot().pending.length <= FEED_IMPRESSION_QUEUE_MAX);
  while (queue.snapshot().pending.length) await queue.flush();
  assert.ok(sizes.every((size) => size <= FEED_IMPRESSION_BATCH_MAX));
});

test("inactive apps do not qualify new impressions and resume pending work", async () => {
  const timers = fakeTimers();
  const sent = [];
  const queue = createFeedImpressionQueue({
    send: async (batch) => sent.push(batch),
    schedule: timers.schedule,
    cancel: timers.cancel,
  });
  queue.configure("u_activity");
  queue.setActive(false);
  assert.equal(queue.record({ postId: "p_hidden_1", surface: "for_you" }), false);
  queue.setActive(true);
  assert.equal(queue.record({ postId: "p_visible_1", surface: "for_you" }), true);
  await queue.flush();
  assert.equal(sent.length, 1);
});
