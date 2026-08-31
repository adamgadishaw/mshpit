import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  projectDiscoveryCatalogTotals,
  resolveDiscoveryCatalogTotal,
} from "./discoveryCatalogTotals.mjs";

test("discovery catalog totals preserve real zeroes and reject malformed counts", () => {
  assert.deepEqual(projectDiscoveryCatalogTotals({ artists: 30_158, venues: 5_346 }), {
    artists: 30_158,
    venues: 5_346,
  });
  assert.deepEqual(projectDiscoveryCatalogTotals({ artists: 0, venues: "12" }), {
    artists: 0,
    venues: 12,
  });
  assert.deepEqual(projectDiscoveryCatalogTotals({ artists: -1, venues: 3.5 }), null);
  assert.equal(projectDiscoveryCatalogTotals(null), null);
  assert.equal(resolveDiscoveryCatalogTotal(0, 112), 0);
  assert.equal(resolveDiscoveryCatalogTotal("bad", 112), 112);
});

test("the existing discovery request owns the server-to-Store catalog-total projection", () => {
  const server = readFileSync(new URL("../../server/discovery.js", import.meta.url), "utf8");
  const store = readFileSync(new URL("../store.js", import.meta.url), "utf8");

  assert.match(server, /catalogTotals:\s*catalogTotals\(\{ at: timestamp \}\)/);
  assert.match(store, /catalogTotals:\s*projectDiscoveryCatalogTotals\(data\?\.catalogTotals\)/);
  assert.match(store, /resolveDiscoveryCatalogTotal\(discoverySidebar\?\.catalogTotals\?\.artists/);
  assert.match(store, /resolveDiscoveryCatalogTotal\([\s\S]*discoverySidebar\?\.catalogTotals\?\.venues/);
});
