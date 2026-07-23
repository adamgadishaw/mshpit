import assert from "node:assert/strict";
import test from "node:test";

import { classifyResolve, CACHE_MS, backoffFor, RESOLVE_ATTEMPTS } from "./playback.mjs";

test("a resolved video is trusted and cached for a long time", () => {
  const r = classifyResolve({ videoId: "abc123", status: "artist_catalogue" });
  assert.equal(r.videoId, "abc123");
  assert.equal(r.retry, false);
  assert.equal(r.cacheMs, CACHE_MS.hit);
});

test("capacity failures are temporary and must be retried, not cached as 'no video'", () => {
  // These are the statuses that made popular songs play as previews: the song
  // was fine, we just could not ask at that moment.
  for (const status of ["search_budget_exhausted", "provider_paused", "quota_or_forbidden", "rate_limited"]) {
    const r = classifyResolve({ videoId: null, status, retryable: true });
    assert.equal(r.transient, true, `${status} should be temporary`);
    assert.equal(r.retry, true, `${status} should be retried`);
    assert.equal(r.cacheMs, CACHE_MS.transient, `${status} must not be cached as a lasting answer`);
  }
});

test("a real 'no video exists' answer is respected and not retried forever", () => {
  for (const status of ["confirmed_unavailable", "not_found", "unconfigured"]) {
    const r = classifyResolve({ videoId: null, status });
    assert.equal(r.transient, false, `${status} is a real answer`);
    assert.equal(r.retry, false);
    assert.equal(r.cacheMs, CACHE_MS.definitive);
  }
});

test("a failed request is retried, including our own rate limiter's 429", () => {
  for (const error of [{ status: 429 }, { status: 500 }, { status: 503 }, { status: 408 }, new Error("network down")]) {
    const r = classifyResolve({ error });
    assert.equal(r.retry, true, `${error.status || "network"} should be retried`);
    assert.equal(r.cacheMs, CACHE_MS.transient);
  }
});

test("a genuine client mistake is not retried in a loop", () => {
  for (const error of [{ status: 400 }, { status: 404 }]) {
    const r = classifyResolve({ error });
    assert.equal(r.retry, false, `${error.status} is our bug, retrying cannot fix it`);
  }
});

test("an unrecognised status errs toward retrying", () => {
  // Getting this wrong one way costs one request; the other way silently
  // downgrades a song to a preview.
  const r = classifyResolve({ videoId: null, status: "something_new" });
  assert.equal(r.retry, true);
});

test("backoff is bounded and defined for every attempt", () => {
  for (let i = 0; i < RESOLVE_ATTEMPTS + 2; i++) {
    const ms = backoffFor(i);
    assert.ok(Number.isFinite(ms) && ms > 0 && ms <= 5000, `attempt ${i} backoff should be sane, got ${ms}`);
  }
});

test("missing or empty input never claims a video", () => {
  for (const outcome of [{}, { videoId: null }, { videoId: "" }, undefined]) {
    assert.equal(classifyResolve(outcome).videoId, null);
  }
});
