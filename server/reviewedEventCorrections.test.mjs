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

test("Dax warning is scoped to the original HISTORY date without mutating the row or lifecycle", async () => {
  const { reviewedEventNoticeFields, reviewedShowNoticeFields, reviewedEventWriteRow } = await import("./reviewedEventCorrections.js");
  const old = Object.freeze({ id: "tm_177Zv0G61YPAJyV", source: "ticketmaster",
    provider_event_id: "177Zv0G61YPAJyV", owner_id: null, event_status: "onsale",
    date: "2026-11-25", venue: "HISTORY" });
  const notice = reviewedEventNoticeFields(old);
  assert.match(notice.eventNotice, /not playing HISTORY.*The Concert Hall.*Dec\. 1.*7 p\.m\..*8 p\.m\..*tickets are valid/);
  assert.equal(notice.eventNoticeSource, "https://www.ticketmaster.ca/event/100064AC25166E74");
  assert.equal(publicTourDateProviderFields(old).eventNotice, notice.eventNotice);
  assert.equal(publicTourDateProviderFields(old).eventStatus, "onsale");
  assert.equal(reviewedEventWriteRow(old), old);
  assert.equal(reviewedEventCorrection(old), null);
  assert.deepEqual(reviewedShowNoticeFields({ provider: "ticketmaster", providerEventId: old.provider_event_id }), notice);
  assert.deepEqual(reviewedShowNoticeFields({ provider: "ticketmaster", providerEventId: old.provider_event_id, tourDateId: old.id, ownerId: "member" }), {});
  assert.deepEqual(reviewedShowNoticeFields({ provider: "ticketmaster", providerEventId: "1A8ZkfUGkdRqpNX" }), {});
  for (const change of [{source: "bandsintown"}, {provider_event_id: "other"}, {owner_id: "member"}, {id: "tm_1A8ZkfUGkdRqpNX"}]) {
    assert.deepEqual(reviewedEventNoticeFields({...old, ...change}), {});
  }
});
