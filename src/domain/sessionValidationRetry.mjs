const INITIAL_MS = 5_000;
const MAX_MS = 60_000;
const MAX_HINT_MS = 3_600_000;

// One identity effect owns this policy. Strict account changes still lock and
// validate immediately; only its scheduled recovery attempts back off. Jitter
// prevents a group of offline clients from retrying in the same five-second wave.
export function createSessionValidationRetry({ random = Math.random } = {}) {
  let failures = 0;
  return Object.freeze({
    next(error) {
      const base = Math.min(MAX_MS / 2, INITIAL_MS * 2 ** Math.min(failures++, 4));
      const sample = Number(random());
      const jitter = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0.5;
      const delay = Math.min(MAX_MS, Math.round(base * (1 + jitter)));
      const hint = Number(error?.retryAfterMs);
      return Number.isFinite(hint) && hint > 0
        ? Math.max(delay, Math.min(MAX_HINT_MS, Math.ceil(hint))) : delay;
    },
    reset() { failures = 0; },
  });
}
