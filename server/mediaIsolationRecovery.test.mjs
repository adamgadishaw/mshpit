import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { createMediaIsolationMonitor } from "./mediaIsolationMonitor.js";
import { createMediaPresign, privateMediaIsolationStatus, verifyPrivateMediaBucketIsolation } from "./media.js";

function fakeTimers() {
  const tasks = new Map();
  return {
    tasks,
    setTimer(callback, delay) { const id = {}; tasks.set(id, { callback, delay }); return id; },
    clearTimer(id) { tasks.delete(id); },
    get delay() { return [...tasks.values()][0]?.delay; },
    async fire() {
      const [id, task] = [...tasks][0];
      tasks.delete(id);
      task.callback();
      await nextTurn();
    },
  };
}
const ENV = Object.freeze({
  NODE_ENV: "production", MEDIA_ENDPOINT: "https://objects.example.com",
  MEDIA_BUCKET: "public-media", MEDIA_SOURCE_BUCKET: "private-recovery",
  MEDIA_REGION: "auto", MEDIA_ACCESS_KEY_ID: "test", MEDIA_SECRET_ACCESS_KEY: "test",
  MEDIA_PUBLIC_BASE_URL: "https://media.example.com",
});
const privacyProbe = (fetchImpl, options = {}) => verifyPrivateMediaBucketIsolation({ env: ENV, fetchImpl, ...options });
const presign = () => createMediaPresign({ userId: "recovery-owner", storageScope: "private", env: ENV,
  body: { purpose: "post", contentType: "image/jpeg", fileSize: 1024, name: "concert.jpg" } });

test("an overnight-style privacy failure blocks uploads then recovers on the two-second retry", async () => {
  const timers = fakeTimers();
  let unavailable = false;
  const reports = [];
  const monitor = createMediaIsolationMonitor({ ...timers,
    probe: ({ signal }) => privacyProbe(async () => {
      if (unavailable) throw new TypeError("fetch failed");
      return { status: 403 };
    }, { signal }),
    onResult: (status, report) => reports.push({ status, ...report }),
  });
  await monitor.trigger("startup");
  assert.equal(presign().storageScope, "private");
  assert.equal(timers.delay, 300_000);
  unavailable = true;
  await timers.fire();
  assert.equal(privateMediaIsolationStatus(ENV).errorCode, "probe_failed");
  assert.throws(presign, (error) => error.code === "MEDIA_STORAGE_UNAVAILABLE");
  assert.equal(timers.delay, 2_000);
  unavailable = false;
  await timers.fire();
  assert.equal(presign().storageScope, "private");
  assert.equal(timers.delay, 300_000);
  assert.equal(reports.at(-1).recovered, true);
  assert.equal(reports.at(-1).phase, "recovery");
  await monitor.stop();
  assert.equal(timers.tasks.size, 0);
});

test("temporary storage HTTP failures close publishing and recover promptly instead of waiting five minutes", async () => {
  for (const statuses of [[503, 403], [403, 503], [502, 504], [429, 403], [408, 403], [599, 403]]) {
    const timers = fakeTimers();
    let unavailable = true;
    const monitor = createMediaIsolationMonitor({ ...timers,
      probe: ({ signal }) => privacyProbe(async (url) => ({ status: unavailable
        ? statuses[new URL(url).searchParams.has("list-type") ? 0 : 1] : 403 }), { signal }),
    });
    try {
      const failed = await monitor.trigger("startup");
      assert.equal(failed.errorCode, "probe_http_unavailable");
      assert.equal(failed.ready, false);
      assert.throws(presign, (error) => error.code === "MEDIA_STORAGE_UNAVAILABLE");
      assert.equal(timers.delay, 2_000);
      unavailable = false;
      await timers.fire();
      assert.equal(presign().storageScope, "private");
      assert.equal(timers.delay, 300_000);
    } finally { await monitor.stop(); }
  }
});

test("an unexpected anonymous response wins over a temporary failure on the other privacy check", async () => {
  for (const statuses of [[200, 503], [503, 200], [404, 503], [503, 400], [null, 503]]) {
    const timers = fakeTimers();
    const monitor = createMediaIsolationMonitor({ ...timers,
      probe: ({ signal }) => privacyProbe(async (url) => ({ status:
        statuses[new URL(url).searchParams.has("list-type") ? 0 : 1] }), { signal }),
    });
    try {
      const result = await monitor.trigger("startup");
      assert.equal(result.errorCode, "anonymous_access_not_denied");
      assert.equal(result.ready, false);
      assert.throws(presign, (error) => error.status === 503);
      assert.equal(timers.delay, 300_000);
    } finally { await monitor.stop(); }
  }
});

test("storage recovery respects Retry-After without overflowing timers or retaining stale delay on recovery", async () => {
  const at = Date.parse("2026-09-09T19:00:00Z");
  for (const [header, expected] of [["120", 120_000], ["Wed, 09 Sep 2026 19:02:00 GMT", 120_000],
    ["0", 2_000], ["nonsense", 2_000], ["999999999999", 2_147_483_647]]) {
    const timers = fakeTimers();
    let unavailable = true;
    const monitor = createMediaIsolationMonitor({ ...timers,
      probe: ({ signal }) => privacyProbe(async () => ({ status: unavailable ? 429 : 403,
        headers: new Headers({ "retry-after": header }) }), { signal, clock: () => at }),
    });
    try {
      await monitor.trigger("startup");
      assert.equal(timers.delay, expected);
      assert.throws(presign, (error) => error.status === 503);
      unavailable = false;
      await timers.fire();
      assert.equal(timers.delay, 300_000);
      assert.equal(privateMediaIsolationStatus(ENV).retryAfterMs, undefined);
    } finally { await monitor.stop(); }
  }
});

test("a response cooldown survives the other privacy probe failing", async () => {
  const timers = fakeTimers();
  const monitor = createMediaIsolationMonitor({ ...timers,
    probe: ({ signal }) => privacyProbe(async (url) => {
      if (new URL(url).searchParams.has("list-type")) {
        return { status: 429, headers: new Headers({ "retry-after": "120" }) };
      }
      await nextTurn();
      throw new TypeError("connection failed");
    }, { signal }),
  });
  try {
    const result = await monitor.trigger("startup");
    assert.equal(result.errorCode, "probe_failed");
    assert.equal(result.listStatus, 429);
    assert.equal(result.retryAfterMs, 120_000);
    assert.equal(timers.delay, 120_000);
    assert.throws(presign, (error) => error.status === 503);
  } finally { await monitor.stop(); }
});

test("continued transport failures back off to one minute without stacking timers", async () => {
  const timers = fakeTimers();
  const monitor = createMediaIsolationMonitor({ ...timers,
    probe: async () => ({ ready: false, errorCode: "probe_timeout" }),
  });
  await monitor.trigger("startup");
  for (const delay of [2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]) {
    assert.equal(timers.tasks.size, 1);
    assert.equal(timers.delay, delay);
    await timers.fire();
  }
  await monitor.stop();
});

test("privacy denial and configuration failures never enter a hot retry loop", async () => {
  for (const errorCode of ["anonymous_access_not_denied", "storage_unconfigured"]) {
    const timers = fakeTimers();
    const monitor = createMediaIsolationMonitor({ ...timers, probe: async () => ({ ready: false, errorCode }) });
    await monitor.trigger("startup");
    assert.equal(timers.delay, 300_000);
    await monitor.stop();
  }
});

test("overlapping checks share one probe and shutdown suppresses late recovery", async () => {
  const timers = fakeTimers();
  let resolve;
  let signal;
  let results = 0;
  const monitor = createMediaIsolationMonitor({ ...timers,
    probe: (options) => { signal = options.signal; return new Promise((done) => { resolve = done; }); },
    onResult: () => { results += 1; },
  });
  const first = monitor.trigger("startup");
  assert.equal(monitor.trigger("scheduled"), first);
  await nextTurn();
  const stopping = monitor.stop();
  assert.equal(signal.aborted, true);
  resolve({ ready: true });
  await stopping;
  assert.equal(results, 0);
  assert.equal(timers.tasks.size, 0);
  assert.equal(await monitor.trigger(), null);
});

test("a failed probe or diagnostic sink does not break the recovery loop", async () => {
  const timers = fakeTimers();
  let throws = true;
  const monitor = createMediaIsolationMonitor({ ...timers,
    probe: async () => { if (throws) throw new TypeError("private URL must not be reported here"); return { ready: true }; },
    onError: () => { throw new Error("logger failed"); },
    onResult: () => { throw new Error("callback failed"); },
  });
  assert.equal(await monitor.trigger("startup"), null);
  assert.equal(timers.delay, 2_000);
  throws = false;
  await timers.fire();
  assert.equal(timers.delay, 300_000);
  await monitor.stop();
});

test("privacy deadline settles even when transport ignores abort; late success cannot reopen storage", async () => {
  const guard = setTimeout(() => {}, 2_000);
  const resolvers = [];
  let released = 0;
  try {
    const result = await privacyProbe(() => new Promise((resolve) => resolvers.push(resolve)), { timeoutMs: 500 });
    assert.equal(result.errorCode, "probe_timeout");
    assert.equal(result.ready, false);
    await privacyProbe(async () => ({ status: 200 }));
    for (const resolve of resolvers) resolve({ status: 403, body: { cancel() { released += 1; } } });
    await nextTurn();
    assert.equal(privateMediaIsolationStatus(ENV).ready, false);
    assert.equal(privateMediaIsolationStatus(ENV).errorCode, "anonymous_access_not_denied");
    assert.equal(released, 2);
    assert.throws(presign, (error) => error.status === 503);
    assert.equal((await privacyProbe(async () => ({ status: 403 }))).ready, true);
  } finally { clearTimeout(guard); }
});

test("shutdown cancels a hanging privacy probe without committing its late result", async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = privacyProbe(() => { calls += 1; return new Promise(() => {}); }, { signal: controller.signal });
  const rejected = assert.rejects(pending, (error) => error.name === "AbortError");
  controller.abort();
  await rejected;
  assert.equal(calls, 2);
  await assert.rejects(privacyProbe(() => { calls += 1; }, { signal: controller.signal }), /aborted/i);
  assert.equal(calls, 2);
});

test("successful denial responses release unread bodies instead of retaining storage connections", async () => {
  let cancelled = 0;
  const result = await privacyProbe(async () => ({ status: 403,
    body: new ReadableStream({ cancel() { cancelled += 1; } }),
  }));
  assert.equal(result.ready, true);
  await nextTurn();
  assert.equal(cancelled, 2);
});

test("cancellation during response cleanup cannot publish a late ready state", async () => {
  await privacyProbe(async () => ({ status: 200 }));
  const controller = new AbortController();
  await assert.rejects(privacyProbe(async () => ({ status: 403,
    body: { cancel() { controller.abort(); } },
  }), { signal: controller.signal }), (error) => error.name === "AbortError");
  assert.equal(privateMediaIsolationStatus(ENV).ready, false);
  assert.equal(privateMediaIsolationStatus(ENV).errorCode, "anonymous_access_not_denied");
});
