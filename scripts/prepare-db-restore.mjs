// Creates a NEW offline recovery copy. Never overwrites the input or live DB.
// Run only after replaying privacy/credential changes in an isolated clone.
import { DatabaseSync } from "node:sqlite";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { verifyBackupSnapshot } from "./backup-db-verification.mjs";
import { prepareRecoveryDatabase, assertDatabaseRecoveryReady, fenceBackupSnapshot } from "../server/databaseRecovery.js";
import { registerPitSqliteFunctions } from "../server/sqliteFunctions.js";

const DEFAULT_LIVE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../server/data/pit.db");
const entryExists = (path) => {
  try { lstatSync(path); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
};
// Resolve symlinks/junctions even when the final database does not exist yet.
function physicalPath(path) {
  const absolute = resolve(path);
  if (entryExists(absolute)) return realpathSync(absolute);
  const parent = dirname(absolute);
  if (parent === absolute) throw new Error("Recovery path has no existing root.");
  return join(physicalPath(parent), basename(absolute));
}

export function prepareOfflineRestore({ source, output, privacyReplayReference, credentialReviewReference, env = process.env } = {}) {
  if (!source || !output) throw new Error("Provide explicit --source and --output paths.");
  const input = realpathSync(resolve(source));
  // existsSync alone follows links and misses a dangling output symlink.
  // Refuse every existing directory entry before SQLite opens the destination.
  if (entryExists(resolve(output))) throw new Error("Recovery needs a new offline output, separate from the source and configured live database.");
  const destination = join(realpathSync(dirname(resolve(output))), basename(resolve(output)));
  const configuredDirectory = String(env.PIT_DATA_DIR || "").trim();
  const livePaths = [DEFAULT_LIVE_PATH, ...(configuredDirectory ? [resolve(configuredDirectory, "pit.db")] : [])].map(physicalPath);
  const same = (a, b) => process.platform === "win32" ? a?.toLowerCase() === b?.toLowerCase() : a === b;
  if (same(input, destination) || entryExists(destination) || livePaths.some(live => same(input, live) || same(destination, live))) {
    throw new Error("Recovery needs a new offline output, separate from the source and configured live database.");
  }
  if (existsSync(`${input}-wal`) || existsSync(`${input}-shm`)) throw new Error("Close/checkpoint the isolated recovery clone before preparing it.");
  verifyBackupSnapshot(input);
  const original = new DatabaseSync(input, { readOnly: true });
  registerPitSqliteFunctions(original);
  try { original.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`); } finally { original.close(); }
  const copy = new DatabaseSync(destination);
  registerPitSqliteFunctions(copy);
  try {
    fenceBackupSnapshot(copy);
    const counts = prepareRecoveryDatabase(copy, { privacyReplayReference, credentialReviewReference });
    assertDatabaseRecoveryReady(copy);
    return counts;
  } finally { copy.close(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const value = (flag) => process.argv[process.argv.indexOf(flag) + 1];
  try {
    for (const flag of ["--source", "--output", "--privacy-replay-ref", "--credential-review-ref"]) {
      if (!process.argv.includes(flag) || !value(flag) || value(flag).startsWith("--")) throw new Error(`Missing ${flag}`);
    }
    const counts = prepareOfflineRestore({ source: value("--source"), output: value("--output"),
      privacyReplayReference: value("--privacy-replay-ref"), credentialReviewReference: value("--credential-review-ref") });
    console.log("Offline recovery copy prepared; restored sessions/tokens and queued mail invalidated.", counts);
    console.log("Production was not changed. Keep outbound jobs disabled until the complete restore drill passes.");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
