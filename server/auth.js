// Auth primitives — scrypt password hashing + opaque session tokens.
// Zero dependencies (node:crypto only).
//
// Design notes, so this stays easy to fix:
// - Passwords: scrypt (memory-hard) with a per-user random salt. Stored as
//   "scrypt:<salt hex>:<hash hex>" so the algorithm can be swapped later and old
//   hashes still verify.
// - Sessions: 32 random bytes, sent to the client as an httpOnly cookie. The DB
//   stores only sha256(token) — a leaked DB cannot be replayed as a session.
// - Rate limiting: fixed-window in-memory buckets per key. Survivable default:
//   if the process restarts, buckets reset — acceptable, fails open not closed.
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
