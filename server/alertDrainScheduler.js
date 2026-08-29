/**
 * Keep HTTP error reporting off the response path without allocating one timer
 * for every failure in an outage. Errors are recorded synchronously before this
 * is called, so every call queued before the timer fires is covered by the same
 * digest read. A request arriving during delivery marks one replay, preserving
 * the delivery trigger without allowing an unbounded timer fan-out.
 */
export function createAlertDrainScheduler({
  drain,
  scheduleTask = (task) => setTimeout(task, 0),
} = {}) {
  if (typeof drain !== "function") throw new TypeError("Alert drain scheduler requires a drain function");
  if (typeof scheduleTask !== "function") throw new TypeError("Alert drain scheduler requires a task scheduler");

  let pending = false;
  let draining = false;
  let replayRequested = false;

  const schedule = () => {
    if (pending) {
      if (draining) replayRequested = true;
      return false;
    }
    pending = true;
    const timer = scheduleTask(async () => {
      draining = true;
      try {
        await drain();
      } catch {
        // Alert delivery is deliberately fail-safe and must not feed itself.
      } finally {
        draining = false;
        pending = false;
        if (replayRequested) {
          replayRequested = false;
          schedule();
        }
      }
    });
    timer?.unref?.();
    return true;
  };

  return Object.freeze({
    schedule,
    state: () => Object.freeze({ pending, draining, replayRequested }),
  });
}
