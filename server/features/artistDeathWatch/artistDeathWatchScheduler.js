import { ARTIST_DEATH_WATCH_INTERVAL_MS } from "../../../src/domain/artistDeathWatch.mjs";
import { backgroundJobEnabled } from "../../backgroundJobs.js";
import { ARTIST_DEATH_WATCH_MAX_COOLDOWN_MS } from "./artistDeathWatchRetry.js";

const START_DELAY_MS = 30_000;

export function artistDeathWatchSchedulerEnabled(env = process.env) {
  return backgroundJobEnabled(env, "ARTIST_DEATH_WATCH_SCHEDULER_ENABLED");
}

export function startArtistDeathWatchScheduler({
  service,
  env = process.env,
  now = Date.now,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  onError = (error) => console.error(`[memorial-watch] bounded scan failed safely: code=${String(error?.code || "provider_error").replace(/[^a-z0-9_]/giu, "").slice(0, 60)} status=${Number(error?.status) || 0}`),
} = {}) {
  if (!service?.scan || typeof now !== "function" || typeof setTimeoutImpl !== "function"
    || typeof clearTimeoutImpl !== "function" || typeof onError !== "function") {
    throw new TypeError("Artist death-watch scheduler requires complete dependencies");
  }
  if (!artistDeathWatchSchedulerEnabled(env)) {
    return Object.freeze({ enabled: false, stop: async () => {} });
  }
  let stopped = false;
  let timer = null;
  let pending = null;

  const nextDelay = (fallback) => {
    let nextScanAt;
    try { nextScanAt=service.readSnapshot?.()?.settings?.nextScanAt; }
    catch { /* A status read failure cannot stop the scheduler from trying later. */ }
    const wait=Number(nextScanAt)-now();
    return Number.isFinite(wait) && wait>0
      ? Math.min(ARTIST_DEATH_WATCH_MAX_COOLDOWN_MS,Math.max(START_DELAY_MS,wait)) : fallback;
  };

  const schedule = (delay) => {
    if (stopped) return;
    timer = setTimeoutImpl(tick, delay);
    timer?.unref?.();
  };
  const tick = () => {
    if (stopped || pending) return;
    pending = Promise.resolve()
      .then(() => service.scan({ at: now() }))
      .catch((error) => {
        try { onError(error); }
        catch { /* A logger failure must not create an unhandled background rejection. */ }
      })
      .finally(() => {
        pending = null;
        schedule(nextDelay(ARTIST_DEATH_WATCH_INTERVAL_MS));
      });
  };
  schedule(nextDelay(START_DELAY_MS));

  return Object.freeze({
    enabled: true,
    async stop() {
      stopped = true;
      if (timer) clearTimeoutImpl(timer);
      timer = null;
      await (pending || Promise.resolve());
    },
  });
}
