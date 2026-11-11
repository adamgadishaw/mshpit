import { randomUUID } from "node:crypto";
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readlinkSync,
  readSync, readdirSync, realpathSync, unlinkSync, writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";

export const BACKUP_PARTIAL_MIN_AGE_MS = 60 * 60 * 1000;
const SNAPSHOT_NAME = /^pit-\d{8}-\d{6}\.db$/;
const OWNED_PARTIAL_NAME = /^pit-\d{8}-\d{6}\.db\.partial-([1-9]\d*)-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const OWNER_SUFFIX = ".owner.json";
const MAX_OWNER_BYTES = 4096;

// A PID is meaningful only on the same host and, on Linux, in the same boot
// and PID namespace. A replacement container/host needs operator review; absence
// of its PID in our namespace is not proof that its writer has stopped.
function processContext() {
  try {
    return JSON.stringify([process.platform, hostname(), ...(process.platform === "linux"
      ? [readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(), readlinkSync("/proc/self/ns/pid")]
      : [])]);
  } catch { return null; }
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "ESRCH" ? false : null; }
}

function fileStats(path) {
  try { return lstatSync(path, { bigint: true }); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

const ordinaryFile = (stats) => !!stats?.isFile() && stats.nlink === 1n
  && (typeof process.getuid !== "function" || stats.uid === BigInt(process.getuid()));
const identity = (stats) => stats ? [stats.dev, stats.ino, stats.birthtimeNs].map(String).join(":") : null;
const unchanged = (a, b) => ordinaryFile(a) && ordinaryFile(b) && identity(a) === identity(b)
  && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

function directoryIdentity(directory) {
  const path = resolve(directory);
  const stats = lstatSync(path, { bigint: true });
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("Backup partial directory must be an ordinary directory.");
  return { path, real: realpathSync(path), identity: identity(stats) };
}

function sameDirectory(directory) {
  const current = directoryIdentity(directory.path);
  return current.real === directory.real && current.identity === directory.identity;
}

function readOwner(path, expected) {
  if (!ordinaryFile(expected) || expected.size > BigInt(MAX_OWNER_BYTES)) return null;
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    if (!unchanged(expected, fstatSync(fd, { bigint: true }))) return null;
    const bytes = Buffer.alloc(MAX_OWNER_BYTES + 1);
    const length = readSync(fd, bytes, 0, bytes.length, 0);
    if (length > MAX_OWNER_BYTES || !unchanged(expected, fstatSync(fd, { bigint: true }))) return null;
    return JSON.parse(bytes.subarray(0, length).toString("utf8"));
  } finally { closeSync(fd); }
}

export function createBackupPartial(directory, snapshotName) {
  if (!SNAPSHOT_NAME.test(snapshotName)) throw new TypeError("Backup partial requires a generated snapshot name.");
  const root = directoryIdentity(directory);
  const name = `${snapshotName}.partial-${process.pid}-${randomUUID()}`;
  const path = join(root.path, name);
  // VACUUM INTO accepts an empty file. Exclusive creation lets us bind the
  // ownership record to its actual file identity before SQLite starts writing.
  const fd = openSync(path, "wx", 0o600);
  let stats;
  try { stats = fstatSync(fd, { bigint: true }); }
  finally { closeSync(fd); }
  const ownerPath = `${path}${OWNER_SUFFIX}`;
  const record = { version: 1, name, pid: process.pid, createdAt: Date.now(),
    context: processContext(), directory: root.real, fileIdentity: identity(stats) };
  try {
    writeFileSync(ownerPath, `${JSON.stringify(record)}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (sameDirectory(root) && identity(fileStats(path)) === record.fileIdentity) unlinkSync(path);
    throw error;
  }
  return { path, ownerPath, root, record, ownerIdentity: identity(fileStats(ownerPath)) };
}

// Used only by the invocation that created this handle. A replacement path or
// unexpected hard link must never be removed, including on the failure path.
export function removeBackupPartial(owned) {
  if (!sameDirectory(owned.root)) return false;
  const owner = fileStats(owned.ownerPath);
  if (!ordinaryFile(owner) || identity(owner) !== owned.ownerIdentity) return false;
  const partial = fileStats(owned.path);
  if (partial && (!ordinaryFile(partial) || identity(partial) !== owned.record.fileIdentity)) return false;
  if (partial) unlinkSync(owned.path);
  unlinkSync(owned.ownerPath);
  return true;
}

function examine(directory, { now = Date.now(), context = processContext(), isProcessAlive = processAlive } = {}, remove = false) {
  const result = { partialCount: 0, partialBytes: 0, ownerBytes: 0, reclaimableCount: 0,
    reclaimableBytes: 0, removedCount: 0, removedBytes: 0, preservedCount: 0, unreadableCount: 0 };
  const root = directoryIdentity(directory);
  const names = readdirSync(root.path).filter((name) => name.includes(".partial-"));
  for (const name of names.filter((entry) => entry.endsWith(OWNER_SUFFIX))) {
    try {
      const owner = fileStats(join(root.path, name));
      if (owner?.isFile()) result.ownerBytes += Number(owner.size);
    } catch { result.unreadableCount++; }
  }
  for (const name of names.filter((entry) => !entry.endsWith(OWNER_SUFFIX))) {
    // Count legacy/unowned partials too, but do not infer ownership from a name.
    const path = join(root.path, name);
    result.partialCount++;
    let reclaimed = false;
    try {
      const partial = fileStats(path);
      if (partial?.isFile()) result.partialBytes += Number(partial.size);
      const match = OWNED_PARTIAL_NAME.exec(name);
      const ownerPath = `${path}${OWNER_SUFFIX}`;
      const owner = match ? fileStats(ownerPath) : null;
      const record = match && ordinaryFile(partial) ? readOwner(ownerPath, owner) : null;
      const oldEnough = (time) => Number.isFinite(time) && time > 0 && Number.isFinite(now)
        && now - time >= BACKUP_PARTIAL_MIN_AGE_MS;
      if (!record || record.version !== 1 || record.name !== name || record.directory !== root.real
        || record.fileIdentity !== identity(partial) || !context || record.context !== context
        || !Number.isSafeInteger(record.pid) || record.pid <= 0 || String(record.pid) !== match[1]
        || !oldEnough(record.createdAt) || !oldEnough(Number(partial.mtimeMs))
        || !oldEnough(Number(owner.mtimeMs)) || isProcessAlive(record.pid) !== false) continue;
      result.reclaimableCount++;
      result.reclaimableBytes += Number(partial.size);
      if (!remove) continue;
      // Recheck namespace, liveness and both identities immediately before the
      // unlink. Concurrent cleaners and new/replaced files fail closed.
      if (isProcessAlive(record.pid) !== false || !sameDirectory(root)
        || !unchanged(partial, fileStats(path)) || !unchanged(owner, fileStats(ownerPath))) continue;
      unlinkSync(path);
      reclaimed = true;
      result.removedCount++;
      result.removedBytes += Number(partial.size);
      result.partialBytes -= Number(partial.size);
      if (unchanged(owner, fileStats(ownerPath))) {
        unlinkSync(ownerPath);
        result.ownerBytes -= Number(owner.size);
      }
    } catch {
      // Unreadable, malformed or concurrently replaced entries remain for
      // inspection. They are never permission to delete unknown files.
      result.unreadableCount++;
    } finally { if (!reclaimed) result.preservedCount++; }
  }
  return Object.freeze(result);
}

export function backupPartialStatus(directory, options) { return examine(directory, options); }
export function reconcileBackupPartials(directory, options) { return examine(directory, options, true); }
