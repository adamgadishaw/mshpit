import assert from "node:assert/strict";
import test from "node:test";

import { persistedStackPolicy, shouldRestorePersistedStack } from "./browserNavigation.mjs";

test("the home URL never resurrects a persisted entity screen", () => {
  assert.deepEqual(persistedStackPolicy("/"), { restore: false, reason: "home" });
  assert.equal(shouldRestorePersistedStack("/?from=search"), false);
});

test("public entity URLs are authoritative over persisted navigation", () => {
  for (const path of [
    "/artist/j-cole",
    "/venue/history-toronto",
    "/u/pitfan",
    "/post/post_123",
    "/event/provider_123",
    "/concert/archive_123",
    "/turnstile",
  ]) {
    assert.deepEqual(persistedStackPolicy(path), { restore: false, reason: "public-entity" }, path);
  }
});

test("other explicit browser paths also reject unrelated persisted overlays", () => {
  assert.deepEqual(persistedStackPolicy("/settings"), { restore: false, reason: "browser-path" });
  assert.equal(shouldRestorePersistedStack("/privacy"), false);
  assert.deepEqual(persistedStackPolicy(null), { restore: true, reason: "no-browser-path" });
});
