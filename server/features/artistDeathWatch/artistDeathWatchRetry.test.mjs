import assert from "node:assert/strict";
import test from "node:test";
import { ARTIST_DEATH_WATCH_INTERVAL_MS } from "../../../src/domain/artistDeathWatch.mjs";
import { ARTIST_DEATH_WATCH_MAX_COOLDOWN_MS, deathWatchRetryAt } from "./artistDeathWatchRetry.js";

const AT = Date.parse("2026-08-30T12:00:00.000Z");

test("bounded response deadlines are not capped again from the earlier scan timestamp", () => {
  const receivedAt = AT + 75_000;
  const retryAt = receivedAt + ARTIST_DEATH_WATCH_MAX_COOLDOWN_MS;
  assert.equal(deathWatchRetryAt({}, { retryAt }, AT, { now: () => receivedAt }), retryAt);
  assert.equal(deathWatchRetryAt({}, { retryAt: Number.MAX_SAFE_INTEGER }, AT, { now: () => receivedAt }), retryAt,
    "callers bypassing the response parser cannot create an unbounded deadline");
});

test("local exponential backoff remains bounded without a valid future provider deadline", () => {
  const previous = {
    lastErrorCode: "musicbrainz_unavailable", lastScanAt: AT - ARTIST_DEATH_WATCH_MAX_COOLDOWN_MS,
    nextScanAt: AT,
  };
  for (const retryAt of [null, NaN, Infinity, -1, AT - 1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(deathWatchRetryAt({}, { retryAt }, AT, { now: () => AT }), AT + ARTIST_DEATH_WATCH_INTERVAL_MS);
    assert.equal(deathWatchRetryAt(previous, { retryAt }, AT, { now: () => AT }), AT + ARTIST_DEATH_WATCH_MAX_COOLDOWN_MS);
  }
});
