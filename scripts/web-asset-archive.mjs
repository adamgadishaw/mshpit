import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildWebAssetManifest, WEB_ASSET_LIMITS, WEB_ASSET_MANIFEST_NAME } from "../server/webAssetManifest.js";
import { prepareWebAssetArchive, promoteWebAssetGraph, webAssetArchiveRoot, webAssetProcessEnvironment } from "../server/webAssetArchive.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function runWebAssetArchiveCommand(args, env = process.env) {
  const [command, ...rest] = args;
  if (!["manifest", "prepare", "promote"].includes(command)) throw new Error("Expected manifest, prepare or promote");
  const options = {};
  const allowed = new Set(["--dist", "--manifest", "--data-dir", "--release", "--graph"]);
  for (let i = 0; i < rest.length; i += 2) {
    if (!allowed.has(rest[i]) || !rest[i + 1] || rest[i + 1].startsWith("--") || options[rest[i]]) throw new Error("Invalid archive command arguments");
    options[rest[i]] = rest[i + 1];
  }
  const distDir = resolve(options["--dist"] || resolve(ROOT, "dist"));
  const manifestPath = resolve(options["--manifest"] || resolve(ROOT, WEB_ASSET_MANIFEST_NAME));
  if (command === "manifest") {
    const manifest = buildWebAssetManifest(distDir);
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
    return { ok: true, graphId: manifest.graphId, entries: manifest.entries.length };
  }
  const dataDirectory = options["--data-dir"] || env.PIT_DATA_DIR;
  if (!dataDirectory) throw new Error("PIT_DATA_DIR or --data-dir is required");
  const archiveRoot = webAssetArchiveRoot(dataDirectory);
  if (command === "promote") return promoteWebAssetGraph({ archiveRoot, graphId: options["--graph"] });
  return prepareWebAssetArchive({ distDir, manifestPath, archiveRoot, release: options["--release"] || env.RENDER_GIT_COMMIT });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  // The explicit operator promotion is bounded too. Startup already invokes
  // prepare in its own killed-on-timeout child, so it must not spawn a grandchild.
  if (args[0] === "promote") {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--promotion-worker", ...args], {
      env: webAssetProcessEnvironment(process.env), windowsHide: true,
      stdio: "inherit", timeout: WEB_ASSET_LIMITS.deadlineMs, killSignal: "SIGKILL",
    });
    if (result.error || result.signal) process.stderr.write("[web-assets] promotion_unavailable\n");
    process.exitCode = result.status ?? 1;
  } else try { process.stdout.write(`${JSON.stringify(runWebAssetArchiveCommand(args[0] === "--promotion-worker" ? args.slice(1) : args))}\n`); }
  catch (error) {
    // Fixed operational codes only: never dump environment, file bytes or paths.
    process.stderr.write(`[web-assets] ${/^[a-z_]+$/.test(error?.code || "") ? error.code : "archive_failed"}\n`);
    process.exitCode = 1;
  }
}
