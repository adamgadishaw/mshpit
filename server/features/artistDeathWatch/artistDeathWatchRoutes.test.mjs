import assert from "node:assert/strict";
import test from "node:test";

import { artistDeathWatchRoutes } from "./artistDeathWatchRoutes.js";

class ApiError extends Error {
  constructor(status, message, code, cause) {
    super(message, { cause });
    this.status = status;
    this.code = code;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function routeFixture({ scan, reportScanError = () => {} } = {}) {
  const calls = { scans: 0 };
  const snapshot = {
    settings: { enabled: true, lastScanAt: null, lastSuccessAt: null, lastErrorCode: null },
    counts: { pending: 0, dismissed: 0, memorialized: 0 },
    eligibleArtists: 12,
  };
  const routes = artistDeathWatchRoutes({
    database: {},
    ApiError,
    decodeArtistKey: () => "artist",
    now: () => 1,
    rateLimit: () => {},
    recordModerationAction: () => {},
    reportScanError,
    requireAdmin: () => ({ id: "admin" }),
    requireModerator: () => ({ id: "moderator" }),
    service: {
      list: () => [],
      readSnapshot: () => snapshot,
      scan: (options) => {
        calls.scans += 1;
        return scan(options);
      },
    },
  });
  return { calls, routes, snapshot };
}

test("manual scan starts in the background and repeated clicks join the singleton work", async () => {
  const work = deferred();
  const fixture = routeFixture({ scan: () => work.promise });
  const ctx = { setHeader() {} };

  const first = fixture.routes["POST /api/admin/artist-death-watch/scan"](ctx);
  assert.equal(first.accepted, true);
  assert.equal(first.started, true);
  assert.equal(first.running, true);
  assert.equal(first.startedAt, 1);

  const second = fixture.routes["POST /api/admin/artist-death-watch/scan"](ctx);
  assert.equal(second.accepted, true);
  assert.equal(second.started, false);
  assert.equal(second.running, true);
  assert.equal(fixture.calls.scans, 0, "the provider work starts after the response can be returned");

  await Promise.resolve();
  assert.equal(fixture.calls.scans, 1);
  assert.equal(fixture.routes["GET /api/moderation/artist-death-watch"]({ query: {}, setHeader() {} }).running, true);

  work.resolve({ ok: true });
  await work.promise;
  await new Promise((resolve) => setImmediate(resolve));
  const completed = fixture.routes["GET /api/moderation/artist-death-watch"]({ query: {}, setHeader() {} });
  assert.equal(completed.running, false);
  assert.equal(completed.startedAt, null);
});

test("manual scan rejection is consumed and reported without failing the trigger request", async () => {
  const work = deferred();
  const failures = [];
  const fixture = routeFixture({
    scan: () => work.promise,
    reportScanError: (error) => failures.push(error),
  });

  const accepted = fixture.routes["POST /api/admin/artist-death-watch/scan"]({ setHeader() {} });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.running, true);
  await Promise.resolve();
  const failure = new Error("provider failed after one confirmation");
  failure.code = "wikidata_timeout";
  work.reject(failure);
  await assert.rejects(work.promise, /provider failed/u);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(failures, [failure]);
  const settled = fixture.routes["GET /api/moderation/artist-death-watch"]({ query: {}, setHeader() {} });
  assert.equal(settled.running, false);
  assert.equal(settled.startedAt, null);
});
