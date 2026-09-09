import { createHash } from "node:crypto";

const tokenHash = (token) => typeof token === "string" && token
  ? createHash("sha256").update(token).digest("hex") : null;
const normalizedEmail = (email) => String(email || "").trim().toLowerCase();

// A pair records successful verification of the SAME plaintext against both
// independently salted password records. Never persist plaintext, an additional
// password digest, or a reusable cross-account bearer token.
export function ensureLinkedAccountsSchema(database) {
  if (!database.prepare("PRAGMA foreign_keys").get().foreign_keys) {
    throw new Error("Linked accounts require SQLite foreign-key enforcement");
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS linked_account_pairs (
      user_a_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_b_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_a_id,user_b_id),
      CHECK (user_a_id < user_b_id)
    );
    CREATE INDEX IF NOT EXISTS idx_linked_account_pairs_b ON linked_account_pairs(user_b_id);
    CREATE TABLE IF NOT EXISTS linked_account_session_grants (
      token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
      user_a_id TEXT NOT NULL,
      user_b_id TEXT NOT NULL,
      authenticated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_a_id,user_b_id) REFERENCES linked_account_pairs(user_a_id,user_b_id) ON DELETE CASCADE,
      CHECK (expires_at > authenticated_at)
    );
    CREATE INDEX IF NOT EXISTS idx_linked_account_grants_pair
      ON linked_account_session_grants(user_a_id,user_b_id);
    CREATE TRIGGER IF NOT EXISTS trg_linked_accounts_credentials_changed
      AFTER UPDATE OF pass_hash,email,role,is_banned,suspended_until,email_verified_at ON users
      WHEN NEW.pass_hash IS NOT OLD.pass_hash OR NEW.email IS NOT OLD.email
        OR NEW.role IS NOT OLD.role OR NEW.is_banned IS NOT OLD.is_banned
        OR NEW.suspended_until IS NOT OLD.suspended_until
        OR (OLD.email_verified_at IS NOT NULL AND OLD.email_verified_at != 0
          AND (NEW.email_verified_at IS NULL OR NEW.email_verified_at = 0))
      BEGIN
        DELETE FROM linked_account_pairs WHERE user_a_id=OLD.id OR user_b_id=OLD.id;
      END;
    CREATE TRIGGER IF NOT EXISTS trg_linked_accounts_user_deleted BEFORE DELETE ON users
      BEGIN DELETE FROM linked_account_pairs WHERE user_a_id=OLD.id OR user_b_id=OLD.id; END;
    CREATE TRIGGER IF NOT EXISTS trg_linked_accounts_pair_deleted AFTER DELETE ON linked_account_pairs
      BEGIN DELETE FROM linked_account_session_grants
        WHERE user_a_id=OLD.user_a_id AND user_b_id=OLD.user_b_id; END;
  `);
}

export function createLinkedAccounts({ database, ApiError, requireSessionUser, limit, verifyPassword,
  atomicWrite, createSession, sessionTtlForRole, publicUser, now = Date.now, onAuthenticated = () => {} }) {
  if (!database?.prepare || [ApiError, requireSessionUser, limit, verifyPassword, atomicWrite,
    createSession, sessionTtlForRole, publicUser, now, onAuthenticated].some((dependency) => typeof dependency !== "function")) {
    throw new TypeError("Linked accounts require complete authentication boundary dependencies");
  }
  ensureLinkedAccountsSchema(database);
  const userById = database.prepare("SELECT * FROM users WHERE id=?");
  const sessionByHash = database.prepare("SELECT * FROM sessions WHERE token_hash=?");
  const grantByHash = database.prepare(`SELECT g.* FROM linked_account_session_grants g
    JOIN linked_account_pairs p ON p.user_a_id=g.user_a_id AND p.user_b_id=g.user_b_id
    WHERE g.token_hash=?`);
  const addPair = database.prepare(`INSERT OR IGNORE INTO linked_account_pairs
    (user_a_id,user_b_id,created_at) VALUES (?,?,?)`);
  const addGrant = database.prepare(`INSERT INTO linked_account_session_grants
    (token_hash,user_a_id,user_b_id,authenticated_at,expires_at) VALUES (?,?,?,?,?)
    ON CONFLICT(token_hash) DO UPDATE SET user_a_id=excluded.user_a_id,user_b_id=excluded.user_b_id,
      authenticated_at=excluded.authenticated_at,expires_at=excluded.expires_at`);

  function usable(user, at = now()) {
    return !!user && !user.is_banned && !(user.suspended_until && user.suspended_until > at);
  }

  function liveSession(hash, user, at = now()) {
    if (!hash || !user) return null;
    const session = sessionByHash.get(hash);
    if (!session || session.user_id !== user.id) return null;
    const expiresAt = Math.min(session.expires_at, session.created_at + sessionTtlForRole(user.role));
    return expiresAt > at ? { ...session, expires_at: expiresAt } : null;
  }

  function requireActor(ctx) {
    const actor = requireSessionUser(ctx);
    const user = userById.get(actor.id);
    if (!usable(user)) throw new ApiError(403, "This account cannot switch accounts right now.", "FORBIDDEN");
    const hash = tokenHash(ctx.token);
    const session = liveSession(hash, user);
    if (!session) throw new ApiError(401, "Log in again to manage linked accounts.", "AUTH_REQUIRED");
    return { user, hash, session };
  }

  function availableGrant(hash, user, session, at = now()) {
    if (!user.email_verified_at) return null;
    const grant = grantByHash.get(hash);
    if (!grant || (grant.user_a_id !== user.id && grant.user_b_id !== user.id)) return null;
    const target = userById.get(grant.user_a_id === user.id ? grant.user_b_id : grant.user_a_id);
    if (!usable(target, at) || !target.email_verified_at
      || normalizedEmail(target.email) !== normalizedEmail(user.email)) return null;
    const expiresAt = Math.min(grant.expires_at, session.expires_at,
      grant.authenticated_at + sessionTtlForRole(user.role),
      grant.authenticated_at + sessionTtlForRole(target.role));
    return expiresAt > at ? { ...grant, expires_at: expiresAt, target } : null;
  }

  function card(user, currentId) {
    const projected = publicUser(user);
    return {
      id: user.id,
      name: projected.name,
      handle: projected.handle,
      avatarUri: projected.avatarUri || null,
      avatarColor: projected.avatarColor || null,
      initials: projected.initials || null,
      role: projected.role,
      isCurrent: user.id === currentId,
    };
  }

  function accountList({ user, hash, session }) {
    const grant = availableGrant(hash, user, session);
    return {
      accounts: [card(user, user.id), ...(grant ? [card(grant.target, user.id)] : [])],
      connected: !!grant,
      // Independent of sibling existence: this must not be an address oracle.
      canConnect: !!user.email_verified_at && !grant,
    };
  }

  // Call after password-authenticated login/add-account, OUTSIDE any caller
  // transaction. Expensive verification precedes the write lock; snapshots are
  // checked inside it so concurrent credential changes cannot mint a link.
  // Pending signup may be linked, but no sibling metadata or switching becomes
  // available until BOTH accounts are email-verified.
  async function matchingPasswordUsers({ email, password }) {
    const candidates = database.prepare("SELECT * FROM users WHERE lower(trim(email))=? ORDER BY created_at,id LIMIT 2")
      .all(normalizedEmail(email));
    const matching = [];
    if (typeof password !== "string" || !password || password.length > 100) return matching;
    for (const user of candidates) {
      if (await verifyPassword(password, user.pass_hash)) matching.push(user);
    }
    return matching;
  }

  // These proofs are server-local snapshots from password verification, never
  // request data. No expensive work follows issuance of a replacement session.
  function grantVerifiedAccounts({ userId, users, token }) {
    const hash = tokenHash(token);
    const user = users.find((entry) => entry.id === userId);
    const other = users.find((entry) => entry.id !== userId && normalizedEmail(entry.email) === normalizedEmail(user?.email));
    if (!usable(user) || !usable(other)) return { connected: false };
    const grant = () => {
      const freshUser = userById.get(user.id);
      const freshOther = userById.get(other.id);
      const at = now();
      if (!usable(freshUser, at) || !usable(freshOther, at)
        || freshUser.pass_hash !== user.pass_hash || freshOther.pass_hash !== other.pass_hash
        || freshUser.email !== user.email || freshOther.email !== other.email
        || freshUser.role !== user.role || freshOther.role !== other.role) return { connected: false };
      const session = liveSession(hash, freshUser, at);
      if (!session) return { connected: false };
      const previous = grantByHash.get(hash);
      const authenticatedAt = Math.min(session.created_at, previous?.authenticated_at ?? session.created_at);
      const expiresAt = Math.min(session.expires_at, previous?.expires_at ?? Infinity,
        authenticatedAt + sessionTtlForRole(freshUser.role),
        authenticatedAt + sessionTtlForRole(freshOther.role));
      if (expiresAt <= at) return { connected: false };
      const [a, b] = [user.id, other.id].sort();
      addPair.run(a, b, at);
      addGrant.run(hash, a, b, authenticatedAt, expiresAt);
      return { connected: !!freshUser.email_verified_at && !!freshOther.email_verified_at };
    };
    return database.isTransaction ? grant() : atomicWrite(grant);
  }

  async function proveAndGrant({ userId, password, token, rejectInvalidPassword = false, signal }) {
    signal?.throwIfAborted();
    const user = userById.get(userId);
    const users = user ? await matchingPasswordUsers({ email: user.email, password }) : [];
    signal?.throwIfAborted();
    if (!usable(user) || !users.some((entry) => entry.id === userId && entry.pass_hash === user.pass_hash)) {
      if (rejectInvalidPassword) throw new ApiError(401, "Your password doesn't match this account.", "AUTH_INVALID");
      return { connected: false };
    }
    return grantVerifiedAccounts({ userId, users, token });
  }

  const routes = {
    "GET /api/me/accounts": (ctx) => {
      ctx.setHeader?.("Cache-Control", "no-store");
      return accountList(requireActor(ctx));
    },
    "POST /api/me/accounts/connect": async (ctx) => {
      ctx.setHeader?.("Cache-Control", "no-store");
      const { user } = requireActor(ctx);
      limit(ctx, "connect-accounts", 5, 15 * 60 * 1000);
      if (!user.email_verified_at) throw new ApiError(403, "Confirm your email before linking accounts.", "EMAIL_VERIFICATION_REQUIRED");
      await proveAndGrant({ userId: user.id, password: ctx.body?.password, token: ctx.token,
        rejectInvalidPassword: true, signal: ctx.signal });
      return accountList(requireActor(ctx));
    },
    "POST /api/me/accounts/switch": (ctx) => {
      ctx.setHeader?.("Cache-Control", "no-store");
      requireActor(ctx);
      limit(ctx, "switch-accounts", 30, 10 * 60 * 1000);
      const accountId = ctx.body?.accountId;
      if (typeof accountId !== "string" || !accountId || accountId.length > 100) {
        throw new ApiError(400, "Choose an account to switch to.", "VALIDATION_FAILED");
      }
      const result = atomicWrite(() => {
        const current = requireActor(ctx);
        const grant = availableGrant(current.hash, current.user, current.session);
        if (!grant || grant.target.id !== accountId) {
          throw new ApiError(403, "That account is not available to switch to. Confirm your password to reconnect accounts.", "FORBIDDEN");
        }
        // Rotate rather than mutating a bearer's identity. Retain the original
        // authentication time AND cap: bouncing through a member account must
        // never create a fresh twelve-hour privileged session.
        const replacement = createSession(grant.target.id, ctx.ip, ctx.ua);
        const replacementHash = tokenHash(replacement.token);
        const expiresAt = Math.min(replacement.expiresAt, grant.expires_at, current.session.expires_at);
        const changed = database.prepare(`UPDATE sessions SET created_at=?,expires_at=?
          WHERE token_hash=? AND user_id=?`).run(grant.authenticated_at, expiresAt, replacementHash, grant.target.id).changes;
        if (changed !== 1) throw new ApiError(500, "The account switch could not be completed.", "INTERNAL_ERROR");
        addGrant.run(replacementHash, grant.user_a_id, grant.user_b_id, grant.authenticated_at, expiresAt);
        const removed = database.prepare("DELETE FROM sessions WHERE token_hash=? AND user_id=?")
          .run(current.hash, current.user.id).changes;
        if (removed !== 1) throw new ApiError(409, "This session changed. Log in again.", "CONFLICT");
        onAuthenticated(grant.target.id);
        const user = userById.get(grant.target.id);
        const session = { ...replacement, expiresAt };
        return { session, response: { user: publicUser(user, { self: true }),
          ...accountList({ user, hash: replacementHash, session: sessionByHash.get(replacementHash) }) } };
      });
      ctx.setSession(result.session);
      return result.response;
    },
  };
  return { routes, proveAndGrant, matchingPasswordUsers, grantVerifiedAccounts };
}
