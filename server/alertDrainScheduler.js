/**
 * Keep HTTP error reporting off the response path without allocating one timer
 * for every failure in an outage. Errors are recorded synchronously before this
 * is called, so every call queued before the timer fires is covered by the same
 * digest read. A request arriving during delivery marks one replay, preserving
 * the delivery trigger without allowing an unbounded timer fan-out.
 * An eligible batch deferred only by cooldown owns one wake-up at that absolute
 * deadline. Failed/skipped delivery is not an automatic retry instruction.
 */
export function createAlertDrainScheduler({
  drain,
  scheduleTask = (task, delay) => setTimeout(task, delay),
  cancelTask = clearTimeout,
  clock = Date.now,
} = {}) {
  if (typeof drain !== "function") throw new TypeError("Alert drain scheduler requires a drain function");
  if (typeof scheduleTask !== "function") throw new TypeError("Alert drain scheduler requires a task scheduler");

  let pending = false;
  let draining = false;
  let replayRequested = false;
  let timer = null;
  let inFlight = null;
  let stopped = false;
  let workController = null;
  let triggerVersion = 0;

  const schedule = (retryAt = 0, replay = true) => {
    if (stopped) return false;
    if (pending) {
      if (draining && replay) replayRequested = true;
      return false;
    }
    pending = true;
    const controller = new AbortController();
    workController = controller;
    // Node treats overflowing delays as 1ms. Long configured cooldowns instead
    // get a bounded wake-up which rechecks the same absolute deadline.
    const delay = Math.min(2_147_483_647, Math.max(0, retryAt - clock()));
    timer = scheduleTask(async () => {
      if (stopped || controller.signal.aborted) return;
      timer = null;
      draining = true;
      let result;
      const startedAt = clock();
      try {
        inFlight = Promise.resolve().then(() => controller.signal.aborted ? undefined : drain({ signal: controller.signal }));
        result = await inFlight;
      } catch {
        // Alert delivery is deliberately fail-safe and must not feed itself.
      } finally {
        draining = false;
        pending = false;
        inFlight = null;
        const deferred = (result?.sent === true || (result?.sent === false && result.reason === "cooling-down"))
          && Number.isSafeInteger(result.retryAt) && result.retryAt > 0
          && (result.retryAt > clock() || result.retryAt > startedAt);
        if (!controller.signal.aborted && deferred) {
          replayRequested = false;
          schedule(result.retryAt);
        } else if (replayRequested) {
          replayRequested = false;
          schedule();
        }
      }
    }, delay);
    timer?.unref?.();
    return true;
  };

  const cancelPending = ({ since } = {}) => {
    // A failed send invalidates older wake-ups, but an incident that arrived
    // during that attempt still owns its original trigger after cooldown.
    const preserveTrigger = Number.isSafeInteger(since) && triggerVersion > since;
    workController?.abort();
    if (timer !== null) cancelTask(timer);
    timer = null;
    replayRequested = preserveTrigger;
    if (!draining) {
      pending = false;
      if (preserveTrigger) { replayRequested = false; schedule(); }
    }
  };

  return Object.freeze({
    schedule: () => { triggerVersion += 1; return schedule(); },
    triggerVersion: () => triggerVersion,
    defer: (retryAt) => Number.isSafeInteger(retryAt) && retryAt > 0 && schedule(retryAt, false),
    cancelPending,
    stop() {
      stopped = true;
      cancelPending();
      return inFlight?.then(() => undefined, () => undefined) || Promise.resolve();
    },
    state: () => Object.freeze({ pending, draining, replayRequested }),
  });
}
