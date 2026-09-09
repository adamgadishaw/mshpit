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
  workBytes = MEMORY_WORK_BYTES, safetyBytes = 192 * MIB } = {}) {
  const active = new Map();
  let reservedBytes = 0;
  let admitted = 0;
  let denied = 0;
  const snapshot = () => Object.freeze({ ...readMemory(), reservedBytes,
    activeKinds: Object.freeze([...active.keys()]), admitted, denied });
  return Object.freeze({ snapshot,
    tryAcquire(kind) {
      const bytes = positiveBytes(workBytes[kind]);
      if (!bytes) throw new TypeError("Unknown memory work kind");
      // Decode/render/rebuild stages cannot overlap. An already-running provider
      // job has a smaller reservation; interactive work may proceed if it fits.
      // New maintenance waits for interactive work, never the other way around.
      const exclusiveBusy = [...active.keys()].some((key) => key !== "background");
      let memory;
      try { memory = readMemory(); }
      catch { denied += 1; return null; }
      if (active.has(kind) || exclusiveBusy || (kind === "sitemap" && active.size)
        || !memory.limitBytes || memory.usedBytes + reservedBytes + bytes + safetyBytes > memory.limitBytes) {
        denied += 1;
        return null;
      }
      active.set(kind, bytes);
      reservedBytes += bytes;
      admitted += 1;
      let released = false;
      return Object.freeze({ release() {
        if (released) return;
        released = true;
        reservedBytes -= bytes;
        active.delete(kind);
      } });
    },
  });
}

const memoryAdmission = createMemoryAdmission();
export const tryAcquireMemoryWork = (kind) => memoryAdmission.tryAcquire(kind);
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
    write(`[memory] source=${state.source} usedMiB=${mb(state.usedBytes)} limitMiB=${mb(state.limitBytes)}`
      + ` rssMiB=${mb(state.rssBytes)} heapMiB=${mb(state.heapUsedBytes)} externalMiB=${mb(state.externalBytes)}`
      + ` reservedMiB=${mb(state.reservedBytes)} active=${state.activeKinds.join(",") || "none"}`
      + ` admitted=${state.admitted} deferred=${state.denied}`);
  };
  sample();
  const timer = setIntervalFn(sample, Math.max(10_000, intervalMs));
  timer.unref?.();
  return Object.freeze({ stop: () => clearIntervalFn(timer) });
}
