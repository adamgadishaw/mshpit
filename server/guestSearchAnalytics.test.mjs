import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  ensureGuestSearchAnalyticsSchema,
  pruneGuestSearchAnalytics,
  readGuestSearchAnalytics,
  recordGuestSearchAggregate,
} from "./guestSearchAnalytics.js";

function testDatabase() {
  const database = new DatabaseSync(":memory:");
  ensureGuestSearchAnalyticsSchema(database);
  return database;
}

test("guest search schema has no visitor identifier, query, IP, URL, or timestamp column", () => {
  const database = testDatabase();
  try {
    const columns = database.prepare("PRAGMA table_info(guest_search_daily)").all().map((row) => row.name);
    assert.deepEqual(columns, ["day", "kind", "result_bucket", "outcome", "count"]);
    assert.throws(() => database.prepare("SELECT rowid FROM guest_search_daily").all(), /rowid/);
  } finally {
    database.close();
  }
});

test("guest searches aggregate by UTC day and strip every unapproved field", () => {
  const database = testDatabase();
  try {
    const at = Date.parse("2026-08-25T23:30:00.000Z");
    const payload = {
      kind: "all",
      resultBucket: "one_to_five",
      outcome: "success",
      query: "private words",
      userId: "u_private",
      deviceId: "device_private",
      ip: "203.0.113.10",
      url: "https://example.test/search?q=private",
      at: 123,
    };
    const first = recordGuestSearchAggregate(payload, { database, at });
    const second = recordGuestSearchAggregate(payload, { database, at });
    assert.equal(first.accepted, true);
    assert.deepEqual({ ...second.aggregate }, {
      day: "2026-08-25",
      kind: "all",
      resultBucket: "one_to_five",
      outcome: "success",
      count: 2,
    });
    assert.deepEqual(database.prepare("SELECT * FROM guest_search_daily").all().map((row) => ({ ...row })), [{
      day: "2026-08-25",
      kind: "all",
      result_bucket: "one_to_five",
      outcome: "success",
      count: 2,
    }]);
  } finally {
    database.close();
  }
});

test("failed searches use unknown result counts and signed-in writers are rejected", () => {
  const database = testDatabase();
  try {
    const at = Date.parse("2026-08-25T12:00:00.000Z");
    assert.deepEqual(recordGuestSearchAggregate({
      kind: "all", resultBucket: "zero", outcome: "failed",
    }, { database, at }), { ok: false, accepted: false, reason: "invalid" });
    assert.deepEqual(recordGuestSearchAggregate({
      kind: "all", resultBucket: "unknown", outcome: "failed",
    }, { database, user: { id: "u_member" }, at }), {
      ok: false, accepted: false, reason: "signed_in",
    });
    assert.equal(database.prepare("SELECT COUNT(*) count FROM guest_search_daily").get().count, 0);

    const guest = recordGuestSearchAggregate({
      kind: "all", resultBucket: "unknown", outcome: "failed",
    }, { database, at });
    assert.equal(guest.accepted, true);
    assert.equal(guest.aggregate.resultBucket, "unknown");
  } finally {
    database.close();
  }
});

test("guest search aggregates keep exactly 90 UTC calendar days", () => {
  const database = testDatabase();
  try {
    const success = { kind: "all", resultBucket: "zero", outcome: "success" };
    recordGuestSearchAggregate(success, { database, at: Date.parse("2026-05-27T12:00:00.000Z") });
    recordGuestSearchAggregate(success, { database, at: Date.parse("2026-05-28T12:00:00.000Z") });
    recordGuestSearchAggregate(success, { database, at: Date.parse("2026-08-25T12:00:00.000Z") });

    const retained = readGuestSearchAnalytics({ database, at: Date.parse("2026-08-25T12:00:00.000Z"), days: 90 });
    assert.equal(retained.startDay, "2026-05-28");
    assert.deepEqual(retained.rows.map((row) => row.day), ["2026-05-28", "2026-08-25"]);
    assert.deepEqual(pruneGuestSearchAnalytics({ database, at: Date.parse("2026-08-25T12:00:00.000Z") }), {
      cutoffDay: "2026-05-28",
      removed: 0,
    });
  } finally {
    database.close();
  }
});
