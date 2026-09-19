import { DatabaseSync } from "node:sqlite";
import { isAbsolute } from "node:path";
import { registerPitSqliteFunctions } from "../../sqliteFunctions.js";

// This connection deliberately never imports db.js: no migrations, seed writes,
// schedulers, provider credentials, or alternate database path are allowed here.
export function openSitemapReadDatabase(path) {
  if (typeof path !== "string" || !isAbsolute(path) || path.length > 4096) {
    throw new TypeError("SITEMAP_WORKER_DATABASE_PATH");
  }
  const database = new DatabaseSync(path, { readOnly: true, enableExtensions: false });
  try {
    registerPitSqliteFunctions(database);
    database.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=1000; PRAGMA cache_size=-8192;");
    return database;
  } catch (error) { database.close(); throw error; }
}
