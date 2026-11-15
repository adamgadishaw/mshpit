import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { reviewedEventCorrection, reviewedEventRow, reviewedEventUpcomingSql, reviewedShowCorrection } from "./reviewedEventCorrections.js";
import { currentOrUpcomingTourDateRow } from "./tourDateLifecycle.js";
import { publicTourDateProviderFields } from "./tourDateMetadata.js";

const row = { id: "tm_Z698xZu0Z16vCdfAue", provider_event_id: "Z698xZu0Z16vCdfAue",
  source: "ticketmaster", owner_id: null, artist: "Placebo", date: "2026-11-15", event_status: "onsale" };

test("official Prague correction is exact, read-only and preserves original identity/date", () => {
  const correction = reviewedEventCorrection(row);
  assert.equal(correction.sourceUrl, "https://www.ticketportal.cz/Article/11104");
  assert.equal(reviewedEventRow(row).event_status, "postponed");
  assert.equal(row.event_status, "onsale");
  assert.equal(reviewedEventRow(row).date, row.date);
  assert.equal(currentOrUpcomingTourDateRow(row, "2026-11-01"), false);
  assert.equal(publicTourDateProviderFields(row).eventNotice, "New date to be announced. Existing tickets remain valid.");
  for (const patch of [{ id: "tm_other" }, { source: "bandsintown" }, { owner_id: "member" }, { provider_event_id: "other" }]) {
    const unrelated = { ...row, ...patch };
    assert.equal(reviewedEventCorrection(unrelated), null);
    assert.equal(reviewedEventRow(unrelated), unrelated);
  }
});

test("reviewed upcoming exclusion preserves other provider and authored records", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("CREATE TABLE tour_dates(id TEXT,owner_id TEXT)");
    const insert = database.prepare("INSERT INTO tour_dates VALUES (?,?)");
    insert.run(row.id, null); insert.run("tm_other", null); insert.run(row.id, "member");
    database.exec("PRAGMA query_only=ON");
    assert.deepEqual(database.prepare(`SELECT id,owner_id FROM tour_dates td WHERE ${reviewedEventUpcomingSql()}`).all()
      .map((value) => [value.id, value.owner_id]), [["tm_other", null], [row.id, "member"]]);
    assert.throws(() => reviewedEventUpcomingSql("td;DROP TABLE tour_dates"), TypeError);
  } finally { database.close(); }
});

test("canonical provider tuples resolve the same correction with and without a source-row link", () => {
  const show = { provider: "ticketmaster", providerEventId: "Z698xZu0Z16vCdfAue" };
  assert.equal(reviewedShowCorrection(show)?.status, "postponed");
  assert.equal(reviewedShowCorrection({ ...show, tourDateId: row.id })?.status, "postponed");
  for (const patch of [{ provider: "bandsintown" }, { providerEventId: "other" }, { ownerId: "member" }, { tourDateId: "tm_other" }]) {
    assert.equal(reviewedShowCorrection({ ...show, ...patch }), null);
  }
});
