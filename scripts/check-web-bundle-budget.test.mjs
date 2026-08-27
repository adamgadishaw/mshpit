import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

import {
  PAUSED_MUSIC_PLAYER_LABELS,
  bundleBudgetFailureMessages,
  bundleBudgetReport,
  initialScriptSources,
  measureInitialJavaScript,
} from "./check-web-bundle-budget.mjs";

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
    writeFileSync(join(output, "assets", "lazy.js"), `this must not count: ${PAUSED_MUSIC_PLAYER_LABELS.join(" | ")}`.repeat(100));

    const measured = measureInitialJavaScript(output);
    const expected = gzipSync(Buffer.from(runtime), { level: 9 }).byteLength
      + gzipSync(Buffer.from(main), { level: 9 }).byteLength;
    assert.equal(measured.gzipBytes, expected);
    assert.equal(measured.scripts.length, 2);
    assert.deepEqual(measured.pausedMusicPlayerLabels, [], "lazy chunks are outside the first-load leak boundary");

    const passing = bundleBudgetReport(output, expected);
    assert.equal(passing.passed, true);
    assert.equal(passing.budgetPassed, true);
    assert.equal(passing.pausedMusicPlayerUiPassed, true);

    const overBudget = bundleBudgetReport(output, expected - 1);
    assert.equal(overBudget.passed, false);
    assert.equal(overBudget.budgetPassed, false);
    assert.equal(overBudget.pausedMusicPlayerUiPassed, true);
    assert.match(bundleBudgetFailureMessages(overBudget).join("\n"), /exceeded by/);
    assert.doesNotMatch(bundleBudgetFailureMessages(overBudget).join("\n"), /labels leaked/);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test("the web gate rejects paused-player UI labels in initial scripts even under budget", () => {
  const output = mkdtempSync(join(tmpdir(), "pit-web-player-leak-"));
  try {
    mkdirSync(join(output, "assets"), { recursive: true });
    writeFileSync(join(output, "index.html"), '<script src="/assets/main.js"></script>');
    writeFileSync(join(output, "assets", "main.js"), `globalThis.labels=${JSON.stringify(PAUSED_MUSIC_PLAYER_LABELS)};`);

    const report = bundleBudgetReport(output, 1024 * 1024);
    assert.equal(report.passed, false);
    assert.equal(report.budgetPassed, true);
    assert.equal(report.pausedMusicPlayerUiPassed, false);
    assert.deepEqual(report.pausedMusicPlayerLabels, PAUSED_MUSIC_PLAYER_LABELS);
    assert.deepEqual(report.scripts[0].pausedMusicPlayerLabels, PAUSED_MUSIC_PLAYER_LABELS);

    const messages = bundleBudgetFailureMessages(report).join("\n");
    assert.match(messages, /paused music-player labels leaked into initial JavaScript/);
    assert.doesNotMatch(messages, /exceeded by/);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
