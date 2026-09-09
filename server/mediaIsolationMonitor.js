// A failed privacy proof keeps publishing closed. Recover promptly with one
// shared, bounded probe loop instead of making members wait five minutes.
export function createMediaIsolationMonitor({
  probe,
  onResult = () => {},
  onError = () => {},
  healthyIntervalMs = 300_000,
  retryDelayMs = 2_000,
  maxRetryDelayMs = 60_000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof probe !== "function") throw new TypeError("A privacy probe is required.");
  const healthyDelay = Math.max(60_000, Number(healthyIntervalMs) || 300_000);
  const retryDelay = Math.max(1_000, Number(retryDelayMs) || 2_000);
  const maxRetry = Math.max(retryDelay, Number(maxRetryDelayMs) || 60_000);
  let timer = null;
  let active = null;
  let controller = null;
  let stopped = false;
  let failures = 0;
  let wasUnavailable = false;

  const reportError = (error, phase) => {
    try { onError(error, phase); }
    catch { /* architecture: allow-empty-catch -- telemetry cannot break privacy recovery */ }
  };
  const schedule = (delay, phase) => {
    if (stopped) return;
    timer = setTimer(() => {
      timer = null;
      void trigger(phase);
    }, delay);
    timer?.unref?.();
  };
  const trigger = (requestedPhase = "scheduled") => {
    if (stopped) return Promise.resolve(null);
    if (active) return active;
    if (timer !== null) clearTimer(timer);
    timer = null;
    const phase = ["startup", "scheduled", "recovery"].includes(requestedPhase) ? requestedPhase : "scheduled";
    controller = new AbortController();
    const signal = controller.signal;
    active = Promise.resolve().then(() => probe({ signal })).then((status) => {
      if (stopped || signal.aborted) return null;
      const ready = status?.ready === true;
      const recovered = ready && wasUnavailable;
      if (ready) failures = 0;
      else failures = Math.min(failures + 1, 20);
      wasUnavailable = !ready;
      const transient = status?.errorCode === "probe_timeout" || status?.errorCode === "probe_failed";
      const delay = !ready && transient
        ? Math.min(maxRetry, retryDelay * (2 ** Math.min(failures - 1, 10)))
        : healthyDelay;
      try { onResult(status, { phase, recovered, retryInMs: delay }); }
      catch (error) { reportError(error, phase); }
      schedule(delay, ready ? "scheduled" : "recovery");
      return status;
    }).catch((error) => {
      if (stopped || signal.aborted) return null;
      wasUnavailable = true;
      failures = Math.min(failures + 1, 20);
      reportError(error, phase);
      schedule(Math.min(maxRetry, retryDelay * (2 ** Math.min(failures - 1, 10))), "recovery");
      return null;
    }).finally(() => { active = null; controller = null; });
    return active;
  };
  return Object.freeze({
    trigger,
    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      controller?.abort(new DOMException("Server stopping", "AbortError"));
      return active || Promise.resolve(null);
    },
  });
}
