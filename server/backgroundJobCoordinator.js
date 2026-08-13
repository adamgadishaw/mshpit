// Provider-heavy maintenance shares one process and one SQLite connection with
// web traffic. Queue every such job through this coordinator so independent
// timers can never overlap their network fan-out or database writes.
export function createBackgroundJobCoordinator() {
  let tail = Promise.resolve();

  return function runBackgroundJob(job) {
    // `then` also converts a synchronous throw from job() into a rejection for
    // the scheduler's existing safe boundary to report.
    const result = tail.then(() => job());
    // A failed job must not poison the queue. Keep the caller-facing rejection
    // intact while advancing the internal tail after either outcome.
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}

export const runBackgroundJob = createBackgroundJobCoordinator();
// Backwards-compatible name for the two provider schedulers that originally
// introduced this coordinator.
export const runProviderBackgroundJob = runBackgroundJob;
