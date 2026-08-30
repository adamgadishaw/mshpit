import { ARTIST_DEATH_WATCH_INTERVAL_MS } from "../../../src/domain/artistDeathWatch.mjs";
import { backgroundJobEnabled } from "../../backgroundJobs.js";

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
  onError = (error) => console.error(`[memorial-watch] bounded scan failed safely: code=${String(error?.code || "provider_error").replace(/[^a-z0-9_]/giu, "").slice(0, 60)}`),
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

  const schedule = (delay) => {
    if (stopped) return;
    timer = setTimeoutImpl(tick, delay);
    timer?.unref?.();
  };
  const tick = () => {
    if (stopped || pending) return;
    pending = Promise.resolve(service.scan({ at: now() }))
      .catch(onError)
      .finally(() => {
        pending = null;
        schedule(ARTIST_DEATH_WATCH_INTERVAL_MS);
      });
  };
  schedule(START_DELAY_MS);

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
