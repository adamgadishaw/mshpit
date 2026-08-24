import { randomInt } from "node:crypto";

export const RECOVERY_RESPONSE_FLOOR_MIN_MS = 220;
export const RECOVERY_RESPONSE_FLOOR_MAX_MS = 300;

const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));

/**
 * Build one request-scoped minimum response floor. Randomness is sampled before
 * account lookup work and comes from the OS CSPRNG; waiting uses a timer rather
 * than blocking the Node event loop. Dependencies are injectable for exact tests.
 */
export function createRecoveryResponseFloor({
  minMs = RECOVERY_RESPONSE_FLOOR_MIN_MS,
  maxMs = RECOVERY_RESPONSE_FLOOR_MAX_MS,
  randomInteger = randomInt,
  now = Date.now,
  wait = sleep,
} = {}) {
  const minimum = Number(minMs);
  const maximum = Number(maxMs);
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum)
      || minimum < 1 || maximum < minimum || maximum > 2_000) {
    throw new TypeError("recovery response floor bounds are invalid");
  }
  if (typeof randomInteger !== "function" || typeof now !== "function" || typeof wait !== "function") {
    throw new TypeError("recovery response floor dependencies are invalid");
  }

  const sampled = maximum === minimum ? minimum : Number(randomInteger(minimum, maximum + 1));
  const targetMs = Math.max(minimum, Math.min(maximum, Number.isFinite(sampled) ? Math.trunc(sampled) : minimum));
  const startedAt = Number(now());
  let settlement = null;

  return Object.freeze({
    targetMs,
    settle() {
      if (!settlement) settlement = (async () => {
        const elapsedMs = Math.max(0, Number(now()) - startedAt) || 0;
        const waitedMs = Math.max(0, targetMs - elapsedMs);
        if (waitedMs > 0) await wait(waitedMs);
        return Object.freeze({ targetMs, elapsedMs, waitedMs });
      })();
      return settlement;
    },
  });
}
