import assert from "node:assert/strict";
import test from "node:test";

import { staticAssetCacheControl } from "./staticAssetCache.js";

test("only fingerprinted Expo assets receive immutable browser caching", () => {
  assert.equal(
    staticAssetCacheControl("/_expo/static/js/web/index-e2561d5058bbc0d1644cc5b537e83971.js"),
    "public, max-age=31536000, immutable",
  );
  assert.equal(
    staticAssetCacheControl("/assets/assets/pit-favicon-v1.aa909787a4192c1d5ef6fa65c302b57c.png"),
    "public, max-age=31536000, immutable",
  );
  for (const path of ["/logo.svg", "/og.png", "/favicon.ico", "/metadata.json"]) {
    assert.equal(
      staticAssetCacheControl(path),
      "public, max-age=3600, stale-while-revalidate=86400",
      `${path} has a stable URL and must remain refreshable`,
    );
  }
});
