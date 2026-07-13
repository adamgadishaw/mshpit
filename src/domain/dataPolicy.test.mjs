import test from "node:test";
import assert from "node:assert/strict";

import { demoDataEnabled } from "../config/runtime.mjs";
import {
  calendarDateKey,
  isUpcomingEventDate,
  sanitizePersistedStoreValue,
  sanitizeTourDates,
} from "./dataPolicy.mjs";

test("demo data needs both development mode and the explicit public flag", () => {
  assert.equal(demoDataEnabled(true, "true"), true);
  assert.equal(demoDataEnabled(true, "false"), false);
  assert.equal(demoDataEnabled(false, "true"), false);
});

test("production removes only known generated tour date IDs", () => {
  const real = { id: "tm_event_123", date: "2026-08-14" };
  const rows = [
    real,
    { id: "g_t_1" },
    { id: "ca_t_22" },
    { id: "ct8" },
    { id: "t4" },
  ];

  assert.deepEqual(sanitizeTourDates(rows, false), [real]);
  assert.deepEqual(sanitizeTourDates(rows, true), rows);
});

test("persisted demo cleanup keeps server-created records", () => {
  const serverPost = { id: "p_server", userId: "u_real" };
  assert.deepEqual(
    sanitizePersistedStoreValue("pit.feed", [{ id: "log_1" }, serverPost]),
    [serverPost],
  );

  assert.deepEqual(
    sanitizePersistedStoreValue("pit.dms", {
      demo: [{ id: "dm1" }, { id: "msg_server", text: "keep" }],
      real: [{ id: "msg_real", text: "keep too" }],
    }),
    {
      demo: [{ id: "msg_server", text: "keep" }],
      real: [{ id: "msg_real", text: "keep too" }],
    },
  );
});

test("calendar filtering includes today and excludes past or invalid dates", () => {
  const localNoon = new Date(2026, 6, 12, 12).getTime();
  assert.equal(calendarDateKey("2026 · 07 · 12"), 20260712);
  assert.equal(calendarDateKey("2026-02-30"), null);
  assert.equal(isUpcomingEventDate({ date: "2026 · 07 · 11" }, localNoon), false);
  assert.equal(isUpcomingEventDate({ date: "2026-07-12T01:00:00Z" }, localNoon), true);
  assert.equal(isUpcomingEventDate({ date: "2026 · 07 · 13" }, localNoon), true);
  assert.equal(isUpcomingEventDate({ date: "TBA" }, localNoon), false);
});
