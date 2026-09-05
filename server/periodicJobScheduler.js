const MIN_INTERVAL_MS = 60_000;
const MIN_RETRY_MS = 1_000;

function boundedDelay(value, fallback, minimum) {
  const parsed = Number(value);
  const resolved = Number.isFinite(parsed) ? parsed : Number(fallback);
  return Math.max(minimum, Math.floor(Number.isFinite(resolved) ? resolved : minimum));
}

function reportSafely(report, error) {
  try { report?.(error); }
  catch {
    // architecture: allow-empty-catch -- a diagnostic sink cannot turn a
    // contained maintenance failure into an unhandled scheduler rejection.
  }
}

/**
 * Own one recurring background job.
 *
 * Timer callbacks never retain a rejected promise, duplicate ticks share the
 * active run, and an optional short retry repairs transient failures before the
 * ordinary multi-hour interval. stop() clears every future tick and returns the
 * active run so shutdown can keep SQLite open until maintenance has settled.
 */
export function startPeriodicJob({
  run,
  report = () => {},
  initialDelayMs,
  intervalMs,
  retryDelayMs = 0,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  setRepeatingTimer = setInterval,
  clearRepeatingTimer = clearInterval,
} = {}) {
  if (typeof run !== "function") throw new TypeError("Periodic job requires a run function.");
  if (typeof setTimer !== "function" || typeof clearTimer !== "function"
      || typeof setRepeatingTimer !== "function" || typeof clearRepeatingTimer !== "function") {
    throw new TypeError("Periodic job requires timer functions.");
  }

  const firstDelay = boundedDelay(initialDelayMs, MIN_RETRY_MS, 0);
  const repeatingDelay = boundedDelay(intervalMs, MIN_INTERVAL_MS, MIN_INTERVAL_MS);
  const retryDelay = Number(retryDelayMs) > 0
    ? boundedDelay(retryDelayMs, MIN_RETRY_MS, MIN_RETRY_MS)
    : 0;
  let stopped = false;
  let active = null;
  let activeController = null;
  let retryTimer = null;

  const clearRetry = () => {
    if (retryTimer === null) return;
    clearTimer(retryTimer);
    retryTimer = null;
  };

  const scheduleRetry = () => {
    if (stopped || !retryDelay || retryTimer !== null) return;
    retryTimer = setTimer(() => {
      retryTimer = null;
      void trigger();
    }, retryDelay);
    retryTimer?.unref?.();
  };

  const trigger = () => {
    if (stopped) return Promise.resolve(false);
    if (active) return active;
    const controller = new AbortController();
    activeController = controller;
    active = Promise.resolve()
      .then(() => run({ signal: controller.signal }))
      .then((result) => {
        const succeeded = result !== false;
        if (succeeded) clearRetry();
        else scheduleRetry();
        return succeeded;
      })
      .catch((error) => {
        if (stopped && controller.signal.aborted) return false;
        reportSafely(report, error);
        scheduleRetry();
        return false;
      })
      .finally(() => {
        if (activeController === controller) activeController = null;
        active = null;
      });
    return active;
  };

  const firstTimer = setTimer(() => { void trigger(); }, firstDelay);
  const intervalTimer = setRepeatingTimer(() => { void trigger(); }, repeatingDelay);
  firstTimer?.unref?.();
  intervalTimer?.unref?.();

  return Object.freeze({
    trigger,
    stop({ abortActive = false } = {}) {
      if (!stopped) {
        stopped = true;
        clearTimer(firstTimer);
        clearRepeatingTimer(intervalTimer);
        clearRetry();
      }
      if (abortActive && activeController && !activeController.signal.aborted) {
        activeController.abort(new DOMException("Periodic job stopped.", "AbortError"));
      }
      return active || Promise.resolve();
    },
  });
}
