import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleTourDateRowsFrom } from "./tourDateVisibilityQuery.js";

const directory = mkdtempSync(join(tmpdir(), "pit-map-cursor-"));
process.env.PIT_DATA_DIR = directory;
const { db } = await import("./db.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
const at = Date.parse("2026-10-22T12:00:00Z");
const common = { at, today: "2026-10-21", providerOnly: true };

test("provider map cursor seeks same-day exact IDs and preserves the complete public sequence", () => {
  // Only this test's new, isolated database is changed.
  db.exec("DELETE FROM tour_dates");
  const insert = db.prepare("INSERT INTO tour_dates(id,artist,venue,place,date,source,updated_at,provider_active,music_qualified,event_kind,event_end_date,music_evidence,billed_artists) VALUES(?,?,?,?,?,?,?, ?,?,?,?,?,?)");
  db.exec("BEGIN");
  for (let i = 0; i < 1100; i += 1) {
    insert.run(`tm_fixture_${String(i).padStart(5, "0")}${i % 2 ? "A" : "a"}`, "Fixture artist", "Fixture venue", "Toronto, Canada", "2026-11-01", "ticketmaster", at, 1, 1, "concert", null, null, "[]");
  }
  for (const [id, date, active, qualified, kind, end, evidence, billed] of [
    ["tm_case_A", "2026-11-01", 1, 1, "concert", null, null, "[]"],
    ["tm_case_a", "2026-11-01", 1, 1, "concert", null, null, "[]"],
    ["tm_legacy", "2026 · 11 · 02", 1, 1, "concert", null, null, "[]"],
    ["tm_active_festival", "2026-10-20", 1, 1, "festival", "2026-10-23", "provider_music", '["Fixture artist"]'],
    ["tm_inactive", "2026-11-01", 0, 1, "concert", null, null, "[]"],
    ["tm_nonmusic", "2026-11-01", 1, 0, "concert", null, null, "[]"],
    ["tm_invalid", "not-a-date", 1, 1, "concert", null, null, "[]"],
    ["tm_past", "2025-01-01", 1, 1, "concert", null, null, "[]"],
  ]) insert.run(id, "Fixture artist", "Fixture venue", "Toronto, Canada", date, "ticketmaster", at, active, qualified, kind, end, evidence, billed);
  db.exec("COMMIT");
  const expected = visibleTourDateRowsFrom(db, null, { ...common, limit: 5000 }).map(row => row.id);
  const actual = []; const plans = []; let afterCursor = null;
  const tracked = { prepare(sql) { return { all(...args) {
    if (afterCursor) plans.push(...db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map(row => row.detail));
    return db.prepare(sql).all(...args);
  } }; } };
  while (true) {
    const rows = visibleTourDateRowsFrom(tracked, null, { ...common, after: afterCursor, limit: 97 });
    actual.push(...rows.map(row => row.id));
    if (rows.length < 97) break;
    afterCursor = { date: rows.at(-1).date, id: rows.at(-1).id };
  }
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, actual.length);
  for (const id of ["tm_case_A", "tm_case_a", "tm_legacy", "tm_active_festival"]) assert.ok(actual.includes(id), id);
  for (const id of ["tm_inactive", "tm_nonmusic", "tm_invalid", "tm_past"]) assert.equal(actual.includes(id), false, id);
  assert.ok(plans.some(detail => detail.includes("idx_tourdates_owner_date_id") && detail.includes("(date,id)>(?,?)")), plans.join("\n"));
  assert.equal(plans.some(detail => detail.includes("TEMP B-TREE")), false, plans.join("\n"));
});
