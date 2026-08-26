import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { INITIAL_JS_GZIP_BUDGET_BYTES, measureInitialJavaScript } from "../../scripts/check-web-bundle-budget.mjs";

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
};

test("the exported web entry does not contain the venue photo catalogue", { timeout: 240_000 }, () => {
  const output = mkdtempSync(join(tmpdir(), "pit-venue-bundle-"));
  try {
    execFileSync(process.execPath, [
      resolve("node_modules/expo/bin/cli"),
      "export", "-p", "web", "--output-dir", output,
    ], {
      cwd: process.cwd(),
      env: { ...process.env, CI: "1" },
      stdio: "pipe",
      timeout: 220_000,
      maxBuffer: 16 * 1024 * 1024,
    });

    const scripts = walk(output).filter((path) => /[\\/]_expo[\\/]static[\\/]js[\\/]web[\\/].*\.js$/.test(path));
    const initial = measureInitialJavaScript(output);
    const main = initial.scripts
      .filter(({ source }) => !source.includes("__expo-metro-runtime") && !source.includes("__common"))
      .sort((a, b) => b.rawBytes - a.rawBytes)[0]?.path;
    assert.ok(main, "Expo export must contain a hashed web index entry");
    const discoverChunk = scripts.find((path) => /[\\/]DiscoverScreen-[^\\/]+\.js$/.test(path));
    assert.ok(discoverChunk, "Discover must remain an on-demand screen chunk instead of inflating first load");
    assert.ok(
      initial.gzipBytes <= INITIAL_JS_GZIP_BUDGET_BYTES,
      `initial web JavaScript is ${(initial.gzipBytes / 1024).toFixed(0)} KiB gzip; keep it below ${(INITIAL_JS_GZIP_BUDGET_BYTES / 1024).toFixed(0)} KiB`,
    );
    const allClientJavaScript = scripts.map((path) => readFileSync(path, "utf8")).join("\n");
    const mainJavaScript = readFileSync(main, "utf8");

    assert.doesNotMatch(allClientJavaScript, /galleryPool:\[/, "literal venue gallery arrays leaked into a web chunk");
    assert.doesNotMatch(allClientJavaScript, /catalog\.venue-photos/, "the server-only split file leaked into a web chunk");
    assert.doesNotMatch(mainJavaScript, /FIND YOUR NEXT OBSESSION/, "Discover UI leaked back into the entry bundle");
    const mainBytes = Buffer.from(mainJavaScript);
    const rawBytes = mainBytes.byteLength;
    const gzipBytes = gzipSync(mainBytes).byteLength;
    const brotliBytes = brotliCompressSync(mainBytes).byteLength;
    assert.ok(
      rawBytes < 2.5 * 1024 * 1024,
      `web entry is ${(rawBytes / 1048576).toFixed(2)} MiB raw; keep it below 2.50 MiB`,
    );
    assert.ok(
      gzipBytes < 700 * 1024,
      `web entry is ${(gzipBytes / 1024).toFixed(0)} KiB gzip; keep it below 700 KiB`,
    );
    assert.ok(
      brotliBytes < 600 * 1024,
      `web entry is ${(brotliBytes / 1024).toFixed(0)} KiB Brotli; keep it below 600 KiB`,
    );
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
