import assert from "node:assert/strict";
import test from "node:test";

import {
  beginLoadState,
  createLoadState,
  isLoadCancellation,
  projectLoadState,
  rejectLoadState,
  resolveLoadState,
} from "./loadState.mjs";

function appError() {
  const error = new Error("Try again");
  error.name = "AppError";
  error.code = "PIT-NET-001";
  error.retryable = true;
  return error;
}

test("a scope change projects empty loading data before effects run", () => {
  const accountA = resolveLoadState({
    scope: '["account-a","discovery:Toronto"]',
    data: [{ id: "a-private-row" }],
    updatedAt: 100,
  });
  const accountB = projectLoadState(accountA, '["account-b","discovery:Toronto"]', []);
  const guest = projectLoadState(accountA, '["","discovery:Toronto"]', []);

  assert.deepEqual(accountB, {
    scope: '["account-b","discovery:Toronto"]',
    status: "loading",
    data: [],
    error: null,
    updatedAt: null,
  });
  assert.deepEqual(guest.data, []);
  assert.equal(accountB.data.some((row) => row.id === "a-private-row"), false);
});

test("same-scope refresh may retain authorized data while a new scope may not", () => {
  const ready = resolveLoadState({ scope: "account-a", data: [1], updatedAt: 50 });
  assert.deepEqual(beginLoadState(ready, { scope: "account-a", emptyData: [] }), {
    scope: "account-a",
    status: "refreshing",
    data: [1],
    error: null,
    updatedAt: 50,
  });
  assert.deepEqual(beginLoadState(ready, { scope: "account-b", emptyData: [] }).data, []);
});

test("ready and error transitions keep the canonical resource shape", () => {
  const error = appError();
  const ready = resolveLoadState({ scope: "account-a", data: [1], updatedAt: 50 });
  const failed = rejectLoadState(ready, { scope: "account-a", error, emptyData: [] });

  assert.equal(failed.status, "error");
  assert.deepEqual(failed.data, [1]);
  assert.equal(failed.updatedAt, 50);
  assert.equal(failed.error, error);
  assert.throws(
    () => createLoadState({ scope: "account-a", status: "error", error: new Error("raw") }),
    /requires an AppError/,
  );
});

test("caller cancellation remains control flow instead of a failed resource", () => {
  const cancelled = Object.assign(new Error("screen left"), { name: "AbortError" });
  const controller = new AbortController();
  controller.abort();

  assert.equal(isLoadCancellation(cancelled), true);
  assert.equal(isLoadCancellation(new Error("custom reason"), controller.signal), true);
  assert.equal(isLoadCancellation(appError()), false);
  assert.throws(
    () => rejectLoadState(null, { scope: "account-a", error: cancelled, emptyData: [] }),
    /Cancelled reads must not become an error LoadState/,
  );
});
