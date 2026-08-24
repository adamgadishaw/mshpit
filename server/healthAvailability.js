export const HEALTH_RATE_LIMIT_MAX = 120;
export const HEALTH_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const RUNTIME_READINESS_CACHE_MS = 1000;

export function healthRateLimitPolicy(ip) {
  const address = String(ip || "?").trim() || "?";
  return {
    key: `health:ip:${address}`,
    max: HEALTH_RATE_LIMIT_MAX,
    windowMs: HEALTH_RATE_LIMIT_WINDOW_MS,
  };
}

/**
 * Memoize only completed readiness checks. A failed check is deliberately not
 * retained, so a recovered database or disk can make the very next probe pass.
 */
export function createSuccessfulReadinessCache({
  ttlMs = RUNTIME_READINESS_CACHE_MS,
  clock = Date.now,
} = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs < 1) throw new TypeError("Readiness cache TTL must be positive.");
  if (typeof clock !== "function") throw new TypeError("Readiness cache clock must be a function.");
  const entries = new Map();

  return {
    get(key, check) {
      if (typeof check !== "function") throw new TypeError("Readiness cache check must be a function.");
      const at = Number(clock());
      const cached = entries.get(key);
      if (cached && cached.expiresAt > at) return cached.value;
      if (cached) entries.delete(key);

      const value = check();
      entries.set(key, { value, expiresAt: Number(clock()) + ttlMs });
      return value;
    },
    clear() {
      entries.clear();
    },
  };
}
