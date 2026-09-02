import { randomBytes } from "node:crypto";
import { opaqueId } from "./ids.js";
import { hashPassword, verifyPassword } from "./auth.js";
import {
  OWNER_IDENTITY_KEY,
  configuredOwnerEmail,
  ownerIdentity,
  readOwnerIdentityState,
  storeOwnerIdentity,
} from "./ownerIdentity.js";

// Backward-compatible export for the existing tests and operational tooling.
export const BOOTSTRAP_ADMIN_IDENTITY_KEY = OWNER_IDENTITY_KEY;

function configuredPassword(env) {
  const value = env?.ADMIN_PASSWORD;
  return typeof value === "string" && value.length ? value : null;
}

function assertProductionPassword(password, email) {
  const normalized = String(password || "").trim().toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, "");
  const emailLocal = String(email || "").trim().toLowerCase().split("@", 1)[0].replace(/[^a-z0-9]/g, "");
  const looksLikePlaceholder = /^(?:password|admin|changeme|default|placeholder|letmein|secret|test)+\d*$/.test(compact)
    || /(?:replace[-_ ]?(?:me|this)|your[-_ ]?(?:admin[-_ ]?)?password|set[-_ ]?(?:a[-_ ]?)?password)/.test(normalized)
    || /^(.{1,8})\1+$/.test(normalized)
    || (emailLocal.length >= 4 && compact.includes(emailLocal));
  if ([...String(password || "").trim()].length < 16
      || normalized === String(email || "").trim().toLowerCase()
      || looksLikePlaceholder) {
    throw new Error("ADMIN_PASSWORD must be at least 16 characters and must not be a default or account-identifying value.");
  }
}

function atomic(database, action) {
  if (typeof database?.transaction === "function") return database.transaction(action)();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try { database.exec("ROLLBACK"); }
    catch { /* architecture: allow-empty-catch -- preserve the original reconciliation failure if rollback itself fails */ }
    throw error;
  }
}

function revokeAllAdminSessions(database) {
  database.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role='admin')").run();
}

function retireBootstrapRoot(database, userId, retiredPasswordHash) {
  if (!userId) return;
  database.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
  database.prepare("UPDATE users SET pass_hash=?,role='fan' WHERE id=?")
    .run(retiredPasswordHash, userId);
}

function availableBootstrapHandle(database, userId, email) {
  const local = String(email || "mshpit").split("@", 1)[0]
    .toLowerCase().replace(/[^a-z0-9_]/g, "").replace(/^_+|_+$/g, "");
  const preferred = (local || "mshpit").slice(0, 20);
  if (!database.prepare("SELECT 1 FROM users WHERE handle=?").get(preferred)) return preferred;
  const suffix = String(userId || "owner").toLowerCase().replace(/[^a-z0-9]/g, "").slice(-8) || "owner";
  const stem = `${preferred}_${suffix}`.slice(0, 20);
  let candidate = stem;
  let sequence = 2;
  while (database.prepare("SELECT 1 FROM users WHERE handle=?").get(candidate)) {
    candidate = `${stem.slice(0, 20 - String(sequence).length)}${sequence}`;
    sequence += 1;
  }
  return candidate;
}

export function reconcileAdminAccount({
  database,
  queries,
  env = process.env,
  production = env?.NODE_ENV === "production",
  log = console,
  createId = () => opaqueId("u"),
  createDevelopmentPassword = () => randomBytes(18).toString("base64url"),
  now = Date.now,
} = {}) {
  const configured = configuredPassword(env);
  const configuredAdminEmail = configuredOwnerEmail(env);
  if (production && !configured) {
    throw new Error("ADMIN_PASSWORD is required when NODE_ENV=production; refusing to create or start an administrator account.");
  }
  if (production && !configuredAdminEmail) {
    throw new Error("A valid ADMIN_EMAIL is required when NODE_ENV=production, and OWNER_EMAIL must match it; refusing to create or start the Owner account.");
  }
  // Local development gets a deliberately non-routable identity. Never bake a
  // real person's mailbox into source control or make it the implicit root.
  const email = configuredAdminEmail || "admin@localhost.invalid";
  if (production) assertProductionPassword(configured, email);

  const existing = queries.userByEmail.get(email);
  const storedOwnerState = production ? readOwnerIdentityState(database) : { state: "missing", identity: null };
  if (production && storedOwnerState.state === "invalid") {
    throw new Error("The stored Owner identity is malformed; refusing to adopt or replace an Owner automatically.");
  }
  const storedIdentity = storedOwnerState.identity;
  // Once v2 is present, changing deployment configuration cannot transfer the
  // Owner. A deliberate migration from the legacy v1 marker is allowed exactly
  // once; the first successful v2 write permanently closes that path.
  if (production && storedIdentity?.version === 2 && storedIdentity.email !== email) {
    throw new Error(`OWNER_EMAIL does not match the locked Owner identity (${storedIdentity.email}); refusing an automatic ownership transfer.`);
  }
  if (production && storedIdentity?.version === 2 && storedIdentity.userId !== existing?.id) {
    throw new Error("The locked Owner account is missing or no longer matches its stored identity; refusing to replace it automatically.");
  }
  if (production && storedIdentity?.version === 1) {
    const approvedMigrationEmail = String(env?.OWNER_MIGRATION_EMAIL || "").trim().toLowerCase();
    if (approvedMigrationEmail !== email) {
      const legacyIdentityIsHealthy = storedIdentity.email === email
        && storedIdentity.userId === existing?.id
        && existing?.role === "admin"
        && !existing?.is_banned
        && Number(existing?.suspended_until || 0) <= now()
        && !!existing?.email_verified_at;
      // A rolling deployment must be able to start on the last known-good v1
      // identity before Render applies the explicit migration environment. This
      // path neither upgrades the marker nor grants any v2 Owner capability; it
      // only preserves the same confirmed, unrestricted legacy administrator.
      // Any attempted identity/configuration drift still fails closed below.
      if (legacyIdentityIsHealthy && !approvedMigrationEmail) {
        log.warn?.("[pit] legacy Owner migration is pending explicit OWNER_MIGRATION_EMAIL approval; existing authority was left unchanged");
        return {
          created: false,
          passwordChanged: false,
          authorityChanged: false,
          sessionsRevoked: false,
          generated: false,
          migrationPending: true,
        };
      }
      throw new Error("OWNER_MIGRATION_EMAIL must explicitly match OWNER_EMAIL for the one-time legacy Owner lock or transfer.");
    }
    if (!existing) {
      throw new Error("The one-time Owner migration requires an existing member account; refusing to create a replacement identity automatically.");
    }
    if (!existing.email_verified_at) {
      throw new Error("The one-time Owner migration requires an already-confirmed member email.");
    }
  }

  if (!existing) {
    const generated = !configured;
    const password = configured || createDevelopmentPassword();
    const id = createId();
    const passwordHash = hashPassword(password);
    const priorBootstrapRootId = production && storedIdentity?.userId !== id
      ? storedIdentity?.userId
      : null;
    const retiredPasswordHash = priorBootstrapRootId
      ? hashPassword(randomBytes(32).toString("base64url"))
      : null;
    const handle = availableBootstrapHandle(database, id, email);
    const create = () => {
      queries.insertUser.run(id, email, production ? "Mshpit" : "Pit Administrator", handle, passwordHash,
        "admin", null, null, null, "PA", "#F2A65A", now());
      // The production root identity is asserted by deployment configuration plus
      // its dedicated admin secret. Mark only that configured bootstrap identity;
      // this is private address confirmation, never the public verified badge.
      if (production) {
        database.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(now(), id);
        retireBootstrapRoot(database, priorBootstrapRootId, retiredPasswordHash);
        storeOwnerIdentity(database, ownerIdentity(email, id, now()));
        // First adoption is a security boundary: no privileged cookie minted
        // before the canonical root marker existed can survive it.
        revokeAllAdminSessions(database);
      }
    };
    if (production) atomic(database, create);
    else create();
    log.info?.(production && priorBootstrapRootId
      ? "[pit] bootstrap administrator identity transferred to a new account; prior root retired and all admin sessions revoked"
      : "[pit] administrator account created");
    if (generated) {
      // Development only: production returned above. A local generated account
      // would otherwise be impossible to use; never send this line to hosted logs.
      log.warn?.(`[pit] local development admin password (set ADMIN_PASSWORD to replace it): ${password}`);
    }
    return { created: true, passwordChanged: false, authorityChanged: false, sessionsRevoked: production, generated };
  }

  // In local development, an omitted ADMIN_PASSWORD leaves an existing
  // credential alone. Otherwise each restart would silently rotate it to an
  // unreported random value and invalidate every session.
  // A deployed secret may create a brand-new bootstrap account, but it must not
  // seize the password of an existing confirmed member during Owner adoption.
  // Once the account exists, password changes belong to that account's normal
  // authenticated recovery/settings flow, not to Render configuration drift.
  const passwordChanged = !production && !!configured && !verifyPassword(configured, existing.pass_hash);
  const authorityChanged = existing.role !== "admin"
    || !!existing.is_banned
    || Number(existing.suspended_until || 0) > 0
    || (production && !existing.email_verified_at);
  const identityChanged = production && (storedIdentity?.version !== 2
    || storedIdentity?.email !== email
    || storedIdentity?.userId !== existing.id);
  if (!passwordChanged && !authorityChanged && !identityChanged) {
    return { created: false, passwordChanged: false, authorityChanged: false, sessionsRevoked: false, generated: false };
  }

  const replacementPasswordHash = passwordChanged ? hashPassword(configured) : null;
  const priorBootstrapRootId = identityChanged && storedIdentity?.userId !== existing.id
    ? storedIdentity?.userId
    : null;
  // Root transfer invalidates the old deployment credential even if its account
  // remains available for content ownership and ordinary mailbox recovery.
  const retiredPasswordHash = priorBootstrapRootId
    ? hashPassword(randomBytes(32).toString("base64url"))
    : null;

  atomic(database, () => {
    if (passwordChanged) {
      database.prepare(`UPDATE users SET pass_hash=?, role='admin', is_banned=0, suspended_until=NULL,
        email_verified_at=CASE WHEN ?>0 THEN ? ELSE email_verified_at END WHERE id=?`)
        .run(replacementPasswordHash, production ? 1 : 0, now(), existing.id);
    } else if (authorityChanged) {
      database.prepare(`UPDATE users SET role='admin', is_banned=0, suspended_until=NULL,
        email_verified_at=CASE WHEN ?>0 THEN ? ELSE email_verified_at END WHERE id=?`)
        .run(production ? 1 : 0, now(), existing.id);
    }
    if (identityChanged) {
      retireBootstrapRoot(database, priorBootstrapRootId, retiredPasswordHash);
      storeOwnerIdentity(database, ownerIdentity(email, existing.id, now()));
      // Other legitimate administrators keep their role, but every existing
      // admin cookie must authenticate again after a root transfer.
      revokeAllAdminSessions(database);
    } else {
      // Password rotation and authority repair are both privilege boundaries. A
      // pre-existing cookie must never silently inherit the repaired admin role.
      database.prepare("DELETE FROM sessions WHERE user_id=?").run(existing.id);
    }
  });
  log.info?.(identityChanged
    ? "[pit] bootstrap administrator identity transferred; prior root retired and all admin sessions revoked"
    : "[pit] administrator account reconciled; existing sessions revoked");
  return { created: false, passwordChanged, authorityChanged, sessionsRevoked: true, generated: false };
}
