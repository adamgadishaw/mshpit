import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { runCatalogPilot } from "./catalog-pilot-dry-run.mjs";
import { syntheticPilotSnapshot } from "../src/features/catalogMaintenance/catalogPilot.mjs";
const at = 1_790_000_000_000;
function folder(t) {
  const directory = mkdtempSync(join(tmpdir(), "catalog-pilot-offline-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const read = path => JSON.parse(readFileSync(path, "utf8"));
test("default CLI dry-run uses synthetic records and creates no files", (t) => {
  const directory = folder(t), before = readdirSync(directory);
  const result = runCatalogPilot([], { at });
  assert.equal(result.report.snapshot.kind, "synthetic"); assert.equal(result.summary.examined, 25);
  assert.deepEqual(result.summary.byType, { artist: 34, venue: 33, event: 33 });
  assert.equal(result.summary.checkpointSaved, false); assert.deepEqual(readdirSync(directory), before);
});
test("explicit checkpoint resumes locally with CAS, pause and no duplicate selection", (t) => {
  const path = join(folder(t), "checkpoint.json");
  const first = runCatalogPilot(["--checkpoint", path], { at });
  assert.equal(first.summary.examined, 25);
  assert.throws(() => runCatalogPilot(["--checkpoint", path, "--expected-revision", "0"], { at }), /revision changed/);
  const paused = runCatalogPilot(["--checkpoint", path, "--pause"], { at });
  assert.equal(paused.summary.examined, 25); assert.equal(paused.summary.previewPaused, true);
  const resumed = runCatalogPilot(["--checkpoint", path, "--resume", "--batch", "100"], { at });
  assert.equal(resumed.summary.examined, 100);
  const retry = runCatalogPilot(["--checkpoint", path], { at });
  assert.equal(retry.summary.revision, resumed.summary.revision);
  assert.equal(new Set(read(path).selected.map(row => row.type + row.key)).size, 100);
  assert.deepEqual(readdirSync(join(path, "..")), ["checkpoint.json"]);
});
test("authorized snapshots need explicit consent; source bytes are never overwritten", (t) => {
  const directory = folder(t), input = join(directory, "snapshot.json"), checkpoint = join(directory, "report.json");
  const snapshot = syntheticPilotSnapshot(at); snapshot.kind = "authorized-catalog-snapshot";
  writeFileSync(input, JSON.stringify(snapshot)); const before = readFileSync(input);
  assert.throws(() => runCatalogPilot(["--input", input], { at }), /Confirm permission/);
  const result = runCatalogPilot(["--input", input, "--checkpoint", checkpoint, "--authorized-snapshot"], { at });
  assert.match(result.summary.confidence, /live total unverified/);
  assert.deepEqual(readFileSync(input), before);
  assert.throws(() => runCatalogPilot(["--checkpoint", checkpoint], { at }), /Confirm permission/);
  assert.throws(() => runCatalogPilot(["--input", input, "--checkpoint", input, "--authorized-snapshot"], { at }), /separate/);
  assert.deepEqual(readFileSync(input), before);
});
test("newer snapshot pause or revocation cannot be undone by a checkpoint-only retry", (t) => {
  const directory = folder(t), checkpoint = join(directory, "report.json"), input = join(directory, "newer.json");
  const first = runCatalogPilot(["--checkpoint", checkpoint], { at });
  const snapshot = structuredClone(first.report.snapshot); snapshot.capturedAt++; snapshot.control.grantStatus = "revoked";
  writeFileSync(input, JSON.stringify(snapshot));
  const changed = runCatalogPilot(["--checkpoint", checkpoint, "--input", input], { at: at + 1 });
  assert.equal(changed.summary.consistent, 0); assert.equal(changed.summary.revoked, 50);
  const resumed = runCatalogPilot(["--checkpoint", checkpoint], { at: at + 2 });
  assert.equal(resumed.summary.consistent, 0); assert.equal(resumed.summary.revoked, 75);
});
test("a held writer lock and unrelated existing files are preserved", (t) => {
  const directory = folder(t), checkpoint = join(directory, "checkpoint.json"), lock = `${checkpoint}.lock`;
  writeFileSync(lock, "another-worker");
  assert.throws(() => runCatalogPilot(["--checkpoint", checkpoint], { at }), /locked/);
  assert.equal(readFileSync(lock, "utf8"), "another-worker");
  const unrelated = join(directory, "snapshot.json"); writeFileSync(unrelated, JSON.stringify(syntheticPilotSnapshot(at)));
  const before = readFileSync(unrelated);
  assert.throws(() => runCatalogPilot(["--checkpoint", unrelated], { at }), /another file/);
  assert.deepEqual(readFileSync(unrelated), before);
  assert.equal(readdirSync(directory).some(name => name.endsWith(".tmp")), false);
});
test("malformed input cannot overwrite a checkpoint or leave an owned lock", (t) => {
  const directory = folder(t), checkpoint = join(directory, "checkpoint.json"), input = join(directory, "bad.json");
  runCatalogPilot(["--checkpoint", checkpoint], { at }); const before = readFileSync(checkpoint);
  writeFileSync(input, '{"credential":"synthetic-private-value"}');
  assert.throws(() => runCatalogPilot(["--checkpoint", checkpoint, "--input", input], { at }));
  assert.deepEqual(readFileSync(checkpoint), before);
  assert.deepEqual(readdirSync(directory).sort(), ["bad.json", "checkpoint.json"]);
  for (const args of [["--live"], ["--limit", "101"], ["--batch", "-1"], ["--pause", "--resume"], ["--limit", "2", "--limit", "3"]]) {
    assert.throws(() => runCatalogPilot(args, { at }));
  }
});
test("CLI subprocess runs with all network blocked and leaves a sentinel database untouched", (t) => {
  const directory = folder(t), guard = join(directory, "offline-guard.mjs"), sentinel = join(directory, "sentinel.sqlite");
  writeFileSync(sentinel, "synthetic sentinel; must never be opened or modified");
  const digest = () => createHash("sha256").update(readFileSync(sentinel)).digest("hex"), before = digest();
  writeFileSync(guard, `import net from 'node:net'; import http from 'node:http'; import https from 'node:https';
    import {syncBuiltinESMExports} from 'node:module';
    const denied=()=>{throw new Error('No network allowed in offline pilot');};
    globalThis.fetch=denied; net.connect=denied; net.createConnection=denied; net.Socket.prototype.connect=denied;
    http.request=denied; https.request=denied; http.get=denied; https.get=denied; syncBuiltinESMExports();`);
  const result = spawnSync(process.execPath, ["--import", pathToFileURL(guard).href,
    fileURLToPath(new URL("./catalog-pilot-dry-run.mjs", import.meta.url)), "--batch", "100"], {
    cwd: directory, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, env: { ...process.env, PIT_DATA_DIR: sentinel,
      ANTHROPIC_API_KEY: "synthetic-disabled-key", OPENAI_API_KEY: "synthetic-disabled-key", PIT_CATALOG_API_ENABLED: "true", PIT_CATALOG_API_COMMIT_ENABLED: "true" },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout); assert.equal(report.selected.filter(row => row.status === "consistent").length, 100);
  assert.equal(digest(), before); assert.deepEqual(readdirSync(directory).sort(), ["offline-guard.mjs", "sentinel.sqlite"]);
});
