import { readFileSync } from "node:fs";
import { totalmem } from "node:os";

const MIB = 1024 * 1024;
// Admission estimates include native decoder memory, not just the V8 heap.
// These are reservations, not a claim that Node can enforce a hard RSS cap.
export const MEMORY_WORK_BYTES = Object.freeze({ image: 768 * MIB, share: 384 * MIB,
  sitemap: 256 * MIB, background: 128 * MIB });

function positiveBytes(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number < 2 ** 50 ? number : null;
}

export function createMemoryReader({ read = readFileSync, platform = process.platform,
  memoryUsage = () => process.memoryUsage(), constrainedMemory = () => process.constrainedMemory?.(),
  availableMemory = () => process.availableMemory?.(), totalMemory = totalmem, env = process.env } = {}) {
  const readNumber = (path) => {
    try { return positiveBytes(String(read(path, "utf8")).trim()); }
    catch { return null; } // Missing cgroup files are normal outside Linux containers.
  };
  return () => {
    const memory = memoryUsage();
    const rssBytes = positiveBytes(memory.rss) || 0;
    let limitBytes = positiveBytes(constrainedMemory());
    let usedBytes = rssBytes;
    let source = "process";
    if (platform === "linux") {
      for (const [limitPath, usagePath] of [
        ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.current"],
        ["/sys/fs/cgroup/memory/memory.limit_in_bytes", "/sys/fs/cgroup/memory/memory.usage_in_bytes"],
      ]) {
        const limit = readNumber(limitPath);
        const usage = readNumber(usagePath);
        if (limit && usage && (!limitBytes || limit <= limitBytes)) {
          limitBytes = Math.min(limitBytes || limit, limit);
          usedBytes = Math.max(rssBytes, usage);
          source = "container";
          break;
        }
      }
    }
    if (source !== "container" && limitBytes) {
      const available = Number(availableMemory());
      if (Number.isFinite(available) && available >= 0 && available <= limitBytes) {
        usedBytes = Math.max(rssBytes, limitBytes - available);
        source = "constrained";
      }
    }
    const configuredMb = Number(env.PIT_MEMORY_LIMIT_MB);
    const configured = Number.isSafeInteger(configuredMb) && configuredMb >= 256
      && configuredMb <= 1_048_576 ? configuredMb * MIB : null;
    limitBytes = Math.min(limitBytes || Infinity, configured || Infinity,
      positiveBytes(totalMemory()) || Infinity);
    return Object.freeze({ limitBytes: Number.isFinite(limitBytes) ? limitBytes : null,
      usedBytes, rssBytes, heapUsedBytes: positiveBytes(memory.heapUsed) || 0,
      externalBytes: positiveBytes(memory.external) || 0, source });
  };
}

export function createMemoryAdmission({ readMemory = createMemoryReader(),
  workBytes = MEMORY_WORK_BYTES, safetyBytes = 192 * MIB,
  maxQueuedWaiters = 8, maxQueuedRetainedBytes = 64 * MIB,
  retryIntervalMs = 100, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const active = new Map();
  const waiters = [];
  let reservedBytes = 0;
  let queuedRetainedBytes = 0;
  let admitted = 0;
  let denied = 0;
  const admittedByKind = Object.fromEntries(Object.keys(workBytes).map((kind) => [kind, 0]));
  const deniedByKind = Object.fromEntries(Object.keys(workBytes).map((kind) => [kind, 0]));
  let sequence = 0;
  let retryTimer = null;
  let draining = false;
  const queueLimit = Math.max(1, Math.min(64, Math.trunc(Number(maxQueuedWaiters) || 8)));
  const retainedLimit = Math.max(MIB, positiveBytes(maxQueuedRetainedBytes) || 64 * MIB);
  const retryDelay = Math.max(25, Math.min(1_000, Math.trunc(Number(retryIntervalMs) || 100)));
  const snapshot = () => {
    const queuedByKind = Object.fromEntries(Object.keys(workBytes).map((kind) => [kind, 0]));
    for (const waiter of waiters) queuedByKind[waiter.kind] += 1;
    return Object.freeze({ ...readMemory(), reservedBytes,
    activeKinds: Object.freeze([...active.keys()]), admitted, denied,
    admittedByKind: Object.freeze({ ...admittedByKind }),
    deniedByKind: Object.freeze({ ...deniedByKind }),
    queuedByKind: Object.freeze(queuedByKind),
    queued: waiters.length, queuedRetainedBytes, maxQueuedWaiters: queueLimit,
    maxQueuedRetainedBytes: retainedLimit });
  };

  const workSize = (kind) => {
    const bytes = positiveBytes(workBytes[kind]);
    if (!bytes) throw new TypeError("Unknown memory work kind");
    return bytes;
  };
  const canAdmit = (kind, bytes) => {
      // Decode/render/rebuild stages cannot overlap. An already-running provider
      // job has a smaller reservation; interactive work may proceed if it fits.
      // New maintenance waits for interactive work, never the other way around.
      const exclusiveBusy = [...active.keys()].some((key) => key !== "background");
      let memory;
      try { memory = readMemory(); } catch { return false; }
      return !(active.has(kind) || exclusiveBusy || (kind === "sitemap" && active.size)
        || !memory.limitBytes || memory.usedBytes + reservedBytes + bytes + safetyBytes > memory.limitBytes);
  };
  const normalizedPriority = (kind, value) => {
    if (value === "interactive") return 0;
    if (value === "background") return 2;
    if (value === "normal") return 1;
    return kind === "image" || kind === "share" ? 0 : kind === "background" ? 2 : 1;
  };
  const scheduleRetry = () => {
    if (retryTimer || !waiters.length) return;
    retryTimer = setTimer(() => {
      retryTimer = null;
      drain();
    }, retryDelay);
    retryTimer?.unref?.();
  };
  const createLease = (kind, bytes) => {
      active.set(kind, bytes);
      reservedBytes += bytes;
      admitted += 1;
      admittedByKind[kind] += 1;
      let released = false;
      return Object.freeze({ release() {
        if (released) return;
        released = true;
        reservedBytes = Math.max(0, reservedBytes - bytes);
        active.delete(kind);
        drain();
      } });
  };
  const removeWaiter = (waiter) => {
    const index = waiters.indexOf(waiter);
    if (index < 0) return false;
    waiters.splice(index, 1);
    queuedRetainedBytes = Math.max(0, queuedRetainedBytes - waiter.retainedBytes);
    clearTimer(waiter.timeout);
    waiter.signal?.removeEventListener("abort", waiter.onAbort);
    return true;
  };
  function drain() {
    if (draining) return;
    draining = true;
    try {
      while (waiters.length) {
        waiters.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
        const waiter = waiters[0];
        if (!canAdmit(waiter.kind, waiter.bytes)) break;
        removeWaiter(waiter);
        waiter.resolve(createLease(waiter.kind, waiter.bytes));
      }
      if (!waiters.length && retryTimer) {
        clearTimer(retryTimer);
        retryTimer = null;
      }
    } finally {
      draining = false;
    }
    scheduleRetry();
  }
  return Object.freeze({ snapshot,
    tryAcquire(kind) {
      const bytes = workSize(kind);
      // Synchronous maintenance must never jump ahead of an interactive caller
      // that is already waiting for a short-lived native-memory reservation.
      if (waiters.length || !canAdmit(kind, bytes)) {
        denied += 1;
        deniedByKind[kind] += 1;
        return null;
      }
      return createLease(kind, bytes);
    },
    acquire(kind, { signal = null, timeoutMs = 10_000, retainedBytes = 0, priority } = {}) {
      const bytes = workSize(kind);
      if (signal?.aborted) return Promise.reject(signal.reason || new DOMException("Aborted", "AbortError"));
      const retained = Math.max(0, Math.trunc(Number(retainedBytes) || 0));
      if (!Number.isSafeInteger(retained)) throw new TypeError("Invalid retained memory size");
      const timeout = Math.max(100, Math.min(30_000, Math.trunc(Number(timeoutMs) || 10_000)));
      if (!waiters.length && canAdmit(kind, bytes)) return Promise.resolve(createLease(kind, bytes));
      if (waiters.length >= queueLimit || queuedRetainedBytes + retained > retainedLimit) {
        denied += 1;
        deniedByKind[kind] += 1;
        return Promise.resolve(null);
      }
      return new Promise((resolve, reject) => {
        const waiter = { kind, bytes, retainedBytes: retained,
          priority: normalizedPriority(kind, priority), sequence: sequence += 1,
          signal, resolve, reject, timeout: null, onAbort: null };
        waiter.onAbort = () => {
          if (!removeWaiter(waiter)) return;
          reject(signal.reason || new DOMException("Aborted", "AbortError"));
          drain();
        };
        waiter.timeout = setTimer(() => {
          if (!removeWaiter(waiter)) return;
          denied += 1;
          deniedByKind[kind] += 1;
          resolve(null);
          drain();
        }, timeout);
        waiter.timeout?.unref?.();
        queuedRetainedBytes += retained;
        waiters.push(waiter);
        signal?.addEventListener("abort", waiter.onAbort, { once: true });
        if (signal?.aborted) waiter.onAbort();
        else scheduleRetry();
      });
    },
  });
}

const memoryAdmission = createMemoryAdmission();
export const tryAcquireMemoryWork = (kind) => memoryAdmission.tryAcquire(kind);
export const acquireMemoryWork = (kind, options) => memoryAdmission.acquire(kind, options);
export const memoryWorkSnapshot = () => memoryAdmission.snapshot();

export class MemoryWorkBusyError extends Error {
  constructor() {
    super("Background work deferred to preserve server memory");
    this.name = "MemoryWorkBusyError";
    this.code = "MEMORY_PRESSURE";
  }
}

// Only aggregate resource figures and fixed operation names are logged: never
// request bodies, account IDs, credentials, file names, or URLs.
export function startMemoryMonitor({ snapshot = memoryWorkSnapshot, log = console.log,
  intervalMs = 60_000, setIntervalFn = setInterval, clearIntervalFn = clearInterval } = {}) {
  const write = (line) => {
    try { log(line); }
    catch { /* architecture: allow-empty-catch -- optional diagnostic output must not crash the web service. */ }
  };
  const sample = () => {
    let state;
    try { state = snapshot(); }
    catch {
      write("[memory] resource_sample_unavailable");
      return;
    }
    const mb = (bytes) => bytes == null ? "unknown" : Math.round(bytes / MIB);
    const perKind = (values) => ["image", "share", "sitemap", "background"]
      .map((kind) => `${kind}:${Number(values?.[kind]) || 0}`).join(",");
    write(`[memory] source=${state.source} usedMiB=${mb(state.usedBytes)} limitMiB=${mb(state.limitBytes)}`
      + ` rssMiB=${mb(state.rssBytes)} heapMiB=${mb(state.heapUsedBytes)} externalMiB=${mb(state.externalBytes)}`
      + ` reservedMiB=${mb(state.reservedBytes)} active=${state.activeKinds.join(",") || "none"}`
      + ` waiting=${state.queued || 0} waitingMiB=${mb(state.queuedRetainedBytes || 0)}`
      + ` admitted=${state.admitted} deferred=${state.denied}`
      + ` admittedByKind=${perKind(state.admittedByKind)} deferredByKind=${perKind(state.deniedByKind)}`
      + ` waitingByKind=${perKind(state.queuedByKind)}`);
  };
  sample();
  const timer = setIntervalFn(sample, Math.max(10_000, intervalMs));
  timer.unref?.();
  return Object.freeze({ stop: () => clearIntervalFn(timer) });
}
