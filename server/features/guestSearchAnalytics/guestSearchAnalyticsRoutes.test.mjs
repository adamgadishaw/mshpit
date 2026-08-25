import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { ensureGuestSearchAnalyticsSchema } from "../../guestSearchAnalytics.js";
import { guestSearchAnalyticsRoutes } from "./guestSearchAnalyticsRoutes.js";

class TestApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

test("guest search route stores one categorical counter and no signed-in event", () => {
  const database = ensureGuestSearchAnalyticsSchema(new DatabaseSync(":memory:"));
  try {
    const calls = [];
    const route = guestSearchAnalyticsRoutes({
      database,
      ApiError: TestApiError,
      now: () => Date.UTC(2026, 7, 25, 12),
      rateLimit: (...args) => calls.push(args),
    })["POST /api/analytics/guest-search"];

    assert.deepEqual(route({ user: null, body: { kind: "all", resultBucket: "zero", outcome: "success", query: "secret" } }), {
      ok: true,
      recorded: true,
    });
    assert.deepEqual(route({ user: { id: "member" }, body: { kind: "all", resultBucket: "zero", outcome: "success" } }), {
      ok: true,
      recorded: false,
    });
    assert.equal(database.prepare("SELECT SUM(count) count FROM guest_search_daily").get().count, 1);
    assert.equal(calls.length, 2);
    assert.equal(calls[0][1], "guest-search-analytics");
    assert.equal(calls[0][2], 120);
  } finally {
    database.close();
  }
});

test("guest search route rejects malformed category combinations before storage", () => {
  const database = ensureGuestSearchAnalyticsSchema(new DatabaseSync(":memory:"));
  try {
    const route = guestSearchAnalyticsRoutes({
      database,
      ApiError: TestApiError,
      now: () => Date.UTC(2026, 7, 25, 12),
      rateLimit: () => {},
    })["POST /api/analytics/guest-search"];
    assert.throws(
      () => route({ user: null, body: { kind: "all", resultBucket: "unknown", outcome: "success" } }),
      (error) => error instanceof TestApiError && error.status === 400 && error.code === "VALIDATION_FAILED",
    );
    assert.equal(database.prepare("SELECT COUNT(*) count FROM guest_search_daily").get().count, 0);
  } finally {
    database.close();
  }
});
