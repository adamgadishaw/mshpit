import { ApiError } from "./errors.js";

export const IMAGE_FINALIZATION_PREFLIGHT_TOKEN = Symbol("image-finalization-preflight");
export const IMAGE_FINALIZATION_GENERATION_TOKEN = Symbol("image-finalization-generation");

export const IMAGE_FINALIZATION_LIMITS = Object.freeze({
  preflightActive: 4,
  preflightQueued: 64,
  preflightQueuedBytes: 600 * 1024 * 1024,
  preflightQueuedPerOwner: 20,
  generationActive: 1,
  generationQueued: 24,
  generationQueuedBytes: 128 * 1024 * 1024,
});

function busyError() {
  return new ApiError(
    503,
    "Photo verification is at capacity. Your upload is safe; retry shortly.",
    "MEDIA_STORAGE_UNAVAILABLE",
  );
}

function conflictError() {
  return new ApiError(
    409,
    "That photo is already being finalized with different settings.",
    "CONFLICT",
  );
}

function positiveLimit(value, label, { allowZero = false } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1)) {
    throw new TypeError(`${label} must be a ${allowZero ? "non-negative" : "positive"} safe integer.`);
  }
  return number;
}

export function createImageFinalizationAdmissionController({
  maxActive,
  maxQueued,
  maxQueuedBytes,
  maxQueuedPerOwner,
  maxActivePerOwner = 1,
  maxQueueWaitMs = 90_000,
  maxTaskMs = 5 * 60_000,
  label = "image-finalization",
} = {}) {
  const activeLimit = positiveLimit(maxActive, "maxActive");
  const queuedLimit = positiveLimit(maxQueued, "maxQueued", { allowZero: true });
  const queuedByteLimit = positiveLimit(maxQueuedBytes, "maxQueuedBytes", { allowZero: true });
  const ownerQueuedLimit = positiveLimit(maxQueuedPerOwner ?? maxQueued, "maxQueuedPerOwner", { allowZero: true });
  const ownerActiveLimit = positiveLimit(maxActivePerOwner, "maxActivePerOwner");
  const queueWaitLimitMs = positiveLimit(maxQueueWaitMs, "maxQueueWaitMs");
  const taskLimitMs = positiveLimit(maxTaskMs, "maxTaskMs");
  const inFlightByScope = new WeakMap();
  const scopeIds = new WeakMap();
  const ownerQueues = new Map();
  const ownerOrder = [];
  const activeByOwner = new Map();
  let nextScopeId = 1;
  let active = 0;
  let queued = 0;
  let queuedBytes = 0;

  function scopeId(scope) {
    if ((!scope || typeof scope !== "object") && typeof scope !== "function") {
      throw new TypeError(`${label} scope must be an object.`);
    }
    let id = scopeIds.get(scope);
    if (!id) {
      id = nextScopeId;
      nextScopeId += 1;
      scopeIds.set(scope, id);
    }
    return id;
  }

  function scopedFlights(scope) {
    let flights = inFlightByScope.get(scope);
    if (!flights) {
      flights = new Map();
      inFlightByScope.set(scope, flights);
    }
    return flights;
  }

  function canStart(ownerKey) {
    return active < activeLimit && Number(activeByOwner.get(ownerKey) || 0) < ownerActiveLimit;
  }

  function removeFlight(entry) {
    const flights = inFlightByScope.get(entry.scope);
    if (flights?.get(entry.baseKey) !== entry) return;
    flights.delete(entry.baseKey);
    if (!flights.size) inFlightByScope.delete(entry.scope);
  }

  function removeOwnerOrder(ownerKey) {
    const index = ownerOrder.indexOf(ownerKey);
    if (index >= 0) ownerOrder.splice(index, 1);
  }

  function cancelQueued(entry, error) {
    if (entry.state !== "queued") return false;
    const queue = ownerQueues.get(entry.ownerKey);
    const index = queue?.indexOf(entry) ?? -1;
    if (index < 0) return false;
    queue.splice(index, 1);
    queued -= 1;
    queuedBytes -= entry.byteSize;
    clearTimeout(entry.queueTimer);
    if (!queue.length) {
      ownerQueues.delete(entry.ownerKey);
      removeOwnerOrder(entry.ownerKey);
    }
    entry.state = "settled";
    removeFlight(entry);
    entry.reject(error);
    drain();
    return true;
  }

  function dequeueStartable() {
    const attempts = ownerOrder.length;
    for (let index = 0; index < attempts; index += 1) {
      const ownerKey = ownerOrder.shift();
      const queue = ownerQueues.get(ownerKey);
      if (!queue?.length) {
        ownerQueues.delete(ownerKey);
        continue;
      }
      if (!canStart(ownerKey)) {
        ownerOrder.push(ownerKey);
        continue;
      }
      const entry = queue.shift();
      queued -= 1;
      queuedBytes -= entry.byteSize;
      clearTimeout(entry.queueTimer);
      if (queue.length) ownerOrder.push(ownerKey);
      else ownerQueues.delete(ownerKey);
      return entry;
    }
    return null;
  }

  function drain() {
    while (active < activeLimit) {
      const entry = dequeueStartable();
      if (!entry) break;
      start(entry);
    }
  }

  function settle(entry) {
    if (entry.state !== "active") return;
    entry.state = "settled";
    clearTimeout(entry.taskTimer);
    removeFlight(entry);
    active -= 1;
    const ownerActive = Number(activeByOwner.get(entry.ownerKey) || 1) - 1;
    if (ownerActive > 0) activeByOwner.set(entry.ownerKey, ownerActive);
    else activeByOwner.delete(entry.ownerKey);
    drain();
  }

  function start(entry) {
    entry.state = "active";
    active += 1;
    activeByOwner.set(entry.ownerKey, Number(activeByOwner.get(entry.ownerKey) || 0) + 1);
    const controller = new AbortController();
    entry.controller = controller;
    const timeoutError = new ApiError(
      503,
      "Photo verification timed out. Your upload is safe; retry shortly.",
      "MEDIA_STORAGE_UNAVAILABLE",
    );
    const taskPromise = Promise.resolve().then(() => entry.task({ signal: controller.signal }));
    // architecture: allow-empty-catch -- Promise.race observes leader failures; this late observer prevents a post-timeout rejection without retaining errors or media buffers.
    taskPromise.catch(() => {});
    const timeoutPromise = new Promise((resolve, reject) => {
      void resolve;
      entry.taskTimer = setTimeout(() => {
        controller.abort(timeoutError);
        reject(timeoutError);
      }, taskLimitMs);
      entry.taskTimer.unref?.();
    });
    Promise.race([taskPromise, timeoutPromise])
      .then(entry.resolve, entry.reject)
      .finally(() => settle(entry));
  }

  function enqueue(entry) {
    const queue = ownerQueues.get(entry.ownerKey) || [];
    if (queued >= queuedLimit
        || queue.length >= ownerQueuedLimit
        || entry.byteSize > queuedByteLimit - queuedBytes) {
      return false;
    }
    if (!queue.length) ownerOrder.push(entry.ownerKey);
    entry.state = "queued";
    entry.queueTimer = setTimeout(() => {
      cancelQueued(entry, new ApiError(
        503,
        "Photo verification did not start in time. Your upload is safe; retry shortly.",
        "MEDIA_STORAGE_UNAVAILABLE",
      ));
    }, queueWaitLimitMs);
    entry.queueTimer.unref?.();
    queue.push(entry);
    ownerQueues.set(entry.ownerKey, queue);
    queued += 1;
    queuedBytes += entry.byteSize;
    return true;
  }

  function waiterAbortError(signal) {
    if (signal?.reason instanceof Error) return signal.reason;
    const error = new Error("Photo verification wait was cancelled.");
    error.name = "AbortError";
    return error;
  }

  function waitForEntry(entry, { signal, onJoin, joined }) {
    entry.waiters += 1;
    const output = joined && typeof onJoin === "function" ? entry.promise.then(onJoin) : entry.promise;
    if (!signal) {
      return output.finally(() => {
        entry.waiters = Math.max(0, entry.waiters - 1);
      });
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener?.("abort", abort);
        entry.waiters = Math.max(0, entry.waiters - 1);
        callback(value);
      };
      const abort = () => {
        finish(reject, waiterAbortError(signal));
        if (entry.state === "queued" && entry.waiters === 0) {
          cancelQueued(entry, waiterAbortError(signal));
        }
      };
      signal.addEventListener?.("abort", abort, { once: true });
      output.then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error),
      );
      if (signal.aborted) abort();
    });
  }

  function run({
    scope,
    ownerId,
    baseKey,
    fingerprint,
    byteSize = 0,
    task,
    onJoin,
    signal,
  } = {}) {
    const owner = String(ownerId || "");
    const key = String(baseKey || "");
    const operationFingerprint = String(fingerprint || "");
    const bytes = Number(byteSize);
    if (!owner || !key || !operationFingerprint || typeof task !== "function"
        || !Number.isSafeInteger(bytes) || bytes < 0) {
      return Promise.reject(new TypeError(`${label} admission request is invalid.`));
    }
    const flights = scopedFlights(scope);
    const flightKey = `${owner}\u0000${key}`;
    const existing = flights.get(flightKey);
    if (existing) {
      if (existing.fingerprint !== operationFingerprint) return Promise.reject(conflictError());
      return waitForEntry(existing, { signal, onJoin, joined: true });
    }

    const ownerKey = `${scopeId(scope)}\u0000${owner}`;
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const entry = {
      scope,
      ownerKey,
      baseKey: flightKey,
      fingerprint: operationFingerprint,
      byteSize: bytes,
      task,
      promise,
      resolve,
      reject,
      waiters: 0,
      state: "new",
      queueTimer: null,
      taskTimer: null,
      controller: null,
    };
    if (!canStart(ownerKey) && !enqueue(entry)) return Promise.reject(busyError());
    flights.set(flightKey, entry);
    if (entry.state === "new") start(entry);
    return waitForEntry(entry, { signal, onJoin, joined: false });
  }

  function health() {
    return Object.freeze({
      active,
      queued,
      queuedBytes,
      maxActive: activeLimit,
      maxQueued: queuedLimit,
      maxQueuedBytes: queuedByteLimit,
      maxQueuedPerOwner: ownerQueuedLimit,
      maxActivePerOwner: ownerActiveLimit,
      maxQueueWaitMs: queueWaitLimitMs,
      maxTaskMs: taskLimitMs,
    });
  }

  return Object.freeze({ run, health });
}

const preflightController = createImageFinalizationAdmissionController({
  maxActive: IMAGE_FINALIZATION_LIMITS.preflightActive,
  maxQueued: IMAGE_FINALIZATION_LIMITS.preflightQueued,
  maxQueuedBytes: IMAGE_FINALIZATION_LIMITS.preflightQueuedBytes,
  maxQueuedPerOwner: IMAGE_FINALIZATION_LIMITS.preflightQueuedPerOwner,
  maxActivePerOwner: 1,
  label: "image-finalization-preflight",
});

const generationController = createImageFinalizationAdmissionController({
  maxActive: IMAGE_FINALIZATION_LIMITS.generationActive,
  maxQueued: IMAGE_FINALIZATION_LIMITS.generationQueued,
  maxQueuedBytes: IMAGE_FINALIZATION_LIMITS.generationQueuedBytes,
  maxQueuedPerOwner: IMAGE_FINALIZATION_LIMITS.generationQueued,
  maxActivePerOwner: 1,
  label: "image-finalization-generation",
});

export function runImageFinalizationPreflight(options) {
  return preflightController.run(options);
}

export function runImageFinalizationGeneration(options) {
  return generationController.run(options);
}

export function imageFinalizationAdmissionHealth() {
  return Object.freeze({
    preflight: preflightController.health(),
    generation: generationController.health(),
  });
}
