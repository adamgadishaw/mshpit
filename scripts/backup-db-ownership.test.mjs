import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireBackupOwnership, BACKUP_OWNERSHIP_FILE, cleanupClosedBackup } from "./backup-db-ownership.mjs";

function deadPid() {
  const result = spawnSync(process.execPath, ["-e", ""], { windowsHide: true });
  assert.equal(result.status, 0);
  assert.throws(() => process.kill(result.pid, 0), { code: "ESRCH" });
  return result.pid;
}

test("backup ownership rejects contention promptly and remains reusable without deleting its file", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-backup-owner-"));
  let first, second;
  try {
    first = acquireBackupOwnership(directory);
    assert.throws(() => acquireBackupOwnership(directory), /locked/);
    const contender = spawnSync(process.execPath, ["--input-type=module", "-e",
      `import { acquireBackupOwnership } from ${JSON.stringify(new URL("./backup-db-ownership.mjs", import.meta.url).href)};
       acquireBackupOwnership(process.argv[1]);`, directory], { encoding: "utf8", windowsHide: true, timeout: 2_000 });
    assert.notEqual(contender.status, 0);
    assert.equal(contender.error, undefined, "contention must fail instead of waiting for the timeout");
    assert.match(contender.stderr, /locked/);
    first.close(); first = null;
    assert.ok(existsSync(join(directory, BACKUP_OWNERSHIP_FILE)));
    second = acquireBackupOwnership(directory);
  } finally { first?.close(); second?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("cleanup removes only dead owned partials and their exact SQLite sidecars", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-backup-orphans-"));
  const pid = deadPid();
  const dead = `pit-20261002-010203.db.partial-${pid}`;
  const live = `pit-20261002-010203.db.partial-${process.pid}`;
  const preserve = [live, `${live}-journal`, "pit-20261002-010203.db", "pit.db", `${dead}-other`, "unknown.partial-1"];
  let owner;
  try {
    for (const name of [...preserve, dead, `${dead}-journal`, `${dead}-wal`, `${dead}-shm`]) writeFileSync(join(directory, name), "synthetic");
    mkdirSync(join(directory, `pit-20261002-010204.db.partial-${pid}`));
    owner = acquireBackupOwnership(directory);
    assert.equal(owner.cleanup(), 4);
    for (const name of preserve) assert.equal(readFileSync(join(directory, name), "utf8"), "synthetic");
    assert.equal(owner.cleanup({ pid: process.pid }), 0);
    assert.throws(() => owner.removeOwnPartial(`../${live}`), /exact partial/);
    owner.removeOwnPartial(live);
    assert.equal(existsSync(join(directory, live)), false);
  } finally { owner?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("parent cleanup restricts deletion to its closed child PID", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-backup-child-cleanup-"));
  const pid = deadPid(), other = deadPid();
  assert.notEqual(pid, other);
  const name = value => `pit-20261002-010203.db.partial-${value}`;
  try {
    writeFileSync(join(directory, name(pid)), "owned");
    writeFileSync(join(directory, name(other)), "other");
    assert.equal(cleanupClosedBackup(directory, pid), 1);
    assert.equal(readFileSync(join(directory, name(other)), "utf8"), "other");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("ownership rejects a hard-linked lock without modifying its target", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-backup-lock-link-"));
  try {
    const target = join(directory, "unrelated");
    writeFileSync(target, "preserve");
    linkSync(target, join(directory, BACKUP_OWNERSHIP_FILE));
    assert.throws(() => acquireBackupOwnership(directory), /owned regular file/);
    assert.equal(readFileSync(target, "utf8"), "preserve");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("ownership rejects a symlink lock and preserves a symlink partial", t => {
  const directory = mkdtempSync(join(tmpdir(), "pit-backup-lock-symlink-"));
  let owner;
  try {
    const target = join(directory, "unrelated");
    writeFileSync(target, "preserve");
    try { symlinkSync(target, join(directory, BACKUP_OWNERSHIP_FILE)); }
    catch (error) { if (["EPERM", "EACCES"].includes(error.code)) return t.skip("host cannot create file symlinks"); throw error; }
    assert.throws(() => acquireBackupOwnership(directory), /owned regular file/);
    rmSync(join(directory, BACKUP_OWNERSHIP_FILE));
    const name = `pit-20261002-010203.db.partial-${deadPid()}`;
    symlinkSync(target, join(directory, name));
    owner = acquireBackupOwnership(directory);
    assert.equal(owner.cleanup(), 0);
    assert.equal(readFileSync(target, "utf8"), "preserve");
    assert.equal(existsSync(join(directory, name)), true);
  } finally { owner?.close(); rmSync(directory, { recursive: true, force: true }); }
});
