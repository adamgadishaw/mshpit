// Consistent SQLite backups.
//
// Copying pit.db while the server is running is NOT a backup: the database is in
// WAL mode, so committed transactions live in pit.db-wal until a checkpoint and a
// bare file copy can land mid-transaction. `VACUUM INTO` asks SQLite itself for a
// transactionally consistent snapshot in a single new file, with no server
// downtime and no lock held on the live database.
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
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { presignS3Request } from "../server/media.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(String(process.env.PIT_DATA_DIR || "").trim() || join(HERE, "../server/data"));
const SOURCE = join(DATA_DIR, "pit.db");
const BACKUP_DIR = resolve(String(process.env.BACKUP_DIR || "").trim() || join(HERE, "../backups"));
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP || 7));
const NAME = /^pit-\d{8}-\d{6}\.db$/;

// Tables whose emptiness would mean the snapshot is useless even if SQLite
// considers the file structurally valid.
const CRITICAL = ["users", "posts", "artists"];

function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function counts(database) {
  const out = {};
  for (const table of CRITICAL) {
    try { out[table] = database.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c; }
    catch { out[table] = null; }
  }
  return out;
}

// A backup nobody has opened is a guess. This opens the snapshot as a separate
// database and makes it answer questions before the snapshot is called good.
function verify(path, expected = null) {
  if (!existsSync(path)) throw new Error(`No such snapshot: ${path}`);
  const snapshot = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = snapshot.prepare("PRAGMA integrity_check").get();
    const verdict = String(Object.values(integrity)[0] || "");
    if (verdict !== "ok") throw new Error(`integrity_check failed: ${verdict}`);
    const got = counts(snapshot);
    for (const table of CRITICAL) {
      if (got[table] === null) throw new Error(`${table} is missing from the snapshot`);
    }
    if (expected) {
      for (const table of CRITICAL) {
        // The live DB can legitimately grow mid-backup, so the snapshot may trail
        // the source. It must never be ahead, and it must not have lost rows.
        if (got[table] > expected[table]) throw new Error(`${table}: snapshot has more rows than source (${got[table]} > ${expected[table]})`);
        if (expected[table] > 0 && got[table] === 0) throw new Error(`${table}: source had ${expected[table]} rows, snapshot has none`);
      }
    }
    return got;
  } finally { snapshot.close(); }
}

async function upload(path) {
  const need = ["BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"];
  const missing = need.filter((k) => !String(process.env[k] || "").trim());
  if (missing.length) throw new Error(`--upload needs ${missing.join(", ")}`);
  const bucket = process.env.BACKUP_S3_BUCKET.trim();
  // The guard that matters. A backup in the public media bucket is a breach.
  if (bucket === String(process.env.MEDIA_BUCKET || "").trim()) {
    throw new Error(`Refusing to upload: BACKUP_S3_BUCKET is the public media bucket (${bucket}). Use a separate private bucket.`);
  }
  const endpoint = new URL(process.env.BACKUP_S3_ENDPOINT.trim());
  const key = `db/${path.split(/[\\/]/).pop()}`;
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
  const res = await fetch(url, { method: "PUT", body, headers: { "Content-Length": String(body.byteLength) } });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return `${bucket}/${key}`;
}

function prune() {
  const kept = readdirSync(BACKUP_DIR).filter((f) => NAME.test(f))
    .map((f) => ({ f, t: statSync(join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  const dropped = kept.slice(KEEP);
  for (const { f } of dropped) unlinkSync(join(BACKUP_DIR, f));
  return { kept: Math.min(kept.length, KEEP), dropped: dropped.length };
}

const args = process.argv.slice(2);
const verifyAt = args.indexOf("--verify");
if (verifyAt !== -1) {
  const target = args[verifyAt + 1];
  if (!target) { console.error("--verify needs a path"); process.exit(2); }
  const got = verify(resolve(target));
  console.log(`ok  ${target}\n    ${Object.entries(got).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  process.exit(0);
}

if (!existsSync(SOURCE)) { console.error(`No database at ${SOURCE}. Set PIT_DATA_DIR.`); process.exit(1); }
mkdirSync(BACKUP_DIR, { recursive: true });

const live = new DatabaseSync(SOURCE, { readOnly: true });
let expected;
try { expected = counts(live); } finally { live.close(); }

const dest = join(BACKUP_DIR, `pit-${stamp()}.db`);
// VACUUM INTO needs a writable handle to the source, but takes only a read lock
// for the duration and writes nothing to it.
const source = new DatabaseSync(SOURCE);
try { source.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`); } finally { source.close(); }

const got = verify(dest, expected);
const bytes = statSync(dest).size;
console.log(`snapshot  ${dest}`);
console.log(`size      ${(bytes / 1048576).toFixed(2)} MB`);
console.log(`verified  integrity_check ok  ${Object.entries(got).map(([k, v]) => `${k}=${v}`).join("  ")}`);

if (args.includes("--upload")) {
  const at = await upload(dest);
  console.log(`uploaded  ${at}`);
} else {
  console.log("offhost   skipped (pass --upload with BACKUP_S3_* set)");
}

const { kept, dropped } = prune();
console.log(`retention ${kept} kept, ${dropped} pruned (BACKUP_KEEP=${KEEP})`);
