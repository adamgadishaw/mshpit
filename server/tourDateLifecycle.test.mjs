import assert from "node:assert/strict";
import test from "node:test";

import {
  currentOrUpcomingTourDateRow,
  currentOrUpcomingTourDateSql,
  effectiveTourDateEndSql,
} from "./tourDateLifecycle.js";

test("tour-date lifecycle keeps active ranges current and rejects malformed end dates", () => {
  const today = "2026-08-27";
  assert.equal(currentOrUpcomingTourDateRow({ date: "2026-08-21", event_end_date: "2026-09-07" }, today), true);
  assert.equal(currentOrUpcomingTourDateRow({ date: "2026-08-21", event_end_date: "2026-08-26" }, today), false);
  assert.equal(currentOrUpcomingTourDateRow({ date: "2026-08-28" }, today), true);
  assert.equal(currentOrUpcomingTourDateRow({ date: "2026-08-21", event_end_date: "invalid" }, today), false);
});

test("tour-date lifecycle SQL is bounded to safe aliases and one caller placeholder", () => {
  assert.equal(currentOrUpcomingTourDateSql("td", "?2"), effectiveTourDateEndSql("td") + ">=?2");
  assert.throws(() => effectiveTourDateEndSql("td;DROP TABLE users"), TypeError);
});
