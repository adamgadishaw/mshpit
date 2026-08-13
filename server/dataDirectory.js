import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const PIT_SQLITE_APPLICATION_ID = 0x50495431; // ASCII "PIT1"
const REQUIRED_PRODUCTION_TABLES = Object.freeze(["schema_version", "users", "posts", "artists", "app_meta"]);
const REQUIRED_NONEMPTY_TABLES = Object.freeze(["users", "artists"]);

// Opening SQLite without a preflight is destructive in this particular failure
// mode: a zero-byte file (or an unrelated SQLite database) is considered a valid
// database handle, then db.js creates Pit's schema into it and production appears
// to have lost every account and post. Probe read-only before migrations instead.
export function assertExistingProductionDatabase(databasePath, { allowEmpty = false } = {}) {
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const integrity = database.prepare("PRAGMA quick_check").get();
    const verdict = String(Object.values(integrity || {})[0] || "");
    if (verdict !== "ok") throw new Error(`quick_check failed: ${verdict || "no result"}`);

    const found = new Set(database.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${REQUIRED_PRODUCTION_TABLES.map(() => "?").join(",")})`,
    ).all(...REQUIRED_PRODUCTION_TABLES).map((row) => row.name));
    const missing = REQUIRED_PRODUCTION_TABLES.filter((table) => !found.has(table));
    if (missing.length) throw new Error(`missing required tables: ${missing.join(", ")}`);

    const applicationId = Number(database.prepare("PRAGMA application_id").get()?.application_id || 0);
    if (applicationId !== 0 && applicationId !== PIT_SQLITE_APPLICATION_ID) {
      throw new Error(`unexpected SQLite application_id: ${applicationId}`);
    }
    const counts = Object.fromEntries(REQUIRED_NONEMPTY_TABLES.map((table) => [
      table,
      Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count),
    ]));
    if (!allowEmpty && REQUIRED_NONEMPTY_TABLES.some((table) => !Number.isSafeInteger(counts[table]) || counts[table] < 1)) {
      throw new Error(`critical table is empty: ${REQUIRED_NONEMPTY_TABLES.filter((table) => counts[table] < 1).join(", ")}`);
    }
    // The first release carrying this marker must still admit the known legacy
    // production database once. Requiring at least one post for that transition
    // prevents an old healthy-looking blank bootstrap from being blessed. Once
    // db.js writes PIT1, a legitimate new/staging site may reboot before its
    // first community post while users + the artist catalogue still prove it is
    // not an empty replacement database.
    if (!allowEmpty && applicationId === 0) {
      const posts = Number(database.prepare("SELECT COUNT(*) AS count FROM posts").get()?.count);
      if (!Number.isSafeInteger(posts) || posts < 1) throw new Error("unmarked legacy database has no posts");
    }
  } catch (error) {
    throw new Error(
      `The production database at ${databasePath} is not an initialized Pit database; refusing to migrate it. ` +
      "Set PIT_ALLOW_EMPTY_DB_BOOTSTRAP=true only for an intentional first boot.",
      { cause: error },
    );
  } finally {
    try { database?.close(); } catch {}
  }
}

// Production must never silently create a fallback database. A missing or
// mistyped disk path otherwise looks like a healthy empty site and makes every
// account/post appear deleted. Both an absent mount and an absent database are
// fatal unless the latter is an explicitly approved first boot.
export function prepareDataDirectory({
  env = process.env,
  fallbackDir,
  exists = existsSync,
  mkdir = (path) => mkdirSync(path, { recursive: true }),
  validateDatabase = assertExistingProductionDatabase,
} = {}) {
  const configured = String(env?.PIT_DATA_DIR || "").trim();
  const production = String(env?.NODE_ENV || "").toLowerCase() === "production";
  if (production && !configured) {
    throw new Error("PIT_DATA_DIR is required in production; refusing to create an empty fallback database.");
  }

  const directory = resolve(configured || fallbackDir || "server/data");
  if (production) {
    if (!exists(directory)) {
      throw new Error(
        `PIT_DATA_DIR does not exist at ${directory}; refusing to start without the persistent disk mount.`,
      );
    }
    const allowBootstrap = ["1", "true", "yes", "on"].includes(
      String(env?.PIT_ALLOW_EMPTY_DB_BOOTSTRAP || "").trim().toLowerCase(),
    );
    const databasePath = join(directory, "pit.db");
    if (!exists(databasePath) && !allowBootstrap) {
      throw new Error(`The production database is missing from ${directory}; refusing to create an empty site. Set PIT_ALLOW_EMPTY_DB_BOOTSTRAP=true only for an intentional first boot.`);
    }
    if (exists(databasePath) && !allowBootstrap) validateDatabase(databasePath, { allowEmpty: false });
  } else {
    mkdir(directory);
  }
  return directory;
}
