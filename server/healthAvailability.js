import { createRateLimitBuckets } from "./rateLimitBuckets.js";

export const HEALTH_RATE_LIMIT_MAX = 120;
export const HEALTH_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const HEALTH_RATE_LIMIT_IDENTITIES = 1_024;
export const RUNTIME_READINESS_CACHE_MS = 1000;

// Application bucket saturation must not consume the liveness pool. This is
// still bounded, per-address admission, not an exemption for arbitrary probes.
export function createHealthRateLimiter({ clock = Date.now, maxIdentities = HEALTH_RATE_LIMIT_IDENTITIES } = {}) {
  const buckets = createRateLimitBuckets({ maxEntries: maxIdentities });
  return (key, max, windowMs) => {
    const now = clock();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (!buckets.hasCapacity([key], now)) return false;
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    if (bucket.count >= max) return false;
    bucket.count += 1;
    return true;
  };
}

export const healthRateLimit = createHealthRateLimiter();

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
