import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sitemapIndexXml, urlsetParts } from "./sitemapService.js";
import {
  SITEMAP_SNAPSHOT_REVISION,
  SITEMAP_MAX_PERSISTED_SNAPSHOT_BYTES,
  createSitemapSnapshotManager,
  sitemapStartupRefreshDecision,
  validateSitemapSnapshotPayload,
} from "./sitemapSnapshotManager.js";

const ENV = Object.freeze({ PUBLIC_ORIGIN: "https://www.example.com" });
const DATABASE = Object.freeze({ prepare() { throw new Error("fake builder should own reads"); } });

function testSnapshot(marker, { generatedAt = 1_725_000_000_000, paths = ["/sitemaps/pages.xml"] } = {}) {
  const documents = {
    "/sitemap.xml": sitemapIndexXml(ENV, paths),
  };
  for (const [index, path] of paths.entries()) {
    documents[path] = urlsetParts(
      [{ path: `/post/${marker}-${index}`, lastmod: generatedAt }],
      ENV.PUBLIC_ORIGIN,
    )[0];
  }
  return Object.freeze({
    generatedAt,
    paths: Object.freeze(paths),
    stats: Object.freeze({
      totalUrls: paths.length,
      shardCount: paths.length,
      datasetCounts: Object.freeze({ pages: paths.length }),
    }),
    xmlFor(pathname) {
      return Object.hasOwn(documents, pathname) ? documents[pathname] : null;
    },
  });
}

function duplicateUrlSnapshot() {
  const paths = ["/sitemaps/pages.xml", "/sitemaps/pages-2.xml"];
  const duplicate = urlsetParts([{ path: "/post/duplicate" }], ENV.PUBLIC_ORIGIN)[0];
  const documents = {
    "/sitemap.xml": sitemapIndexXml(ENV, paths),
    [paths[0]]: duplicate,
    [paths[1]]: duplicate,
  };
  return {
    generatedAt: 1_725_000_000_000,
    paths,
    stats: { datasetCounts: { pages: 2 } },
    xmlFor(pathname) { return documents[pathname] || null; },
  };
}

function createTempManager(options = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "pit-sitemap-lkg-"));
  const manager = createSitemapSnapshotManager({
    database: DATABASE,
    dataDir,
    env: ENV,
    ...options,
  });
  return { dataDir, manager };
}

test("sitemap lookups never build and distinguish unavailable, missing, and unrecognized paths", async () => {
  let builds = 0;
  let marker = "lookup";
  const { dataDir, manager } = createTempManager({
    buildSnapshot() { builds += 1; return testSnapshot(marker); },
  });
  try {
    assert.deepEqual(manager.lookup("/sitemap.xml"), { status: "unavailable", retryAfterSeconds: 30 });
    assert.deepEqual(manager.lookup("/sitemaps/pages.xml"), { status: "unavailable", retryAfterSeconds: 30 });
    assert.deepEqual(manager.lookup("/sitemaps/not-a-dataset.xml"), { status: "unrecognized" });
    assert.equal(manager.xmlFor("/sitemap.xml"), null);
    assert.equal(builds, 0, "read paths never trigger database materialization");

    assert.equal((await manager.refresh()).ok, true);
    assert.equal(builds, 1);
    assert.equal(manager.lookup("/sitemap.xml").status, "ready");
    assert.equal(manager.lookup("/sitemaps/pages-2.xml").status, "missing");
    assert.equal(manager.lookup("/sitemaps/not-a-dataset.xml").status, "unrecognized");
    marker = "replacement";
    assert.equal((await manager.refresh({ force: true })).ok, true);
    assert.match(manager.lookup("/sitemaps/pages.xml").body, /replacement/,
      "a later validated snapshot atomically replaces the persisted and in-memory LKG");
    assert.equal(builds, 2);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("concurrent refreshes coalesce, persist atomically, and load before serving", async () => {
  let builds = 0;
  let releaseBuild;
  const buildGate = new Promise((resolve) => { releaseBuild = resolve; });
  const { dataDir, manager } = createTempManager({
    async buildSnapshot() {
      builds += 1;
      await buildGate;
      return testSnapshot("coalesced");
    },
  });
  try {
    const first = manager.refresh();
    const second = manager.refresh();
    let drained = false;
    const drain = manager.drain().then((result) => {
      drained = true;
      return result;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(builds, 1);
    assert.equal(manager.health().refreshing, true);
    assert.equal(drained, false, "shutdown drain waits for the active refresh");
    releaseBuild();
    const results = await Promise.all([first, second, drain]);
    assert.equal(results.every((result) => result.ok), true);
    assert.equal(builds, 1);
    assert.equal(manager.health().available, true);
    assert.equal(manager.health().source, "refresh");
    assert.equal(manager.health().totalUrls, 1);
    assert.equal(readFileSync(manager.persistedPath, "utf8").includes("coalesced"), true);

    const loaded = createSitemapSnapshotManager({
      database: DATABASE,
      dataDir,
      env: ENV,
      buildSnapshot() { throw new Error("load must not rebuild"); },
    });
    assert.equal((await loaded.load()).ok, true);
    assert.equal(loaded.health().source, "persisted");
    assert.match(loaded.lookup("/sitemaps/pages.xml").body, /coalesced/);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("a failed refresh retains the last-known-good snapshot and applies retry backoff", async () => {
  let clock = 1_725_000_000_000;
  let invalid = false;
  const { dataDir, manager } = createTempManager({
    now: () => clock,
    retryBaseMs: 5_000,
    buildSnapshot() {
      return invalid ? duplicateUrlSnapshot() : testSnapshot("last-known-good", { generatedAt: clock });
    },
  });
  try {
    assert.equal((await manager.refresh()).ok, true);
    const original = manager.lookup("/sitemaps/pages.xml").body;
    invalid = true;
    clock += 1_000;
    const failed = await manager.refresh({ force: true });
    assert.equal(failed.ok, false);
    assert.equal(failed.reason, "refresh_validation");
    assert.equal(manager.lookup("/sitemaps/pages.xml").body, original);
    assert.equal(manager.health().available, true);
    assert.equal(manager.health().consecutiveFailures, 1);
    assert.equal(manager.health().lastFailureCategory, "refresh_validation");
    assert.equal(manager.health().nextRetryAt, clock + 5_000);

    clock += 1_000;
    const backedOff = await manager.refresh();
    assert.deepEqual(backedOff, { ok: false, reason: "backoff", retryAt: 1_725_000_006_000 });
    assert.equal(manager.lookup("/sitemaps/pages.xml").body, original);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("an unavailable snapshot reports the actual retry window and refreshes after it", async () => {
  let clock = 1_725_000_000_000;
  const { dataDir, manager } = createTempManager({
    now: () => clock,
    retryBaseMs: 5_000,
    buildSnapshot() { throw new Error("temporary build failure"); },
  });
  try {
    const failed = await manager.refresh();
    assert.equal(failed.retryAt, clock + 5_000);
    assert.deepEqual(manager.lookup("/sitemap.xml"), {
      status: "unavailable",
      retryAfterSeconds: 5,
    });
    clock += 1_001;
    assert.equal(manager.lookup("/sitemap.xml").retryAfterSeconds, 4);
    clock += 3_999;
    assert.equal(manager.lookup("/sitemap.xml").retryAfterSeconds, 1);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("persisted snapshots have a measured total-size ceiling before write and load", async () => {
  assert.equal(SITEMAP_MAX_PERSISTED_SNAPSHOT_BYTES, 96 * 1024 * 1024);
  const { dataDir, manager } = createTempManager({
    maximumPersistedBytes: 128,
    buildSnapshot() { return testSnapshot("too-large-for-test-cap"); },
  });
  try {
    const failed = await manager.refresh();
    assert.equal(failed.ok, false);
    assert.equal(failed.reason, "refresh_validation");
    assert.equal(manager.health().available, false);

    writeFileSync(manager.persistedPath, "x".repeat(129));
    const loaded = await manager.load();
    assert.deepEqual(loaded, { ok: false, reason: "load_validation" });
    assert.equal(manager.health().available, false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("persisted snapshots are fully validated before becoming serveable", async () => {
  const { dataDir, manager } = createTempManager({
    buildSnapshot() { return testSnapshot("unused"); },
  });
  try {
    writeFileSync(manager.persistedPath, JSON.stringify({
      version: 1,
      revision: SITEMAP_SNAPSHOT_REVISION,
      generatedAt: 1_725_000_000_000,
      paths: ["/sitemaps/pages.xml", "/sitemaps/pages-2.xml"],
      documents: {
        "/sitemap.xml": sitemapIndexXml(ENV, ["/sitemaps/pages.xml", "/sitemaps/pages-2.xml"]),
        "/sitemaps/pages.xml": urlsetParts([{ path: "/post/duplicate" }], ENV.PUBLIC_ORIGIN)[0],
        "/sitemaps/pages-2.xml": urlsetParts([{ path: "/post/duplicate" }], ENV.PUBLIC_ORIGIN)[0],
      },
      stats: { datasetCounts: { pages: 2 } },
    }));
    const result = await manager.load();
    assert.equal(result.ok, false);
    assert.equal(result.reason, "load_validation");
    assert.equal(manager.health().available, false);
    assert.equal(manager.lookup("/sitemap.xml").status, "unavailable");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("payload validation enforces canonical host, shard membership, and global URL uniqueness", () => {
  const valid = testSnapshot("valid");
  const paths = [...valid.paths];
  const payload = {
    version: 1,
    revision: SITEMAP_SNAPSHOT_REVISION,
    generatedAt: valid.generatedAt,
    paths,
    documents: Object.fromEntries(["/sitemap.xml", ...paths].map((path) => [path, valid.xmlFor(path)])),
    stats: valid.stats,
  };
  assert.equal(validateSitemapSnapshotPayload(payload, { env: ENV }).stats.totalUrls, 1);

  assert.throws(
    () => validateSitemapSnapshotPayload({ ...payload, revision: SITEMAP_SNAPSHOT_REVISION + 1 }, { env: ENV }),
    /SITEMAP_SNAPSHOT_REVISION/,
    "a deploy with changed sitemap policy rebuilds instead of reusing old selection rules",
  );

  const foreign = structuredClone(payload);
  foreign.documents[paths[0]] = foreign.documents[paths[0]].replace(
    "https://www.example.com",
    "https://attacker.example",
  );
  assert.throws(
    () => validateSitemapSnapshotPayload(foreign, { env: ENV }),
    /SITEMAP_SNAPSHOT_URL_ORIGIN/,
  );

  const extra = structuredClone(payload);
  extra.documents["/sitemaps/posts.xml"] = urlsetParts([{ path: "/post/extra" }], ENV.PUBLIC_ORIGIN)[0];
  assert.throws(
    () => validateSitemapSnapshotPayload(extra, { env: ENV }),
    /SITEMAP_SNAPSHOT_DOCUMENT_SET/,
  );
});

test("startup reuses only a fresh validated snapshot from the current sitemap revision", async () => {
  let clock = 1_725_000_000_000;
  const { dataDir, manager } = createTempManager({
    now: () => clock,
    buildSnapshot() { return testSnapshot("startup-reuse", { generatedAt: clock }); },
  });
  try {
    assert.equal((await manager.refresh()).ok, true);
    const loadedManager = createSitemapSnapshotManager({
      database: DATABASE,
      dataDir,
      env: ENV,
      now: () => clock,
      buildSnapshot() { throw new Error("startup policy must not build"); },
    });
    const loaded = await loadedManager.load();
    assert.equal(loaded.ok, true);
    assert.equal(loaded.snapshot.revision, SITEMAP_SNAPSHOT_REVISION);

    clock += 5_000;
    assert.deepEqual(sitemapStartupRefreshDecision(loaded, {
      now: clock,
      maximumAgeMs: 10_000,
    }), { refresh: false, force: false, reason: "fresh", ageMs: 5_000 });

    clock += 5_001;
    assert.deepEqual(sitemapStartupRefreshDecision(loaded, {
      now: clock,
      maximumAgeMs: 10_000,
    }), { refresh: true, force: true, reason: "stale", ageMs: 10_001 });
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("startup rejects missing, incompatible, and implausibly future snapshot state", () => {
  assert.deepEqual(sitemapStartupRefreshDecision({ ok: false, reason: "missing" }), {
    refresh: true, force: true, reason: "missing",
  });
  assert.equal(sitemapStartupRefreshDecision({
    ok: true,
    snapshot: { version: 1, revision: SITEMAP_SNAPSHOT_REVISION + 1, generatedAt: 100 },
  }, { now: 100 }).reason, "revision");
  assert.equal(sitemapStartupRefreshDecision({
    ok: true,
    snapshot: { version: 1, revision: SITEMAP_SNAPSHOT_REVISION, generatedAt: 61_001 },
  }, { now: 1_000 }).reason, "future");
});
