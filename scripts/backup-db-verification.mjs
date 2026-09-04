import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { registerPitSqliteFunctions } from "../server/sqliteFunctions.js";
import { PIT_SQLITE_APPLICATION_ID } from "../server/dataDirectory.js";

// These tables contain the irreplaceable product graph. A SQLite file can pass
// page integrity while still being the wrong or partially initialized Pit
// database, so recovery proof covers artist profiles/photos, venue reviews,
// tour coverage, and app metadata in addition to accounts and posts.
export const CRITICAL_BACKUP_TABLES = Object.freeze([
  "schema_version",
  "users",
  "posts",
  "artists",
  "tour_dates",
  "artist_profiles",
  "venue_reviews",
  "app_meta",
]);

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
  registerPitSqliteFunctions(snapshot);
  try {
    const integrity = snapshot.prepare("PRAGMA integrity_check").get();
    const verdict = String(Object.values(integrity)[0] || "");
    if (verdict !== "ok") throw new Error(`integrity_check failed: ${verdict}`);
    const foreignKeyFailures = snapshot.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyFailures.length) {
      // Do not print table/row samples: recovery output can be copied into
      // third-party incident tickets. The count is enough to reject the copy.
      throw new Error(`foreign_key_check failed (${foreignKeyFailures.length} violation(s))`);
    }

    const applicationId = Number(snapshot.prepare("PRAGMA application_id").get()?.application_id || 0);
    if (applicationId !== 0 && applicationId !== PIT_SQLITE_APPLICATION_ID) {
      throw new Error(`unexpected SQLite application_id: ${applicationId}`);
    }

    const got = backupTableCounts(snapshot);
    for (const table of CRITICAL_BACKUP_TABLES) {
      if (got[table] === null) throw new Error(`${table} is missing from the snapshot`);
    }
    if (got.schema_version < 1) throw new Error("schema_version is empty in the snapshot");
    if (got.users < 1 || got.artists < 1) {
      throw new Error("critical account or artist catalogue data is empty in the snapshot");
    }
    if (applicationId === 0 && got.posts < 1) {
      throw new Error("unmarked legacy snapshot has no posts");
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
