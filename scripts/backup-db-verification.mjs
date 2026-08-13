import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

// Tables whose absence means a snapshot is unusable even when SQLite's page
// structure itself is valid.
export const CRITICAL_BACKUP_TABLES = Object.freeze(["users", "posts", "artists"]);

export function backupRetentionCount(value, fallback = 7) {
  const raw = value == null || String(value).trim() === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(raw) || raw < 1) {
    throw new Error("BACKUP_KEEP must be a positive safe integer.");
  }
  return raw;
}

export function boundedBackupTimeout(value, fallback, { min = 1_000, max = 30 * 60 * 1000 } = {}) {
  const parsed = value == null || String(value).trim() === "" ? Number(fallback) : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return Math.max(min, Math.min(max, Number(fallback)));
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

export function backupTableCounts(database) {
  const out = {};
  for (const table of CRITICAL_BACKUP_TABLES) {
    try {
      out[table] = Number(database.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c);
    } catch {
      out[table] = null;
    }
  }
  return out;
}

// Open the backup independently before calling it usable. `expected` is a
// conservative floor captured immediately before VACUUM INTO. Inserts that
// commit before SQLite takes its snapshot can make the backup newer than that
// floor and are valid. Falling below the floor is treated as a failed backup;
// a concurrent delete can cause a safe false alarm, but never silent data loss.
export function verifyBackupSnapshot(path, expected = null) {
  if (!existsSync(path)) throw new Error(`No such snapshot: ${path}`);
  const snapshot = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = snapshot.prepare("PRAGMA integrity_check").get();
    const verdict = String(Object.values(integrity)[0] || "");
    if (verdict !== "ok") throw new Error(`integrity_check failed: ${verdict}`);

    const got = backupTableCounts(snapshot);
    for (const table of CRITICAL_BACKUP_TABLES) {
      if (got[table] === null) throw new Error(`${table} is missing from the snapshot`);
    }

    if (expected) {
      for (const table of CRITICAL_BACKUP_TABLES) {
        const floor = expected[table];
        if (!Number.isSafeInteger(floor) || floor < 0) {
          throw new Error(`${table}: source row baseline is unavailable`);
        }
        if (got[table] < floor) {
          throw new Error(`${table}: snapshot lost rows (${got[table]} < ${floor})`);
        }
      }
    }
    return got;
  } finally {
    snapshot.close();
  }
}
