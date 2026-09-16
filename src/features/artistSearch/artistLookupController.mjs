const DEFAULT_RETRY_MS = 30_000;
const MAX_RETRY_MS = 60 * 60_000;

export function artistLookupRetryDelay(error) {
  if (error?.retryable === false || /^PIT-AUTH-/.test(String(error?.code || ""))
    || [401, 403].includes(Number(error?.status))) return 0;
  if (error?.serverCode !== "PROVIDER_UNAVAILABLE" && error?.code !== "PROVIDER_UNAVAILABLE"
    && Number(error?.status) !== 429) return 0;
  const hint = Number(error?.retryAfterMs);
  return Number.isFinite(hint) && hint > 0 ? Math.min(MAX_RETRY_MS, Math.ceil(hint)) : DEFAULT_RETRY_MS;
}

// One screen-owned directory lookup at a time, including clicks before React
// can repaint the disabled control. Cooldowns are account scoped, not query
// scoped, so editing a letter cannot repeatedly hit an unavailable directory.
export function createArtistLookupController({ clock = Date.now, maxCooldowns = 16 } = {}) {
  let active = null;
  let sequence = 0;
  const cooldowns = new Map();
  const retryAt = (scope) => {
    const now = clock();
    for (const [key, until] of cooldowns) if (until <= now) cooldowns.delete(key);
    return cooldowns.get(scope) || 0;
  };
  const isCurrent = (request) => !!request && active === request && !request.controller.signal.aborted;
  const cancel = () => {
    active?.controller.abort();
    active = null;
    sequence += 1;
  };
  return {
    begin(scope, name) {
      const target = String(name || "").trim().toLowerCase();
      if (!scope || !target || [...target].length > 120 || active || retryAt(scope) > clock()) return null;
      active = { scope, target, sequence: ++sequence, controller: new AbortController() };
      return active;
    },
    isCurrent,
    fail(request, error) {
      if (!isCurrent(request)) return 0;
      const delay = artistLookupRetryDelay(error);
      if (!delay) return 0;
      const until = clock() + delay;
      cooldowns.delete(request.scope);
      cooldowns.set(request.scope, until);
      while (cooldowns.size > Math.max(1, Math.min(64, Number(maxCooldowns) || 16))) {
        cooldowns.delete(cooldowns.keys().next().value);
      }
      return until;
    },
    finish(request) { if (active === request) active = null; },
    cancel,
    reset() { cancel(); cooldowns.clear(); },
    retryAt,
  };
}
