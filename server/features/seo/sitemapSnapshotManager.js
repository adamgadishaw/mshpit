import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tryAcquireMemoryWork } from "../../memoryAdmission.js";
import {
  SITEMAP_MAX_BYTES,
  SITEMAP_MAX_URLS,
  createSitemapSnapshot,
  isSitemapRequestPath,
} from "./sitemapService.js";

const SNAPSHOT_VERSION = 1;
// Bump this when sitemap selection/canonicalization policy changes without a
// persistence-format change. A prior deploy's otherwise valid XML then gets one
// deliberate rebuild instead of being reused under rules it never evaluated.
export const SITEMAP_SNAPSHOT_REVISION = 5;
const SNAPSHOT_FILENAME = "seo-sitemap-snapshot-v1.json";
const DEFAULT_RETRY_SECONDS = 30;
export const DEFAULT_SITEMAP_STARTUP_REUSE_MS = 15 * 60 * 1_000;
const MAX_STARTUP_CLOCK_SKEW_MS = 60 * 1_000;
export const SITEMAP_MAX_PERSISTED_SNAPSHOT_BYTES = 96 * 1024 * 1024;

function canonicalOrigin(env = process.env) {
  try {
    const value = new URL(String(env?.PUBLIC_ORIGIN || "https://www.mshpit.com"));
    if (value.protocol !== "https:" || value.username || value.password) throw new TypeError("invalid origin");
    return value.origin;
  } catch {
    return "https://www.mshpit.com";
  }
}

function* sitemapLocations(xml) {
  for (const match of String(xml || "").matchAll(/<loc>([^<]+)<\/loc>/g)) yield match[1];
}

function urlCount(xml) {
  let count = 0;
  for (const match of String(xml || "").matchAll(/<url>/g)) {
    if (match) count += 1;
  }
  return count;
}

function sanitizedStats(value, { totalUrls, shardCount }) {
  const sanitizedCounts = (source) => Object.fromEntries(Object.entries(
    source && typeof source === "object" ? source : {},
  )
    .filter(([key, count]) => /^[a-z][a-z0-9-]{0,31}$/.test(key)
      && Number.isSafeInteger(Number(count)) && Number(count) >= 0)
    .map(([key, count]) => [key, Number(count)]));
  return Object.freeze({
    totalUrls,
    shardCount,
    datasetCounts: Object.freeze(sanitizedCounts(value?.datasetCounts)),
    sourceCounts: Object.freeze(sanitizedCounts(value?.sourceCounts)),
  });
}

export function validateSitemapSnapshotPayload(payload, { env = process.env } = {}) {
  if (!payload || payload.version !== SNAPSHOT_VERSION) throw new TypeError("SITEMAP_SNAPSHOT_VERSION");
  if (payload.revision !== SITEMAP_SNAPSHOT_REVISION) throw new TypeError("SITEMAP_SNAPSHOT_REVISION");
  const generatedAt = Number(payload.generatedAt);
  if (!Number.isSafeInteger(generatedAt) || generatedAt < 0) throw new TypeError("SITEMAP_SNAPSHOT_TIME");
  if (!Array.isArray(payload.paths) || !payload.paths.length || payload.paths.length > SITEMAP_MAX_URLS) {
    throw new TypeError("SITEMAP_SNAPSHOT_PATHS");
  }
  if (!payload.documents || typeof payload.documents !== "object" || Array.isArray(payload.documents)) {
    throw new TypeError("SITEMAP_SNAPSHOT_DOCUMENTS");
  }

  const paths = [...payload.paths];
  if (new Set(paths).size !== paths.length) throw new TypeError("SITEMAP_SNAPSHOT_DUPLICATE_SHARD");
  for (const path of paths) {
    if (!isSitemapRequestPath(path) || path === "/sitemap.xml") throw new TypeError("SITEMAP_SNAPSHOT_SHARD_PATH");
  }
  const expectedDocuments = new Set(["/sitemap.xml", ...paths]);
  const documentKeys = Object.keys(payload.documents);
  if (documentKeys.length !== expectedDocuments.size
    || documentKeys.some((path) => !expectedDocuments.has(path))) {
    throw new TypeError("SITEMAP_SNAPSHOT_DOCUMENT_SET");
  }

  const origin = canonicalOrigin(env);
  const indexXml = String(payload.documents["/sitemap.xml"] || "");
  if (!indexXml.startsWith("<?xml") || !indexXml.includes("<sitemapindex")) {
    throw new TypeError("SITEMAP_SNAPSHOT_INDEX_XML");
  }
  if (Buffer.byteLength(indexXml, "utf8") > SITEMAP_MAX_BYTES) throw new TypeError("SITEMAP_SNAPSHOT_INDEX_BYTES");
  let indexedCount = 0;
  for (const value of sitemapLocations(indexXml)) {
    const url = new URL(value);
    if (url.origin !== origin || url.search || url.hash) throw new TypeError("SITEMAP_SNAPSHOT_INDEX_ORIGIN");
    if (url.pathname !== paths[indexedCount]) throw new TypeError("SITEMAP_SNAPSHOT_INDEX_CONTENTS");
    indexedCount += 1;
  }
  if (indexedCount !== paths.length) {
    throw new TypeError("SITEMAP_SNAPSHOT_INDEX_CONTENTS");
  }

  const seenUrls = new Set();
  let totalUrls = 0;
  for (const path of paths) {
    const xml = String(payload.documents[path] || "");
    if (!xml.startsWith("<?xml") || !xml.includes("<urlset")) throw new TypeError("SITEMAP_SNAPSHOT_SHARD_XML");
    if (Buffer.byteLength(xml, "utf8") > SITEMAP_MAX_BYTES) throw new TypeError("SITEMAP_SNAPSHOT_SHARD_BYTES");
    const count = urlCount(xml);
    if (count > SITEMAP_MAX_URLS) throw new TypeError("SITEMAP_SNAPSHOT_SHARD_URLS");
    let locationCount = 0;
    for (const value of sitemapLocations(xml)) {
      locationCount += 1;
      const url = new URL(value);
      if (url.origin !== origin || url.search || url.hash) throw new TypeError("SITEMAP_SNAPSHOT_URL_ORIGIN");
      if (seenUrls.has(url.href)) throw new TypeError("SITEMAP_SNAPSHOT_DUPLICATE_URL");
      seenUrls.add(url.href);
    }
    if (locationCount !== count) throw new TypeError("SITEMAP_SNAPSHOT_LOC_COUNT");
    totalUrls += count;
  }

  const documents = Object.freeze(Object.fromEntries(
    ["/sitemap.xml", ...paths].map((path) => [path, String(payload.documents[path])]),
  ));
  return Object.freeze({
    version: SNAPSHOT_VERSION,
    revision: SITEMAP_SNAPSHOT_REVISION,
    generatedAt,
    paths: Object.freeze(paths),
    documents,
    stats: sanitizedStats(payload.stats, { totalUrls, shardCount: paths.length }),
  });
}

function payloadFromSnapshot(snapshot, env) {
  const paths = Array.isArray(snapshot?.paths) ? [...snapshot.paths] : [];
  const documents = Object.fromEntries(
    ["/sitemap.xml", ...paths].map((path) => [path, snapshot?.xmlFor?.(path)]),
  );
  return validateSitemapSnapshotPayload({
    version: SNAPSHOT_VERSION,
    revision: SITEMAP_SNAPSHOT_REVISION,
    generatedAt: snapshot?.generatedAt,
    paths,
    documents,
    stats: snapshot?.stats,
  }, { env });
}

function hydratedSnapshot(payload) {
  const documents = payload.documents;
  return Object.freeze({
    version: payload.version,
    revision: payload.revision,
    generatedAt: payload.generatedAt,
    paths: payload.paths,
    stats: payload.stats,
    xmlFor(pathname) {
      return Object.hasOwn(documents, pathname) ? documents[pathname] : null;
    },
  });
}

// Persist the existing JSON format without constructing another whole-snapshot
// string alongside old XML, new XML, and the builder's candidate structures.
// JSON-escaped surrogate halves remain lossless even at a chunk boundary.
export function* sitemapSnapshotJsonChunks(payload) {
  yield `{"version":${payload.version},"revision":${payload.revision},"generatedAt":${payload.generatedAt},"paths":[`;
  for (let index = 0; index < payload.paths.length; index += 1) {
    yield `${index ? "," : ""}${JSON.stringify(payload.paths[index])}`;
  }
  yield '],"documents":{';
  let index = 0;
  for (const [path, xml] of Object.entries(payload.documents)) {
    yield `${index++ ? "," : ""}${JSON.stringify(path)}:"`;
    for (let offset = 0; offset < xml.length; offset += 16_384) {
      yield JSON.stringify(xml.slice(offset, offset + 16_384)).slice(1, -1);
    }
    yield '"';
  }
  yield `},"stats":${JSON.stringify(payload.stats)}}`;
}

/**
 * Decide whether startup must rebuild after load() has validated a persisted
 * snapshot. Validation proves schema, revision, canonical origin, membership,
 * size, and URL uniqueness; this final gate proves it is also recent enough.
 */
export function sitemapStartupRefreshDecision(loadResult, {
  now = Date.now(),
  maximumAgeMs = DEFAULT_SITEMAP_STARTUP_REUSE_MS,
} = {}) {
  if (!loadResult?.ok || !loadResult.snapshot) {
    return Object.freeze({ refresh: true, force: true, reason: loadResult?.reason || "unavailable" });
  }
  const snapshot = loadResult.snapshot;
  if (snapshot.version !== SNAPSHOT_VERSION) {
    return Object.freeze({ refresh: true, force: true, reason: "schema" });
  }
  if (snapshot.revision !== SITEMAP_SNAPSHOT_REVISION) {
    return Object.freeze({ refresh: true, force: true, reason: "revision" });
  }
  const at = Number(now);
  const generatedAt = Number(snapshot.generatedAt);
  const boundedMaximumAge = Number.isFinite(Number(maximumAgeMs)) && Number(maximumAgeMs) >= 0
    ? Number(maximumAgeMs)
    : DEFAULT_SITEMAP_STARTUP_REUSE_MS;
  if (!Number.isSafeInteger(generatedAt) || !Number.isFinite(at)) {
    return Object.freeze({ refresh: true, force: true, reason: "timestamp" });
  }
  if (generatedAt > at + MAX_STARTUP_CLOCK_SKEW_MS) {
    return Object.freeze({ refresh: true, force: true, reason: "future" });
  }
  const ageMs = Math.max(0, at - generatedAt);
  if (ageMs > boundedMaximumAge) {
    return Object.freeze({ refresh: true, force: true, reason: "stale", ageMs });
  }
  return Object.freeze({ refresh: false, force: false, reason: "fresh", ageMs });
}

function failureCategory(error, phase) {
  if (error?.code === "ENOENT") return `${phase}_missing`;
  const message = String(error?.message || "");
  if (message.startsWith("SITEMAP_SNAPSHOT_")) return `${phase}_validation`;
  if (["EACCES", "EPERM", "EROFS", "ENOSPC"].includes(error?.code)) return `${phase}_storage`;
  return `${phase}_failed`;
}

function frozenLookup(status, extra = {}) {
  return Object.freeze({ status, ...extra });
}

export function createSitemapSnapshotManager({
  database,
  dataDir,
  env = process.env,
  buildSnapshot = createSitemapSnapshot,
  now = () => Date.now(),
  retryBaseMs = DEFAULT_RETRY_SECONDS * 1_000,
  retryMaximumMs = 15 * 60 * 1_000,
  deferBuild = () => new Promise((resolve) => setImmediate(resolve)),
  maximumPersistedBytes = SITEMAP_MAX_PERSISTED_SNAPSHOT_BYTES,
  acquireRefreshLease = () => tryAcquireMemoryWork("sitemap"),
} = {}) {
  if (!database?.prepare) throw new TypeError("Sitemap snapshot manager requires a database");
  if (typeof dataDir !== "string" || !dataDir.trim()) throw new TypeError("Sitemap snapshot manager requires the configured data directory");
  if (typeof buildSnapshot !== "function") throw new TypeError("Sitemap snapshot manager requires a builder");
  if (typeof acquireRefreshLease !== "function") throw new TypeError("Sitemap refresh admission must be a function");
  const persistedByteLimit = Number.isSafeInteger(maximumPersistedBytes) && maximumPersistedBytes > 0
    ? Math.min(maximumPersistedBytes, SITEMAP_MAX_PERSISTED_SNAPSHOT_BYTES)
    : SITEMAP_MAX_PERSISTED_SNAPSHOT_BYTES;

  const persistedPath = join(dataDir, SNAPSHOT_FILENAME);
  let current = null;
  let source = null;
  let refreshPromise = null;
  let refreshStartedAt = null;
  let lastRefreshDurationMs = null;
  let lastSuccessAt = null;
  let lastFailureAt = null;
  let lastFailureCategory = null;
  let consecutiveFailures = 0;
  let nextRetryAt = null;
  let lastDeferredAt = null;

  const health = () => {
    const clock = Number(now());
    const generatedAt = current?.generatedAt ?? null;
    return Object.freeze({
      available: Boolean(current),
      source,
      generatedAt,
      ageMs: generatedAt == null || !Number.isFinite(clock) ? null : Math.max(0, clock - generatedAt),
      refreshing: Boolean(refreshPromise),
      refreshStartedAt,
      lastRefreshDurationMs,
      lastSuccessAt,
      consecutiveFailures,
      lastFailureAt,
      lastFailureCategory,
      nextRetryAt,
      lastDeferredAt,
      totalUrls: current?.stats?.totalUrls ?? 0,
      shardCount: current?.stats?.shardCount ?? 0,
      datasetCounts: Object.freeze({ ...(current?.stats?.datasetCounts || {}) }),
      sourceCounts: Object.freeze({ ...(current?.stats?.sourceCounts || {}) }),
    });
  };

  const lookup = (pathname) => {
    const path = String(pathname || "");
    if (!isSitemapRequestPath(path)) return frozenLookup("unrecognized");
    if (!current) {
      const retryAfterSeconds = nextRetryAt == null
        ? DEFAULT_RETRY_SECONDS
        : Math.max(1, Math.ceil((nextRetryAt - Number(now())) / 1_000));
      return frozenLookup("unavailable", { retryAfterSeconds });
    }
    const body = current.xmlFor(path);
    return body == null
      ? frozenLookup("missing")
      : frozenLookup("ready", { body, generatedAt: current.generatedAt });
  };

  const load = async () => {
    let lease = null;
    try {
      const metadata = await stat(persistedPath);
      if (!metadata.isFile() || metadata.size < 2 || metadata.size > persistedByteLimit) {
        throw new TypeError("SITEMAP_SNAPSHOT_FILE_SIZE");
      }
      lease = acquireRefreshLease({ phase: "load" });
      if (!lease) {
        lastDeferredAt = Number(now());
        nextRetryAt = lastDeferredAt + DEFAULT_RETRY_SECONDS * 1_000;
        return Object.freeze({ ok: false, reason: "resource_pressure", retryAt: nextRetryAt });
      }
      const payload = validateSitemapSnapshotPayload(
        JSON.parse(await readFile(persistedPath, "utf8")),
        { env },
      );
      current = hydratedSnapshot(payload);
      source = "persisted";
      lastSuccessAt = Number(now());
      lastFailureAt = null;
      lastFailureCategory = null;
      consecutiveFailures = 0;
      nextRetryAt = null;
      return Object.freeze({ ok: true, snapshot: current });
    } catch (error) {
      if (error?.code === "ENOENT") {
        return Object.freeze({ ok: false, reason: "missing" });
      }
      lastFailureAt = Number(now());
      lastFailureCategory = failureCategory(error, "load");
      return Object.freeze({ ok: false, reason: lastFailureCategory });
    } finally {
      lease?.release?.();
    }
  };

  const persist = async (payload) => {
    await mkdir(dataDir, { recursive: true });
    const temporaryPath = `${persistedPath}.${process.pid}.${Number(now())}.tmp`;
    let temporaryHandle = null;
    try {
      temporaryHandle = await open(temporaryPath, "wx", 0o600);
      let writtenBytes = 0;
      for (const chunk of sitemapSnapshotJsonChunks(payload)) {
        writtenBytes += Buffer.byteLength(chunk, "utf8");
        if (writtenBytes > persistedByteLimit) throw new TypeError("SITEMAP_SNAPSHOT_FILE_SIZE");
        await temporaryHandle.writeFile(chunk, { encoding: "utf8" });
      }
      await temporaryHandle.sync();
      await temporaryHandle.close();
      temporaryHandle = null;
      await rename(temporaryPath, persistedPath);
      try {
        const directoryHandle = await open(dataDir, "r");
        try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
      } catch (error) {
        // Windows and some mounted filesystems do not permit directory fsync.
        // The temp file itself was fsynced; ignore only known unsupported cases.
        if (!["EACCES", "EISDIR", "EINVAL", "ENOTSUP", "EPERM"].includes(error?.code)) throw error;
      }
    } catch (error) {
      if (temporaryHandle) {
        await temporaryHandle.close().catch(() => {
          /* architecture: allow-empty-catch -- preserve the original persistence failure during handle cleanup */
        });
      }
      await unlink(temporaryPath).catch(() => {
        /* architecture: allow-empty-catch -- preserve the original persistence failure during temp-file cleanup */
      });
      throw error;
    }
  };

  const refresh = ({ force = false } = {}) => {
    if (refreshPromise) return refreshPromise;
    const requestedAt = Number(now());
    if (!force && nextRetryAt != null && requestedAt < nextRetryAt) {
      return Promise.resolve(Object.freeze({ ok: false, reason: "backoff", retryAt: nextRetryAt }));
    }
    refreshStartedAt = requestedAt;
    refreshPromise = (async () => {
      let lease = null;
      try {
        await deferBuild();
        lease = acquireRefreshLease({ phase: "refresh" });
        if (!lease) {
          lastDeferredAt = Number(now());
          nextRetryAt = lastDeferredAt + DEFAULT_RETRY_SECONDS * 1_000;
          return Object.freeze({ ok: false, reason: "resource_pressure", retryAt: nextRetryAt });
        }
        const built = await buildSnapshot({ database, env, now: requestedAt });
        const payload = payloadFromSnapshot(built, env);
        await persist(payload);
        current = hydratedSnapshot(payload);
        source = "refresh";
        lastSuccessAt = Number(now());
        lastFailureAt = null;
        lastFailureCategory = null;
        consecutiveFailures = 0;
        nextRetryAt = null;
        return Object.freeze({ ok: true, snapshot: current });
      } catch (error) {
        consecutiveFailures += 1;
        lastFailureAt = Number(now());
        lastFailureCategory = failureCategory(error, "refresh");
        const backoff = Math.min(
          Math.max(1_000, Number(retryMaximumMs) || 15 * 60 * 1_000),
          Math.max(1_000, Number(retryBaseMs) || DEFAULT_RETRY_SECONDS * 1_000)
            * (2 ** Math.min(10, consecutiveFailures - 1)),
        );
        nextRetryAt = lastFailureAt + backoff;
        return Object.freeze({ ok: false, reason: lastFailureCategory, retryAt: nextRetryAt });
      } finally {
        try { lease?.release?.(); }
        finally {
          lastRefreshDurationMs = Math.max(0, Number(now()) - requestedAt);
          refreshStartedAt = null;
          refreshPromise = null;
        }
      }
    })();
    return refreshPromise;
  };

  return Object.freeze({
    persistedPath,
    load,
    refresh,
    drain() {
      return refreshPromise || Promise.resolve(Object.freeze({ ok: true, idle: true }));
    },
    lookup,
    health,
    xmlFor(pathname) {
      const result = lookup(pathname);
      return result.status === "ready" ? result.body : null;
    },
  });
}
