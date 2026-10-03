import { createHash, randomBytes } from "node:crypto";

export const SIGNUP_RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const actorProof = (user) => digest(JSON.stringify([user.id, user.email, user.pass_hash, user.role, !!user.email_verified_at]));

// Pending submissions never occupy users/email capacity or authorize a session.
// Additive only: existing users and the legacy two-account invariant are intact.
export function ensureSignupReservationsSchema(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS signup_reservations (
    token_hash TEXT PRIMARY KEY,
    cancel_hash TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    payload TEXT NOT NULL,
    actor_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    actor_proof TEXT,
    session_hash TEXT REFERENCES sessions(token_hash) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','occupied','revoked')),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
  );
  CREATE INDEX IF NOT EXISTS idx_signup_reservations_email ON signup_reservations(email);
  CREATE INDEX IF NOT EXISTS idx_signup_reservations_expiry ON signup_reservations(expires_at);
  CREATE INDEX IF NOT EXISTS idx_signup_reservations_actor ON signup_reservations(actor_id);
  CREATE INDEX IF NOT EXISTS idx_signup_reservations_session ON signup_reservations(session_hash);`);
}

export function pruneExpiredSignupReservations(database, at = Date.now()) {
  return Number(database.prepare("DELETE FROM signup_reservations WHERE expires_at<=?").run(at).changes);
}

export function cancelSignupReservation(database, cancelHash) {
  return database.prepare("DELETE FROM signup_reservations WHERE cancel_hash=?").run(cancelHash).changes === 1;
}

export function prepareSignupReservation(database, { payload, cancelToken, actor = null, sessionToken = null, at = Date.now() }) {
  if (!database.isTransaction) throw new Error("Signup reservation requires a transaction");
  const email = normalizeEmail(payload.email);
  const accounts = database.prepare("SELECT id FROM users WHERE lower(trim(email))=?").all(email);
  // An unauthenticated signup cannot create a sibling. Existing accounts use
  // login/recovery first; their response remains identical to a staged signup.
  if ((!actor && accounts.length) || accounts.length >= 2) return null;
  const token = randomBytes(32).toString("base64url");
  const tokenHash = digest(token);
  const sessionHash = actor && sessionToken ? digest(sessionToken) : null;
  if (actor && (!sessionHash || !actor.email_verified_at || normalizeEmail(actor.email) !== email)) {
    throw new Error("An additional signup requires a verified session proof");
  }
  database.prepare(`INSERT INTO signup_reservations
    (token_hash,cancel_hash,email,payload,actor_id,actor_proof,session_hash,created_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(tokenHash, digest(cancelToken), email, JSON.stringify(payload),
    actor?.id || null, actor ? actorProof(actor) : null, sessionHash, at, at + SIGNUP_RESERVATION_TTL_MS);
  return { token, tokenHash, email, expiresAt: at + SIGNUP_RESERVATION_TTL_MS };
}

// The verification transaction owns this entire operation, including the
// injected database-only creation callback and its replay receipt. No awaits.
export function consumeSignupReservation(database, { tokenHash, at = Date.now(), sessionTtlForRole, createAccount }) {
  if (!database.isTransaction) throw new Error("Signup consumption requires a transaction");
  const row = database.prepare("SELECT * FROM signup_reservations WHERE token_hash=? AND expires_at>?").get(tokenHash, at);
  if (!row) return null;
  const blocked = (reason) => {
    database.prepare("UPDATE signup_reservations SET status=?,payload='{}',actor_proof=NULL WHERE token_hash=?")
      .run(reason === "account_exists" ? "occupied" : "revoked", tokenHash);
    return { blocked: reason };
  };
  if (row.status !== "pending") return { blocked: row.status === "occupied" ? "account_exists" : "authorization_changed" };
  const accounts = database.prepare("SELECT id FROM users WHERE lower(trim(email))=?").all(row.email);
  if ((!row.actor_id && accounts.length) || accounts.length >= 2) return blocked("account_exists");
  if (row.actor_id) {
    const actor = database.prepare("SELECT * FROM users WHERE id=?").get(row.actor_id);
    const session = database.prepare("SELECT * FROM sessions WHERE token_hash=?").get(row.session_hash);
    if (!actor || actor.is_banned || Number(actor.suspended_until || 0) > at || actor.dormant_at != null
      || !actor.email_verified_at || normalizeEmail(actor.email) !== row.email || actorProof(actor) !== row.actor_proof
      || !session || session.user_id !== actor.id
      || Math.min(session.expires_at, session.created_at + sessionTtlForRole(actor.role)) <= at) {
      return blocked("authorization_changed");
    }
  }
  const user = createAccount(JSON.parse(row.payload), at);
  // Other submissions cannot spring back to life if this email is later freed.
  // Keep only a bounded-lived outcome so their mailbox holder gets useful login
  // guidance rather than an apparently expired link after a concurrent confirm.
  database.prepare("UPDATE signup_reservations SET status='occupied',payload='{}',actor_proof=NULL WHERE email=?")
    .run(row.email);
  database.prepare("DELETE FROM signup_reservations WHERE token_hash=?").run(tokenHash);
  return { user, expiresAt: row.expires_at };
}
