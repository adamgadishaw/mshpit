import assert from "node:assert/strict";
import test from "node:test";

import { VIDEO_PUBLISHING_PIPELINE_VERSION } from "../domain/mediaPublishingCapabilities.mjs";
import {
  MEDIA_PUBLISHING_CAPABILITIES_TTL_MS,
  MEDIA_PUBLISHING_VIDEO_STALE_IF_UNAVAILABLE_MS,
  loadMediaPublishingCapabilities,
} from "./mediaPublishingHealth.js";

const healthyPipeline = () => ({
  capabilities: {
    mediaPublishing: {
      photos: true,
      videos: true,
      pipeline: VIDEO_PUBLISHING_PIPELINE_VERSION,
      sourceTypes: ["video/mp4", "video/quicktime"],
    },
  },
});

test("media publishing health negotiates the exact pipeline behind a service boundary", async () => {
  const controller = new AbortController();
  const calls = [];
  const result = await loadMediaPublishingCapabilities({
    signal: controller.signal,
    apiCall: async (path, options) => {
      calls.push({ path, options });
      return healthyPipeline();
    },
  });

  assert.deepEqual(result, { photos: true, videos: true, sourceTypes: ["video/mp4", "video/quicktime"] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, `/api/health?mediaPipeline=${VIDEO_PUBLISHING_PIPELINE_VERSION}`);
  assert.equal(calls[0].options.signal instanceof AbortSignal, true);
  assert.notEqual(calls[0].options.signal, controller.signal);
  assert.equal(calls[0].options.silent, true);
  assert.equal(calls[0].options.skipIdentityCheck, true);
  assert.equal(calls[0].options.timeoutMs, 3_000);
});

test("media publishing health keeps malformed capability responses fail-closed", async () => {
  const result = await loadMediaPublishingCapabilities({
    apiCall: async () => ({
      capabilities: { mediaPublishing: { photos: true, videos: true, pipeline: "verified-v0" } },
    }),
  });
  assert.deepEqual(result, { photos: true, videos: false, sourceTypes: [] });
});

test("media publishing health reuses one request inside the short TTL and refreshes after it", async () => {
  let requestCount = 0;
  let currentTime = 10_000;
  const apiCall = async () => {
    requestCount += 1;
    return healthyPipeline();
  };
  const options = { apiCall, now: () => currentTime };

  await loadMediaPublishingCapabilities(options);
  currentTime += MEDIA_PUBLISHING_CAPABILITIES_TTL_MS - 1;
  await loadMediaPublishingCapabilities(options);
  assert.equal(requestCount, 1);

  currentTime += 1;
  await loadMediaPublishingCapabilities(options);
  assert.equal(requestCount, 2);
});

test("media publishing health coalesces concurrent stale checks into one request", async () => {
  let requestCount = 0;
  let releaseRequest;
  const apiCall = async () => {
    requestCount += 1;
    return new Promise((resolve) => {
      releaseRequest = () => resolve(healthyPipeline());
    });
  };

  const first = loadMediaPublishingCapabilities({ apiCall });
  const second = loadMediaPublishingCapabilities({ apiCall });
  await Promise.resolve();
  assert.equal(requestCount, 1);

  releaseRequest();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepEqual(firstResult, { photos: true, videos: true, sourceTypes: ["video/mp4", "video/quicktime"] });
  assert.deepEqual(secondResult, firstResult);
  assert.equal(requestCount, 1);
});

test("a forced pre-upload check bypasses a fresh cached capability result", async () => {
  let requestCount = 0;
  const apiCall = async () => {
    requestCount += 1;
    return healthyPipeline();
  };

  await loadMediaPublishingCapabilities({ apiCall });
  await loadMediaPublishingCapabilities({ apiCall });
  assert.equal(requestCount, 1);

  await loadMediaPublishingCapabilities({ apiCall, force: true });
  assert.equal(requestCount, 2);
});

test("selection briefly retains the last exact healthy video contract but forced upload checks do not", async () => {
  let currentTime = 20_000;
  let healthy = true;
  const apiCall = async () => healthy
    ? healthyPipeline()
    : { capabilities: { mediaPublishing: { photos: true, videos: false } } };

  assert.deepEqual(await loadMediaPublishingCapabilities({ apiCall, now: () => currentTime }),
    { photos: true, videos: true, sourceTypes: ["video/mp4", "video/quicktime"] });
  healthy = false;
  currentTime += MEDIA_PUBLISHING_CAPABILITIES_TTL_MS;
  assert.deepEqual(
    await loadMediaPublishingCapabilities({ apiCall, now: () => currentTime }),
    { photos: true, videos: true, sourceTypes: ["video/mp4", "video/quicktime"] },
    "a non-forced picker check keeps a recently proven pipeline available",
  );
  assert.deepEqual(
    await loadMediaPublishingCapabilities({ apiCall, now: () => currentTime, force: true }),
    { photos: true, videos: false, sourceTypes: [] },
    "the upload boundary sees the current authoritative outage",
  );

  currentTime += MEDIA_PUBLISHING_VIDEO_STALE_IF_UNAVAILABLE_MS + 1;
  assert.deepEqual(
    await loadMediaPublishingCapabilities({ apiCall, now: () => currentTime }),
    { photos: true, videos: false, sourceTypes: [] },
    "the selection grace is bounded",
  );
});

test("one cancelled consumer does not duplicate or cancel a shared request still in use", async () => {
  let requestCount = 0;
  let releaseRequest;
  const apiCall = async () => {
    requestCount += 1;
    return new Promise((resolve) => {
      releaseRequest = () => resolve(healthyPipeline());
    });
  };
  const controller = new AbortController();

  const cancelled = loadMediaPublishingCapabilities({ apiCall, signal: controller.signal });
  const retained = loadMediaPublishingCapabilities({ apiCall });
  await Promise.resolve();
  controller.abort();
  releaseRequest();

  await assert.rejects(cancelled, { name: "AbortError" });
  assert.deepEqual(await retained, { photos: true, videos: true, sourceTypes: ["video/mp4", "video/quicktime"] });
  assert.equal(requestCount, 1);
});

test("temporary photo-readiness failure recovers through bounded rechecks without lying about capability", async () => {
  let requests = 0, clock = 0; const waits = [];
  const result = await loadMediaPublishingCapabilities({
    apiCall: async () => ++requests < 3 ? { capabilities: { mediaPublishing: { photos: false, videos: false } } } : healthyPipeline(),
    now: () => clock, recovery: { wait: async (ms) => { waits.push(ms); clock += ms; } }, force: true,
  });
  assert.deepEqual(result, { photos: true, videos: true, sourceTypes: ["video/mp4", "video/quicktime"] });
  assert.equal(requests, 3); assert.deepEqual(waits, [2_000, 5_000]);
});

test("exhausted readiness recovery stays unavailable and its negative cache expires quickly", async () => {
  let requests = 0, clock = 0;
  const options = { apiCall: async () => { requests += 1; return { capabilities: { mediaPublishing: { photos: false, videos: false } } }; },
    now: () => clock, recovery: { wait: async (ms) => { clock += ms; } } };
  assert.deepEqual(await loadMediaPublishingCapabilities(options), { photos: false, videos: false, sourceTypes: [] });
  assert.equal(requests, 3);
  await loadMediaPublishingCapabilities(options); assert.equal(requests, 3);
  clock += 2_000;
  assert.equal((await loadMediaPublishingCapabilities(options)).photos, false); assert.equal(requests, 6);
});

test("typed network health failure retries but auth and unknown failures do not", async () => {
  let calls = 0;
  const recovered = await loadMediaPublishingCapabilities({ apiCall: async () => {
    if (++calls === 1) throw Object.assign(new Error("Offline"), { code: "PIT-NET-001", status: 0 }); return healthyPipeline();
  }, recovery: { wait: async () => {} } });
  assert.equal(recovered.photos, true); assert.equal(calls, 2);
  for (const failure of [Object.assign(new Error("Expired"), { status: 401 }), new TypeError("Invalid adapter")]) {
    calls = 0;
    await assert.rejects(loadMediaPublishingCapabilities({ apiCall: async () => { calls += 1; throw failure; },
      recovery: { wait: async () => { throw new Error("Must not retry"); } },
    }), (error) => error === failure);
    assert.equal(calls, 1);
  }
});

test("force and selection waiters sharing one check apply their own stale-video policy", async () => {
  let clock = 0, calls = 0, release;
  const apiCall = async () => {
    if (++calls === 1) return healthyPipeline();
    return new Promise((done) => { release = done; });
  };
  await loadMediaPublishingCapabilities({ apiCall, now: () => clock });
  clock += MEDIA_PUBLISHING_CAPABILITIES_TTL_MS;
  const selection = loadMediaPublishingCapabilities({ apiCall, now: () => clock });
  const forced = loadMediaPublishingCapabilities({ apiCall, now: () => clock, force: true });
  await Promise.resolve(); release({ capabilities: { mediaPublishing: { photos: true, videos: false } } });
  assert.equal((await selection).videos, true, "Selection retains bounded proven capability");
  assert.equal((await forced).videos, false, "Forced consumer must see the authoritative response");
  assert.equal(calls, 2);
});

test("the last waiter cancelling a non-aborting transport immediately permits a fresh check", async () => {
  const controller = new AbortController(); let calls = 0, release;
  const apiCall = async () => {
    if (++calls === 1) return new Promise((done) => { release = done; });
    return healthyPipeline();
  };
  const old = loadMediaPublishingCapabilities({ apiCall, signal: controller.signal });
  await Promise.resolve(); controller.abort();
  const current = loadMediaPublishingCapabilities({ apiCall });
  await assert.rejects(old, { name: "AbortError" });
  assert.equal((await current).videos, true);
  release({ capabilities: { mediaPublishing: { photos: false, videos: false } } });
  await new Promise((done) => setImmediate(done));
  assert.equal((await loadMediaPublishingCapabilities({ apiCall })).videos, true);
  assert.equal(calls, 2, "Late aborted response cannot overwrite healthy cache or hold a stale flight");
});

test("health backoff cancellation cannot keep scheduling after its consumer has left", async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(loadMediaPublishingCapabilities({ signal: controller.signal,
    apiCall: async () => { calls += 1; throw Object.assign(new Error("Offline"), { status: 503 }); },
    recovery: { wait: async () => { controller.abort(); } },
  }), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("a stalled health adapter settles on its independent deadline and does not cache a false success", async () => {
  let calls = 0;
  const apiCall = async () => { calls += 1; return new Promise(() => {}); };
  await assert.rejects(loadMediaPublishingCapabilities({ apiCall, recovery: { requestTimeoutMs: 10, totalTimeoutMs: 20 } }), { code: "PIT-NET-002" });
  assert.equal(calls, 1);
});
