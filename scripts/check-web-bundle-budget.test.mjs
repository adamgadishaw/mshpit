import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { bundleBudgetReport, initialScriptSources, measureInitialJavaScript } from "./check-web-bundle-budget.mjs";

test("initialScriptSources preserves exported script order", () => {
  assert.deepEqual(initialScriptSources(`
    <script src="/runtime.js" defer></script>
    <script data-entry src='/main.js?v=1'></script>
  `), ["/runtime.js", "/main.js?v=1"]);
});

test("the web budget measures only scripts referenced by index.html", () => {
  const output = mkdtempSync(join(tmpdir(), "pit-web-budget-"));
  try {
    mkdirSync(join(output, "assets"), { recursive: true });
    const runtime = "globalThis.__runtime=true;";
    const main = "globalThis.__main='pit';".repeat(20);
    writeFileSync(join(output, "index.html"), '<script src="/assets/runtime.js"></script><script src="/assets/main.js"></script>');
    writeFileSync(join(output, "assets", "runtime.js"), runtime);
    writeFileSync(join(output, "assets", "main.js"), main);
    writeFileSync(join(output, "assets", "lazy.js"), "this must not count".repeat(100));

    const measured = measureInitialJavaScript(output);
    const expected = gzipSync(Buffer.from(runtime), { level: 9 }).byteLength
      + gzipSync(Buffer.from(main), { level: 9 }).byteLength;
    assert.equal(measured.gzipBytes, expected);
    assert.equal(measured.scripts.length, 2);
    assert.equal(bundleBudgetReport(output, expected).passed, true);
    assert.equal(bundleBudgetReport(output, expected - 1).passed, false);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
