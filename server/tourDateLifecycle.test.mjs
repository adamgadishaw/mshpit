import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  currentOrUpcomingTourDateRow,
  currentOrUpcomingTourDateSql,
  effectiveTourDateEndSql,
  providerMultiDayConcertEvidenceSql,
} from "./tourDateLifecycle.js";

const providerRange = (overrides = {}) => ({
  owner_id: null,
  event_kind: "festival",
  date: "2026-08-01",
  event_end_date: "2026-08-26",
  music_evidence: "ticketmaster:classification:music",
  billed_artists: JSON.stringify(["The Beaches"]),
  ...overrides,
});

test("tour-date lifecycle trusts only authored or evidenced provider ranges", () => {
  const today = "2026-08-20";
  assert.equal(currentOrUpcomingTourDateRow(providerRange({ event_kind: "concert" }), today), false,
    "a corrupt provider concert end date cannot keep an old concert current");
  assert.equal(currentOrUpcomingTourDateRow(providerRange({
    owner_id: "member", event_kind: "concert", event_end_date: "2026-12-31",
  }), today), true, "member-authored long ranges retain their explicit end date");
  assert.equal(currentOrUpcomingTourDateRow(providerRange(), today), true,
    "an evidenced festival may span 25 elapsed days");
  assert.equal(currentOrUpcomingTourDateRow(providerRange({ event_kind: "fair" }), today), true);
  assert.equal(currentOrUpcomingTourDateRow(providerRange({ event_end_date: "2026-09-16" }), today), false,
    "a provider festival spanning more than 45 elapsed days is rejected");
  assert.equal(currentOrUpcomingTourDateRow(providerRange({
    event_kind: "fair", event_end_date: "2026-09-16",
  }), today), false, "a provider fair spanning more than 45 elapsed days is rejected");
  assert.equal(currentOrUpcomingTourDateRow(providerRange({ music_evidence: "" }), today), false);
  assert.equal(currentOrUpcomingTourDateRow(providerRange({ billed_artists: JSON.stringify(["  "]) }), today), false);
  assert.equal(currentOrUpcomingTourDateRow(providerRange({
    event_kind: "multi_day", date: "2026-08-10", event_end_date: "2026-08-28",
  }), today), true);
  assert.equal(currentOrUpcomingTourDateRow(providerRange({ event_kind: "multi_day" }), today), false,
    "an overlong generic multi-day provider product is excluded");
  assert.equal(currentOrUpcomingTourDateRow(providerRange({
    event_kind: "concert", date: "2026-08-28", event_end_date: "invalid",
  }), today), true);
  assert.equal(currentOrUpcomingTourDateRow(providerRange({
    event_kind: "festival", event_end_date: "invalid",
  }), today), false);
});

test("tour-date lifecycle SQL matches row policy and preserves numbered placeholder ordering", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE tour_dates (id TEXT PRIMARY KEY,owner_id TEXT,event_kind TEXT,date TEXT,event_end_date TEXT,music_evidence TEXT,billed_artists TEXT)");
  const insert = database.prepare("INSERT INTO tour_dates (id,owner_id,event_kind,date,event_end_date,music_evidence,billed_artists) VALUES (?,?,?,?,?,?,?)");
  const values = [
    ["expired-provider-concert", providerRange({ event_kind: "concert" })],
    ["active-member-concert", providerRange({
      owner_id: "member", event_kind: "concert", event_end_date: "2026-12-31",
    })],
    ["active-provider-festival", providerRange()],
    ["active-provider-fair", providerRange({ event_kind: "fair" })],
    ["overlong-provider-festival", providerRange({ event_end_date: "2026-09-16" })],
    ["overlong-provider-fair", providerRange({ event_kind: "fair", event_end_date: "2026-09-16" })],
    ["unevidenced-provider-festival", providerRange({ music_evidence: "" })],
    ["empty-bill-provider-fair", providerRange({ event_kind: "fair", billed_artists: "[]" })],
    ["active-provider-multi-day", providerRange({
      event_kind: "multi_day", date: "2026-08-10", event_end_date: "2026-08-28",
    })],
    ["overlong-provider-multi-day", providerRange({ event_kind: "multi_day" })],
    ["future-provider-concert", providerRange({
      event_kind: "concert", date: "2026-08-28", event_end_date: "invalid",
    })],
  ];
  try {
    for (const [id, row] of values) {
      insert.run(id, row.owner_id, row.event_kind, row.date, row.event_end_date, row.music_evidence, row.billed_artists);
    }
    const sql = "SELECT id FROM tour_dates td WHERE ?1=?1 AND "
      + currentOrUpcomingTourDateSql("td", "?2") + " ORDER BY id";
    const ids = database.prepare(sql).all("placeholder-one", "2026-08-20").map((row) => row.id);
    assert.deepEqual(ids, [
      "active-member-concert",
      "active-provider-fair",
      "active-provider-festival",
      "active-provider-multi-day",
      "future-provider-concert",
    ]);
  } finally {
    database.close();
  }

  assert.match(currentOrUpcomingTourDateSql("td", "?2"), />=\?2/);
  assert.match(providerMultiDayConcertEvidenceSql("td"), /json_each/);
  assert.throws(() => effectiveTourDateEndSql("td;DROP TABLE users"), TypeError);
  assert.throws(() => currentOrUpcomingTourDateSql("td", "? OR 1=1"), TypeError);
  assert.throws(() => providerMultiDayConcertEvidenceSql("td;DROP TABLE users"), TypeError);
});
