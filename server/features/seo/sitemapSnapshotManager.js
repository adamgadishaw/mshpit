import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  SITEMAP_MAX_BYTES,
  SITEMAP_MAX_URLS,
  createSitemapSnapshot,
  isSitemapRequestPath,
} from "./sitemapService.js";

const SNAPSHOT_VERSION = 1;
const SNAPSHOT_FILENAME = "seo-sitemap-snapshot-v1.json";
const DEFAULT_RETRY_SECONDS = 30;
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

function sitemapLocations(xml) {
  return [...String(xml || "").matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}

function urlCount(xml) {
  return [...String(xml || "").matchAll(/<url>/g)].length;
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
  const indexedPaths = sitemapLocations(indexXml).map((value) => {
    const url = new URL(value);
    if (url.origin !== origin || url.search || url.hash) throw new TypeError("SITEMAP_SNAPSHOT_INDEX_ORIGIN");
    return url.pathname;
  });
  if (indexedPaths.length !== paths.length || indexedPaths.some((path, index) => path !== paths[index])) {
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
    const locations = sitemapLocations(xml);
    if (locations.length !== count) throw new TypeError("SITEMAP_SNAPSHOT_LOC_COUNT");
    for (const value of locations) {
      const url = new URL(value);
      if (url.origin !== origin || url.search || url.hash) throw new TypeError("SITEMAP_SNAPSHOT_URL_ORIGIN");
      if (seenUrls.has(url.href)) throw new TypeError("SITEMAP_SNAPSHOT_DUPLICATE_URL");
      seenUrls.add(url.href);
    }
    totalUrls += count;
  }

  const documents = Object.freeze(Object.fromEntries(
    ["/sitemap.xml", ...paths].map((path) => [path, String(payload.documents[path])]),
  ));
  return Object.freeze({
    version: SNAPSHOT_VERSION,
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
    generatedAt: snapshot?.generatedAt,
    paths,
    documents,
    stats: snapshot?.stats,
  }, { env });
}

function hydratedSnapshot(payload) {
  const documents = payload.documents;
  return Object.freeze({
    generatedAt: payload.generatedAt,
    paths: payload.paths,
    stats: payload.stats,
    xmlFor(pathname) {
      return Object.hasOwn(documents, pathname) ? documents[pathname] : null;
    },
  });
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
} = {}) {
  if (!database?.prepare) throw new TypeError("Sitemap snapshot manager requires a database");
  if (typeof dataDir !== "string" || !dataDir.trim()) throw new TypeError("Sitemap snapshot manager requires the configured data directory");
  if (typeof buildSnapshot !== "function") throw new TypeError("Sitemap snapshot manager requires a builder");
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
    try {
      const metadata = await stat(persistedPath);
      if (!metadata.isFile() || metadata.size < 2 || metadata.size > persistedByteLimit) {
        throw new TypeError("SITEMAP_SNAPSHOT_FILE_SIZE");
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
    }
  };

  const persist = async (payload) => {
    await mkdir(dataDir, { recursive: true });
    const temporaryPath = `${persistedPath}.${process.pid}.${Number(now())}.tmp`;
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized, "utf8") > persistedByteLimit) {
      throw new TypeError("SITEMAP_SNAPSHOT_FILE_SIZE");
    }
    let temporaryHandle = null;
    try {
      temporaryHandle = await open(temporaryPath, "wx", 0o600);
      await temporaryHandle.writeFile(serialized, { encoding: "utf8" });
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
      try {
        await deferBuild();
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
        lastRefreshDurationMs = Math.max(0, Number(now()) - requestedAt);
        refreshStartedAt = null;
        refreshPromise = null;
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
