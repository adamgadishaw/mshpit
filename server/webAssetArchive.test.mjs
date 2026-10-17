import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { WEB_ASSET_LIMITS, assetSha256, buildWebAssetManifest, fingerprintedWebAsset, validateWebAssetManifest } from "./webAssetManifest.js";
import { loadWebAssetArchiveResolver, prepareWebAssetArchive, promoteWebAssetGraph, webAssetProcessEnvironment } from "./webAssetArchive.js";

const EPOCH = 1_800_000_000_000;
const DAY = 86_400_000;
const FREE = 2 * 1024 * 1024 * 1024;
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "pit-web-assets-"));
  t.after(() => {
    assert.equal(dirname(resolve(base)), resolve(tmpdir()));
    assert.match(basename(base), /^pit-web-assets-/);
    rmSync(base, { recursive: true, force: true });
  });
  const archiveRoot = join(base, "archive");
  const write = (root, url, body) => { const path = join(root, url); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); };
  function graph(tag, { extra = "", boot = "globalThis.boot=true;" } = {}) {
    const distDir = join(base, `dist-${tag}`);
    const hash = (name) => assetSha256(`${tag}:${name}`).slice(0, 32);
    const entry = `/_expo/static/js/web/entry-${hash("entry")}.js`;
    const nested = `/_expo/static/js/web/nested-${hash("nested")}.js`;
    const asset = `/assets/probe.${hash("asset")}.svg`;
    write(distDir, entry, `export const open=()=>import("./${basename(nested)}");${extra}`);
    write(distDir, nested, `export const name=${JSON.stringify(tag)};export const image=${JSON.stringify(asset)};`);
    write(distDir, asset, `<svg>${tag}</svg>`);
    write(distDir, "/index.html", `<script src="/boot-v1.js"></script><script src="${entry}"></script>`);
    write(distDir, "/boot-v1.js", boot);
    write(distDir, `${entry}.map`, "PRIVATE MAP SYNTHETIC");
    const manifestPath = join(base, `${tag}-manifest.json`);
    const manifest = buildWebAssetManifest(distDir);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    return { distDir, manifestPath, manifest, entry, nested, asset, release: assetSha256(`release:${tag}`).slice(0, 40) };
  }
  const prepare = (g, options = {}) => prepareWebAssetArchive({ ...g, archiveRoot, now: EPOCH, freeBytes: FREE, ...options });
  const load = (now = EPOCH, limits = WEB_ASSET_LIMITS) => loadWebAssetArchiveResolver({ archiveRoot, now, limits });
  return { base, archiveRoot, write, graph, prepare, load };
}

test("manifest captures the complete nested fingerprinted graph and leaves maps/stable code private", (t) => {
  const f = fixture(t); const a = f.graph("a");
  assert.equal(a.manifest.entries.length, 3);
  assert.deepEqual(a.manifest.stableDependencies.map((e) => e.url), ["/boot-v1.js"]);
  assert.equal(a.manifest.entries.some((e) => e.url.endsWith(".map")), false);
  assert.equal(buildWebAssetManifest(a.distDir).graphId, a.manifest.graphId);
  rmSync(join(a.distDir, a.nested));
  assert.throws(() => buildWebAssetManifest(a.distDir), /incomplete_graph/);
});

test("missing relative, stable, worker and URL dependencies cannot pass complete-graph validation", (t) => {
  const f = fixture(t);
  for (const [i, expression] of [
    'import("./missing-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.js")',
    'import("/missing-worker.js")',
    'export {x} from "./missing-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.js"',
    'new Worker("/missing-worker.js")',
    'new URL("./missing-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.js",import.meta.url)',
  ].entries()) {
    assert.throws(() => f.graph(`missing${i}`, { extra: expression }), /incomplete_graph|ENOENT/);
  }
});

test("manifest validation rejects tampering, noncanonical URLs and oversized graphs", (t) => {
  const f = fixture(t); const a = f.graph("a");
  const tampered = structuredClone(a.manifest); tampered.entries[0].bytes++;
  assert.throws(() => validateWebAssetManifest(tampered), /manifest_integrity/);
  for (const url of ["/assets/../private.aaaaaaaaaaaaaaaa.svg", "/assets/%2e%2e/private.aaaaaaaaaaaaaaaa.svg", "/assets\\a.aaaaaaaaaaaaaaaa.svg", "/_expo/static/js/android/index-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.js", `${a.entry}.map`]) assert.equal(fingerprintedWebAsset(url), false);
  assert.throws(() => buildWebAssetManifest(a.distDir, { limits: { ...WEB_ASSET_LIMITS, fileBytes: 5 } }), /unsafe_asset_file/);
  assert.throws(() => buildWebAssetManifest(a.distDir, { limits: { ...WEB_ASSET_LIMITS, graphFiles: 3 } }), /graph_limit/);
});

test("initial stable scripts and CSS dependencies cannot hide query or fragment variants", (t) => {
  const f = fixture(t); const a = f.graph("a");
  f.write(a.distDir, "/index.html", `<script src="/boot-v1.js?v=1"></script><script src="${a.entry}"></script>`);
  assert.throws(() => buildWebAssetManifest(a.distDir), /nonlocal_initial_code/);
  f.write(a.distDir, "/index.html", `<script src="${a.entry}"></script>`);
  for (const reference of [`${a.asset}?v=1`, `${a.asset}#image`]) {
    f.write(a.distDir, "/_expo/static/css/styles-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.css", `body{background:url("${reference}")}`);
    assert.throws(() => buildWebAssetManifest(a.distDir), /noncanonical_dependency/);
  }
});

test("runtime captures A and B exactly without inferring release acceptance", (t) => {
  const f = fixture(t); const a = f.graph("a"); const b = f.graph("b");
  f.prepare(a); const result = f.prepare(b, { now: EPOCH + 1 });
  assert.equal(result.catalog.current, b.manifest.graphId);
  assert.equal(result.catalog.rollback, null);
  const archive = f.load();
  for (const g of [a, b]) for (const url of [g.entry, g.nested, g.asset]) {
    const retained = archive.lookup(url);
    assert.equal(readFileSync(retained.path, "utf8"), readFileSync(join(g.distDir, url), "utf8"));
  }
  assert.equal(archive.lookup(`${a.entry}.map`), null);
  assert.equal(archive.lookup("/boot-v1.js"), null);
  assert.equal(archive.lookup("/index.html"), null);
});

test("explicit promotion, durable expiry and rollback preserve the intended pins", (t) => {
  const f = fixture(t); const a = f.graph("a"); const b = f.graph("b");
  f.prepare(a); f.prepare(b, { now: EPOCH + 1 });
  assert.throws(() => promoteWebAssetGraph({ archiveRoot: f.archiveRoot, graphId: a.manifest.graphId, freeBytes: FREE }), /promotion_requires_current/);
  promoteWebAssetGraph({ archiveRoot: f.archiveRoot, graphId: b.manifest.graphId, freeBytes: FREE });
  f.prepare(b, { now: EPOCH + 2 * DAY });
  assert.equal(f.load(EPOCH + 8 * DAY).lookup(a.entry), null);
  assert.ok(f.load(EPOCH + 80 * DAY).lookup(b.entry));
  const rollback = f.prepare(a, { now: EPOCH + 8 * DAY });
  assert.equal(rollback.catalog.current, a.manifest.graphId);
  assert.equal(rollback.catalog.rollback, b.manifest.graphId);
  assert.ok(f.load(EPOCH + 9 * DAY).lookup(b.nested));
});

test("graph limits evict whole unpinned generations and never displace current/rollback", (t) => {
  const f = fixture(t); const limits = { ...WEB_ASSET_LIMITS, graphs: 2 };
  const a = f.graph("a"); const b = f.graph("b"); const c = f.graph("c");
  f.prepare(a, { limits });
  promoteWebAssetGraph({ archiveRoot: f.archiveRoot, graphId: a.manifest.graphId, limits, freeBytes: FREE });
  f.prepare(b, { limits, now: EPOCH + 1 });
  assert.throws(() => f.prepare(c, { limits, now: EPOCH + 2 }), /archive_capacity/);
  assert.ok(f.load(EPOCH, limits).lookup(a.entry)); assert.ok(f.load(EPOCH, limits).lookup(b.entry));
  promoteWebAssetGraph({ archiveRoot: f.archiveRoot, graphId: b.manifest.graphId, limits, freeBytes: FREE });
  const result = f.prepare(c, { limits, now: EPOCH + 3 });
  assert.equal(result.catalog.graphs.length, 2);
  assert.equal(f.load(EPOCH, limits).lookup(a.entry), null);
  assert.ok(f.load(EPOCH, limits).lookup(b.entry));
});

test("free-space and global byte/file admission include staging before publication", (t) => {
  const f = fixture(t); const a = f.graph("a"); const b = f.graph("b");
  f.prepare(a);
  const before = readFileSync(join(f.archiveRoot, "catalog.json"), "utf8");
  for (const options of [{ freeBytes: 0 }, { limits: { ...WEB_ASSET_LIMITS, archiveBytes: 4096 } }, { limits: { ...WEB_ASSET_LIMITS, archiveFiles: 2 } }]) {
    assert.throws(() => f.prepare(b, options), /archive_capacity|archive_limit|archive_scan_limit/);
    assert.equal(readFileSync(join(f.archiveRoot, "catalog.json"), "utf8"), before);
    assert.equal(readdirSync(f.archiveRoot).some((name) => name.startsWith(".stage-")), false);
  }
});

test("interrupted copy or rename cannot expose a partial graph; next startup reclaims owned orphan", (t) => {
  const f = fixture(t); const a = f.graph("a"); const b = f.graph("b");
  f.prepare(a);
  for (const point of ["staged-file", "renamed-graph"]) {
    assert.throws(() => f.prepare(b, { now: EPOCH + 1, checkpoint: (phase) => { if (phase === point) throw new Error("synthetic interruption"); } }), /synthetic interruption/);
    const archive = f.load(); assert.equal(archive.lookup(b.entry), null); assert.ok(archive.lookup(a.entry));
  }
  f.prepare(b, { now: EPOCH + 2 });
  assert.ok(f.load().lookup(b.entry));
  assert.equal(readdirSync(f.archiveRoot).some((name) => name.startsWith(".stage-")), false);
});

test("an existing writer lock is never reclaimed automatically, including a stale PID", (t) => {
  const f = fixture(t); const a = f.graph("a"); const b = f.graph("b");
  f.prepare(a);
  const lock = join(f.archiveRoot, "writer.lock");
  const contents = JSON.stringify({ pid: 2147483647 });
  writeFileSync(lock, contents);
  assert.throws(() => f.prepare(b), /archive_locked/);
  assert.equal(readFileSync(lock, "utf8"), contents);
  assert.ok(f.load().lookup(a.entry));
  assert.equal(f.load().lookup(b.entry), null);
});

test("tampered retained bytes, stable-code changes and reused URL collisions fail closed", (t) => {
  const f = fixture(t); const a = f.graph("a"); f.prepare(a);
  const changedBoot = f.graph("b", { boot: "globalThis.boot=false;" });
  assert.throws(() => f.prepare(changedBoot), /stable_dependency_changed/);
  const collision = f.graph("c"); f.write(collision.distDir, a.entry, "different bytes under an old hash");
  writeFileSync(collision.manifestPath, JSON.stringify(buildWebAssetManifest(collision.distDir)));
  assert.throws(() => f.prepare(collision), /asset_url_collision/);
  const retained = f.load().lookup(a.entry); writeFileSync(retained.path, "tampered");
  assert.throws(() => f.load(), /archive_integrity/);
});

test("ancestor junctions and unowned directories cannot be traversed or cleaned", (t) => {
  const f = fixture(t); const a = f.graph("a");
  const outside = join(f.base, "outside"); mkdirSync(outside); writeFileSync(join(outside, "sentinel.txt"), "preserve");
  symlinkSync(outside, f.archiveRoot, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => f.prepare(a), /unsafe_directory/);
  assert.equal(readFileSync(join(outside, "sentinel.txt"), "utf8"), "preserve");
  assert.equal(existsSync(join(outside, ".owner")), false);
});

test("archive child receives only filesystem/release fields, never provider or auth credentials", () => {
  assert.deepEqual(webAssetProcessEnvironment({ PIT_DATA_DIR: "/synthetic", RENDER_GIT_COMMIT: "a".repeat(40), NODE_OPTIONS: "untrusted", ADMIN_PASSWORD: "fixture", RESEND_API_KEY: "fixture" }), {
    PIT_DATA_DIR: "/synthetic", RENDER_GIT_COMMIT: "a".repeat(40),
  });
});
