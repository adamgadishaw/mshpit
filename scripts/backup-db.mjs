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
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { presignS3Request } from "../server/media.js";
import { privateBackupStorageConfig, verifyPrivateBackupBucket } from "../server/backupStorageSecurity.js";
import {
  backupRetentionCount,
  backupTableCounts,
  boundedBackupTimeout,
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

async function upload(path, publishedName = basename(path)) {
  const need = ["BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"];
  const missing = need.filter((k) => !String(process.env[k] || "").trim());
  if (missing.length) throw new Error(`--upload needs ${missing.join(", ")}`);
  const config = privateBackupStorageConfig(process.env);
  if (!config) throw new Error("Refusing off-host upload: private backup storage is not safely configured.");
  const { endpoint, bucket } = config;
  const key = `db/${publishedName}`;
  // Configuration labels are not proof of privacy. Fail before reading the
  // database snapshot unless anonymous listing and object reads are denied.
  await verifyPrivateBackupBucket({ env: process.env, objectKey: key });
  const body = readFileSync(path);
  const url = presignS3Request({
    method: "PUT",
    url: `${endpoint.origin}${endpoint.pathname.replace(/\/+$/, "")}/${bucket}/${key}`,
    region: String(process.env.BACKUP_S3_REGION || "auto").trim(),
    accessKeyId: process.env.BACKUP_S3_ACCESS_KEY_ID.trim(),
    secretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY.trim(),
    headers: { "Content-Length": String(body.byteLength) },
    expiresIn: 900,
  });
  const res = await fetch(url, {
    method: "PUT",
    body,
    headers: { "Content-Length": String(body.byteLength) },
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!res.ok) {
    // Provider bodies can echo object names or credential-adjacent request
    // details. The status is sufficient for the scheduler's retry decision.
    const error = new Error("Off-host backup upload failed.");
    error.code = `HTTP_${res.status}`;
    throw error;
  }
  // Re-check the exact uploaded key. If a provider policy changed between
  // preflight and PUT, never report the copy as verified/private and attempt an
  // immediate authenticated removal before surfacing the failure.
  try {
    await verifyPrivateBackupBucket({ env: process.env, objectKey: key });
  } catch (privacyError) {
    try {
      const deleteUrl = presignS3Request({
        method: "DELETE",
        url: `${endpoint.origin}${endpoint.pathname.replace(/\/+$/, "")}/${bucket}/${key}`,
        region: String(process.env.BACKUP_S3_REGION || "auto").trim(),
        accessKeyId: process.env.BACKUP_S3_ACCESS_KEY_ID.trim(),
        secretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY.trim(),
        expiresIn: 60,
      });
      await fetch(deleteUrl, { method: "DELETE", signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
    } catch {}
    throw privacyError;
  }
  return key;
}

function completedSnapshots() {
  return readdirSync(BACKUP_DIR).filter((f) => NAME.test(f))
    .map((f) => ({ f, t: statSync(join(BACKUP_DIR, f)).mtimeMs }))
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

const rollover = reserveReplacementSlot();
if (rollover.dropped) {
  console.log(`preflight ${rollover.kept} verified snapshot(s) kept, ${rollover.dropped} oldest pruned for replacement capacity`);
}
const live = new DatabaseSync(SOURCE, { readOnly: true });
let expected;
try { expected = backupTableCounts(live); } finally { live.close(); }

const dest = join(BACKUP_DIR, `pit-${stamp()}.db`);
// A crash or failed integrity check must not leave a filename the scheduler
// considers successful. Only the atomic rename publishes a completed snapshot.
const partial = `${dest}.partial-${process.pid}`;
// VACUUM INTO needs a writable handle to the source, but takes only a read lock
// for the duration and writes nothing to it.
let got;
let bytes;
let uploadedAt = null;
try {
  const source = new DatabaseSync(SOURCE);
  try { source.exec(`VACUUM INTO '${partial.replace(/'/g, "''")}'`); } finally { source.close(); }

  got = verifyBackupSnapshot(partial, expected);
  bytes = statSync(partial).size;
  // When off-host durability was requested, do not publish a fresh local final
  // that would suppress the next scheduler retry unless that upload succeeded.
  if (args.includes("--upload")) uploadedAt = await upload(partial, basename(dest));
  renameSync(partial, dest);
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
