import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { parse } from "@babel/parser";
import { transformFromAstSync } from "@babel/core";

const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module" });
const shutdown = ast.program.body.find(node => node.type === "FunctionDeclaration" && node.id?.name === "shutdown");
const declaration = shutdown.body.body.find(node => node.type === "VariableDeclaration" && node.declarations.some(item => item.id.name === "additionalStops"));
const compiled = transformFromAstSync({ type: "File", program: { type: "Program", sourceType: "script", body: [declaration] } }, "", { configFile: false, babelrc: false }).code;
const stop = new Function("additionalSchedulers", "console", "safeRequestFailureContext", `${compiled}; return additionalStops;`);
const deadline = ast.program.body.find(node => node.type === "VariableDeclaration"
  && node.declarations.some(item => item.id.name === "SHUTDOWN_FORCE_EXIT_MS"));

// Execute the production shutdown function without starting the app, opening
// SQLite, or contacting providers. HTTP drain and worker settlement are
// independently controlled; the clock runs the actual registered fallback.
function shutdownFixture({ workerStop = () => Promise.resolve(), alertStop = () => Promise.resolve() } = {}) {
  const events = [], errors = [], stops = [], exits = [], timers = [];
  let closeCallback, elapsed = 0;
  const schedulerNames = [
    "memoryMonitor", "storageMaintenance", "emailCampaignScheduler", "founderOperationsScheduler",
    "legacyImageRecoveryScheduler", "artistDeathWatchScheduler", "tourDateScheduler", "cacheWarmScheduler",
    "artistKnowledgeScheduler", "searchGrowthScheduler", "venuePhotoScheduler", "backupScheduler",
    "mediaDeletionScheduler", "accountLifecycleScheduler", "privateMediaIsolationMonitor", "legacyVideoPosterScheduler",
  ];
  const dependencies = Object.fromEntries(schedulerNames.map(name => [name, {
    stop: options => { stops.push({ name, options }); return Promise.resolve(); },
  }]));
  for (const name of ["stopArtistTourDateDemandRefresh", "stopMusicBrainzGenreRefreshScheduler",
    "stopArtistPhotoSeedScheduler", "stopVideoVerifierHealthScheduler", "drainSitemapSnapshotRefresh"]) {
    dependencies[name] = options => { stops.push({ name, options }); return Promise.resolve(); };
  }
  Object.assign(dependencies, {
    stopErrorAlertScheduler: () => { stops.push({ name: "stopErrorAlertScheduler" }); return alertStop(); },
    additionalSchedulers: new Map([["fixture-worker", {
      stop: options => { stops.push({ name: "fixture-worker", options }); return workerStop(); },
    }]]),
    sitemapRefreshTimer: null, sitemapRetryTimer: null,
    clearInterval() {}, clearTimeout() {},
    safeRequestFailureContext: () => ({ cause: "safe_failure" }),
    console: { log: () => {}, error: text => errors.push(text) },
    server: { close: callback => { events.push("http:draining"); closeCallback = callback; } },
    db: { close: () => events.push("db:closed") },
    process: { exit: code => { events.push("process:exit"); exits.push(code); } },
    setTimeout: (callback, delay) => {
      const timer = { callback, dueAt: elapsed + delay, fired: false, unreferenced: false,
        unref() { this.unreferenced = true; return this; } };
      timers.push(timer);
      return timer;
    },
  });
  const run = runInNewContext(`${source.slice(deadline.start, deadline.end)}\nlet shuttingDown = false;\n`
    + `${source.slice(shutdown.start, shutdown.end)}\nshutdown;`, dependencies);
  return {
    run, events, errors, stops, exits, timers,
    finishHttp: () => { events.push("http:drained"); return closeCallback(); },
    advance: milliseconds => {
      elapsed += milliseconds;
      for (const timer of timers) if (!timer.fired && timer.dueAt <= elapsed) {
        timer.fired = true;
        timer.callback();
      }
    },
  };
}

const flushShutdownPromises = () => new Promise(resolve => setImmediate(resolve));

test("all newly introduced database workers retain a shutdown handle", () => {
  for (const name of ["privacy-journal", "video-processing", "catalog-research", "web-profiles", "artist-news", "news-desk", "artist-photos"]) {
    assert.ok(source.includes(`additionalSchedulers.set("${name}", startBackgroundRuntime("/startup/${name}"`), name);
  }
  const wait = source.indexOf("await additionalStops;");
  assert.ok(wait > source.indexOf("server.close(async () =>"));
  assert.ok(wait < source.indexOf("try { db.close(); }"));
});

test("shutdown aborts every owned worker and waits for unsettled database work despite another failure", async () => {
  let finish, settled = false;
  const calls = [], errors = [];
  const schedulers = new Map([
    ["slow", { stop: options => { calls.push(options); return new Promise(resolve => { finish = resolve; }); } }],
    ["broken", { stop: options => { calls.push(options); throw new Error("private remote response"); } }],
    ["disabled", null],
    ["last", { stop: options => { calls.push(options); return Promise.resolve(); } }],
  ]);
  const pending = stop(schedulers, { error: text => errors.push(text) }, () => ({ cause: "safe_failure" })).then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(calls.length, 3); assert.ok(calls.every(options => options.abortActive)); assert.equal(settled, false);
  assert.deepEqual(errors, ["[pit] broken shutdown failed safely: cause=safe_failure"]);
  finish(); await pending; assert.equal(settled, true);
});

test("prompt shutdown drains HTTP and cancelled worker work before closing SQLite and exiting", async () => {
  let finishWorker;
  const worker = new Promise(resolve => { finishWorker = resolve; });
  const fixture = shutdownFixture({ workerStop: () => worker });
  fixture.run();
  await flushShutdownPromises();
  assert.deepEqual(fixture.events, ["http:draining"]);
  const draining = fixture.finishHttp();
  await flushShutdownPromises();
  assert.equal(fixture.events.includes("db:closed"), false, "HTTP drain alone must not close an active worker's database");
  for (const name of ["tourDateScheduler", "cacheWarmScheduler", "backupScheduler", "mediaDeletionScheduler",
    "stopArtistTourDateDemandRefresh", "stopMusicBrainzGenreRefreshScheduler", "stopArtistPhotoSeedScheduler", "fixture-worker"]) {
    assert.equal(fixture.stops.find(entry => entry.name === name)?.options?.abortActive, true, name);
  }
  finishWorker();
  await draining;
  assert.deepEqual(fixture.events, ["http:draining", "http:drained", "db:closed", "process:exit"]);
  assert.deepEqual(fixture.exits, [0]);
  assert.deepEqual(fixture.errors, []);
  assert.equal(fixture.timers.length, 1);
  assert.equal(fixture.timers[0].dueAt, 25_000);
  assert.equal(fixture.timers[0].unreferenced, true);
  assert.equal(fixture.timers[0].fired, false, "prompt drain must not wait for the fallback");
});

test("a stalled worker reaches the 25-second fallback without prematurely closing SQLite", async () => {
  const fixture = shutdownFixture({ workerStop: () => new Promise(() => {}) });
  fixture.run();
  void fixture.finishHttp();
  await flushShutdownPromises();
  fixture.advance(24_999);
  assert.deepEqual(fixture.exits, []);
  assert.equal(fixture.events.includes("db:closed"), false);
  fixture.advance(1);
  assert.deepEqual(fixture.exits, [0]);
  assert.equal(fixture.events.includes("db:closed"), false, "forced exit must not close SQLite underneath unsettled work");
  assert.deepEqual(fixture.errors, ["[pit] shutdown exceeded 25s; forcing process exit."]);
});

test("stalled HTTP is bounded and repeated shutdown signals do not restart cancellation or the deadline", async () => {
  const fixture = shutdownFixture();
  fixture.run(1);
  const stopCount = fixture.stops.length;
  fixture.advance(10_000);
  fixture.run(0);
  await flushShutdownPromises();
  assert.equal(fixture.stops.length, stopCount);
  assert.equal(fixture.stops.filter(entry => entry.name === "stopErrorAlertScheduler").length, 1);
  assert.equal(fixture.timers.length, 1);
  fixture.advance(14_999);
  assert.deepEqual(fixture.exits, []);
  fixture.advance(1);
  assert.deepEqual(fixture.exits, [1], "the original shutdown reason is retained");
  assert.deepEqual(fixture.events, ["http:draining", "process:exit"]);
});

test("shutdown waits for an active alert drain before closing SQLite and stops it only once", async () => {
  let finishAlert;
  const alert = new Promise(resolve => { finishAlert = resolve; });
  const fixture = shutdownFixture({ alertStop: () => alert });
  fixture.run();
  const draining = fixture.finishHttp();
  await flushShutdownPromises();
  assert.deepEqual(fixture.events, ["http:draining", "http:drained"]);
  assert.deepEqual(fixture.exits, []);
  fixture.run(1);
  assert.equal(fixture.stops.filter(entry => entry.name === "stopErrorAlertScheduler").length, 1);
  assert.equal(fixture.timers.length, 1);
  finishAlert();
  await draining;
  assert.deepEqual(fixture.events, ["http:draining", "http:drained", "db:closed", "process:exit"]);
  assert.deepEqual(fixture.exits, [0], "repeated shutdown retains the original exit reason");
  assert.equal(fixture.timers[0].fired, false);
  assert.deepEqual(fixture.errors, []);
});

test("a stalled alert drain retains the bounded forced exit without closing its database", async () => {
  const fixture = shutdownFixture({ alertStop: () => new Promise(() => {}) });
  fixture.run(1);
  void fixture.finishHttp();
  await flushShutdownPromises();
  fixture.advance(10_000);
  fixture.run(0);
  assert.equal(fixture.stops.filter(entry => entry.name === "stopErrorAlertScheduler").length, 1);
  assert.equal(fixture.timers.length, 1);
  assert.equal(fixture.timers[0].unreferenced, true);
  fixture.advance(14_999);
  assert.deepEqual(fixture.exits, []);
  assert.equal(fixture.events.includes("db:closed"), false);
  fixture.advance(1);
  assert.deepEqual(fixture.exits, [1]);
  assert.equal(fixture.events.includes("db:closed"), false);
  assert.deepEqual(fixture.errors, ["[pit] shutdown exceeded 25s; forcing process exit."]);
});
