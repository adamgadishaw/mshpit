import assert from "node:assert/strict";
import test from "node:test";

import { staticAssetCacheControl } from "./staticAssetCache.js";

test("only fingerprinted Expo assets receive immutable browser caching", () => {
  assert.equal(
    staticAssetCacheControl("/_expo/static/js/web/index-e2561d5058bbc0d1644cc5b537e83971.js"),
    "public, max-age=31536000, immutable",
  );
  assert.equal(
    staticAssetCacheControl("/assets/assets/pit-favicon-v2.aa909787a4192c1d5ef6fa65c302b57c.png"),
    "public, max-age=31536000, immutable",
  );
  for (const path of ["/logo.svg", "/og.png", "/favicon.ico", "/metadata.json", "/mshpit-web-boot-v1.js"]) {
    assert.equal(
      staticAssetCacheControl(path),
      "public, max-age=3600, stale-while-revalidate=86400",
      `${path} has a stable URL and must remain refreshable`,
    );
  }
});

test("stable map modules, worker, stylesheet and catalogue revalidate without changing neighboring assets", () => {
  for (const path of [
    "/mshpit-maplibre/renderer.mjs", "/mshpit-maplibre/cluster-model.mjs",
    "/mshpit-maplibre/maplibre-gl-worker.mjs", "/mshpit-maplibre/card.css",
    "/mshpit-maplibre/venue-catalogue.json",
  ]) assert.equal(staticAssetCacheControl(path), "no-cache", path);
  for (const path of ["/mshpit-maplibre-other/renderer.mjs", "/renderer.mjs", "/assets/maplibre/card.css"]) {
    assert.equal(staticAssetCacheControl(path), "public, max-age=3600, stale-while-revalidate=86400", path);
  }
});
