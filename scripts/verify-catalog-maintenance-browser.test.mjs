import assert from "node:assert/strict";
import test from "node:test";
import { upkeepAdmin, upkeepFixture, staffFixture } from "./verify-catalog-maintenance-browser.mjs";

test("catalog browser fixture uses only a synthetic administrator", () => {
  assert.equal(upkeepAdmin.role, "admin");
  assert.match(upkeepAdmin.email, /@example\.test$/);
  assert.match(upkeepAdmin.id, /fixture/);
});
test("upkeep fixtures distinguish multiple lanes from Google indexing proof", () => {
  assert.equal(upkeepFixture("catch_up").catalog.limits.lanes, 10);
  assert.equal(upkeepFixture("maintenance").catalog.limits.lanes, 1);
  assert.equal(upkeepFixture().seo.indexingState, "not_measured");
  assert.equal(upkeepFixture().artistPhotos.lastPass.filled, 18);
  assert.equal(upkeepFixture().venuePhotos.counts.filled, 12);
  assert.throws(() => upkeepFixture("run-now"));
});
test("unrelated staff fixture writes are refused", () => {
  assert.throws(() => staffFixture(new URL("https://fixture.invalid/api/admin/catalog/seed"), "POST"), /explicit upkeep button/);
  assert.equal(staffFixture(new URL("https://fixture.invalid/api/unknown")), null);
});
