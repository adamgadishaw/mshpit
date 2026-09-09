// Provider-heavy maintenance shares one process and one SQLite connection with
// web traffic. Queue every such job through this coordinator so independent
// timers can never overlap their network fan-out or database writes.
import { MemoryWorkBusyError, tryAcquireMemoryWork } from "./memoryAdmission.js";

export function createBackgroundJobCoordinator({
  acquireMemoryLease = () => tryAcquireMemoryWork("background"), maxPending = 32,
} = {}) {
  let tail = Promise.resolve();
  let pending = 0;

  return function runBackgroundJob(job) {
    // `then` also converts a synchronous throw from job() into a rejection for
    // the scheduler's existing safe boundary to report.
    if (pending >= maxPending) return Promise.reject(new MemoryWorkBusyError());
    pending += 1;
    const result = tail.then(() => {
      const lease = acquireMemoryLease();
      if (!lease) throw new MemoryWorkBusyError();
      try {
        return Promise.resolve(job()).finally(() => lease.release());
      } catch (error) {
        lease.release();
        throw error;
      }
    }).finally(() => { pending -= 1; });
    // A failed job must not poison the queue. Keep the caller-facing rejection
    // intact while advancing the internal tail after either outcome.
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

export const runBackgroundJob = createBackgroundJobCoordinator();
