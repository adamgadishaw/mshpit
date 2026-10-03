import { DatabaseSync } from "node:sqlite";
import { closeSync, lstatSync, openSync, readdirSync, realpathSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export const BACKUP_OWNERSHIP_FILE = ".backup-ownership-v1.sqlite";
const APPLICATION_ID = 0x50425431;
const PARTIAL = /^(pit-\d{8}-\d{6}\.db\.partial-([1-9]\d*))(?:-journal|-wal|-shm)?$/;

function privateRegularFile(path, { missing = false } = {}) {
  let stat;
  try { stat = lstatSync(path); }
  catch (error) { if (missing && error.code === "ENOENT") return null; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
      || (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
    throw new Error("Backup ownership requires an owned regular file.");
  }
  return stat;
}

function deadProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return false; }
  catch (error) { return error.code === "ESRCH"; }
}

// A kernel-backed SQLite write lock has no stale-lock deletion protocol: death
// releases it automatically. Keep this file permanently; unlinking it would
// allow two processes to lock different inodes. No application data lives here.
export function acquireBackupOwnership(directory) {
  const root = realpathSync(directory);
  const directoryStat = lstatSync(root);
  if (!directoryStat.isDirectory() || (typeof process.getuid === "function"
      && (directoryStat.uid !== process.getuid() || (directoryStat.mode & 0o022)))) {
    throw new Error("Backup directory must be owned and not writable by other users.");
  }
  const path = join(root, BACKUP_OWNERSHIP_FILE);
  try { closeSync(openSync(path, "wx", 0o600)); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  privateRegularFile(path);
  for (const suffix of ["-journal", "-wal", "-shm"]) privateRegularFile(`${path}${suffix}`, { missing: true });
  const database = new DatabaseSync(path);
  try {
    // Fail promptly on contention; callers retry through their existing cadence.
    database.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE");
    const identity = database.prepare("PRAGMA application_id").get().application_id;
    if ((identity !== 0 && identity !== APPLICATION_ID)
        || database.prepare("SELECT COUNT(*) count FROM sqlite_schema").get().count !== 0) {
      throw new Error("Unexpected backup ownership database.");
    }
    database.exec(`PRAGMA application_id=${APPLICATION_ID}`);
  } catch (error) { database.close(); throw error; }
  let closed = false;
  const remove = (name) => {
    const match = PARTIAL.exec(name);
    if (!match) throw new TypeError("Invalid backup partial name.");
    // Never follow links, delete directories, or touch a completed snapshot.
    const target = join(root, name);
    if (privateRegularFile(target, { missing: true })) unlinkSync(target);
  };
  return Object.freeze({
    cleanup({ pid } = {}) {
      if (closed) throw new Error("Backup ownership already released.");
      let removed = 0;
      for (const name of readdirSync(root)) {
        const match = PARTIAL.exec(name);
        if (!match) continue;
        const owner = Number(match[2]);
        if ((pid !== undefined && owner !== pid) || !deadProcess(owner)) continue;
        // Ambiguous entries remain for operator inspection, including symlinks.
        try {
          privateRegularFile(join(root, match[1]), { missing: true });
          remove(name);
          removed += 1;
        } catch (error) {
          if (error.code === "ENOENT") continue;
          if (error.message === "Backup ownership requires an owned regular file.") continue;
          throw error;
        }
      }
      return removed;
    },
    removeOwnPartial(name) {
      if (closed) throw new Error("Backup ownership already released.");
      const match = PARTIAL.exec(name);
      if (!match || match[1] !== name || Number(match[2]) !== process.pid) {
        throw new TypeError("Backup cleanup requires this process's exact partial.");
      }
      for (const suffix of ["", "-journal", "-wal", "-shm"]) remove(`${name}${suffix}`);
    },
    close() {
      if (closed) return;
      closed = true;
      try { database.exec("COMMIT"); } finally { database.close(); }
    },
  });
}

// Called only after child close/spawnSync return. PID liveness remains a second
// conservative check against reuse; lock contention leaves cleanup to next run.
export function cleanupClosedBackup(directory, pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return;
  const ownership = acquireBackupOwnership(directory);
  try { return ownership.cleanup({ pid }); } finally { ownership.close(); }
}
