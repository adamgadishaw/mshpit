// Consistent SQLite backups.
//
// Copying pit.db while the server is running is NOT a backup: the database is in
// WAL mode, so committed transactions live in pit.db-wal until a checkpoint and a
// bare file copy can land mid-transaction. `VACUUM INTO` asks SQLite itself for a
// transactionally consistent snapshot in a single new file, with no server
// downtime. It takes a consistent read transaction/read lock, but no exclusive
// or write lock on the live database.
//
//   node scripts/backup-db.mjs               snapshot + verify + prune
//   node scripts/backup-db.mjs --verify FILE  prove an existing snapshot opens
//   node scripts/backup-db.mjs --upload       also copy off-host (see below)
//
// Off-host upload is deliberately NOT wired to the MEDIA_* bucket. That bucket is
// public-read so photos can be served from it; putting a database dump there
// would publish every account, email and password hash on the internet. Upload
// requires its own private BACKUP_S3_* credentials and refuses to run if it is
// pointed at the media bucket.
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, renameSync, statfsSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerPitSqliteFunctions } from "../server/sqliteFunctions.js";
import { uploadPrivateBackup } from "../server/backupTransfer.js";
import {
  backupRetentionCount,
  backupSourceManifest,
  backupTableCounts,
  boundedBackupTimeout,
  isDiskFullError,
  requiredBackupBytes,
  snapshotsToFreeSpace,
  verifyBackupSnapshot,
} from "./backup-db-verification.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(String(process.env.PIT_DATA_DIR || "").trim() || join(HERE, "../server/data"));
const SOURCE = join(DATA_DIR, "pit.db");
// Production snapshots belong on the mounted data disk. Keeping the historical
// repo-level default for local CLI use avoids surprising developers, while the
// hosted scheduler gets restart-persistent snapshots under /data/backups.
const DEFAULT_BACKUP_DIR = process.env.NODE_ENV === "production" ? join(DATA_DIR, "backups") : join(HERE, "../backups");
const BACKUP_DIR = resolve(String(process.env.BACKUP_DIR || "").trim() || DEFAULT_BACKUP_DIR);
// Never let Number("typo") -> NaN flow into Array#slice: slice(NaN) starts at
// zero and the old code consequently deleted every valid snapshot.
const KEEP = backupRetentionCount(process.env.BACKUP_KEEP);
const NAME = /^pit-\d{8}-\d{6}\.db$/;
const UPLOAD_TIMEOUT_MS = boundedBackupTimeout(process.env.BACKUP_UPLOAD_TIMEOUT_MS, 2 * 60 * 1000);

function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function completedSnapshots() {
  return readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && NAME.test(entry.name)).map((entry) => entry.name)
    .map((f) => {
      const stats = statSync(join(BACKUP_DIR, f));
      return { f, t: stats.mtimeMs, size: stats.size };
    })
    .sort((a, b) => b.t - a.t);
}

function prune(keep = KEEP) {
  const snapshots = completedSnapshots();
  const safeKeep = Math.max(0, Math.floor(Number(keep) || 0));
  const dropped = snapshots.slice(safeKeep);
  for (const { f } of dropped) unlinkSync(join(BACKUP_DIR, f));
  return { kept: Math.min(snapshots.length, safeKeep), dropped: dropped.length };
}

function reserveReplacementSlot() {
  const snapshots = completedSnapshots();
  // Retention rotation must make room before VACUUM INTO writes another
  // database-sized file. Keep at least the newest verified snapshot if the new
  // backup later fails; after a successful replacement the ordinary retention
  // pass below returns the directory to KEEP snapshots.
  if (snapshots.length < KEEP || snapshots.length <= 1) {
    return { kept: snapshots.length, dropped: 0 };
  }
  return prune(Math.max(1, KEEP - 1));
}

const megabytes = (bytes) => (Number(bytes) / 1048576).toFixed(2);
// Tests cannot fill a real disk. Outside production a fixture may state the free
// space or force one disk-full copy; production ignores both.
const testHooksAllowed = String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production";
let simulatedDiskFullPending = testHooksAllowed
  && String(process.env.PIT_TEST_BACKUP_DISK_FULL_ONCE || "").trim() === "1";

function freeBackupBytes() {
  const stated = testHooksAllowed ? String(process.env.PIT_TEST_BACKUP_FREE_BYTES || "").trim() : "";
  if (stated) return Number(stated);
  try {
    const stats = statfsSync(BACKUP_DIR);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch (error) {
    console.log(`space     free space unavailable (${error?.code || "unknown"}); copy deferred`);
    return Number.NaN;
  }
}

// A full disk used to fail every startup backup, and a persistent-disk service
// that refuses to start without one stayed down (2026-09-11). Delete the oldest
// completed snapshots only when that makes the copy fit; the newest always stays.
function makeRoomForCopy(requiredBytes) {
  const plan = snapshotsToFreeSpace({ snapshots: completedSnapshots(), freeBytes: freeBackupBytes(), requiredBytes });
  if (!plan.fits) {
    throw Object.assign(new Error("Backup deferred: disk space cannot safely hold a new snapshot and write headroom."), {
      code: "BACKUP_DISK_SPACE",
    });
  }
  for (const name of plan.remove) unlinkSync(join(BACKUP_DIR, name));
  if (plan.remove.length) {
    console.log(`space     preflight: pruned ${plan.remove.length} oldest snapshot(s) so a ${megabytes(requiredBytes)} MB copy fits`);
  }
}

function copyDatabaseInto(path) {
  // VACUUM INTO needs a writable handle to the source, but takes only a read lock
  // for the duration and writes nothing to it.
  const source = new DatabaseSync(SOURCE);
  registerPitSqliteFunctions(source);
  try {
    source.exec("PRAGMA cache_size=-8192; PRAGMA busy_timeout=1000");
    if (simulatedDiskFullPending) {
      simulatedDiskFullPending = false;
      throw Object.assign(new Error("database or disk is full"), { errcode: 13 });
    }
    source.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
  } finally { source.close(); }
}

const args = process.argv.slice(2);
const verifyAt = args.indexOf("--verify");
if (verifyAt !== -1) {
  const target = args[verifyAt + 1];
  if (!target) { console.error("--verify needs a path"); process.exit(2); }
  const got = verifyBackupSnapshot(resolve(target));
  console.log(`ok  ${target}\n    ${Object.entries(got).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  process.exit(0);
}

if (!existsSync(SOURCE)) { console.error(`No database at ${SOURCE}. Set PIT_DATA_DIR.`); process.exit(1); }
mkdirSync(BACKUP_DIR, { recursive: true });

const walPath = `${SOURCE}-wal`;
// An impossible copy must not destroy history during retention rotation.
makeRoomForCopy(requiredBackupBytes(statSync(SOURCE).size, existsSync(walPath) ? statSync(walPath).size : 0));
const rollover = reserveReplacementSlot();
if (rollover.dropped) {
  console.log(`preflight ${rollover.kept} verified snapshot(s) kept, ${rollover.dropped} oldest pruned for replacement capacity`);
}
const live = new DatabaseSync(SOURCE, { readOnly: true });
registerPitSqliteFunctions(live);
let expected;
let sourceManifest;
try {
  // Capture both baselines from one read snapshot. This does not block WAL
  // writers and does not mutate the source or repair missing data.
  live.exec("BEGIN");
  expected = backupTableCounts(live);
  sourceManifest = backupSourceManifest(live);
  live.exec("COMMIT");
} finally { live.close(); }

const dest = join(BACKUP_DIR, `pit-${stamp()}.db`);
// A crash or failed integrity check must not leave a filename the scheduler
// considers successful. Only the atomic rename publishes a completed snapshot.
const partial = `${dest}.partial-${process.pid}`;
let got;
let bytes;
let uploadedAt = null;
try {
  try {
    copyDatabaseInto(partial);
  } catch (error) {
    // The preflight is an estimate: a WAL can grow and filesystems have overhead.
    // On a full disk keep only the newest verified snapshot and retry once; a
    // second failure still refuses, as before.
    if (!isDiskFullError(error)) throw error;
    if (existsSync(partial)) unlinkSync(partial);
    // Recheck after the failed copy: concurrent writes may have consumed the
    // initial margin. Never delete additional recovery history if a retry still
    // cannot fit with write headroom, or if disk metrics are now unavailable.
    const beforeRetry = completedSnapshots().length;
    makeRoomForCopy(requiredBackupBytes(statSync(SOURCE).size, existsSync(walPath) ? statSync(walPath).size : 0));
    prune(1);
    const totalDropped = beforeRetry - completedSnapshots().length;
    if (!totalDropped) throw error;
    console.log(`space     disk full during copy: pruned ${totalDropped} older snapshot(s), kept the newest, retrying once`);
    copyDatabaseInto(partial);
  }

  got = verifyBackupSnapshot(partial, expected, sourceManifest);
  bytes = statSync(partial).size;
  // Keep the verified local recovery point even if the provider is unavailable.
  // The scheduler checks off-host receipts independently of local freshness, so
  // this does not suppress a missing/overdue remote retry or claim remote success.
  renameSync(partial, dest);
  if (args.includes("--upload")) uploadedAt = await uploadPrivateBackup(dest, {
    publishedName: basename(dest), timeoutMs: UPLOAD_TIMEOUT_MS,
  });
} catch (error) {
  try { if (existsSync(partial)) unlinkSync(partial); } catch {}
  throw error;
}

console.log(`snapshot  ${dest}`);
console.log(`size      ${(bytes / 1048576).toFixed(2)} MB`);
console.log(`verified  integrity_check ok  ${Object.entries(got).map(([k, v]) => `${k}=${v}`).join("  ")}`);
if (uploadedAt) console.log("uploaded  verified private off-host copy");
else console.log("offhost   skipped (pass --upload with BACKUP_S3_* set)");

const { kept, dropped } = prune();
console.log(`retention ${kept} kept, ${dropped} pruned (BACKUP_KEEP=${KEEP})`);
