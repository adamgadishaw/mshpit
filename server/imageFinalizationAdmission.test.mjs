import assert from "node:assert/strict";
import test from "node:test";

import { createImageFinalizationAdmissionController } from "./imageFinalizationAdmission.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function controller(overrides = {}) {
  return createImageFinalizationAdmissionController({
    maxActive: 1,
    maxQueued: 8,
    maxQueuedBytes: 64,
    maxQueuedPerOwner: 8,
    maxActivePerOwner: 1,
    maxQueueWaitMs: 2_000,
    maxTaskMs: 2_000,
    label: "test-image-finalization",
    ...overrides,
  });
}

test("same target and fingerprint coalesce while conflicting settings fail before work", async () => {
  const admission = controller();
  const scope = {};
  const gate = deferred();
  let storageGets = 0;
  const first = admission.run({
    scope,
    ownerId: "user-a",
    baseKey: "asset-1:generation-a",
    fingerprint: "settings-a",
    byteSize: 30,
    task: async () => {
      storageGets += 1;
      await gate.promise;
      return { duplicate: false, value: "ready" };
    },
  });
  const joined = admission.run({
    scope,
    ownerId: "user-a",
    baseKey: "asset-1:generation-a",
    fingerprint: "settings-a",
    byteSize: 30,
    task: async () => {
      storageGets += 100;
      return { duplicate: false, value: "wrong" };
    },
    onJoin: (value) => ({ ...value, duplicate: true }),
  });
  await assert.rejects(
    admission.run({
      scope,
      ownerId: "user-a",
      baseKey: "asset-1:generation-a",
      fingerprint: "settings-b",
      byteSize: 30,
      task: async () => {
        storageGets += 1_000;
      },
    }),
    (error) => error?.status === 409 && error?.code === "CONFLICT",
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(storageGets, 1);
  gate.resolve();
  assert.deepEqual(await first, { duplicate: false, value: "ready" });
  assert.deepEqual(await joined, { duplicate: true, value: "ready" });
  assert.equal(storageGets, 1);
});

test("queued byte rejection invokes zero storage work and retains no rejected reservation", async () => {
  const admission = controller({
    maxQueued: 1,
    maxQueuedBytes: 10,
    maxQueuedPerOwner: 1,
  });
  const scope = {};
  const activeGate = deferred();
  const queuedGate = deferred();
  let rejectedStorageGets = 0;
  const active = admission.run({
    scope,
    ownerId: "user-a",
    baseKey: "active",
    fingerprint: "same",
    byteSize: 30,
    task: () => activeGate.promise,
  });
  const queued = admission.run({
    scope,
    ownerId: "user-b",
    baseKey: "queued",
    fingerprint: "same",
    byteSize: 10,
    task: () => queuedGate.promise,
  });
  assert.deepEqual(admission.health(), {
    active: 1,
    queued: 1,
    queuedBytes: 10,
    maxActive: 1,
    maxQueued: 1,
    maxQueuedBytes: 10,
    maxQueuedPerOwner: 1,
    maxActivePerOwner: 1,
    maxQueueWaitMs: 2_000,
    maxTaskMs: 2_000,
  });
  await assert.rejects(
    admission.run({
      scope,
      ownerId: "user-c",
      baseKey: "rejected",
      fingerprint: "same",
      byteSize: 1,
      task: async () => {
        rejectedStorageGets += 1;
      },
    }),
    (error) => error?.status === 503 && error?.code === "MEDIA_STORAGE_UNAVAILABLE",
  );
  assert.equal(rejectedStorageGets, 0);
  assert.equal(admission.health().queued, 1);
  assert.equal(admission.health().queuedBytes, 10);
  activeGate.resolve("active");
  assert.equal(await active, "active");
  queuedGate.resolve("queued");
  assert.equal(await queued, "queued");
  assert.equal(admission.health().active, 0);
  assert.equal(admission.health().queued, 0);
  assert.equal(admission.health().queuedBytes, 0);
});

test("owner queues are round-robin and do not let an album monopolize the next slot", async () => {
  const admission = controller();
  const scope = {};
  const gates = [deferred(), deferred(), deferred(), deferred()];
  const order = [];
  const run = (ownerId, baseKey, gate) => admission.run({
    scope,
    ownerId,
    baseKey,
    fingerprint: "same",
    byteSize: 1,
    task: async () => {
      order.push(baseKey);
      await gate.promise;
      return baseKey;
    },
  });
  const a1 = run("user-a", "a1", gates[0]);
  const a2 = run("user-a", "a2", gates[1]);
  const a3 = run("user-a", "a3", gates[2]);
  const b1 = run("user-b", "b1", gates[3]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["a1"]);
  gates[0].resolve();
  await a1;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["a1", "a2"]);
  gates[1].resolve();
  await a2;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["a1", "a2", "b1"]);
  gates[3].resolve();
  await b1;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ["a1", "a2", "b1", "a3"]);
  gates[2].resolve();
  await a3;
});

test("a sole aborted queued waiter is removed before storage work", async () => {
  const admission = controller();
  const scope = {};
  const gate = deferred();
  let queuedStorageGets = 0;
  const active = admission.run({
    scope,
    ownerId: "user-a",
    baseKey: "active",
    fingerprint: "same",
    task: () => gate.promise,
  });
  const abortController = new AbortController();
  const queued = admission.run({
    scope,
    ownerId: "user-b",
    baseKey: "queued",
    fingerprint: "same",
    signal: abortController.signal,
    task: async () => {
      queuedStorageGets += 1;
    },
  });
  abortController.abort(new Error("caller disconnected"));
  await assert.rejects(queued, /caller disconnected/);
  assert.equal(queuedStorageGets, 0);
  assert.equal(admission.health().queued, 0);
  gate.resolve();
  await active;
});

test("queue and active deadlines clean admission state and permit a retry", async () => {
  const admission = controller({
    maxQueueWaitMs: 40,
    maxTaskMs: 80,
  });
  const scope = {};
  const active = admission.run({
    scope,
    ownerId: "user-a",
    baseKey: "hung",
    fingerprint: "same",
    task: ({ signal }) => new Promise((resolve, reject) => {
      void resolve;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  });
  let queuedStorageGets = 0;
  const queued = admission.run({
    scope,
    ownerId: "user-b",
    baseKey: "waiting",
    fingerprint: "same",
    task: async () => {
      queuedStorageGets += 1;
    },
  });
  await assert.rejects(
    queued,
    (error) => error?.status === 503 && error?.code === "MEDIA_STORAGE_UNAVAILABLE",
  );
  assert.equal(queuedStorageGets, 0);
  await assert.rejects(
    active,
    (error) => error?.status === 503 && error?.code === "MEDIA_STORAGE_UNAVAILABLE",
  );
  assert.equal(admission.health().active, 0);
  assert.equal(admission.health().queued, 0);
  const retried = await admission.run({
    scope,
    ownerId: "user-a",
    baseKey: "hung",
    fingerprint: "same",
    task: async () => "recovered",
  });
  assert.equal(retried, "recovered");
});

test("twenty maximum-size album entries fit the preflight-style metadata queue", async () => {
  const maxPhotoBytes = 30 * 1024 * 1024;
  const admission = controller({
    maxQueued: 19,
    maxQueuedBytes: 19 * maxPhotoBytes,
    maxQueuedPerOwner: 19,
  });
  const scope = {};
  const firstGate = deferred();
  let started = 0;
  const jobs = Array.from({ length: 20 }, (_, index) => admission.run({
    scope,
    ownerId: "album-owner",
    baseKey: `photo-${index}`,
    fingerprint: "same",
    byteSize: maxPhotoBytes,
    task: async () => {
      started += 1;
      if (index === 0) await firstGate.promise;
      return index;
    },
  }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, 1);
  assert.equal(admission.health().queued, 19);
  assert.equal(admission.health().queuedBytes, 19 * maxPhotoBytes);
  firstGate.resolve();
  assert.deepEqual(await Promise.all(jobs), Array.from({ length: 20 }, (_, index) => index));
  assert.equal(admission.health().active, 0);
  assert.equal(admission.health().queued, 0);
});
