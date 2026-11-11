import { createHash } from "node:crypto";
import { privateBackupStorageConfig } from "./backupStorageSecurity.js";

// Identifies storage, never its credential. Credential rotation in the same
// namespace preserves evidence; a different endpoint/path/bucket does not.
export function backupStorageIdentity(env = process.env) {
  const config = privateBackupStorageConfig(env);
  if (!config) return null;
  return createHash("sha256").update(JSON.stringify([
    "backup-storage-v1", config.endpoint.origin,
    config.endpoint.pathname.replace(/\/+$/u, ""), config.bucket,
    "db/", "privacy-journal/v1/", "privacy-journal/coverage-v1.json",
  ])).digest("hex");
}
