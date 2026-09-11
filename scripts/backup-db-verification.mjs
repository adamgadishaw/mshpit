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

// The current source determines which tables exist: these names are row-count
// floors, NOT new requirements imposed on historical standalone snapshots.
// Cache, session and receipt pruning may race a backup, so those tables retain
// schema-presence protection without being treated as durable member content.
const MEMBER_ROW_FLOOR_TABLES = new Set([
  ...CRITICAL_BACKUP_TABLES,
  "likes", "comments", "follows", "fan_club_members", "fan_club_messages",
  "dms", "dm_reads", "ratings", "going", "artist_requests", "artist_posts",
  "post_user_tags", "post_tag_rejections", "recommendation_preferences",
  "playlists", "blocks", "account_mutes", "user_achievements", "user_badges",
  "custom_badges", "reports", "moderation_actions", "lounge_messages",
  "concert_lounges", "shows", "show_aliases", "show_performers",
  "show_attendance", "show_attendance_verifications", "linked_account_pairs",
  "media_reactions", "media_objects", "media_assets", "media_variants",
  "media_asset_revisions", "post_media", "legacy_video_posters",
]);
const quoteIdentifier = (name) => `"${String(name).replaceAll('"', '""')}"`;

export function backupSourceManifest(database) {
  const tables = database.prepare(
    "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name",
  ).all();
  return Object.fromEntries(tables.map(({ name }) => [name, {
    columns: database.prepare(`PRAGMA table_xinfo(${quoteIdentifier(name)})`).all().map((column) => column.name),
    minimumRows: MEMBER_ROW_FLOOR_TABLES.has(name)
      ? Number(database.prepare(`SELECT COUNT(*) c FROM ${quoteIdentifier(name)}`).get().c)
      : null,
  }]));
}

function verifySourceManifest(snapshot, manifest) {
  const tables = new Set(snapshot.prepare("SELECT name FROM sqlite_schema WHERE type='table'")
    .all().map((row) => row.name));
  for (const [table, expected] of Object.entries(manifest)) {
    if (!tables.has(table)) throw new Error(`${table} is missing from the source-matched snapshot`);
    const columns = new Set(snapshot.prepare(`PRAGMA table_xinfo(${quoteIdentifier(table)})`)
      .all().map((column) => column.name));
    if (!columns.size) throw new Error(`${table} is missing from the source-matched snapshot`);
    for (const column of expected.columns) {
      if (!columns.has(column)) throw new Error(`${table}: snapshot is missing source column ${column}`);
    }
    if (expected.minimumRows === null) continue;
    if (!Number.isSafeInteger(expected.minimumRows) || expected.minimumRows < 0) {
      throw new Error(`${table}: source row baseline is unavailable`);
    }
    const count = Number(snapshot.prepare(`SELECT COUNT(*) c FROM ${quoteIdentifier(table)}`).get().c);
    if (count < expected.minimumRows) {
      throw new Error(`${table}: snapshot lost rows (${count} < ${expected.minimumRows})`);
    }
  }
}

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

// A VACUUM INTO copy can need as much space as the live database plus its WAL;
// the extra tenth covers page rounding and a WAL that grows during the copy.
export function requiredBackupBytes(databaseBytes, walBytes = 0) {
  const total = Math.max(0, Number(databaseBytes) || 0) + Math.max(0, Number(walBytes) || 0);
  return total + Math.ceil(total / 10);
}

export function isDiskFullError(error) {
  return error?.errcode === 13 || error?.code === "ENOSPC"
    || /database or disk is full/i.test(String(error?.message || ""));
}

// Choose the oldest completed snapshots to delete so a new copy fits. Snapshots
// arrive newest first. The newest verified recovery point is never chosen, and
// nothing is chosen when pruning every older snapshot still would not make room:
// deleting history that cannot rescue the backup only loses recovery points.
// Unknown free space takes no preflight action.
export function snapshotsToFreeSpace({ snapshots = [], freeBytes, requiredBytes } = {}) {
  const free = Number(freeBytes);
  const needed = Number(requiredBytes);
  if (!Number.isFinite(free) || !Number.isFinite(needed) || free >= needed) return { fits: true, remove: [] };
  const remove = [];
  let available = free;
  for (let index = snapshots.length - 1; index >= 1 && available < needed; index -= 1) {
    remove.push(snapshots[index].f);
    available += Math.max(0, Number(snapshots[index].size) || 0);
  }
  return available >= needed ? { fits: true, remove } : { fits: false, remove: [] };
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
export function verifyBackupSnapshot(path, expected = null, sourceManifest = null) {
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
    const schemaVersion = snapshot.prepare("SELECT version FROM schema_version LIMIT 1").get()?.version;
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
      throw new Error("schema_version has no valid version marker");
    }
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
    if (sourceManifest) verifySourceManifest(snapshot, sourceManifest);
    return got;
  } finally {
    snapshot.close();
  }
}
