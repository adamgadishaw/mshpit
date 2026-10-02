import { ApiError } from "./errors.js";

// Origin request ceilings, not a CPU deadline or a production capacity claim.
// Accounts do not share an address allowance; guests retain the API's generous
// shared-address allowance. All actors still share the process ceilings.
export const PUBLIC_READ_LIMITS = Object.freeze({
  burstMax: 30, burstWindowMs: 1_000,
  processMax: 600, processWindowMs: 60_000,
  identityMax: 300, identityWindowMs: 60_000,
  maxIdentities: 4_096,
});

// Provider adapters have their own admission. These local projection families
// also need an aggregate origin ceiling, including the HTML-equivalent APIs.
export function isExpensiveApiRead(method, pathname) {
  return method === "GET" && /^\/api\/(?:page-head|resolve|artists(?:\/.*)?|discover\/.*|discovery\/sidebar|tourdates|feed(?:\/for-you)?|clips|cities(?:\/.*)?|venues\/[^/]+\/(?:photos|reviews)|shows\/[^/]+|landing\/media|news|news-desk\/(?:stories|live(?:\/[^/]+)?)|festivals(?:\/[^/]+)?)$/.test(pathname);
}

export function createPublicReadAdmission({ clock = Date.now, ...overrides } = {}) {
  const limits = { ...PUBLIC_READ_LIMITS, ...overrides };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("Invalid public read admission limit.");
  }
  const identities = new Map();
  let burst = null, process = null;
  const active = (bucket, now, windowMs) => bucket?.resetAt > now ? bucket : { count: 0, resetAt: now + windowMs };
  const deny = (retryAfterMs) => {
    const error = new ApiError(429, "Too many requests. Try again shortly.", "RATE_LIMITED");
    error.retryAfterMs = Math.max(1_000, retryAfterMs);
    throw error;
  };

  const precheck = () => {
    const now = clock();
    burst = active(burst, now, limits.burstWindowMs);
    process = active(process, now, limits.processWindowMs);
    const waits = [];
    if (burst.count >= limits.burstMax) waits.push(burst.resetAt - now);
    if (process.count >= limits.processMax) waits.push(process.resetAt - now);
    // Do not parse a cookie or query a session while process admission is shut.
    if (waits.length) deny(Math.max(...waits));
    return now;
  };

  return Object.freeze({
    precheck,
    admit(identity) {
      const now = precheck();
      const key = typeof identity === "function" ? identity() : identity;
      if (typeof key !== "string" || !key || key.length > 512) throw new TypeError("Invalid public read identity.");

      // Entries are ordered by expiry: renewing an expired key moves it to the
      // end. Reclaim at most 16 per request; no full-map sweep on saturation.
      for (let pruned = 0; pruned < 16; pruned += 1) {
        const first = identities.entries().next().value;
        if (!first || first[1].resetAt > now) break;
        identities.delete(first[0]);
      }
      let actor = identities.get(key);
      if (actor && actor.resetAt <= now) { identities.delete(key); actor = null; }
      if (!actor) {
        if (identities.size >= limits.maxIdentities) {
          deny(identities.values().next().value.resetAt - now);
        }
        actor = { count: 0, resetAt: now + limits.identityWindowMs };
        identities.set(key, actor);
      }
      if (actor.count >= limits.identityMax) deny(actor.resetAt - now);
      actor.count += 1;
      burst.count += 1;
      process.count += 1;
    },
  });
}
