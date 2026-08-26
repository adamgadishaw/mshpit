import assert from "node:assert/strict";
import test from "node:test";
import { sitemapIndexXml, urlsetParts } from "../server/features/seo/sitemapService.js";
import { formatSeoInventory, inventoryFromSitemapSnapshot } from "./seo-inventory.mjs";

const ORIGIN = "https://www.example.com";

function snapshot({ duplicate = false, claimedTotal = null } = {}) {
  const paths = ["/sitemaps/pages.xml", "/sitemaps/cities.xml"];
  const documents = {
    "/sitemap.xml": sitemapIndexXml({ PUBLIC_ORIGIN: ORIGIN }, paths),
    "/sitemaps/pages.xml": urlsetParts([
      { path: "/" },
      { path: "/artists" },
      { path: "/artist/example/concerts" },
    ], ORIGIN)[0],
    "/sitemaps/cities.xml": urlsetParts([
      { path: duplicate ? "/artists" : "/concerts/ca/toronto" },
    ], ORIGIN)[0],
  };
  return {
    generatedAt: 1_725_000_000_000,
    paths,
    stats: {
      totalUrls: claimedTotal ?? 4,
      sourceCounts: { posts: 12, tourDates: 20, upcomingEvents: 8 },
    },
    xmlFor(pathname) { return documents[pathname] || null; },
  };
}

test("runtime SEO inventory reports aggregate completeness, route classes, scale, and no identifiers", () => {
  const inventory = inventoryFromSitemapSnapshot(snapshot(), {
    durationMs: 12.7,
    rssDeltaBytes: 4_096,
  });
  assert.equal(inventory.ok, true);
  assert.equal(inventory.totalUrls, 4);
  assert.equal(inventory.uniqueUrls, 4);
  assert.equal(inventory.shardCount, 2);
  assert.deepEqual(inventory.datasetCounts, { pages: 3, cities: 1 });
  assert.deepEqual(inventory.routeCounts, {
    home: 1,
    directories: 1,
    "artist-archives": 1,
    "city-directories": 1,
  });
  assert.deepEqual(inventory.sourceCounts, { posts: 12, tourDates: 20, upcomingEvents: 8 });
  assert.equal(inventory.durationMs, 13);
  assert.equal(inventory.rssDeltaBytes, 4_096);
  const output = formatSeoInventory(inventory);
  assert.match(output, /SEO inventory: PASS/);
  assert.doesNotMatch(output, /example\.com|\/artist\/example|\/concerts\/ca\/toronto/);
});

test("runtime SEO inventory fails duplicate canonicals and snapshot count drift", () => {
  const inventory = inventoryFromSitemapSnapshot(snapshot({ duplicate: true, claimedTotal: 99 }));
  assert.equal(inventory.ok, false);
  assert.equal(inventory.totalUrls, 4);
  assert.equal(inventory.uniqueUrls, 3);
  assert.equal(inventory.duplicateUrls, 1);
  assert.deepEqual([...inventory.problems].sort(), [
    "DUPLICATE_CANONICAL_URL",
    "SNAPSHOT_COUNT_MISMATCH",
  ]);
});
