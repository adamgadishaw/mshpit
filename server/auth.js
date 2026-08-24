// Auth primitives, scrypt password hashing + opaque session tokens.
// Zero dependencies (node:crypto only).
//
// Design notes, so this stays easy to fix:
// - Passwords: scrypt (memory-hard) with a per-user random salt. Stored as
//   "scrypt:<salt hex>:<hash hex>" so the algorithm can be swapped later and old
//   hashes still verify.
// - Sessions: 32 random bytes, sent to the client as an httpOnly cookie. The DB
//   stores only sha256(token), a leaked DB cannot be replayed as a session. Raw
//   IP addresses and user-agent fingerprints are deliberately not retained.
// - Rate limiting: fixed-window in-memory buckets per key. Process restarts
//   reset counters, while the in-process memory ceiling rejects new identities
//   without discarding live limits.
import { scryptSync, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { q } from "./db.js";

export const STANDARD_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const PRIVILEGED_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const PRIVILEGED_ROLES = new Set(["admin", "moderator"]);

export function sessionTtlForRole(role) {
  return PRIVILEGED_ROLES.has(String(role || ""))
    ? PRIVILEGED_SESSION_TTL_MS
    : STANDARD_SESSION_TTL_MS;
}

// --- passwords ---------------------------------------------------------------
export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algo, saltHex, hashHex] = String(stored).split(":");
    if (algo !== "scrypt") return false;
    const hash = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
    return timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
  } catch {
    return false;
  }
}

// A valid scrypt record gives nonexistent-account logins the same expensive
// password-verification path as existing accounts. It is deliberately not a
// real credential and never leaves this module.
const DUMMY_PASSWORD_RECORD = (() => {
  const salt = Buffer.from("d6547856ff48631ba5d9f51fc80424d7", "hex");
  const hash = scryptSync("not-a-real-account-password", salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
})();

export function verifyPasswordForUser(password, stored) {
  const hasStoredPassword = typeof stored === "string" && stored.length > 0;
  const valid = verifyPassword(password, hasStoredPassword ? stored : DUMMY_PASSWORD_RECORD);
  return hasStoredPassword && valid;
}

// --- sessions ----------------------------------------------------------------
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export function createSession(userId, _ip, _ua) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const ttl = sessionTtlForRole(q.userById.get(userId)?.role);
  // Keep the nullable legacy columns empty. They are not used for authorization
  // or account UI, so retaining them would add privacy exposure without a
  // security control in return.
  q.insertSession.run(sha256(token), userId, now, now + ttl, "", "");
  return { token, expiresAt: now + ttl };
}

export function getSession(token) {
  if (!token) return null;
  const row = q.sessionByHash.get(sha256(token));
  if (!row) return null;
  // Re-evaluate the cap from the live role so an old 30-day member session
  // cannot become a 30-day staff session after a later promotion.
  const effectiveExpiry = Math.min(
    row.expires_at,
    row.created_at + sessionTtlForRole(q.userById.get(row.user_id)?.role),
  );
  if (effectiveExpiry < Date.now()) {
    q.deleteSession.run(row.token_hash);
    return null;
  }
  return effectiveExpiry === row.expires_at ? row : { ...row, expires_at: effectiveExpiry };
}

export function destroySession(token) {
  if (token) q.deleteSession.run(sha256(token));
}

export function sweepExpiredSessions() {
  q.deleteExpiredSessions.run(Date.now());
}

// --- rate limiting -----------------------------------------------------------
const buckets = new Map(); // key -> { count, resetAt }
const MAX_RATE_LIMIT_BUCKETS = 50_000;

function pruneExpiredRateLimitBuckets(now) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function hasRateLimitBucketCapacity(keys, now) {
  const candidateKeys = [...keys];
  const newKeys = new Set();
  for (const key of candidateKeys) {
    if (!buckets.has(key)) newKeys.add(key);
  }
  if (buckets.size + newKeys.size <= MAX_RATE_LIMIT_BUCKETS) return true;

  // Only an apparent overflow requires the O(n) sweep. Expired identities must
  // not deny capacity, but live identities must never be cleared to make room.
  pruneExpiredRateLimitBuckets(now);
  newKeys.clear();
  for (const key of candidateKeys) {
    if (!buckets.has(key)) newKeys.add(key);
  }
  return buckets.size + newKeys.size <= MAX_RATE_LIMIT_BUCKETS;
}

export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (b && b.resetAt <= now) {
    buckets.delete(key);
    b = null;
  }
  if (!b) {
    if (!hasRateLimitBucketCapacity([key], now)) return false;
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  return b.count <= max;
}

// Reserve several process-local buckets as one unit. Callers that still have a
// later synchronous gate (for example a persisted daily account allowance) can
// roll the whole group back instead of consuming the first bucket when a later
// bucket denies the operation.
export function reserveRateLimits(requests = []) {
  const reservedAt = Date.now();
  const grouped = new Map();
  for (const request of Array.isArray(requests) ? requests : []) {
    const key = String(request?.key || "");
    const max = Math.floor(Number(request?.max));
    const windowMs = Math.floor(Number(request?.windowMs));
    const cost = Math.max(1, Math.floor(Number(request?.cost) || 1));
    if (!key || !Number.isFinite(max) || max < 1 || !Number.isFinite(windowMs) || windowMs < 1) {
      throw new TypeError("Invalid rate-limit reservation.");
    }
    const existing = grouped.get(key);
    if (existing && (existing.max !== max || existing.windowMs !== windowMs)) {
      throw new TypeError("Conflicting rate-limit reservation.");
    }
    grouped.set(key, existing ? { ...existing, cost: existing.cost + cost } : { key, max, windowMs, cost });
  }

  if (!hasRateLimitBucketCapacity(grouped.keys(), reservedAt)) return null;

  const plans = [];
  for (const request of grouped.values()) {
    const previous = buckets.get(request.key);
    const activePrevious = previous && previous.resetAt > reservedAt ? previous : null;
    const count = activePrevious?.count || 0;
    if (count + request.cost > request.max) return null;
    plans.push({
      key: request.key,
      previous: activePrevious,
      next: {
        count: count + request.cost,
        resetAt: activePrevious?.resetAt || (reservedAt + request.windowMs),
      },
    });
  }

  for (const plan of plans) buckets.set(plan.key, plan.next);
  let open = true;
  return Object.freeze({
    commit() {
      if (!open) return false;
      open = false;
      return true;
    },
    rollback() {
      if (!open) return false;
      open = false;
      for (const plan of plans) {
        if (buckets.get(plan.key) !== plan.next) continue;
        if (plan.previous) buckets.set(plan.key, plan.previous);
        else buckets.delete(plan.key);
      }
      return true;
    },
  });
}

// Deterministic policy tests exercise cross-account/IP/global interactions in
// one process. Never call this from runtime code; production refuses it even if
// accidentally imported.
export function resetRateLimitsForTests() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Rate-limit test reset is unavailable in production.");
  }
  buckets.clear();
}

// Bound the bucket map so it can't grow without limit (memory-safety).
setInterval(() => {
  pruneExpiredRateLimitBuckets(Date.now());
}, 60000).unref();

// --- cookie helpers ----------------------------------------------------------
export const COOKIE = "pit_session"; // local-development and legacy name
export const PRODUCTION_COOKIE = "__Host-pit_session";

export function sessionCookieName(secure) {
  return secure ? PRODUCTION_COOKIE : COOKIE;
}

function cookieSuffix(expiresAt, secure) {
  const exp = new Date(expiresAt).toUTCString();
  return `Path=/; HttpOnly; SameSite=Lax; Expires=${exp}${secure ? "; Secure" : ""}; Priority=High`;
}

function expiredCookie(name, secure) {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? "; Secure" : ""}; Priority=High`;
}

export function sessionCookie(token, expiresAt, secure) {
  return `${sessionCookieName(secure)}=${token}; ${cookieSuffix(expiresAt, secure)}`;
}

export function sessionCookieHeaders(token, expiresAt, secure) {
  const headers = [sessionCookie(token, expiresAt, secure)];
  // A successful production login also retires the pre-hardening cookie.
  if (secure) headers.push(expiredCookie(COOKIE, true));
  return headers;
}

export function clearCookie(secure) {
  return expiredCookie(sessionCookieName(secure), secure);
}

export function clearSessionCookies(secure) {
  const headers = [clearCookie(secure)];
  if (secure) headers.push(expiredCookie(COOKIE, true));
  return headers;
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
