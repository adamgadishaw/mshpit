import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { collectStorageHealth, formatStorageHealth } from "./storageHealth.js";

const MiB = 1024 ** 2;
function fixture(overrides = {}) {
  const values = { "SELECT 1 ok": { ok: 1 }, "PRAGMA page_size": { page_size: 4096 },
    "PRAGMA page_count": { page_count: 25_600 }, "PRAGMA freelist_count": { freelist_count: 100 },
    "PRAGMA journal_mode": { journal_mode: "wal" } };
  let clock = 0;
  return collectStorageHealth({ prepare(sql) { assert.ok(sql in values, "only fixed metadata probes are allowed"); return { get: () => values[sql] }; } }, {
    databasePath: "/private/member-database/pit.db", at: 1000,
    stat: (path) => ({ size: path.endsWith("-wal") ? 5 * MiB : 100 * MiB }),
    statfs: () => ({ bavail: 5_000, blocks: 10_000, bsize: MiB }),
    monotonicNow: () => clock += 0.1, ...overrides,
  });
}

test("storage health uses fixed metadata reads and exposes no paths or data", () => {
  const result = fixture();
  assert.equal(result.status, "healthy");
  assert.equal(result.databaseBytes, 100 * MiB);
  assert.equal(result.freePercent, 50);
  assert.equal(result.databaseReadMs, 0.1);
  assert.equal(result.snapshotHeadroomBytes, 512 * MiB);
  assert.equal(result.reusableBytes, 409600);
  assert.equal(JSON.stringify(result).includes("member-database"), false);
  assert.match(formatStorageHealth(result), /disk free 5000 MiB \(50%\)/);
  assert.ok(Object.isFrozen(result.warnings));
});

test("missing WAL is normal but unreadable WAL is unknown, never zero", () => {
  const missing = fixture({ stat: (path) => {
    if (path.endsWith("-wal")) throw Object.assign(new Error("private path"), { code: "ENOENT" });
    return { size: 100 * MiB };
  } });
  assert.equal(missing.walBytes, 0); assert.equal(missing.status, "healthy");
  const denied = fixture({ stat: () => { throw Object.assign(new Error("secret"), { code: "EACCES" }); } });
  assert.equal(denied.walBytes, null);
  assert.ok(denied.warnings.includes("database_file_metrics_unavailable"));
  assert.equal(JSON.stringify(denied).includes("secret"), false);
});

test("disk pressure alerts on absolute reserve, percent and snapshot headroom", () => {
  const disk = (free, total) => ({ statfs: () => ({ bavail: free, blocks: total, bsize: MiB }) });
  assert.ok(fixture(disk(200, 500)).issues.includes("disk_space_critical"));
  assert.ok(fixture(disk(900, 10_000)).issues.includes("disk_space_critical"));
  assert.ok(fixture(disk(1500, 10_000)).warnings.includes("disk_space_low"));
  assert.ok(fixture(disk(400, 1000)).warnings.includes("disk_space_low"));
  const big = fixture({ ...disk(1800, 4000), stat: () => ({ size: 900 * MiB }) });
  assert.ok(big.warnings.includes("disk_space_low"));
  assert.equal(big.snapshotHeadroomBytes, 3728 * MiB);
});

test("large WAL warns without initiating a checkpoint or deleting anything", () => {
  const result = fixture({ stat: (path) => ({ size: (path.endsWith("-wal") ? 80 : 100) * MiB }) });
  assert.ok(result.warnings.includes("database_wal_large"));
});

test("unavailable, invalid, impossible and overflowing metrics never show healthy", () => {
  for (const statfs of [() => { throw new Error("secret"); }, () => ({ blocks: 0, bavail: 0, bsize: 4096 }),
    () => ({ blocks: 10, bavail: 11, bsize: 4096 }), () => ({ blocks: 100, bavail: -1, bsize: 4096 }),
    () => ({ blocks: 100, bavail: null, bsize: 4096 }),
    () => ({ blocks: 1n << 60n, bavail: 1n << 59n, bsize: 4096n })]) {
    const result = fixture({ statfs });
    assert.equal(result.status, "watch"); assert.equal(result.freePercent, null);
    assert.ok(result.warnings.includes("disk_space_metrics_unavailable"));
  }
  const bigInt = fixture({ statfs: () => ({ blocks: 10_000n, bavail: 5000n, bsize: BigInt(MiB) }) });
  assert.equal(bigInt.status, "healthy");
});

test("real SQLite metadata works without querying user tables", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("CREATE TABLE private_users(secret TEXT); INSERT INTO private_users VALUES ('do not emit')");
    const result = collectStorageHealth(database, {
      databasePath: "/fixture/pit.db", stat: () => ({ size: 8192 }),
      statfs: () => ({ blocks: 10_000, bavail: 5000, bsize: MiB }),
    });
    assert.equal(result.logicalBytes, 8192);
    assert.equal(result.journalMode, "memory");
    assert.ok(result.warnings.includes("database_wal_disabled"));
    assert.equal(JSON.stringify(result).includes("do not emit"), false);
  } finally { database.close(); }
});

test("database failures report allowlisted labels, never errors or content", () => {
  const result = collectStorageHealth({ prepare() { throw new Error("secret database path"); } }, {
    databasePath: "/fixture/pit.db", stat: () => ({ size: 100 * MiB }),
    statfs: () => ({ blocks: 10_000, bavail: 5000, bsize: MiB }),
  });
  assert.equal(result.status, "needs_attention");
  assert.deepEqual(result.issues, ["database_storage_unavailable"]);
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(result.snapshotHeadroomBytes, null);
  assert.match(formatStorageHealth(result), /headroom unavailable/);
});
