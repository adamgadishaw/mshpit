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
import { scrypt, scryptSync, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { passwordWork } from "./passwordWork.js";
import { db, q } from "./db.js";
import { recordInteractiveAccountActivity } from "./features/accountLifecycle/accountLifecycle.js";

export const STANDARD_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const PRIVILEGED_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const NEWSROOM_SESSION_IDLE_MS = 48 * 60 * 60 * 1000;
export const NEWSROOM_SESSION_MAX_MS = 7 * 24 * 60 * 60 * 1000;
// Proposed duration is inactive unless separately approved and explicitly enabled.
export const newsroomSessionsEnabled = () => process.env.NEWSROOM_BROWSER_SESSIONS_ENABLED === "true";
const NEWSROOM_ROLES = new Set(["admin", "editor"]);
// Keep scoped tokens outside the legacy session table. Old deployments must
// never resolve one as full staff authority during a rolling deploy/rollback.
db.exec("CREATE TABLE IF NOT EXISTS newsroom_browser_sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,auth_role TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_newsroom_browser_sessions_user ON newsroom_browser_sessions(user_id)");
// Every credential/authority change invalidates remembered Newsroom rows,
// including a role loss followed by restoration before the next browser read.
db.exec(`CREATE TRIGGER IF NOT EXISTS revoke_newsroom_browser_sessions
  AFTER UPDATE OF role,pass_hash,is_banned,suspended_until,email_verified_at,dormant_at ON users
  WHEN OLD.role IS NOT NEW.role OR OLD.pass_hash IS NOT NEW.pass_hash
    OR NEW.is_banned<>0 OR OLD.suspended_until IS NOT NEW.suspended_until
    OR NOT (NEW.email_verified_at>0) OR NEW.dormant_at>0
  BEGIN DELETE FROM newsroom_browser_sessions WHERE user_id=NEW.id; END`);
// Starting with the feature disabled also invalidates any previously issued rows.
if (!newsroomSessionsEnabled()) db.prepare("DELETE FROM newsroom_browser_sessions").run();
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

// HTTP handlers use bounded asynchronous work. Keep synchronous helpers for
// bootstrap and fixtures only. Existing hashes need no migration.
const derivePassword = (password, salt) => passwordWork(() => new Promise((resolve, reject) => {
  scrypt(password, salt, 64, (error, hash) => error ? reject(error) : resolve(hash));
}));

export async function hashPasswordAsync(password) {
  const salt = randomBytes(16);
  const hash = await derivePassword(password, salt);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPasswordAsync(password, stored) {
  const [algo, saltHex, hashHex, extra] = String(stored || "").split(":");
  if (typeof password !== "string" || password.length > 100 || algo !== "scrypt" || extra !== undefined
    || !/^[a-f0-9]{32}$/i.test(saltHex || "") || !/^[a-f0-9]{128}$/i.test(hashHex || "")) return false;
  const hash = await derivePassword(password, Buffer.from(saltHex, "hex"));
  return timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
}

export async function verifyPasswordForUserAsync(password, stored) {
  const hasStoredPassword = typeof stored === "string" && stored.length > 0;
  const valid = await verifyPasswordAsync(password, hasStoredPassword ? stored : DUMMY_PASSWORD_RECORD);
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
  // Session issuance follows a successful explicit authentication boundary,
  // including account switching and password recovery. Atomically fence stale
  // inactivity work before issuing the session; nested password-change
  // transactions remain valid because this uses a savepoint.
  db.exec("SAVEPOINT authenticated_account_session");
  try {
    recordInteractiveAccountActivity(db, { userId, at: now, kind: "login", reactivate: true });
    q.insertSession.run(sha256(token), userId, now, now + ttl, "", "");
    db.exec("RELEASE authenticated_account_session");
  } catch (error) {
    try {
      db.exec("ROLLBACK TO authenticated_account_session; RELEASE authenticated_account_session");
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], "Session issuance and rollback failed");
    }
    throw error;
  }
  return { token, expiresAt: now + ttl };
}

export function getSession(token, { scope = "full" } = {}) {
  if (!token) return null;
  if (scope !== "full" && scope !== "newsroom") return null;
  if (scope === "newsroom" && !newsroomSessionsEnabled()) return null;
  const row = scope === "newsroom"
    ? db.prepare("SELECT * FROM newsroom_browser_sessions WHERE token_hash=?").get(sha256(token))
    : q.sessionByHash.get(sha256(token));
  if (!row) return null;
  if (scope === "newsroom") {
    const actor = q.userById.get(row.user_id);
    const expiry = Math.min(row.expires_at, row.created_at + NEWSROOM_SESSION_MAX_MS);
    if (!actor || !NEWSROOM_ROLES.has(actor.role) || actor.role !== row.auth_role
      || !actor.email_verified_at || actor.is_banned || actor.dormant_at>0 || actor.suspended_until > Date.now()
      || expiry <= Date.now()) { db.prepare("DELETE FROM newsroom_browser_sessions WHERE token_hash=?").run(row.token_hash); return null; }
    return { ...row, session_scope: "newsroom", expires_at: expiry };
  }
  // Re-evaluate the cap from the live role so an old 30-day member session
  // cannot become a 30-day staff session after a later promotion.
  const effectiveExpiry = Math.min(
    row.expires_at,
    row.created_at + sessionTtlForRole(q.userById.get(row.user_id)?.role),
  );
  if (effectiveExpiry <= Date.now()) {
    q.deleteSession.run(row.token_hash);
    return null;
  }
  return effectiveExpiry === row.expires_at ? row : { ...row, expires_at: effectiveExpiry };
}

export function createNewsroomSession(userId) {
  if (!newsroomSessionsEnabled()) throw new Error("Remembered Newsroom is not enabled.");
  const actor = q.userById.get(userId);
  if (!actor || !NEWSROOM_ROLES.has(actor.role) || !actor.email_verified_at
    || actor.is_banned || actor.dormant_at>0 || actor.suspended_until > Date.now()) throw new Error("Newsroom session requires an active verified editor.");
  db.exec("SAVEPOINT newsroom_browser_issuance");
  try {
    const token = randomBytes(32).toString("base64url"), at = Date.now();
    const expiresAt = at + NEWSROOM_SESSION_IDLE_MS;
    recordInteractiveAccountActivity(db, { userId, at, kind: "login", reactivate: true });
    db.prepare("INSERT INTO newsroom_browser_sessions(token_hash,user_id,created_at,expires_at,auth_role) VALUES (?,?,?,?,?)")
      .run(sha256(token), userId, at, expiresAt, actor.role);
    db.exec("RELEASE newsroom_browser_issuance");
    return { token, expiresAt, persistent: true, scope: "newsroom" };
  } catch (error) {
    db.exec("ROLLBACK TO newsroom_browser_issuance; RELEASE newsroom_browser_issuance"); throw error;
  }
}

export function renewNewsroomSession(token) {
  const row = getSession(token, { scope: "newsroom" });
  if (!row) return null;
  const at = Date.now(), expiresAt = Math.min(at + NEWSROOM_SESSION_IDLE_MS, row.created_at + NEWSROOM_SESSION_MAX_MS);
  if (expiresAt - row.expires_at < 12 * 60 * 60 * 1000) return null;
  const changed = db.prepare("UPDATE newsroom_browser_sessions SET expires_at=? WHERE token_hash=? AND expires_at=? AND expires_at>?")
    .run(expiresAt, row.token_hash, row.expires_at, at).changes;
  return changed ? { token, expiresAt, persistent: true, scope: "newsroom" } : null;
}

export function revokeNewsroomSessionsForUser(userId) {
  return db.prepare("DELETE FROM newsroom_browser_sessions WHERE user_id=?").run(userId).changes;
}

export function destroySession(token) {
  if (token) {
    q.deleteSession.run(sha256(token));
    db.prepare("DELETE FROM newsroom_browser_sessions WHERE token_hash=?").run(sha256(token));
  }
}

export function sweepExpiredSessions() {
  q.deleteExpiredSessions.run(Date.now());
  db.prepare("DELETE FROM newsroom_browser_sessions WHERE token_hash IN (SELECT token_hash FROM newsroom_browser_sessions WHERE expires_at<=? ORDER BY expires_at,token_hash LIMIT 500)").run(Date.now());
}

// --- rate limiting -----------------------------------------------------------
const buckets = new Map(); // key -> { count, resetAt }
const MAX_RATE_LIMIT_BUCKETS = 50_000;
const MAX_RATE_LIMIT_RETRY_AFTER_MS = 60 * 60 * 1000;

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

export function rateLimitAvailable(key, max, windowMs, cost = 1) {
  const now = Date.now();
  const bucket = buckets.get(key);
  const active = bucket && bucket.resetAt > now ? bucket : null;
  const requested = Math.max(1, Math.floor(Number(cost) || 1));
  if (active) return active.count + requested <= max;
  return hasRateLimitBucketCapacity([key], now);
}

// The boolean limiter deliberately stays tiny for the many existing call
// sites. A denied HTTP request can ask for the matching bounded retry hint
// immediately afterwards. Node runs both synchronous calls in one turn, so
// the bucket cannot change between denial and this lookup.
export function rateLimitRetryAfterMs(key, fallbackWindowMs = 60_000, maxMs = MAX_RATE_LIMIT_RETRY_AFTER_MS) {
  const now = Date.now();
  const bucket = buckets.get(key);
  const fallback = Number.isFinite(Number(fallbackWindowMs)) && Number(fallbackWindowMs) > 0
    ? Number(fallbackWindowMs)
    : 60_000;
  const remaining = bucket?.resetAt > now ? bucket.resetAt - now : fallback;
  const ceiling = Number.isFinite(Number(maxMs)) && Number(maxMs) > 0
    ? Number(maxMs)
    : MAX_RATE_LIMIT_RETRY_AFTER_MS;
  return Math.max(1_000, Math.min(ceiling, Math.ceil(remaining)));
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

export function newsroomCookieName(secure) { return secure ? "__Host-pit_newsroom" : "pit_newsroom"; }
export function newsroomCookieHeaders(session, secure) {
  return [`${newsroomCookieName(secure)}=${session.token}; ${cookieSuffix(session.expiresAt, secure)}`];
}
export function clearNewsroomCookies(secure) { return [expiredCookie(newsroomCookieName(secure), secure)]; }

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
