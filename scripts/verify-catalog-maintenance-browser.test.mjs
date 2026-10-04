import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createSearchGrowthService } from "../server/features/searchGrowth/searchGrowthService.js";
import { assertCatalogEditorRequestIsolation, catalogBrowserCases, catalogCompletionFixture, catalogExactVenueKey, catalogQueueFixture, exactCatalogFixture, upkeepAdmin, upkeepFixture, staffFixture, waitForCatalogCompletionSelection } from "./verify-catalog-maintenance-browser.mjs";

test("completion readiness cannot reuse the previous entity's acknowledged photo while a selection is pending", async () => {
  const entity = catalogCompletionFixture("venue");
  const identity = `${entity.type} · ${entity.key} · revision ${entity.revision}`;
  const photo = `Accepted catalog photo of ${entity.identity.name}`;
  const ready = "Accepted photo displayed in this preview; verify the public page after publication.";
  const visible = new Set(["artist · artist-fixture · revision 0", "Accepted catalog photo of Fixture artist", ready]);
  const pending = [];
  const locator = (value, options) => {
    assert.equal(options.exact, true);
    return { waitFor: () => visible.has(value) ? Promise.resolve() : new Promise(resolve => pending.push({ value, resolve })) };
  };
  const page = { getByText: locator, getByLabel: locator };
  let finished = false;
  const selection = waitForCatalogCompletionSelection(page, entity).then(() => { finished = true; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(finished, false, "The old acknowledgement must not release the venue assertion");
  assert.deepEqual(pending.map(row => row.value), [identity]);
  visible.delete(ready); visible.add(identity); visible.add(photo);
  pending.shift().resolve();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(finished, false, "New identity alone must not bypass the new photo load");
  assert.deepEqual(pending.map(row => row.value), [ready]);
  visible.add(ready); pending.shift().resolve(); await selection;
  assert.equal(finished, true);
});

test("completion browser cases use local accepted-photo fixtures for both catalog types and viewport sizes", () => {
  assert.deepEqual(catalogBrowserCases.filter(row => row.kind === "catalog-completion").map(row => row.width), [390, 1280]);
  for (const type of ["artist", "venue"]) {
    const row = catalogCompletionFixture(type);
    assert.equal(row.type, type); assert.equal(row.completion.photo.uri, "/fixture-catalog-photo.svg");
    assert.equal(row.completion.textStatus, "draft_ready"); assert.equal(row.completion.canDraft, true);
  }
  assert.throws(() => catalogCompletionFixture("event"));
  assert.notEqual(catalogCompletionFixture("artist").completion.hash, catalogCompletionFixture("venue").completion.hash,
    "Each exact identity must independently acknowledge its accepted photo, even when fixture image bytes are shared");
});

test("queue browser cases cover mobile and desktop continuation without reusing cursors across queries", () => {
  assert.deepEqual(catalogBrowserCases.filter(item => item.kind === "catalog-queue").map(item => item.width), [390, 1280]);
  for (const type of ["artist", "venue", "event"]) {
    const first = catalogQueueFixture(type, "");
    assert.deepEqual(first.items, []); assert.equal(first.scanLimitReached, true);
    const second = catalogQueueFixture(type, first.nextCursor);
    assert.equal(second.items[0].type, type); assert.equal(second.nextCursor, null);
    assert.equal(catalogQueueFixture(type, "", "Fixture").items.length, 1);
    assert.throws(() => catalogQueueFixture(type, first.nextCursor, "Fixture"), /changed name filter/);
    assert.throws(() => catalogQueueFixture(type, "unknown"), /Unexpected queue cursor/);
  }
});

test("exact-key browser cases cover mobile and desktop with strict synthetic identity/error fixtures", () => {
  assert.deepEqual(catalogBrowserCases.filter(item => item.kind === "catalog-exact-key").map(item => item.width), [390, 1280]);
  const venue = exactCatalogFixture("venue", catalogExactVenueKey);
  assert.equal(venue.status, 200); assert.equal(venue.body.key, "ticketmaster:rZ7HnEZaeot");
  assert.equal(venue.body.identity.name, "Lee's Palace"); assert.equal(venue.body.identity.city, "Toronto");
  assert.equal(exactCatalogFixture("artist", catalogExactVenueKey).status, 404);
  assert.equal(exactCatalogFixture("venue", "ticketmaster:fixture-missing").status, 404);
  assert.throws(() => exactCatalogFixture("venue", "ticketmaster:rz7hnezaeot"), /Unknown exact/);
  assert.throws(() => exactCatalogFixture("event", catalogExactVenueKey));
});

test("catalog editor isolation distinguishes existing sign-in reads and rejects every later private staff request", () => {
  const bootstrap = ["/api/admin/moderation", "/api/admin/artist-requests"].map(path => ({ path, method: "GET", phase: "bootstrap" }));
  const editor = ["/api/admin/catalog-editor/artist", "/api/admin/catalog-editor/prepare", "/api/admin/catalog-editor/save"]
    .map(path => ({ path, method: path.endsWith("artist") ? "GET" : "POST", phase: "catalog-editor" }));
  assert.doesNotThrow(() => assertCatalogEditorRequestIsolation([...bootstrap, ...editor]));
  for (const path of ["/api/admin/moderation", "/api/admin/artist-requests", "/api/admin/members", "/api/admin/errors", "/api/moderation/news-desk/editor"]) {
    assert.throws(() => assertCatalogEditorRequestIsolation([...bootstrap, ...editor, { path, method: "GET", phase: "catalog-editor" }]), /unrelated private staff data/);
  }
  assert.throws(() => assertCatalogEditorRequestIsolation([...bootstrap, bootstrap[0], ...editor]), /two existing sign-in queue reads/);
  assert.throws(() => assertCatalogEditorRequestIsolation([...bootstrap, { path: "/api/admin/members", method: "GET", phase: "bootstrap" }, ...editor]), /two existing sign-in queue reads/);
});

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
