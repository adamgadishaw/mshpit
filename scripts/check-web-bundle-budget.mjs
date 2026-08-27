import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export const INITIAL_JS_GZIP_BUDGET_BYTES = 512 * 1024;
export const PAUSED_MUSIC_PLAYER_LABELS = Object.freeze([
  "PIT PLAYER",
  "Open the player panel",
  "Playback missed its cue",
  "Save queue",
  "Listening history",
  "Private Listening",
  "plays in your Pit player",
  "music player is paused",
  "YouTube full-track lookup",
]);

export function pausedMusicPlayerLabels(source) {
  const text = String(source || "").toLocaleLowerCase("en-US");
  return PAUSED_MUSIC_PLAYER_LABELS.filter((label) => text.includes(label.toLocaleLowerCase("en-US")));
}

export function initialScriptSources(html) {
  const sources = [];
  const pattern = /<script\b[^>]*\bsrc=(['"])(.*?)\1[^>]*>/gi;
  for (const match of String(html || "").matchAll(pattern)) {
    const source = String(match[2] || "").trim();
    if (source) sources.push(source);
  }
  return sources;
}

function localScriptPath(outputDir, source) {
  if (/^(?:[a-z]+:)?\/\//i.test(source)) {
    throw new Error(`Initial script must be a local export asset: ${source}`);
  }
  const clean = source.split(/[?#]/, 1)[0].replace(/^\/+/, "");
  const root = resolve(outputDir);
  const absolute = resolve(root, clean);
  const fromRoot = relative(root, absolute);
  if (!clean || fromRoot.startsWith("..") || fromRoot.includes(":\\")) {
    throw new Error(`Initial script escapes the web export: ${source}`);
  }
  return absolute;
}

export function measureInitialJavaScript(outputDir = "dist") {
  const root = resolve(outputDir);
  const htmlPath = resolve(root, "index.html");
  if (!existsSync(htmlPath)) throw new Error(`Missing web export: ${htmlPath}`);
  const sources = initialScriptSources(readFileSync(htmlPath, "utf8"));
  if (!sources.length) throw new Error(`No initial JavaScript found in ${htmlPath}`);

  const scripts = sources.map((source) => {
    const path = localScriptPath(root, source);
    if (!existsSync(path)) throw new Error(`Missing initial JavaScript asset: ${path}`);
    const bytes = readFileSync(path);
    return {
      source,
      path,
      rawBytes: bytes.byteLength,
      gzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
      pausedMusicPlayerLabels: pausedMusicPlayerLabels(bytes.toString("utf8")),
    };
  });
  return {
    scripts,
    rawBytes: scripts.reduce((sum, script) => sum + script.rawBytes, 0),
    gzipBytes: scripts.reduce((sum, script) => sum + script.gzipBytes, 0),
    pausedMusicPlayerLabels: [...new Set(scripts.flatMap((script) => script.pausedMusicPlayerLabels))],
  };
}

export function bundleBudgetReport(outputDir = "dist", budgetBytes = INITIAL_JS_GZIP_BUDGET_BYTES) {
  const measured = measureInitialJavaScript(outputDir);
  const budgetPassed = measured.gzipBytes <= budgetBytes;
  const pausedMusicPlayerUiPassed = measured.pausedMusicPlayerLabels.length === 0;
  return {
    generatedAt: new Date().toISOString(),
    budgetBytes,
    passed: budgetPassed && pausedMusicPlayerUiPassed,
    budgetPassed,
    pausedMusicPlayerUiPassed,
    pausedMusicPlayerLabels: measured.pausedMusicPlayerLabels,
    headroomBytes: budgetBytes - measured.gzipBytes,
    rawBytes: measured.rawBytes,
    gzipBytes: measured.gzipBytes,
    scripts: measured.scripts.map(({ source, rawBytes, gzipBytes, pausedMusicPlayerLabels: labels }) => ({
      source,
      rawBytes,
      gzipBytes,
      pausedMusicPlayerLabels: labels,
    })),
  };
}

function formatKib(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

export function bundleBudgetFailureMessages(report) {
  const messages = [];
  if (!report?.budgetPassed) {
    messages.push(`exceeded by ${formatKib(-Number(report?.headroomBytes || 0))}; split or remove first-load code before shipping.`);
  }
  if (!report?.pausedMusicPlayerUiPassed) {
    messages.push(`paused music-player labels leaked into initial JavaScript: ${(report?.pausedMusicPlayerLabels || []).join(", ")}.`);
  }
  return messages;
}

function run() {
  const outputDir = process.argv[2] || "dist";
  const report = bundleBudgetReport(outputDir);
  const reportPath = resolve(outputDir, "web-bundle-budget.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  for (const script of report.scripts) {
    console.log(`[web-budget] ${script.source}: ${formatKib(script.gzipBytes)} gzip`);
  }
  console.log(`[web-budget] initial JavaScript: ${formatKib(report.gzipBytes)} / ${formatKib(report.budgetBytes)} gzip`);
  console.log(`[web-budget] report: ${reportPath}`);
  for (const message of bundleBudgetFailureMessages(report)) console.error(`[web-budget] ${message}`);
  if (!report.passed) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === resolve(fileURLToPath(import.meta.url))) run();
