import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync,
  rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BACKUP_PARTIAL_MIN_AGE_MS, backupPartialStatus, createBackupPartial,
  reconcileBackupPartials, removeBackupPartial } from "./backup-db-partials.mjs";

const SNAPSHOT = "pit-20261111-010203.db";
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "pit-owned-partials-"));
  try { return run(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

function age(owned, now, changes = {}) {
  const old = now - BACKUP_PARTIAL_MIN_AGE_MS - 10_000;
  const record = JSON.parse(readFileSync(owned.ownerPath, "utf8"));
  writeFileSync(owned.ownerPath, JSON.stringify({ ...record, createdAt: old, ...changes }));
  utimesSync(owned.path, old / 1000, old / 1000);
  utimesSync(owned.ownerPath, old / 1000, old / 1000);
}

test("reconciles only aged owned dead-writer bytes before capacity planning", () => fixture((root) => {
  const now = Date.now();
  const owned = createBackupPartial(root, SNAPSHOT);
  writeFileSync(owned.path, Buffer.alloc(8192, 7));
  age(owned, now);
  const recovery = join(root, SNAPSHOT);
  const unknown = join(root, `${SNAPSHOT}.partial-123`);
  writeFileSync(recovery, "retained verified recovery point");
  writeFileSync(unknown, Buffer.alloc(4096, 3));
  const original = hash(recovery);
  const options = { now, isProcessAlive: () => false };
  const before = backupPartialStatus(root, options);
  assert.equal(before.partialBytes, 12288);
  assert.equal(before.reclaimableBytes, 8192);
  assert.ok(before.ownerBytes > 0);
  assert.equal(existsSync(owned.path), true, "diagnostics do not mutate files");
  const result = reconcileBackupPartials(root, options);
  assert.equal(result.removedCount, 1);
  assert.equal(result.removedBytes, 8192);
  assert.equal(result.partialBytes, 4096);
  assert.equal(result.preservedCount, 1);
  assert.equal(existsSync(owned.path), false);
  assert.equal(existsSync(owned.ownerPath), false);
  assert.equal(existsSync(unknown), true);
  assert.equal(hash(recovery), original);
}));

test("preserves live, recent, future-clock and foreign-namespace owners", () => fixture((root) => {
  const now = Date.now();
  for (const kind of ["active", "unknown-process", "recent", "future", "foreign", "wrong-directory", "wrong-file"]) {
    const owned = createBackupPartial(root, SNAPSHOT);
    writeFileSync(owned.path, kind);
    const changes = kind === "future" ? { createdAt: now + 1000 }
      : kind === "foreign" ? { context: "another host or PID namespace" }
        : kind === "wrong-directory" ? { directory: join(root, "other") }
          : kind === "wrong-file" ? { fileIdentity: "different-inode" } : {};
    if (kind !== "recent") age(owned, now, changes);
    const options = kind === "active" ? { now }
      : { now, isProcessAlive: () => kind === "unknown-process" ? null : false };
    const result = reconcileBackupPartials(root, options);
    assert.equal(existsSync(owned.path), true, kind);
    assert.equal(existsSync(owned.ownerPath), true, kind);
    assert.equal(result.removedCount, 0, kind);
    // Isolate cases without using the ownership cleaner under test.
    rmSync(owned.path); rmSync(owned.ownerPath);
  }
}));

test("preserves unowned and malformed partials, hard links and directories", () => fixture((root) => {
  const now = Date.now();
  for (const kind of ["missing-record", "malformed", "oversized", "hardlink", "owner-hardlink", "directory"]) {
    const owned = createBackupPartial(root, SNAPSHOT);
    writeFileSync(owned.path, kind);
    age(owned, now);
    if (kind === "missing-record") rmSync(owned.ownerPath);
    if (kind === "malformed") writeFileSync(owned.ownerPath, "{");
    if (kind === "oversized") writeFileSync(owned.ownerPath, " ".repeat(5000));
    if (kind === "hardlink") linkSync(owned.path, join(root, "source.db"));
    if (kind === "owner-hardlink") linkSync(owned.ownerPath, join(root, "unrelated.json"));
    if (kind === "directory") { rmSync(owned.path); mkdirSync(owned.path); }
    reconcileBackupPartials(root, { now, isProcessAlive: () => false });
    assert.equal(existsSync(owned.path), true, kind);
  }
  assert.equal(existsSync(join(root, "source.db")), true);
  assert.equal(existsSync(join(root, "unrelated.json")), true);
}));

test("rechecks process liveness and file identity immediately before removal", () => fixture((root) => {
  const now = Date.now();
  for (const replace of [false, true]) {
    const owned = createBackupPartial(root, SNAPSHOT);
    writeFileSync(owned.path, "old orphan");
    age(owned, now);
    let calls = 0;
    const result = reconcileBackupPartials(root, { now, isProcessAlive: () => {
      calls++;
      if (replace && calls === 2) {
        renameSync(owned.path, `${owned.path}.preserved`);
        writeFileSync(owned.path, "new file must survive");
      }
      return replace ? false : calls > 1;
    } });
    assert.equal(result.removedCount, 0);
    assert.equal(readFileSync(owned.path, "utf8"), replace ? "new file must survive" : "old orphan");
    rmSync(owned.path); rmSync(owned.ownerPath);
  }
}));

test("rejects a backup directory junction and preserves partial file symlinks", (t) => fixture((root) => {
  const directory = join(root, "real");
  const alias = join(root, "alias");
  mkdirSync(directory);
  symlinkSync(directory, alias, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => reconcileBackupPartials(alias), /ordinary directory/);
  assert.throws(() => createBackupPartial(alias, SNAPSHOT), /ordinary directory/);
  const owned = createBackupPartial(directory, SNAPSHOT);
  age(owned, Date.now());
  const target = join(root, "recovery.db");
  writeFileSync(target, "must survive");
  rmSync(owned.path);
  try { symlinkSync(target, owned.path, "file"); }
  catch (error) {
    if (error.code === "EPERM") { t.diagnostic("Host disallows file symlinks; directory-junction guard passed."); return; }
    throw error;
  }
  reconcileBackupPartials(directory, { isProcessAlive: () => false });
  assert.equal(readFileSync(target, "utf8"), "must survive");
  assert.equal(existsSync(owned.path), true);
}));

test("current-invocation cleanup preserves replaced paths and removes its own empty staging files", () => fixture((root) => {
  const owned = createBackupPartial(root, SNAPSHOT);
  assert.equal(statSync(owned.path).size, 0);
  assert.equal(removeBackupPartial(owned), true);
  assert.deepEqual(readdirSync(root), []);
  const replaced = createBackupPartial(root, SNAPSHOT);
  renameSync(replaced.path, `${replaced.path}.original`);
  writeFileSync(replaced.path, "replacement");
  assert.equal(removeBackupPartial(replaced), false);
  assert.equal(readFileSync(replaced.path, "utf8"), "replacement");
}));
