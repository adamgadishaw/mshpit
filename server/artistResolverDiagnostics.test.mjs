import assert from "node:assert/strict";
import test from "node:test";
import { artistPath, eventPath } from "../src/domain/urls.mjs";
import {
  artistLookupFailureCode, artistResolverEntryPoint, createArtistResolverDiagnostics,
  createArtistResolverMetrics, formatArtistResolverFailure, observeArtistLookup, sanitizeArtistResolverDiagnostic,
} from "./artistResolverDiagnostics.js";

test("one request records both provider outcomes and cannot be changed by a late loser", () => {
  let at = 10, detail, captures = 0, records = 0;
  const trace = createArtistResolverDiagnostics({ monotonicNow: () => at, entryPoint: "event_page",
    capture: (value) => { detail = value; captures++; }, metrics: { record: () => { records++; } } });
  trace.provider({ provider: "musicbrainz", type: "start" });
  trace.work("musicbrainz", { origin: "memoized_result" });
  at = 12;
  trace.provider({ provider: "musicbrainz", outcome: "no_match" });
  trace.provider({ provider: "deezer", type: "start" });
  trace.work("deezer", { origin: "new_work" });
  at = 1512;
  trace.provider({ provider: "deezer", outcome: "unavailable", failure: "provider_timeout" });
  trace.failed({ code: "PROVIDER_UNAVAILABLE" });
  trace.finish();
  assert.equal(detail.source, "none");
  assert.equal(detail.outcome, "unavailable");
  assert.equal(detail.entryPoint, "event_page");
  assert.deepEqual(detail.musicbrainz, { outcome: "no_match", origin: "memoized_result", failure: "none", elapsedMs: 2 });
  assert.deepEqual(detail.deezer, { outcome: "unavailable", origin: "new_work", failure: "provider_timeout", elapsedMs: 1500 });
  assert.equal(detail.elapsedMs, 1502);
  assert.equal(detail.cacheWrite, "not_attempted");
  trace.provider({ provider: "deezer", outcome: "matched" });
  trace.source("deezer"); trace.result("matched"); trace.cacheWrite("stored"); trace.finish();
  assert.equal(captures, 1); assert.equal(records, 1);
  assert.equal(detail.deezer.outcome, "unavailable");
  assert.throws(() => { detail.deezer.failure = "network"; }, TypeError);
});

test("only fixed labels and capped numbers survive hostile diagnostic fields", () => {
  const secret = "private-search token=secret user@example.test";
  const dangerous = new Proxy({}, { get() { throw new Error(secret); } });
  let coercions = 0;
  const number = { valueOf() { coercions++; throw new Error(secret); } };
  const detail = sanitizeArtistResolverDiagnostic({ source: secret, outcome: secret, cacheWrite: secret, entryPoint: secret,
    elapsedMs: 1e20, requestId: secret, name: secret, key: secret, userId: secret, ip: secret,
    musicbrainz: { outcome: secret, origin: secret, failure: secret, elapsedMs: number }, deezer: dangerous });
  assert.equal(detail.elapsedMs, 60_000);
  assert.equal(detail.musicbrainz.elapsedMs, null);
  assert.equal(coercions, 0);
  assert.equal(detail.entryPoint, "unknown");
  assert.doesNotMatch(JSON.stringify(detail), /private-search|secret|requestId|userId|@|token/);
  assert.doesNotThrow(() => sanitizeArtistResolverDiagnostic(dangerous));
  assert.equal(artistLookupFailureCode(dangerous), "other");
  const cycle = { code: secret }; cycle.cause = cycle;
  assert.equal(artistLookupFailureCode(cycle), "other");
  assert.equal(artistLookupFailureCode({ code: "PROVIDER_UNAVAILABLE", cause: { code: "network", message: secret } }), "network");
});

test("failure suffix has a hard shape and small maximum encoded size", () => {
  const value = { entryPoint: "other_same_origin", source: "musicbrainz_cache_stale", outcome: "rate_limited", cacheWrite: "optional_storage_failure", elapsedMs: 60000,
    musicbrainz: { outcome: "cancelled_after_failure", origin: "capacity_rejected", failure: "quota_or_forbidden", elapsedMs: 60000 },
    deezer: { outcome: "cancelled_after_failure", origin: "capacity_rejected", failure: "quota_or_forbidden", elapsedMs: 60000 } };
  const suffix = formatArtistResolverFailure(value);
  assert.ok(Buffer.byteLength(suffix) < 700, suffix);
  assert.deepEqual(JSON.parse(suffix.slice(" resolver=".length)), sanitizeArtistResolverDiagnostic(value));
  assert.equal(formatArtistResolverFailure(null), "");
});

test("same-origin entry categories follow canonical paths and never imply client identity", () => {
  const origin = "https://mshpit.com";
  assert.equal(artistResolverEntryPoint(origin + eventPath({ id: "sensitive/opaque event" }) + "?token=private", origin), "event_page");
  assert.equal(artistResolverEntryPoint(origin + artistPath("A Private Artist") + "#secret", origin), "artist_page");
  assert.equal(artistResolverEntryPoint(origin + "/search?q=secret", origin), "search_page");
  assert.equal(artistResolverEntryPoint(origin + "/settings?private=secret", origin), "other_same_origin");
  for (const value of [undefined, [origin + "/event/a"], "/event/a", "https://evil.test/event/a", "https://mshpit.com.evil.test/event/a",
    "https://user:password@mshpit.com/event/a", "http://mshpit.com/event/a", origin + "/" + "x".repeat(2048)]) {
    assert.equal(artistResolverEntryPoint(value, origin), "unknown");
  }
  assert.equal(artistResolverEntryPoint(origin + "/event/a", undefined), "unknown");
});

test("rolling aggregates retain quiet windows, prune to 60 buckets, and use no request dimensions", () => {
  let at = 600_000;
  const metrics = createArtistResolverMetrics({ now: () => at });
  for (let minute = 0; minute < 65; minute++) {
    metrics.record({ source: "catalog", outcome: "matched", elapsedMs: minute, entryPoint: `private-${minute}`,
      name: `secret-${minute}`, musicbrainz: { outcome: "not_started" }, deezer: { outcome: "not_started" } });
    at += 60_000;
  }
  let snapshot = metrics.snapshot();
  assert.equal(snapshot.completed, 59);
  assert.equal(snapshot.sources.catalog, 59);
  assert.equal(snapshot.entryPoints.unknown, 59);
  assert.equal(snapshot.providers.musicbrainz.outcomes.not_started, 59);
  assert.equal(snapshot.providers.musicbrainz.timing.count, 0);
  assert.equal(snapshot.scope, "process_local_handler_completions");
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 4000);
  assert.doesNotMatch(JSON.stringify(snapshot), /private-|secret-/);
  assert.equal(metrics.snapshot().completed, 59, "reading does not consume observations");
  at += 60 * 60_000;
  snapshot = metrics.snapshot();
  assert.equal(snapshot.completed, 0, "quiet expired data is pruned without another request");
  at -= 120 * 60_000;
  assert.equal(metrics.snapshot().completed, 0, "clock rollback cannot retain future buckets");
});

test("throwing and rejected observers cannot escape or replace a response", async () => {
  const throws = () => { throw new Error("private observer failure"); };
  observeArtistLookup(throws, { origin: "new_work" });
  observeArtistLookup(async () => { throw new Error("private async failure"); }, {});
  const trace = createArtistResolverDiagnostics({ capture: throws, monotonicNow: throws, metrics: { record: throws } });
  trace.source("catalog"); trace.result("matched");
  assert.doesNotThrow(() => trace.finish());
  await new Promise((done) => setImmediate(done));
});

test("malformed error status and failed aggregate reads remain observational", () => {
  const hostileNumber = { valueOf() { throw new Error("must not coerce telemetry"); } };
  let detail;
  const trace = createArtistResolverDiagnostics({ capture: (value) => { detail = value; }, metrics: { record() {} } });
  assert.doesNotThrow(() => trace.failed({ status: hostileNumber }));
  trace.finish();
  assert.equal(detail.outcome, "error");
  let broken = false;
  const metrics = createArtistResolverMetrics({ now: () => { if (broken) throw new Error("clock failed"); return 1000; } });
  broken = true;
  assert.doesNotThrow(() => metrics.record({ source: "catalog", outcome: "matched" }));
  assert.equal(metrics.snapshot().state, "unavailable");
});
