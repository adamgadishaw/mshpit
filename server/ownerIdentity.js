import { cleanEmail, isEmail } from "../src/domain/validation.mjs";

// The database identity is the authority. Environment configuration may select
// the first Owner during bootstrap, but it may not silently transfer an Owner
// once a v2 identity has been locked.
export const OWNER_IDENTITY_KEY = "security.bootstrap_admin_identity.v1";

export function configuredOwnerEmail(env = process.env) {
  const rawOwner = typeof env?.OWNER_EMAIL === "string" ? env.OWNER_EMAIL.trim() : "";
  const rawLegacyAdmin = typeof env?.ADMIN_EMAIL === "string" ? env.ADMIN_EMAIL.trim() : "";
  const owner = cleanEmail(rawOwner);
  const legacyAdmin = cleanEmail(rawLegacyAdmin);
  if (rawOwner && !isEmail(owner)) return "";
  if (rawLegacyAdmin && !isEmail(legacyAdmin)) return "";
  if (owner && legacyAdmin && owner !== legacyAdmin) return "";
  return owner || legacyAdmin || "";
}

export function parseOwnerIdentity(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    const lockedAt = Number(parsed?.lockedAt);
    if (![1, 2].includes(parsed?.version)
      || typeof parsed?.email !== "string"
      || typeof parsed?.userId !== "string"
      || !isEmail(cleanEmail(parsed.email))
      || (parsed.version === 2 && (!Number.isSafeInteger(lockedAt) || lockedAt <= 0))) return null;
    return Object.freeze({
      version: parsed.version,
      email: cleanEmail(parsed.email),
      userId: String(parsed.userId),
      lockedAt: parsed.version === 2 ? lockedAt : null,
    });
  } catch {
    return null;
  }
}

export function readOwnerIdentity(database) {
  if (!database?.prepare) return null;
  const stored = database.prepare("SELECT value FROM app_meta WHERE key=?").get(OWNER_IDENTITY_KEY)?.value;
  return parseOwnerIdentity(stored);
}

export function readOwnerIdentityState(database) {
  if (!database?.prepare) return Object.freeze({ state: "missing", identity: null });
  const row = database.prepare("SELECT value FROM app_meta WHERE key=?").get(OWNER_IDENTITY_KEY);
  if (!row) return Object.freeze({ state: "missing", identity: null });
  const identity = parseOwnerIdentity(row.value);
  return Object.freeze({ state: identity ? "valid" : "invalid", identity });
}

export function ownerIdentity(email, userId, lockedAt = Date.now()) {
  return Object.freeze({
    version: 2,
    email: cleanEmail(email),
    userId: String(userId),
    lockedAt: Number(lockedAt) || Date.now(),
  });
}

export function storeOwnerIdentity(database, identity) {
  database.prepare(`INSERT INTO app_meta (key,value) VALUES (?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
    .run(OWNER_IDENTITY_KEY, JSON.stringify(identity));
}

export function isOwnerId(database, userId) {
  const identity = readOwnerIdentity(database);
  return !!identity && identity.version === 2 && identity.userId === String(userId || "");
}

export function ownerAccount(database) {
  const identity = readOwnerIdentity(database);
  if (!identity) return null;
  const user = database.prepare("SELECT * FROM users WHERE id=?").get(identity.userId);
  if (!user || cleanEmail(user.email) !== identity.email) return null;
  return { identity, user };
}

export function ownerRecipient(database, env = process.env) {
  const locked = ownerAccount(database)?.identity?.email || "";
  const configured = configuredOwnerEmail(env);
  return locked || configured;
}
