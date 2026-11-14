import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { festivalToday, currentFestivalEditions, pastFestivalEditions, distinctFestivalAnnouncement, creditedFestivalImage, confirmedFestivalPlan } from "./festivalPresentation.ios.mjs";
const edition = { id: "one", startDate: "2027-01-01", endDate: "2027-01-03" };
test("current editions include a live multi-day date, not expired or invalid dates", () => {
  assert.deepEqual(currentFestivalEditions([edition], "2027-01-03"), [edition]);
  assert.deepEqual(currentFestivalEditions([edition], "2027-01-04"), []);
  assert.deepEqual(currentFestivalEditions([{ ...edition, startDate: "2027-02-30" }], "2027-01-01"), []);
});
test("past projection deduplicates an expired cached upcoming row", () => {
  assert.deepEqual(pastFestivalEditions({ upcoming: [edition], past: [edition] }, "2027-01-04"), [edition]);
});
test("official announcement is preserved beside a different provider date, never fabricated as edition", () => {
  const announcement = { startDate: "2026-12-01", endDate: "2026-12-02" };
  assert.equal(distinctFestivalAnnouncement({ upcoming: [edition], announcement }, "2026-11-08"), announcement);
  assert.equal(distinctFestivalAnnouncement({ upcoming: [edition], announcement: { ...edition } }, "2026-11-08"), null);
  assert.equal(distinctFestivalAnnouncement({ upcoming: [], announcement }, "2027-01-01"), null);
});
test("image eligibility never manufactures provenance", () => {
  assert.equal(creditedFestivalImage({ imageUrl: "https://example.test/photo" }), null);
  assert.equal(creditedFestivalImage({ imageUrl: "https://name:secret@example.test/photo", imageAttribution: "Credit" }), null);
});
test("a plan receipt must identify the edition and allowed days/acts", () => {
  const e = { ...edition, days: ["2027-01-01"], lineup: [{ name: "Artist" }] };
  const p = { editionId: "one", days: ["2027-01-01"], mustSee: ["Artist"] };
  assert.equal(confirmedFestivalPlan(p, e), true); assert.equal(confirmedFestivalPlan({ ...p, editionId: "other" }, e), false);
  assert.equal(confirmedFestivalPlan({ ...p, days: ["2027-02-01"] }, e), false);
});
test("platform entry remains extensionless and default platforms cannot resolve new variants", () => {
  const entry = readFileSync(new URL("./festivalsEntry.js", import.meta.url), "utf8");
  for (const name of ["FestivalScreen", "FestivalsHubScreen", "FestivalsPanel", "FestivalCard"]) {
    assert.ok(existsSync(new URL(`./${name}.ios.jsx`, import.meta.url)));
    assert.ok(existsSync(new URL(`./${name}.jsx`, import.meta.url)));
    const original = readFileSync(new URL(`./${name}.jsx`, import.meta.url), "utf8");
    assert.ok(!original.includes(".ios"));
  }
  assert.ok(!entry.includes(".ios"));
});

test("catalogue date remains UTC on both sides of the date line", () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ["Pacific/Honolulu", "Pacific/Kiritimati"]) {
      process.env.TZ = zone;
      assert.equal(festivalToday("2027-01-01T00:30:00Z"), "2027-01-01");
      assert.equal(festivalToday("2026-12-31T23:30:00Z"), "2026-12-31");
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
