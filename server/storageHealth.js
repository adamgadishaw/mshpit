// Cheap, privacy-safe observations: no directory walks, content queries,
// checkpoint, VACUUM, or writes against the live database.
import { statSync, statfsSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";

const MiB = 1024 ** 2;
const integer = (value) => {
  if (typeof value !== "number" && typeof value !== "bigint") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
};
const byteProduct = (left, right) => {
  const a = integer(left); const b = integer(right);
  return a === null || b === null ? null : integer(a * b);
};
const scalar = (database, pragma) => integer(Object.values(database.prepare(pragma).get() || {})[0]);
const mib = (bytes) => bytes === null ? "unavailable" : `${Math.round(bytes / MiB)} MiB`;

export function collectStorageHealth(database, {
  databasePath,
  directory = databasePath ? dirname(databasePath) : null,
  at = Date.now(),
  stat = statSync,
  statfs = statfsSync,
  monotonicNow = () => performance.now(),
} = {}) {
  const issues = []; const warnings = [];
  let databaseBytes = null; let walBytes = null;
  let logicalBytes = null; let reusableBytes = null;
  let freeBytes = null; let totalBytes = null; let freePercent = null;
  let journalMode = null; let databaseReadMs = null;
  try {
    const started = monotonicNow();
    if (database.prepare("SELECT 1 ok").get()?.ok !== 1) throw new Error("database_unavailable");
    const elapsed = monotonicNow() - started;
    databaseReadMs = Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed * 100) / 100 : null;
    const pageSize = scalar(database, "PRAGMA page_size");
    logicalBytes = byteProduct(pageSize, scalar(database, "PRAGMA page_count"));
    reusableBytes = byteProduct(pageSize, scalar(database, "PRAGMA freelist_count"));
    const mode = String(Object.values(database.prepare("PRAGMA journal_mode").get() || {})[0] || "").toLowerCase();
    journalMode = ["wal", "delete", "truncate", "persist", "memory", "off"].includes(mode) ? mode : null;
    if (logicalBytes === null || reusableBytes === null || !journalMode) warnings.push("database_storage_metrics_unavailable");
    if (journalMode && journalMode !== "wal") warnings.push("database_wal_disabled");
  } catch {
    issues.push("database_storage_unavailable");
  }
  try {
    if (!databasePath) throw new Error("database_path_unavailable");
    databaseBytes = integer(stat(databasePath).size);
    if (databaseBytes === null) throw new Error("database_size_unavailable");
    try { walBytes = integer(stat(`${databasePath}-wal`).size); }
    catch (error) {
      if (error?.code !== "ENOENT") throw error;
      walBytes = 0;
    }
    if (walBytes === null) throw new Error("wal_size_unavailable");
  } catch {
    warnings.push("database_file_metrics_unavailable");
  }
  try {
    if (!directory) throw new Error("disk_path_unavailable");
    const space = statfs(directory);
    freeBytes = byteProduct(space.bavail, space.bsize);
    totalBytes = byteProduct(space.blocks, space.bsize);
    if (freeBytes === null || !totalBytes || freeBytes > totalBytes) throw new Error("disk_metrics_unavailable");
    freePercent = Math.round((freeBytes / totalBytes) * 1000) / 10;
  } catch {
    freeBytes = null; totalBytes = null; freePercent = null;
    warnings.push("disk_space_metrics_unavailable");
  }

  // Two database footprints plus reserve warn before backup creation or large
  // writes exhaust disk. This estimate is not a promise that a backup will fit.
  const footprint = logicalBytes === null || databaseBytes === null || walBytes === null
    ? null : Math.max(logicalBytes, databaseBytes + walBytes);
  const snapshotHeadroomBytes = footprint === null ? null : integer(Math.max(512 * MiB, footprint * 2 + 128 * MiB));
  if (freeBytes !== null) {
    if (freeBytes < 256 * MiB || freeBytes / totalBytes < 0.1) issues.push("disk_space_critical");
    else if (freeBytes / totalBytes < 0.2 || (snapshotHeadroomBytes !== null && freeBytes < snapshotHeadroomBytes)) warnings.push("disk_space_low");
  }
  if (walBytes !== null && logicalBytes !== null && walBytes > Math.max(64 * MiB, logicalBytes / 2)) {
    warnings.push("database_wal_large");
  }
  return Object.freeze({
    status: issues.length ? "needs_attention" : warnings.length ? "watch" : "healthy",
    checkedAt: at, databaseBytes, walBytes, logicalBytes, reusableBytes,
    freeBytes, totalBytes, freePercent, snapshotHeadroomBytes, databaseReadMs, journalMode,
    issues: Object.freeze(issues), warnings: Object.freeze(warnings),
  });
}

export function formatStorageHealth(storage) {
  if (!storage) return "Storage: measurements unavailable";
  return `Storage: database ${mib(storage.databaseBytes)}; WAL ${mib(storage.walBytes)}; reusable database space ${mib(storage.reusableBytes)}; disk free ${mib(storage.freeBytes)}${storage.freePercent === null ? "" : ` (${storage.freePercent}%)`}; estimated backup headroom ${mib(storage.snapshotHeadroomBytes)}; database read probe ${storage.databaseReadMs === null ? "unavailable" : `${storage.databaseReadMs}ms`}`;
}
