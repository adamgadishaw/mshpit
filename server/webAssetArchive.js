import { randomUUID } from "node:crypto";
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, renameSync, rmSync, statfsSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import {
  WEB_ASSET_LIMITS, assetFailure, assetSha256, assertAssetDirectory,
  buildWebAssetManifest, fingerprintedWebAsset, regularAssetFile, validateWebAssetManifest,
} from "./webAssetManifest.js";

const OWNER = "mshpit-public-web-assets-v1\n";
const GRAPH_ID = /^[a-f0-9]{64}$/;
const RELEASE = /^[a-f0-9]{40}$/;
const EMPTY_CATALOG = () => ({ version: 1, current: null, rollback: null, graphs: [] });
const blockBytes = (stats, unit) => Math.max(Math.ceil(stats.size / unit) * unit, Number(stats.blocks || 0) * 512, unit);
function allocationUnit(root) {
  const bytes = Number(statfsSync(root).bsize);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw assetFailure("invalid_allocation_unit");
  return Math.max(4096, bytes);
}
const allocatedBytes = (bytes, unit) => Math.max(unit, Math.ceil(bytes / unit) * unit);
const expired = (graph, catalog, now, limits) => graph.id !== catalog.current && graph.id !== catalog.rollback
  && graph.deactivatedAt !== null && now - graph.deactivatedAt >= limits.ttlMs;

export function webAssetArchiveRoot(dataDirectory) {
  return join(resolve(dataDirectory), "web-asset-cache", "v1");
}
function safeDirectory(path) {
  if (!existsSync(path)) {
    safeDirectory(dirname(path));
    mkdirSync(path, { mode: 0o700 });
    syncDirectory(dirname(path));
  }
  return assertAssetDirectory(path);
}
function jsonFile(path, maximum) {
  assertAssetDirectory(dirname(path));
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink > 1 || stats.size > maximum) throw assetFailure("unsafe_metadata");
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { throw assetFailure("invalid_metadata"); }
}
function initializeRoot(root) {
  const created = !existsSync(root);
  safeDirectory(root);
  const marker = join(root, ".owner");
  if (created) { writeExclusive(marker, Buffer.from(OWNER)); syncDirectory(root); }
  const stats = lstatSync(marker);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink > 1 || stats.size !== Buffer.byteLength(OWNER)
    || readFileSync(marker, "utf8") !== OWNER) throw assetFailure("unowned_archive");
}
function inspectArchive(root, limits) {
  const unit = allocationUnit(root);
  let bytes = 0;
  let files = 0;
  let nodes = 0;
  function walk(directory, depth) {
    if (depth > 20) throw assetFailure("archive_depth_limit");
    bytes += blockBytes(lstatSync(directory), unit);
    for (const name of readdirSync(directory)) {
      if (++nodes > limits.archiveFiles * 2) throw assetFailure("archive_scan_limit");
      const path = join(directory, name);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) throw assetFailure("archive_link");
      if (stats.isDirectory()) walk(path, depth + 1);
      else if (stats.isFile() && stats.nlink === 1) {
        files++;
        bytes += blockBytes(stats, unit);
      } else throw assetFailure("unsafe_archive_node");
      if (bytes > limits.archiveBytes || files > limits.archiveFiles) throw assetFailure("archive_limit");
    }
  }
  walk(root, 0);
  return { bytes, files };
}
function validateCatalog(value, limits) {
  if (!value || value.version !== 1 || Object.keys(value).sort().join() !== "current,graphs,rollback,version"
    || !Array.isArray(value.graphs) || value.graphs.length > limits.graphs
    || (value.current !== null && !GRAPH_ID.test(value.current))
    || (value.rollback !== null && !GRAPH_ID.test(value.rollback))) throw assetFailure("invalid_catalog");
  const ids = new Set();
  for (const graph of value.graphs) {
    if (!graph || Object.keys(graph).sort().join() !== "deactivatedAt,id,publishedAt,release"
      || !GRAPH_ID.test(graph.id) || ids.has(graph.id) || !RELEASE.test(graph.release)
      || !Number.isSafeInteger(graph.publishedAt) || graph.publishedAt < 0
      || (graph.deactivatedAt !== null && (!Number.isSafeInteger(graph.deactivatedAt) || graph.deactivatedAt < graph.publishedAt))) {
      throw assetFailure("invalid_catalog_graph");
    }
    ids.add(graph.id);
  }
  if ((value.current && !ids.has(value.current)) || (value.rollback && !ids.has(value.rollback))
    || value.graphs.some((g) => (g.id === value.current) !== (g.deactivatedAt === null))) throw assetFailure("invalid_catalog_pin");
  return value;
}
function readCatalog(root, limits) {
  const path = join(root, "catalog.json");
  return existsSync(path) ? validateCatalog(jsonFile(path, limits.catalogBytes), limits) : EMPTY_CATALOG();
}
function syncDirectory(path) {
  if (process.platform === "win32") return;
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function syncGraphDirectories(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw assetFailure("archive_link");
    if (entry.isDirectory()) syncGraphDirectories(join(directory, entry.name));
  }
  syncDirectory(directory);
}
function writeExclusive(path, bytes) {
  const fd = openSync(path, "wx", 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function saveCatalog(root, catalog, limits) {
  validateCatalog(catalog, limits);
  const bytes = Buffer.from(`${JSON.stringify(catalog)}\n`);
  if (bytes.length > limits.catalogBytes) throw assetFailure("catalog_limit");
  const path = join(root, `.catalog-${randomUUID()}.tmp`);
  try { writeExclusive(path, bytes); renameSync(path, join(root, "catalog.json")); syncDirectory(root); }
  finally { if (existsSync(path)) unlinkSync(path); }
}
function withWriter(root, operation, limits) {
  initializeRoot(root);
  const path = join(root, "writer.lock");
  // Reclaiming a dead PID by unlinking can delete a competing writer's new
  // lock. Existing locks fail closed; interrupted owners require offline
  // maintenance with all archive writers stopped, never request-time repair.
  if (existsSync(path)) throw assetFailure("archive_locked");
  const inventory = inspectArchive(root, limits);
  const unit = allocationUnit(root);
  if (inventory.bytes + unit + allocatedBytes(limits.catalogBytes, unit) > limits.archiveBytes
    || inventory.files + 2 > limits.archiveFiles) throw assetFailure("archive_capacity");
  writeExclusive(path, Buffer.from(JSON.stringify({ pid: process.pid })));
  try { inspectArchive(root, limits); return operation(); }
  finally { unlinkSync(path); }
}
function ownedChild(root, name) {
  if (!/^(?:g-[a-f0-9]{64}|\.stage-[a-f0-9-]{36})$/.test(name)) throw assetFailure("unsafe_cleanup_name");
  const target = resolve(root, name);
  if (dirname(target) !== resolve(root) || !target.startsWith(resolve(root) + sep)) throw assetFailure("unsafe_cleanup_path");
  assertAssetDirectory(target);
  return target;
}
function removeGraphDirectory(root, name, limits) {
  const target = ownedChild(root, name);
  // Verify all descendants before recursive removal, including junctions.
  inspectArchive(target, limits);
  rmSync(target, { recursive: true, force: false });
}
function cleanupOrphans(root, catalog, limits) {
  const retained = new Set(catalog.graphs.map((g) => `g-${g.id}`));
  for (const name of readdirSync(root)) {
    if (/^\.stage-[a-f0-9-]{36}$/.test(name) || (/^g-[a-f0-9]{64}$/.test(name) && !retained.has(name))) {
      removeGraphDirectory(root, name, limits);
    } else if (/^\.catalog-[a-f0-9-]{36}\.tmp$/.test(name)) {
      const path = join(root, name);
      const stats = lstatSync(path);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink > 1) throw assetFailure("unsafe_metadata");
      unlinkSync(path);
    } else if (!retained.has(name) && ![".owner", "writer.lock", "catalog.json"].includes(name)) {
      throw assetFailure("unknown_archive_entry");
    }
  }
}
function verifyGraph(root, graph, limits) {
  const directory = ownedChild(root, `g-${graph.id}`);
  const manifest = validateWebAssetManifest(jsonFile(join(directory, "manifest.json"), limits.manifestBytes), limits);
  if (manifest.graphId !== graph.id) throw assetFailure("graph_identity_mismatch");
  const descriptors = [];
  for (const entry of manifest.entries) {
    const file = regularAssetFile(directory, entry.url, limits.fileBytes);
    if (file.stats.size !== entry.bytes || assetSha256(readFileSync(file.path)) !== entry.sha256) throw assetFailure("archive_integrity");
    descriptors.push({ url: entry.url, mtimeMs: file.stats.mtimeMs, ino: file.stats.ino });
  }
  return { graph, manifest, descriptors };
}
function allocatedCandidate(manifest, unit) {
  const directories = new Map([["", new Set(["manifest.json"])]]);
  for (const entry of manifest.entries) {
    const parts = entry.url.slice(1).split("/");
    for (let i = 0; i < parts.length; i++) {
      const directory = parts.slice(0, i).join("/");
      if (!directories.has(directory)) directories.set(directory, new Set());
      directories.get(directory).add(parts[i]);
    }
  }
  // Reserve a full allocation unit for every directory entry as well as the
  // directory itself. This exceeds ordinary directory/index growth instead
  // of assuming that a wide directory always occupies one 4KiB block.
  return [...directories.values()].reduce((sum, children) => sum + (children.size + 1) * unit, 0)
    + manifest.entries.reduce((sum, entry) => sum + allocatedBytes(entry.bytes, unit), 0)
    + allocatedBytes(Buffer.byteLength(JSON.stringify(manifest)) + 1, unit);
}
function availableBytes(root) { const stats = statfsSync(root); return Number(stats.bavail) * Number(stats.bsize); }
function capacity(root, manifest, limits, freeBytes) {
  const inventory = inspectArchive(root, limits);
  const unit = allocationUnit(root);
  const needed = manifest ? allocatedCandidate(manifest, unit) : 0;
  const metadata = allocatedBytes(limits.catalogBytes, unit);
  const files = manifest ? manifest.entries.length + 1 : 0;
  const free = typeof freeBytes === "function" ? freeBytes(root) : freeBytes ?? availableBytes(root);
  return Number.isFinite(free) && free >= needed + metadata + limits.reserveBytes
    && inventory.bytes + needed + metadata <= limits.archiveBytes
    && inventory.files + files + 1 <= limits.archiveFiles;
}
function rejectCollisions(manifest, graphs, distDir, limits) {
  const entries = new Map(manifest.entries.map((e) => [e.url, e.sha256]));
  const stable = new Map();
  for (const old of graphs) {
    for (const entry of old.manifest.entries) {
      if (entries.has(entry.url) && entries.get(entry.url) !== entry.sha256) throw assetFailure("asset_url_collision");
    }
    for (const entry of old.manifest.stableDependencies) {
      if (!stable.has(entry.url)) {
        try {
          const file = regularAssetFile(distDir, entry.url, limits.fileBytes);
          stable.set(entry.url, assetSha256(readFileSync(file.path)));
        } catch { throw assetFailure("stable_dependency_changed"); }
      }
      if (stable.get(entry.url) !== entry.sha256) throw assetFailure("stable_dependency_changed");
    }
  }
}
function removeCatalogGraph(root, catalog, id, limits) {
  if (id === catalog.current || id === catalog.rollback) throw assetFailure("pinned_graph");
  catalog.graphs = catalog.graphs.filter((graph) => graph.id !== id);
  saveCatalog(root, catalog, limits); // Unpublish before deletion; interruption leaves an owned orphan.
  removeGraphDirectory(root, `g-${id}`, limits);
}

export function prepareWebAssetArchive({
  distDir, manifestPath, archiveRoot, release, now = Date.now(), limits = WEB_ASSET_LIMITS, freeBytes,
  checkpoint = () => {},
}) {
  if (!RELEASE.test(release) || !Number.isSafeInteger(now) || now < 0) throw assetFailure("invalid_release");
  const manifest = validateWebAssetManifest(jsonFile(manifestPath, limits.manifestBytes), limits);
  if (buildWebAssetManifest(distDir, { limits }).graphId !== manifest.graphId) throw assetFailure("build_manifest_mismatch");
  const root = resolve(archiveRoot);
  return withWriter(root, () => {
    const catalog = readCatalog(root, limits);
    cleanupOrphans(root, catalog, limits);
    for (const graph of [...catalog.graphs]) if (expired(graph, catalog, now, limits)) removeCatalogGraph(root, catalog, graph.id, limits);
    const verified = catalog.graphs.map((graph) => verifyGraph(root, graph, limits));
    rejectCollisions(manifest, verified, distDir, limits);
    const existing = catalog.graphs.find((graph) => graph.id === manifest.graphId);
    if (!existing) {
      const victims = catalog.graphs.filter((graph) => graph.id !== catalog.current && graph.id !== catalog.rollback)
        .sort((a, b) => a.deactivatedAt - b.deactivatedAt || a.publishedAt - b.publishedAt);
      while (catalog.graphs.length >= limits.graphs || !capacity(root, manifest, limits, freeBytes)) {
        const victim = victims.shift();
        if (!victim) throw assetFailure("archive_capacity");
        removeCatalogGraph(root, catalog, victim.id, limits);
      }
      const stageName = `.stage-${randomUUID()}`;
      const stage = join(root, stageName);
      mkdirSync(stage, { mode: 0o700 });
      try {
        for (const entry of manifest.entries) {
          const source = regularAssetFile(distDir, entry.url, limits.fileBytes);
          const bytes = readFileSync(source.path);
          if (bytes.length !== entry.bytes || assetSha256(bytes) !== entry.sha256) throw assetFailure("build_changed");
          const target = join(stage, ...entry.url.slice(1).split("/"));
          safeDirectory(dirname(target));
          writeExclusive(target, bytes);
          inspectArchive(root, limits);
          checkpoint("staged-file");
        }
        writeExclusive(join(stage, "manifest.json"), Buffer.from(JSON.stringify(manifest)));
        syncGraphDirectories(stage);
        inspectArchive(root, limits);
        renameSync(stage, join(root, `g-${manifest.graphId}`));
        syncDirectory(root);
        checkpoint("renamed-graph");
      } finally { if (existsSync(stage)) removeGraphDirectory(root, stageName, limits); }
    }
    for (const graph of catalog.graphs) {
      if (graph.id === manifest.graphId) { graph.deactivatedAt = null; graph.release = release; }
      else if (graph.deactivatedAt === null) graph.deactivatedAt = now;
    }
    if (!existing) catalog.graphs.push({ id: manifest.graphId, release, publishedAt: now, deactivatedAt: null });
    catalog.current = manifest.graphId;
    if (!capacity(root, null, limits, freeBytes)) throw assetFailure("archive_capacity");
    saveCatalog(root, catalog, limits);
    checkpoint("published-catalog");
    const snapshot = archiveSnapshot(root, catalog, now, limits);
    return { ok: true, graphId: manifest.graphId, status: existing ? "reused" : "published", catalog, snapshot };
  }, limits);
}

function archiveSnapshot(root, catalog, now, limits) {
  const graphs = catalog.graphs.filter((graph) => !expired(graph, catalog, now, limits))
    .map((graph) => verifyGraph(root, graph, limits));
  return { root, catalog, graphs };
}
export function promoteWebAssetGraph({ archiveRoot, graphId, limits = WEB_ASSET_LIMITS, freeBytes }) {
  if (!GRAPH_ID.test(graphId)) throw assetFailure("invalid_graph_id");
  const root = resolve(archiveRoot);
  return withWriter(root, () => {
    const catalog = readCatalog(root, limits);
    if (catalog.current !== graphId) throw assetFailure("promotion_requires_current");
    verifyGraph(root, catalog.graphs.find((graph) => graph.id === graphId), limits);
    if (!capacity(root, null, limits, freeBytes)) throw assetFailure("archive_capacity");
    catalog.rollback = graphId;
    saveCatalog(root, catalog, limits);
    return { ok: true, graphId, catalog };
  }, limits);
}

export function resolverFromWebAssetSnapshot(snapshot, { now = () => Date.now(), limits = WEB_ASSET_LIMITS } = {}) {
  const clock = typeof now === "function" ? now : () => now;
  const root = resolve(snapshot.root);
  let catalog = validateCatalog(snapshot.catalog, limits);
  const graphSignature = JSON.stringify({ current: catalog.current, graphs: catalog.graphs });
  let refreshedAt = -Infinity;
  let available = true;
  if (!Array.isArray(snapshot.graphs) || snapshot.graphs.length > limits.graphs) throw assetFailure("invalid_snapshot");
  const index = new Map();
  const ordered = [...snapshot.graphs].sort((a, b) => Number(b.graph.id === catalog.current) - Number(a.graph.id === catalog.current));
  for (const item of ordered) {
    const graph = catalog.graphs.find((g) => g.id === item.graph?.id);
    const manifest = validateWebAssetManifest(item.manifest, limits);
    if (!graph || graph.id !== manifest.graphId || !Array.isArray(item.descriptors) || item.descriptors.length !== manifest.entries.length) throw assetFailure("invalid_snapshot_graph");
    for (let i = 0; i < manifest.entries.length; i++) {
      const entry = manifest.entries[i];
      const descriptor = item.descriptors[i];
      if (descriptor.url !== entry.url || !Number.isFinite(descriptor.mtimeMs) || !Number.isFinite(descriptor.ino)) throw assetFailure("invalid_snapshot_descriptor");
      if (index.has(entry.url) && index.get(entry.url)[0].sha256 !== entry.sha256) throw assetFailure("asset_url_collision");
      if (!index.has(entry.url)) index.set(entry.url, []);
      index.get(entry.url).push({
        ...entry, ...descriptor, graph,
        root: join(root, `g-${graph.id}`), path: join(root, `g-${graph.id}`, ...entry.url.slice(1).split("/")),
      });
    }
  }
  return {
    lookup(url) {
      if (!fingerprintedWebAsset(url)) return null;
      if (!available || !index.has(url)) return null;
      const instant = clock();
      // Promotion changes only the accepted rollback pin. Observe it within a
      // second without timers, directory scans or asset reads on request paths.
      // Any other writer/corruption needs a fresh verified startup snapshot.
      if (instant - refreshedAt >= 1000 || instant < refreshedAt) {
        refreshedAt = instant;
        try {
          const updated = validateCatalog(jsonFile(join(root, "catalog.json"), limits.catalogBytes), limits);
          if (JSON.stringify({ current: updated.current, graphs: updated.graphs }) !== graphSignature) throw assetFailure("archive_generation_changed");
          catalog = updated;
        } catch { available = false; return null; }
      }
      return index.get(url)?.find((entry) => !expired(entry.graph, catalog, instant, limits)) || null;
    },
    snapshot,
  };
}
export function loadWebAssetArchiveResolver({ archiveRoot, now = () => Date.now(), limits = WEB_ASSET_LIMITS }) {
  const root = resolve(archiveRoot);
  const clock = typeof now === "function" ? now : () => now;
  if (!existsSync(root)) return resolverFromWebAssetSnapshot({ root, catalog: EMPTY_CATALOG(), graphs: [] }, { now: clock, limits });
  initializeRoot(root);
  inspectArchive(root, limits);
  return resolverFromWebAssetSnapshot(archiveSnapshot(root, readCatalog(root, limits), clock(), limits), { now: clock, limits });
}
export function webAssetProcessEnvironment(env) {
  return Object.fromEntries(["SystemRoot", "WINDIR", "TEMP", "TMP", "PIT_DATA_DIR", "RENDER_GIT_COMMIT"]
    .filter((key) => typeof env[key] === "string").map((key) => [key, env[key]]));
}
let runtimeArchive = null;
export function installWebAssetArchiveSnapshot(snapshot) { runtimeArchive = snapshot ? resolverFromWebAssetSnapshot(snapshot) : null; }
export function runtimeWebAssetArchive() { return runtimeArchive; }
