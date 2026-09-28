import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createSearchGrowthService } from "../server/features/searchGrowth/searchGrowthService.js";
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

test("search growth fixture matches an unconfigured service without making Google requests", () => {
  const database = new DatabaseSync(":memory:");
  try {
    const service = createSearchGrowthService({ database, env: {},
      client: { readWindow: () => assert.fail("A status read must not contact Google.") } });
    const url = new URL("https://fixture.invalid/api/moderation/search-growth");
    const fixture = staffFixture(url);
    assert.deepEqual(fixture, service.collectStatus());
    assert.equal(fixture.enabled, false);
    assert.equal(fixture.configured, false);
    assert.deepEqual(fixture.totals, { current: null, previous: null });
    assert.throws(() => staffFixture(url, "POST"), /explicit upkeep button/);
    assert.equal(staffFixture(new URL("https://fixture.invalid/api/moderation/search-growth/unknown")), null);
  } finally {
    database.close();
  }
});
