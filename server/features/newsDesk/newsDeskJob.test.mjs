import assert from "node:assert/strict";
import test from "node:test";
import { createBackgroundJobCoordinator } from "../../backgroundJobCoordinator.js";
import { runNewsDeskPass } from "./newsDeskJob.js";

const result = () => ({ published: 0, declined: 0, skippedForBudget: 0, picked: [] });
test("unreviewed publisher identity pauses before feed or paid work with actionable diagnostics", async () => {
  let ingests = 0, publishes = 0;
  const warnings = [];
  const completed = await runNewsDeskPass({ coordinate: job => job(), memoryReady: () => true,
    logger: { warn: message => warnings.push(message) }, desk: {
      publisherStatus: () => ({ ok: false, reason: "publisher_not_configured", message: "Set NEWS_DESK_ACCOUNT_ID to the reviewed account ID." }),
      async ingest() { ingests++; }, async publishPass() { publishes++; },
    } });
  assert.equal(completed, false); assert.equal(ingests, 0); assert.equal(publishes, 0);
  assert.match(warnings[0], /publisher_not_configured.*NEWS_DESK_ACCOUNT_ID/);
});
test("news work queues behind other maintenance and releases its memory lease", async () => {
  let release, leases = 0, releases = 0, ingests = 0, publishes = 0;
  const coordinate = createBackgroundJobCoordinator({ acquireMemoryLease: () => { leases++; return { release() { releases++; } }; } });
  const prior = coordinate(() => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  const news = runNewsDeskPass({ coordinate, memoryReady: () => true, desk: {
    async ingest() { ingests++; return 2; }, async publishPass() { publishes++; return result(); },
  } });
  await Promise.resolve(); assert.equal(ingests, 0);
  release(); await prior; assert.equal(await news, true);
  assert.equal(ingests, 1); assert.equal(publishes, 1);
  assert.equal(leases, 2); assert.equal(releases, 2);
});

test("news yields before fetching and before paid publishing when uploads need memory", async () => {
  let ingests = 0, publishes = 0, ready = false;
  const desk = { async ingest() { ingests++; ready = false; return 0; }, async publishPass() { publishes++; return result(); } };
  const options = { desk, coordinate: job => job(), memoryReady: () => ready };
  assert.equal(await runNewsDeskPass(options), false); assert.equal(ingests, 0);
  ready = true; assert.equal(await runNewsDeskPass(options), false);
  assert.equal(ingests, 1); assert.equal(publishes, 0);
});

test("the whole news pass has a deadline and never starts publication after it expires", async () => {
  let publishes = 0;
  // Keep the event loop alive: AbortSignal.timeout itself is deliberately unref'd.
  const keepAlive = setInterval(() => {}, 2000);
  try {
    const value = await runNewsDeskPass({ coordinate: job => job(), memoryReady: () => true, budgetMs: 1000, desk: {
      ingest: ({ signal }) => new Promise(resolve => signal.addEventListener("abort", () => resolve(0), { once: true })),
      async publishPass() { publishes++; return result(); },
    } });
    assert.equal(value, false); assert.equal(publishes, 0);
  } finally { clearInterval(keepAlive); }
});
