import test from "node:test";
import assert from "node:assert/strict";
import { projectCatalogSeoMaintenanceStatus } from "./catalogSeoMaintenanceStatus.js";

test("moderation SEO status distinguishes published crawl candidates from Google indexing", () => {
  const result = projectCatalogSeoMaintenanceStatus({ available: true, generatedAt: 1800000000000,
    ageMs: 12000, totalUrls: 22, datasetCounts: { artists: 10, venues: 4, events: 8, secret: 1 } }, { env: {} });
  assert.equal(result.state, "ready");
  assert.equal(result.lastBuiltAt, 1800000000000);
  assert.equal(result.ageSeconds, 12);
  assert.equal(result.nextRefreshMinutes, 15);
  assert.equal(result.counts.artists, 10);
  assert.equal(result.counts.secret, undefined);
  assert.equal(result.indexingState, "not_measured");
  assert.equal(result.sitemapUrl, "https://www.mshpit.com/sitemap.xml");
  assert.equal(Object.isFrozen(result.counts), true);
});

test("missing, stale, refreshing and retrying snapshots remain visibly distinct without provider work", () => {
  assert.equal(projectCatalogSeoMaintenanceStatus({}, { env: {} }).state, "pending");
  assert.equal(projectCatalogSeoMaintenanceStatus({}, { env: {} }).lastBuiltAt, null);
  const healthy = { available: true, generatedAt: 1, ageMs: 31 * 60000 };
  assert.equal(projectCatalogSeoMaintenanceStatus(healthy, { env: {} }).state, "stale");
  assert.equal(projectCatalogSeoMaintenanceStatus({ ...healthy, refreshing: true }, { env: {} }).state, "refreshing");
  assert.equal(projectCatalogSeoMaintenanceStatus({ ...healthy, consecutiveFailures: 1 }, { env: {} }).state, "retrying");
  const untrusted = projectCatalogSeoMaintenanceStatus({ datasetCounts: { artists: -1, venues: "500", events: Infinity } },
    { env: { PUBLIC_ORIGIN: "https://password:secret@example.test/", SITEMAP_REFRESH_INTERVAL_MS: "-1" } });
  assert.deepEqual([untrusted.counts.artists, untrusted.counts.venues, untrusted.counts.events], [0, 0, 0]);
  assert.equal(untrusted.sitemapUrl, "https://www.mshpit.com/sitemap.xml");
  assert.equal(untrusted.nextRefreshMinutes, 1);
});
