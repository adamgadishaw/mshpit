// Auth primitives, scrypt password hashing + opaque session tokens.
// Zero dependencies (node:crypto only).
//
// Design notes, so this stays easy to fix:
// - Passwords: scrypt (memory-hard) with a per-user random salt. Stored as
//   "scrypt:<salt hex>:<hash hex>" so the algorithm can be swapped later and old
//   hashes still verify.
// - Sessions: 32 random bytes, sent to the client as an httpOnly cookie. The DB
//   stores only sha256(token), a leaked DB cannot be replayed as a session.
// - Rate limiting: fixed-window in-memory buckets per key. Survivable default:
//   if the process restarts, buckets reset, acceptable, fails open not closed.
import { scryptSync, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { q } from "./db.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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

// --- sessions ----------------------------------------------------------------
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export function createSession(userId, ip, ua) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  q.insertSession.run(sha256(token), userId, now, now + SESSION_TTL_MS, String(ip || ""), String(ua || "").slice(0, 200));
  return { token, expiresAt: now + SESSION_TTL_MS };
}

export function getSession(token) {
  if (!token) return null;
  const row = q.sessionByHash.get(sha256(token));
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    q.deleteSession.run(row.token_hash);
    return null;
  }
  return row;
}

export function destroySession(token) {
  if (token) q.deleteSession.run(sha256(token));
}

export function sweepExpiredSessions() {
  q.deleteExpiredSessions.run(Date.now());
}

// --- rate limiting -----------------------------------------------------------
const buckets = new Map(); // key -> { count, resetAt }

export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt < now) {
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

  const plans = [];
  for (const request of grouped.values()) {
    const previous = buckets.get(request.key);
    const activePrevious = previous && previous.resetAt >= reservedAt ? previous : null;
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

// Bound the bucket map so it can't grow without limit (memory-safety).
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
  if (buckets.size > 50000) buckets.clear(); // hard ceiling, fail open
}, 60000).unref();

// --- cookie helpers ----------------------------------------------------------
export const COOKIE = "pit_session";

export function sessionCookie(token, expiresAt, secure) {
  const exp = new Date(expiresAt).toUTCString();
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${exp}${secure ? "; Secure" : ""}`;
}

export function clearCookie(secure) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? "; Secure" : ""}`;
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
