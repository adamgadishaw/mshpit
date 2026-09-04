import assert from "node:assert/strict";
import test from "node:test";

import { startArtistDeathWatchScheduler } from "./artistDeathWatchScheduler.js";

test("death-watch scheduler contains a synchronous scan failure and reschedules", async () => {
  const timers = [];
  const cleared = [];
  const errors = [];
  const scheduler = startArtistDeathWatchScheduler({
    service: {
      scan() {
        const error = new Error("provider detail must stay private");
        error.code = "wikidata_timeout";
        throw error;
      },
    },
    env: { RENDER: "true", ARTIST_DEATH_WATCH_SCHEDULER_ENABLED: "true" },
    now: () => 123,
    setTimeoutImpl(callback, delay) {
      const handle = { callback, delay, unref() {} };
      timers.push(handle);
      return handle;
    },
    clearTimeoutImpl: (handle) => cleared.push(handle),
    onError: (error) => errors.push(error.code),
  });

  assert.equal(timers.length, 1);
  assert.doesNotThrow(() => timers[0].callback());
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(errors, ["wikidata_timeout"]);
  assert.equal(timers.length, 2, "a failed scan retains the bounded next run");

  await scheduler.stop();
  assert.ok(cleared.includes(timers[1]));
});
