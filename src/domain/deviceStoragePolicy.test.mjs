import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  isDisposableDeviceCacheKey,
  shouldToastDeviceStorageFailure,
  writeWebStorageWithQuotaRecovery,
} from "./deviceStoragePolicy.mjs";

function quotaError() {
  const error = new Error("quota full");
  error.name = "QuotaExceededError";
  error.code = 22;
  return error;
}

function quotaStorage(entries) {
  const values = new Map(entries);
  let writes = 0;
  let failFirstWrite = true;
  return {
    values,
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) {
      writes += 1;
      if (failFirstWrite) {
        failFirstWrite = false;
        throw quotaError();
      }
      values.set(key, value);
    },
    writes: () => writes,
  };
}

test("quota recovery evicts only server-recoverable caches and retries once", () => {
  const storage = quotaStorage([
    ["pit.tourDates", "large catalogue"],
    ["pit.feed.v2.user-a", "feed cache"],
    ["pit.drafts", "unfinished review"],
    ["pit.recentSearches.user.user-a", "preference"],
  ]);

  const result = writeWebStorageWithQuotaRecovery(storage, "pit.drafts", "updated draft");
  assert.equal(result.recovered, true);
  assert.deepEqual(new Set(result.evicted), new Set(["pit.tourDates", "pit.feed.v2.user-a"]));
  assert.equal(storage.writes(), 2, "one initial write plus exactly one retry");
  assert.equal(storage.values.get("pit.drafts"), "updated draft");
  assert.equal(storage.values.get("pit.recentSearches.user.user-a"), "preference");
});

test("quota recovery never loops after its single retry", () => {
  const values = new Map([
    ["pit.tourDates", "large catalogue"],
    ["pit.drafts", "unfinished review"],
  ]);
  let writes = 0;
  const storage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem() { writes += 1; throw quotaError(); },
  };
  assert.throws(() => writeWebStorageWithQuotaRecovery(storage, "pit.drafts", "updated"), /quota full/);
  assert.equal(writes, 2);
  assert.equal(values.get("pit.drafts"), "unfinished review", "authored state is never evicted");
});

test("non-quota storage failures neither evict nor retry", () => {
  const values = new Map([["pit.tourDates", "catalogue"]]);
  let writes = 0;
  const storage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem() { writes += 1; throw new Error("storage disabled"); },
  };
  assert.throws(() => writeWebStorageWithQuotaRecovery(storage, "pit.drafts", "draft"), /storage disabled/);
  assert.equal(writes, 1);
  assert.equal(values.has("pit.tourDates"), true);
});

test("only failed device-authored recovery state warrants an interruption", () => {
  assert.equal(isDisposableDeviceCacheKey("pit.tourDates"), true);
  assert.equal(isDisposableDeviceCacheKey("pit.artistProfiles.v2.user-a"), true);
  assert.equal(isDisposableDeviceCacheKey("pit.drafts"), false);
  assert.equal(shouldToastDeviceStorageFailure({ operation: "write", key: "pit.tourDates" }), false);
  assert.equal(shouldToastDeviceStorageFailure({ operation: "write", key: "pit.feed.v2.user-a" }), false);
  assert.equal(shouldToastDeviceStorageFailure({ operation: "read", key: "pit.drafts" }), false);
  assert.equal(shouldToastDeviceStorageFailure({ operation: "write", key: "pit.drafts" }), true);
  assert.equal(shouldToastDeviceStorageFailure({ operation: "remove", key: "pit.activeComposer" }), true);
});

test("web persistence and diagnostics use the quota and interruption policies", () => {
  const web = readFileSync(new URL("../lib/persist.web.js", import.meta.url), "utf8");
  const diagnostics = readFileSync(new URL("../lib/diagnostics.js", import.meta.url), "utf8");
  const store = readFileSync(new URL("../store.js", import.meta.url), "utf8");
  assert.match(web, /writeWebStorageWithQuotaRecovery\(storage, key, value\)/);
  assert.match(diagnostics, /toast:\s*shouldToastDeviceStorageFailure\(\{ operation, key \}\)/);
  assert.match(store, /save\("pit\.tourDates", persistedTourDateCache\(tourDates/);
  assert.match(store, /tourDatesRef\.current = next;\s*setTourDates\(next\);/s,
    "the complete server response remains in runtime state");
});
