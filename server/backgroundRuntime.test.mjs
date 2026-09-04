import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  listenForServer,
  startOptionalBackgroundRuntime,
} from "./backgroundRuntime.js";

test("a synchronous optional runtime returns its exact handle", () => {
  const handle = { stop() {} };
  let reports = 0;
  const result = startOptionalBackgroundRuntime({
    start: () => handle,
    report: () => { reports += 1; },
  });

  assert.equal(result, handle);
  assert.equal(reports, 0);
});

test("a missing or empty synchronous runtime normalizes to null", () => {
  assert.equal(startOptionalBackgroundRuntime({ start: () => undefined }), null);

  let reported = null;
  assert.equal(startOptionalBackgroundRuntime({
    report: (error) => { reported = error; },
  }), null);
  assert.ok(reported instanceof TypeError);
});

test("a synchronous starter failure is reported once and contained", () => {
  const failure = new Error("starter failed");
  const reports = [];
  const result = startOptionalBackgroundRuntime({
    start: () => { throw failure; },
    report: (error) => reports.push(error),
  });

  assert.equal(result, null);
  assert.deepEqual(reports, [failure]);
});

test("a synchronous reporter failure never escapes the runtime boundary", () => {
  const result = startOptionalBackgroundRuntime({
    start: () => { throw new Error("starter failed"); },
    report: () => { throw new Error("reporter failed"); },
  });

  assert.equal(result, null);
});

test("an asynchronous optional runtime resolves to its exact handle", async () => {
  const handle = { stop() {} };
  const result = await startOptionalBackgroundRuntime({
    start: async () => handle,
    report: () => assert.fail("a successful runtime must not be reported"),
  });

  assert.equal(result, handle);
});

test("an asynchronous starter rejection is owned, reported once, and resolves null", async () => {
  const failure = new Error("async starter failed");
  const reports = [];
  const result = await startOptionalBackgroundRuntime({
    start: () => Promise.reject(failure),
    report: (error) => reports.push(error),
  });

  assert.equal(result, null);
  assert.deepEqual(reports, [failure]);
});

test("a rejected asynchronous reporter is also owned", async () => {
  const result = await startOptionalBackgroundRuntime({
    start: () => Promise.reject(new Error("async starter failed")),
    report: () => Promise.reject(new Error("async reporter failed")),
  });

  assert.equal(result, null);
  await new Promise((resolve) => setImmediate(resolve));
});

test("the HTTP listener boundary rejects a bind error and removes startup observers", async () => {
  const failure = Object.assign(new Error("address already in use"), { code: "EADDRINUSE" });
  const server = new EventEmitter();
  server.listen = () => queueMicrotask(() => server.emit("error", failure));

  await assert.rejects(listenForServer(server, 3000), (error) => error === failure);
  assert.equal(server.listenerCount("error"), 0);
  assert.equal(server.listenerCount("listening"), 0);
});

test("the HTTP listener boundary resolves only after listening and removes startup observers", async () => {
  const server = new EventEmitter();
  let receivedPort = null;
  server.listen = (port) => {
    receivedPort = port;
    queueMicrotask(() => server.emit("listening"));
  };

  assert.equal(await listenForServer(server, 4321), server);
  assert.equal(receivedPort, 4321);
  assert.equal(server.listenerCount("error"), 0);
  assert.equal(server.listenerCount("listening"), 0);
});

test("a synchronous HTTP listen throw is converted into a startup rejection", async () => {
  const failure = new Error("invalid listen options");
  const server = new EventEmitter();
  server.listen = () => { throw failure; };

  await assert.rejects(listenForServer(server, 3000), (error) => error === failure);
  assert.equal(server.listenerCount("error"), 0);
  assert.equal(server.listenerCount("listening"), 0);
});

test("server startup owns its listener and starts core schedulers through the optional boundary", async () => {
  const source = await readFile(new URL("./index.js", import.meta.url), "utf8");

  assert.match(source, /await listenForServer\(server,\s*PORT\);/);
  assert.doesNotMatch(source, /server\.listen\(/);

  const requiredStarters = [
    ["email-campaigns", "startEmailCampaignScheduler"],
    ["tour-dates", "startTourDateScheduler"],
    ["artist-tourdate-demand", "startArtistTourDateDemandRefresh"],
    ["artist-genres", "startMusicBrainzGenreRefreshScheduler"],
    ["artist-photos", "startArtistPhotoSeedScheduler"],
    ["death-watch", "startArtistDeathWatchScheduler"],
    ["catalog-warm", "startCacheWarmScheduler"],
    ["database-backup", "startBackupScheduler"],
    ["media-deletion", "startMediaDeletionScheduler"],
    ["legacy-video-posters", "startLegacyVideoPosterVerificationScheduler"],
    ["video-verifier-health", "startVideoVerifierHealthScheduler"],
    ["sitemap-refresh", "startSitemapRefreshScheduler"],
    ["private-media-isolation", "startPrivateMediaIsolationScheduler"],
    ["founder-operations", "startFounderOperationsScheduler"],
  ];
  for (const [route, starter] of requiredStarters) {
    assert.match(
      source,
      new RegExp(`startBackgroundRuntime\\(\\s*"/startup/${route}"\\s*,\\s*\\(\\)\\s*=>\\s*${starter}\\(`),
      `${starter} must use its stable optional-runtime boundary`,
    );
  }
  assert.match(source, /code:\s*"BACKGROUND_START_FAILED"/);
  assert.match(source, /method:\s*"JOB"/);
});
