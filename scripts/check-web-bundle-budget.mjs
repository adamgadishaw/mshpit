import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export const INITIAL_JS_GZIP_BUDGET_BYTES = 512 * 1024;

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
    };
  });
  return {
    scripts,
    rawBytes: scripts.reduce((sum, script) => sum + script.rawBytes, 0),
    gzipBytes: scripts.reduce((sum, script) => sum + script.gzipBytes, 0),
  };
}

export function bundleBudgetReport(outputDir = "dist", budgetBytes = INITIAL_JS_GZIP_BUDGET_BYTES) {
  const measured = measureInitialJavaScript(outputDir);
  return {
    generatedAt: new Date().toISOString(),
    budgetBytes,
    passed: measured.gzipBytes <= budgetBytes,
    headroomBytes: budgetBytes - measured.gzipBytes,
    rawBytes: measured.rawBytes,
    gzipBytes: measured.gzipBytes,
    scripts: measured.scripts.map(({ source, rawBytes, gzipBytes }) => ({ source, rawBytes, gzipBytes })),
  };
}

function formatKib(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
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
  if (!report.passed) {
    console.error(`[web-budget] exceeded by ${formatKib(-report.headroomBytes)}; split or remove first-load code before shipping.`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === resolve(fileURLToPath(import.meta.url))) run();
