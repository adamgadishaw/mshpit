// Turns a minified browser crash location into the source file and line.
//
// Web bundles are minified, so "index-<hash>.js line 1 column 482113" is all a
// crash report can carry. The web build emits a source map beside each bundle.
// Those maps stay private on disk (staticPolicy.js refuses to serve them) and
// are read here with Node's built-in SourceMap, so no dependency is added.
//
// The asset name is validated against the emitted-bundle shape before it is
// used, so a report can only ever name a bundle, never an arbitrary file; the
// ".map" suffix is appended here.
import { readFileSync, statSync } from "node:fs";
import { SourceMap } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLIENT_WEB_ASSET_RE } from "../../../src/domain/clientCrashReport.mjs";

const WEB_ASSETS = fileURLToPath(new URL("../../../dist/_expo/static/js/web/", import.meta.url));
const BOOT_ASSET_RE = /^mshpit-web-boot-v\d{1,3}\.js$/;
const MAX_COORDINATE = 9_999_999;
const MAX_MAP_BYTES = 48 * 1024 * 1024;
const CACHE_IDLE_MS = 2 * 60_000;
// Parsing a large map blocks the event loop briefly and costs memory. Crash
// reports are already rate limited per client; this bounds the whole process.
const PARSE_WINDOW_MS = 10 * 60_000;
const MAX_PARSES_PER_WINDOW = 20;

let cached = null;
let parseWindow = { startedAt: 0, count: 0 };

function forgetCachedMap() {
  if (cached?.timer) clearTimeout(cached.timer);
  cached = null;
}

export function resetClientSourceLocationForTests() {
  forgetCachedMap();
  parseWindow = { startedAt: 0, count: 0 };
}

function holdCachedMap() {
  if (cached.timer) clearTimeout(cached.timer);
  cached.timer = setTimeout(forgetCachedMap, CACHE_IDLE_MS);
  cached.timer.unref?.();
}

function loadMap(mapPath, stats, now) {
  const key = `${mapPath}:${stats.size}:${stats.mtimeMs}`;
  if (cached?.key === key) {
    holdCachedMap();
    return cached.map;
  }
  if (now - parseWindow.startedAt >= PARSE_WINDOW_MS) parseWindow = { startedAt: now, count: 0 };
  if (parseWindow.count >= MAX_PARSES_PER_WINDOW) return null;
  parseWindow.count += 1;
  forgetCachedMap();
  const map = new SourceMap(JSON.parse(readFileSync(mapPath, "utf8")));
  cached = { key, map, timer: null };
  holdCachedMap();
  return map;
}

function sourcePath(value) {
  const path = String(value || "")
    .replace(/^[a-z][a-z0-9+.-]*:\/\/\/?/i, "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!path || path.split("/").includes("..")) return null;
  const safe = path.replace(/[^\w$@./+-]/g, "").slice(0, 180);
  return safe || null;
}

/**
 * A human-readable source location for a validated crash location, or null
 * when the report does not name a bundle this server could have shipped.
 * When the exact source cannot be established, the compiled location is still
 * returned with the reason, because "the tab predates the deploy" is itself the
 * answer to why a crash cannot be located.
 */
export function resolveClientSourceLocation(value, { directory = WEB_ASSETS, now = Date.now() } = {}) {
  if (!value || typeof value !== "object") return null;
  const { asset, line, column } = value;
  if (typeof asset !== "string") return null;
  if (![line, column].every((n) => Number.isInteger(n) && n > 0 && n <= MAX_COORDINATE)) return null;

  // The boot script ships unminified from public/, so its coordinates are source lines already.
  if (BOOT_ASSET_RE.test(asset)) return `public/${asset}:${line}:${column}`;
  if (!CLIENT_WEB_ASSET_RE.test(asset)) return null;

  const compiled = `${asset}:${line}:${column}`;
  const assetPath = join(directory, asset);
  try {
    if (!statSync(assetPath).isFile()) return null;
  } catch {
    return `${compiled} (not in the current build: the page was loaded before a deploy)`;
  }
  let stats;
  try {
    stats = statSync(`${assetPath}.map`);
  } catch {
    return `${compiled} (no source map in this build)`;
  }
  if (!stats.isFile() || stats.size > MAX_MAP_BYTES) return `${compiled} (source map unavailable)`;

  let entry;
  try {
    const map = loadMap(`${assetPath}.map`, stats, now);
    if (!map) return `${compiled} (source lookup deferred: too many recent crash lookups)`;
    entry = map.findEntry(line - 1, column - 1);
  } catch {
    return `${compiled} (source map unreadable)`;
  }
  // findEntry answers with the nearest EARLIER mapping, including one from a
  // previous line, rather than "not found". Accepting that would confidently
  // report the wrong file and line, which is worse than admitting the gap.
  if (!entry || entry.generatedLine !== line - 1 || typeof entry.originalSource !== "string") {
    return `${compiled} (no exact source mapping)`;
  }
  const source = sourcePath(entry.originalSource);
  if (!source) return `${compiled} (no exact source mapping)`;
  const name = typeof entry.name === "string" && /^[\w$.]{1,60}$/.test(entry.name) ? ` in ${entry.name}` : "";
  return `${source}:${entry.originalLine + 1}:${entry.originalColumn + 1}${name}`;
}
