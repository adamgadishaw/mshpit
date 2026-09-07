import { ACCOUNT_INACTIVITY_DAY_MS, runAccountLifecycleSweep } from "./accountLifecycle.js";

const CLAIM_KEY = "accounts.inactivity.last_daily_run.v1";

function claimDailyRun(database, at) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const value = database.prepare("SELECT value FROM app_meta WHERE key=?").get(CLAIM_KEY)?.value;
    const previous = Number(value);
    const claimed = !value || (Number.isSafeInteger(previous) && previous > 0 && at - previous >= ACCOUNT_INACTIVITY_DAY_MS);
    if (claimed) database.prepare(`INSERT INTO app_meta (key,value) VALUES (?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(CLAIM_KEY, String(at));
    database.exec("COMMIT");
    return claimed;
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Lifecycle daily claim and rollback failed");
    }
    throw error;
  }
}

export function startAccountLifecycleScheduler({
  database, sendWarning, eraseAccount, limit = 100, now = Date.now,
  sweep = runAccountLifecycleSweep, onResult = () => {}, onError = () => {},
  setIntervalFn = setInterval, clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout,
} = {}) {
  if (!database?.prepare || typeof sendWarning !== "function" || typeof eraseAccount !== "function") {
    throw new TypeError("Lifecycle scheduling requires warning delivery and complete account erasure dependencies");
  }
  let stopped = false;
  let pending = null;
  const abort = new AbortController();
  const tick = () => {
    if (stopped || pending) return pending ?? Promise.resolve(null);
    pending = Promise.resolve().then(async () => {
      const at = now();
      if (stopped || !claimDailyRun(database, at)) return null;
      const result = await sweep({ database, at, limit, sendWarning, eraseAccount, signal: abort.signal });
      onResult(result);
      return result;
    }).catch((error) => { onError(error); return null; }).finally(() => { pending = null; });
    return pending;
  };
  const timer = setIntervalFn(() => { void tick(); }, 60 * 60 * 1000);
  const startup = setTimeoutFn(() => { void tick(); }, 10_000);
  timer?.unref?.(); startup?.unref?.();
  return Object.freeze({
    tick,
    stop() {
      stopped = true;
      abort.abort();
      clearIntervalFn(timer); clearTimeoutFn(startup);
      return pending ?? Promise.resolve(null);
    },
  });
}
