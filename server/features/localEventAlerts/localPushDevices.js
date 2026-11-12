import { createHash, timingSafeEqual } from "node:crypto";
import { withImmediateWrite } from "../../databaseTransaction.js";
import { ApiError } from "../../errors.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const validId = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{20,100}$/.test(value);
const validSecret = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{43,100}$/.test(value);
const matches = (secret, storedHash) => validSecret(secret) && timingSafeEqual(Buffer.from(hash(secret), "hex"), Buffer.from(storedHash, "hex"));

export function createLocalPushDevices({ db, now = Date.now }) {
  function register(accountId, input, { assertCurrentSession, sessionHash }) {
    if (!input || !validId(input.installationId) || !validSecret(input.secret)
      || !Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 0
      || !["ios", "android"].includes(input.platform) || input.permission !== "granted"
      || typeof input.token !== "string" || !/^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/.test(input.token)) {
      throw new ApiError(400, "Enable notifications on this device first.", "VALIDATION_FAILED");
    }
    return withImmediateWrite(db, () => {
      const at = now();
      if (assertCurrentSession().id !== accountId || !db.prepare("SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?").get(sessionHash, accountId, at)) {
        throw new ApiError(401, "Log in again to enable device notifications.", "AUTH_REQUIRED");
      }
      const previous = db.prepare("SELECT * FROM local_push_installations WHERE installation_id=?").get(input.installationId);
      const revoked = db.prepare("SELECT * FROM local_push_installation_receipts WHERE installation_id=?").get(input.installationId);
      if (previous && !matches(input.secret, previous.secret_hash)) throw new ApiError(403, "This device registration could not be verified.", "FORBIDDEN");
      if (revoked && !matches(input.secret, revoked.secret_hash)) throw new ApiError(403, "This device registration could not be verified.", "FORBIDDEN");
      const tokenOwner = db.prepare("SELECT installation_id FROM local_push_installations WHERE token=?").get(input.token);
      if (tokenOwner && tokenOwner.installation_id !== input.installationId) throw new ApiError(409, "This push token is already registered to another installation.", "CONFLICT");
      const changed = !previous || previous.account_id !== accountId || previous.session_hash !== sessionHash || previous.token !== input.token || !previous.enabled;
      const currentGeneration = Math.max(previous?.generation || 0, revoked?.generation || 0);
      if (changed && input.expectedGeneration !== currentGeneration) throw new ApiError(409, "This device registration changed. Try again.", "CONFLICT");
      const generation = currentGeneration + Number(changed);
      db.prepare(`INSERT INTO local_push_installations(installation_id,secret_hash,account_id,session_hash,token,platform,generation,enabled,permission,updated_at)
        VALUES (?,?,?,?,?,?,?,1,'granted',?) ON CONFLICT(installation_id) DO UPDATE SET
        account_id=excluded.account_id,session_hash=excluded.session_hash,token=excluded.token,platform=excluded.platform,
        generation=excluded.generation,enabled=1,permission='granted',updated_at=excluded.updated_at`)
        .run(input.installationId, hash(input.secret), accountId, sessionHash, input.token, input.platform, generation, at);
      // Keep the consumed generation after a session FK removes the active
      // registration, so an older request from another still-live session
      // cannot reuse it. This is installation history, not an active token.
      db.prepare(`INSERT INTO local_push_installation_receipts(installation_id,secret_hash,account_id,generation,revoked_at) VALUES (?,?,?,?,NULL)
        ON CONFLICT(installation_id) DO UPDATE SET account_id=excluded.account_id,generation=excluded.generation,revoked_at=NULL`)
        .run(input.installationId, hash(input.secret), accountId, generation);
      if (changed) db.prepare(`UPDATE local_push_outbox SET state='cancelled',lease_key=NULL WHERE id IN (
        SELECT id FROM local_push_outbox WHERE installation_id=? AND generation<>? AND state IN ('ready','sending','accepted') ORDER BY id LIMIT 100)`)
        .run(input.installationId, generation);
      return { installationId: input.installationId, generation, enabled: true };
    });
  }

  function revoke(accountId, input, assertCurrentSession) {
    if (!input || !validId(input.installationId) || !validSecret(input.secret) || !Number.isSafeInteger(input.expectedGeneration) || input.expectedGeneration < 0) throw new ApiError(400, "Choose this device registration.", "VALIDATION_FAILED");
    return withImmediateWrite(db, () => {
      if (assertCurrentSession().id !== accountId) throw new ApiError(401, "Log in again.", "AUTH_REQUIRED");
      const row = db.prepare("SELECT * FROM local_push_installations WHERE installation_id=?").get(input.installationId);
      const revoked = db.prepare("SELECT * FROM local_push_installation_receipts WHERE installation_id=?").get(input.installationId);
      const previous = row || revoked;
      if (previous && (!matches(input.secret, previous.secret_hash) || (row && row.account_id !== accountId))) throw new ApiError(403, "This account does not own this device registration.", "FORBIDDEN");
      // Retain a generation fence even if the first registration has not yet
      // arrived. Aborted HTTP requests may still commit on the server later.
      if (!row && revoked?.revoked_at != null && input.expectedGeneration === revoked.generation - 1) return { enabled: false, generation: revoked.generation };
      if (input.expectedGeneration !== (previous?.generation || 0)) throw new ApiError(409, "This device registration changed. Try again.", "CONFLICT");
      const generation = (previous?.generation || 0) + 1;
      db.prepare(`INSERT INTO local_push_installation_receipts(installation_id,secret_hash,account_id,generation,revoked_at) VALUES (?,?,?,?,?)
        ON CONFLICT(installation_id) DO UPDATE SET account_id=excluded.account_id,generation=excluded.generation,revoked_at=excluded.revoked_at`)
        .run(input.installationId, hash(input.secret), accountId, generation, now());
      db.prepare("DELETE FROM local_push_installations WHERE installation_id=?").run(input.installationId);
      return { enabled: false, generation };
    });
  }
  function binding(accountId, input, assertCurrentSession) {
    if (!input || !validId(input.installationId) || !validSecret(input.secret)) throw new ApiError(400, "Choose this device registration.", "VALIDATION_FAILED");
    if (assertCurrentSession().id !== accountId) throw new ApiError(401, "Log in again.", "AUTH_REQUIRED");
    const row = db.prepare("SELECT generation,secret_hash FROM local_push_installations WHERE installation_id=?").get(input.installationId)
      || db.prepare("SELECT generation,secret_hash FROM local_push_installation_receipts WHERE installation_id=?").get(input.installationId);
    if (row && !matches(input.secret, row.secret_hash)) throw new ApiError(403, "This device registration could not be verified.", "FORBIDDEN");
    return { generation: row?.generation || 0 };
  }
  return { register, revoke, binding };
}
