import test from "node:test";
import assert from "node:assert/strict";
import {
  createRecommendationPreferenceCoordinator,
  recommendationPreferenceMutationKey,
} from "./recommendationPreferenceMutation.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const flushTasks = () => new Promise((resolve) => setImmediate(resolve));

test("preference mutation keys isolate accounts and posts", () => {
  assert.notEqual(
    recommendationPreferenceMutationKey("account-a", "post-1"),
    recommendationPreferenceMutationKey("account-b", "post-1"),
  );
  assert.notEqual(
    recommendationPreferenceMutationKey("account-a", "post-1"),
    recommendationPreferenceMutationKey("account-a", "post-2"),
  );
});

test("Undo cannot overtake an in-flight Not-for-me write", async () => {
  const coordinator = createRecommendationPreferenceCoordinator();
  const gate = deferred();
  const events = [];
  const key = recommendationPreferenceMutationKey("account-a", "post-1");

  const hide = coordinator.hide(key, async () => {
    events.push("POST:start");
    await gate.promise;
    events.push("POST:end");
    return { ok: true };
  });
  const undo = coordinator.undo(key, async () => {
    events.push("DELETE:start");
    return { ok: true };
  });

  await flushTasks();
  assert.deepEqual(events, ["POST:start"]);
  gate.resolve();
  await Promise.all([hide.promise, undo.promise]);
  assert.deepEqual(events, ["POST:start", "POST:end", "DELETE:start"]);
});

test("Undo is a successful no-op when the preceding hide failed", async () => {
  const coordinator = createRecommendationPreferenceCoordinator();
  const gate = deferred();
  const key = recommendationPreferenceMutationKey("account-a", "post-1");
  let deletes = 0;

  const hide = coordinator.hide(key, () => gate.promise);
  const undo = coordinator.undo(key, async () => {
    deletes += 1;
    return { ok: true };
  });

  gate.reject(new Error("offline"));
  await assert.rejects(hide.promise, /offline/);
  assert.deepEqual(await undo.promise, { ok: true, skipped: true, reason: "hide_failed" });
  assert.equal(deletes, 0);
});

test("only the latest optimistic intent may roll back UI state", async () => {
  const coordinator = createRecommendationPreferenceCoordinator();
  const key = recommendationPreferenceMutationKey("account-a", "post-1");
  const gate = deferred();
  const hide = coordinator.hide(key, () => gate.promise);
  const undo = coordinator.undo(key, async () => ({ ok: true }));

  assert.equal(coordinator.isCurrent(hide), false);
  assert.equal(coordinator.isCurrent(undo), true);
  gate.resolve({ ok: true });
  await Promise.all([hide.promise, undo.promise]);
});

test("different posts are not unnecessarily serialized", async () => {
  const coordinator = createRecommendationPreferenceCoordinator();
  const firstGate = deferred();
  const events = [];
  const first = coordinator.hide(recommendationPreferenceMutationKey("account-a", "post-1"), async () => {
    events.push("first");
    await firstGate.promise;
  });
  const second = coordinator.hide(recommendationPreferenceMutationKey("account-a", "post-2"), async () => {
    events.push("second");
  });

  await flushTasks();
  assert.deepEqual(events, ["first", "second"]);
  firstGate.resolve();
  await Promise.all([first.promise, second.promise]);
});
