import { collectStorageHealth, formatStorageHealth } from "./storageHealth.js";
import { privateErrorLabel } from "./errors.js";

// Every callback here is synchronous and batch-bounded. No provider requests,
// backup, checkpoint or VACUUM run in this timer. Stop it before closing SQLite.
export function startStorageMaintenance({
  database, databasePath, pruneProviders, sweepSessions,
  collect = collectStorageHealth, logger = console, now = Date.now,
  setIntervalImpl = setInterval, clearIntervalImpl = clearInterval,
} = {}) {
  let stopped = false;
  let nextObservationAt = 0;
  function run() {
    if (stopped) return;
    const at = now();
    for (const [label, action] of [["provider", () => pruneProviders(at)], ["session", sweepSessions]]) {
      try { action(); }
      catch (error) { logger.error(`[storage] ${label} maintenance failed safely cause=${privateErrorLabel(error)}`); }
    }
    if (at < nextObservationAt) return;
    nextObservationAt = at + 5 * 60_000;
    try {
      const report = collect(database, { databasePath, at });
      const line = `[storage] ${formatStorageHealth(report)}; status=${report.status}; codes=${[...report.issues, ...report.warnings].join(",") || "none"}`;
      if (report.status === "healthy") logger.log(line);
      else logger.warn(line);
    } catch (error) { logger.error(`[storage] observation failed safely cause=${privateErrorLabel(error)}`); }
  }
  run();
  const timer = setIntervalImpl(run, 60_000);
  timer?.unref?.();
  return { stop() { stopped = true; clearIntervalImpl(timer); } };
}
