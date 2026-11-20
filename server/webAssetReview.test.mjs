import assert from "node:assert/strict";
import { closeSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import test from "node:test";
import { WEB_ASSET_LIMITS, buildWebAssetManifest } from "./webAssetManifest.js";
import { prepareWebAssetArchive, promoteWebAssetGraph, resolverFromWebAssetSnapshot } from "./webAssetArchive.js";
import { serveFingerprintAsset } from "./webAssetServing.js";

// These independent regressions reproduce defects found during review using
// actual production helpers. They use no database, credentials or network.
const FREE_BYTES = 2 ** 40;
const WORKER_V1 = 'export default "worker-v1";';

function fixture(t) {
  const parent = resolve(tmpdir());
  const root = mkdtempSync(join(parent, "pit-web-asset-review-"));
  assert.equal(dirname(resolve(root)), parent);
  t.after(() => {
    const target = resolve(root);
    assert.equal(dirname(target), parent);
    assert.ok(target.startsWith(parent + sep));
    assert.match(target.slice(parent.length + 1), /^pit-web-asset-review-/);
    rmSync(target, { recursive: true, force: true });
  });
  return { root, archiveRoot: join(root, "archive") };
}

function exportedGraph(root, label, digit, { worker = null, extraStable = {} } = {}) {
  const distDir = join(root, label);
  const url = `/_expo/static/js/web/index-${digit.repeat(32)}.js`;
  mkdirSync(join(distDir, "_expo", "static", "js", "web"), { recursive: true });
  writeFileSync(join(distDir, ...url.slice(1).split("/")), worker
    ? `import("/${worker}.js"); export default "${label}";`
    : `export default "${label}";`);
  writeFileSync(join(distDir, "index.html"), `<script src="${url}"></script>`);
  if (worker) writeFileSync(join(distDir, `${worker}.js`), `export default "${worker}";`);
  for (const [name, contents] of Object.entries(extraStable)) writeFileSync(join(distDir, name), contents);
  const manifest = buildWebAssetManifest(distDir);
  const manifestPath = join(root, `${label}-manifest.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { distDir, url, manifest, manifestPath, release: digit.repeat(40) };
}

function prepare(graph, archiveRoot, now) {
  return prepareWebAssetArchive({ ...graph, archiveRoot, now, freeBytes: FREE_BYTES });
}

function promote(graph, archiveRoot) {
  return promoteWebAssetGraph({ archiveRoot, graphId: graph.manifest.graphId, freeBytes: FREE_BYTES });
}

function headResponse() {
  return {
    headersSent: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
    end(body) { this.body = body; this.ended = true; },
    destroy() { this.destroyed = true; },
  };
}

test("a current fingerprinted asset stays available when it exceeds the optional archive file cap", (t) => {
  const { root } = fixture(t);
  const graph = exportedGraph(root, "current", "f");
  const bytes = WEB_ASSET_LIMITS.fileBytes + 1;
  const fd = openSync(join(graph.distDir, ...graph.url.slice(1).split("/")), "w");
  try { ftruncateSync(fd, bytes); } finally { closeSync(fd); }
  assert.throws(() => buildWebAssetManifest(graph.distDir), { code: "unsafe_asset_file" }, "the retention build limit still applies");
  const response = headResponse();
  assert.equal(serveFingerprintAsset({ method: "HEAD" }, response, graph.url, {
    distDir: graph.distDir,
    archive: { lookup() { assert.fail("current dist must win without consulting the optional archive"); } },
    headers: { "X-Content-Type-Options": "nosniff" },
  }), true);
  assert.equal(response.status, 200, "retention limits must not turn an existing current asset into a 404");
  assert.equal(response.headers["Content-Length"], bytes);
  assert.equal(response.headers["Content-Type"], "text/javascript");
  assert.equal(response.headers["Cache-Control"], "public, max-age=31536000, immutable");
  assert.equal(response.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(response.body, undefined, "HEAD must not stream a response body");
  assert.equal(response.ended, true);
  assert.notEqual(response.destroyed, true);
});

for (const change of ["removed", "changed"]) {
  test(`retention rejects a ${change} stable dependency even when the new graph no longer references its URL`, (t) => {
    const { root, archiveRoot } = fixture(t);
    const a = exportedGraph(root, "a", "a", { worker: "worker-v1" });
    prepare(a, archiveRoot, 1_000);
    promote(a, archiveRoot);
    const catalogBefore = readFileSync(join(archiveRoot, "catalog.json"), "utf8");
    const b = exportedGraph(root, "b", "b", {
      worker: "worker-v2",
      extraStable: change === "changed" ? { "worker-v1.js": 'export default "incompatible";' } : {},
    });
    assert.equal(b.manifest.stableDependencies.some((entry) => entry.url === "/worker-v1.js"), false);
    assert.throws(() => prepare(b, archiveRoot, 2_000), undefined,
      "a complete retained A cannot depend on missing or incompatible files in current dist");
    assert.equal(readFileSync(join(archiveRoot, "catalog.json"), "utf8"), catalogBefore,
      "failure must preserve the current and explicitly accepted rollback pins");
    assert.equal(existsSync(join(archiveRoot, `g-${a.manifest.graphId}`)), true);
    const response = headResponse();
    serveFingerprintAsset({ method: "HEAD" }, response, b.url, { distDir: b.distDir });
    assert.equal(response.status, 200, "failed optional retention must not prevent B from serving its current asset");
  });
}

test("an old stable dependency preserved unchanged remains valid even when the new graph no longer references it", (t) => {
  const { root, archiveRoot } = fixture(t);
  const a = exportedGraph(root, "a", "a", { worker: "worker-v1" });
  prepare(a, archiveRoot, 1_000);
  promote(a, archiveRoot);
  const b = exportedGraph(root, "b", "b", { worker: "worker-v2", extraStable: { "worker-v1.js": WORKER_V1 } });
  assert.equal(b.manifest.stableDependencies.some((entry) => entry.url === "/worker-v1.js"), false);
  const prepared = prepare(b, archiveRoot, 2_000);
  assert.equal(prepared.ok, true);
  assert.equal(prepared.catalog.rollback, a.manifest.graphId);
  const live = resolverFromWebAssetSnapshot(prepared.snapshot, { now: () => 3_000 });
  assert.ok(live.lookup(a.url), "A remains complete through the unchanged stable file in B dist");
});

test("explicit promotion updates expiry in an already running resolver without reloading its graph snapshot", (t) => {
  const { root, archiveRoot } = fixture(t);
  const a = exportedGraph(root, "a", "a");
  prepare(a, archiveRoot, 1_000);
  promote(a, archiveRoot);
  const b = exportedGraph(root, "b", "b");
  const deactivatedAt = 2_000;
  const prepared = prepare(b, archiveRoot, deactivatedAt);
  let now = deactivatedAt + WEB_ASSET_LIMITS.ttlMs + 1;
  const live = resolverFromWebAssetSnapshot(prepared.snapshot, { now: () => now });
  assert.ok(live.lookup(a.url), "the explicitly pinned rollback survives seven days");
  assert.ok(live.lookup(b.url), "the current graph also survives expiry");
  const promoted = promote(b, archiveRoot);
  assert.equal(promoted.catalog.rollback, b.manifest.graphId);
  now += 2_000; // Exceeds the bounded one-second metadata refresh interval.
  assert.equal(live.lookup(a.url), null, "the same resolver must honor removal of A's rollback pin");
  assert.ok(live.lookup(b.url), "refreshing pin metadata must preserve the current graph");
  assert.equal(existsSync(join(archiveRoot, `g-${a.manifest.graphId}`)), true,
    "request-time expiry must not delete graph files");
});

test("startup never implicitly accepts an initial rollback graph", (t) => {
  const { root, archiveRoot } = fixture(t);
  const a = exportedGraph(root, "a", "a");
  assert.equal(prepare(a, archiveRoot, 1_000).catalog.rollback, null);
  const b = exportedGraph(root, "b", "b");
  const prepared = prepare(b, archiveRoot, 2_000);
  assert.equal(prepared.catalog.current, b.manifest.graphId);
  assert.equal(prepared.catalog.rollback, null, "A has never been explicitly accepted");
  const expired = resolverFromWebAssetSnapshot(prepared.snapshot, {
    now: () => 2_000 + WEB_ASSET_LIMITS.ttlMs + 1,
  });
  assert.equal(expired.lookup(a.url), null, "unaccepted A must expire normally");
  assert.ok(expired.lookup(b.url));
  assert.equal(promote(b, archiveRoot).catalog.rollback, b.manifest.graphId,
    "only the explicit acceptance operation establishes the rollback pin");
});
