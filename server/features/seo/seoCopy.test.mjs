import assert from "node:assert/strict";
import test from "node:test";
import { publicEventMetadata, readableCountryName, readableRegion } from "./publicMetadataPresentation.js";

test("place names read the way people search them", () => {
  assert.equal(readableRegion("59", "FR"), "", "a French department number is not a place name");
  assert.equal(readableRegion("DL", "IE"), "", "an Irish county code is dropped");
  assert.equal(readableRegion("WA", "US"), "WA", "US state codes stay");
  assert.equal(readableRegion("QC", "Canada"), "QC");
  assert.equal(readableRegion("Bavaria", "DE"), "Bavaria");
  assert.equal(readableCountryName("United States Of America"), "United States");
  assert.equal(readableCountryName("France"), "France");
});

test("event snippets say what the page offers instead of a generic line", () => {
  const base = { name: "Odd Mob", venue: "The Rechabite", place: "Perth, Western Australia, Australia", date: "2026-10-03" };
  assert.match(publicEventMetadata({ ...base, ticketUrl: "https://www.ticketmaster.com.au/x" }, { today: "2026-09-28" }).description,
    /Odd Mob at The Rechabite in Perth, Western Australia, Australia on .+\. Tickets, venue details and who's going\.$/u);
  assert.match(publicEventMetadata(base, { today: "2026-09-28" }).description, /Venue details and who's going\.$/u, "no ticket claim without a ticket link");
  assert.match(publicEventMetadata(base, { today: "2026-10-05" }).description, /Past event details\.$/u);
});
