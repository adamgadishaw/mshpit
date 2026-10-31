import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const WEB_ASSET_LIMITS = Object.freeze({
  archiveBytes: 128 * 1024 * 1024, archiveFiles: 4096, graphs: 6,
  graphBytes: 16 * 1024 * 1024, graphFiles: 512, fileBytes: 8 * 1024 * 1024,
  manifestBytes: 256 * 1024, catalogBytes: 64 * 1024,
  reserveBytes: 1024 * 1024 * 1024, ttlMs: 7 * 24 * 60 * 60 * 1000,
  scanEntries: 4096, deadlineMs: 30_000,
});
export const WEB_ASSET_MANIFEST_NAME = "web-asset-manifest.json";
const HASH = /^[a-f0-9]{64}$/;
const TYPES = Object.freeze({
  js: "text/javascript", css: "text/css", png: "image/png", jpg: "image/jpeg",
  jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  svg: "image/svg+xml", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2",
  ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject",
  wasm: "application/wasm", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "video/mp4",
  webm: "video/webm", ogg: "audio/ogg", wav: "audio/wav",
});

export function assetFailure(reason) {
  return Object.assign(new Error(`Web asset retention rejected: ${reason}`), { code: reason });
}
export function assetSha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
export function canonicalAssetUrl(value) {
  if (typeof value !== "string" || value.length > 240 || !value.startsWith("/")
    || /[\\%?#\x00-\x20\x7f]/.test(value) || value.includes("//")) return null;
  const parts = value.slice(1).split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || !/^[A-Za-z0-9_.@+-]+$/.test(part))) return null;
  return value;
}
export function fingerprintedWebAsset(value) {
  const url = canonicalAssetUrl(value);
  if (!url) return false;
  if (/^\/_expo\/static\/js\/web\/[A-Za-z0-9_.@+-]+-[a-f0-9]{32}\.js$/.test(url)) return true;
  if (/^\/_expo\/static\/css\/(?:web\/)?[A-Za-z0-9_.@+-]+-[a-f0-9]{32}\.css$/.test(url)) return true;
  return /^\/assets\/(?:[A-Za-z0-9_.@+-]+\/)*[A-Za-z0-9_.@+-]+\.[a-f0-9]{16,64}\.[a-z0-9]+$/.test(url)
    && Object.hasOwn(TYPES, url.split(".").at(-1));
}
export function assetContentType(url) { return TYPES[String(url).split(".").at(-1)] || null; }

// Every ancestor is checked, not merely the final filename. This also rejects
// Windows junctions and prevents a pre-existing export/archive link escaping.
export function assertAssetDirectory(directory) {
  const absolute = resolve(directory);
  const parent = dirname(absolute);
  if (parent !== absolute) assertAssetDirectory(parent);
  const stats = lstatSync(absolute);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw assetFailure("unsafe_directory");
  return absolute;
}
export function regularAssetFile(root, url, maxBytes = WEB_ASSET_LIMITS.fileBytes) {
  if (!canonicalAssetUrl(url)) throw assetFailure("invalid_asset_path");
  const absolute = join(root, ...url.slice(1).split("/"));
  assertAssetDirectory(dirname(absolute));
  const stats = lstatSync(absolute);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink > 1 || stats.size > maxBytes) {
    throw assetFailure("unsafe_asset_file");
  }
  return { path: absolute, stats };
}
function graphBody(manifest) {
  return { version: 1, entries: manifest.entries, stableDependencies: manifest.stableDependencies };
}
export function validateWebAssetManifest(input, limits = WEB_ASSET_LIMITS) {
  if (!input || input.version !== 1 || !HASH.test(input.graphId)
    || !Array.isArray(input.entries) || !input.entries.length || input.entries.length + 1 > limits.graphFiles
    || !Array.isArray(input.stableDependencies) || input.stableDependencies.length > 32) throw assetFailure("invalid_manifest");
  let previous = "";
  let bytes = 0;
  for (const entry of input.entries) {
    if (!entry || !fingerprintedWebAsset(entry.url) || entry.url <= previous || !HASH.test(entry.sha256)
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > limits.fileBytes
      || entry.contentType !== assetContentType(entry.url)
      || Object.keys(entry).sort().join() !== "bytes,contentType,sha256,url") throw assetFailure("invalid_manifest_entry");
    previous = entry.url;
    bytes += entry.bytes;
  }
  previous = "";
  for (const entry of input.stableDependencies) {
    if (!entry || !canonicalAssetUrl(entry.url) || !/\.(?:js|css)$/.test(entry.url)
      || fingerprintedWebAsset(entry.url) || entry.url <= previous || !HASH.test(entry.sha256)
      || Object.keys(entry).sort().join() !== "sha256,url") throw assetFailure("invalid_stable_dependency");
    previous = entry.url;
  }
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized) > limits.manifestBytes || bytes + Buffer.byteLength(serialized) > limits.graphBytes
    || input.graphId !== assetSha256(JSON.stringify(graphBody(input)))
    || Object.keys(input).sort().join() !== "entries,graphId,stableDependencies,version") throw assetFailure("manifest_integrity");
  return input;
}

function references(text, baseUrl) {
  const results = new Set();
  const localDependency = (value) => {
    const target = new URL(value, `https://export.invalid${baseUrl}`);
    if (target.search || target.hash) throw assetFailure("noncanonical_dependency");
    return target.pathname;
  };
  // Metro emits local dependency URLs as quoted strings. Inspect the export,
  // never execute it. Include escaped JSON slashes and HTML/CSS references.
  const source = text.replaceAll("\\/", "/");
  for (const match of source.matchAll(/["'`]((?:\/_expo\/static\/|\/assets\/)[^"'`\s<>]+)["'`]/g)) {
    if (!match[1].endsWith("/")) results.add(match[1]);
  }
  const modulePatterns = [
    /\bimport\s*\(\s*["']([^"']+)["']/g,
    /\b(?:import|export)\s+[^;\n]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bnew\s+(?:Worker|SharedWorker)\s*\(\s*["']([^"']+)["']/g,
    /\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g,
  ];
  for (const pattern of modulePatterns) {
    for (const match of source.matchAll(pattern)) {
      if (!/^(?:\.\.?\/|\/)/.test(match[1]) || match[1].startsWith("//")) continue;
      results.add(localDependency(match[1]));
    }
  }
  if (baseUrl.endsWith(".css")) {
    for (const match of source.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gi)) {
      if (/^(?:data:|https?:|\/\/|#)/i.test(match[1])) continue;
      results.add(localDependency(match[1]));
    }
    for (const match of source.matchAll(/@import\s+["']([^"']+)["']/gi)) {
      if (/^(?:https?:|\/\/)/i.test(match[1])) continue;
      results.add(localDependency(match[1]));
    }
  }
  return results;
}
export function buildWebAssetManifest(distDir, { limits = WEB_ASSET_LIMITS } = {}) {
  const root = assertAssetDirectory(distDir);
  const entries = [];
  const contents = new Map();
  let visited = 0;
  let bytes = 0;
  function walk(directory, prefix = "") {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      if (++visited > limits.scanEntries) throw assetFailure("export_scan_limit");
      const url = `${prefix}/${item.name}`;
      if (!canonicalAssetUrl(url) || url.split("/").length > 16 || item.isSymbolicLink()) throw assetFailure("unsafe_export_path");
      if (item.isDirectory()) { walk(join(directory, item.name), url); continue; }
      if (!item.isFile()) throw assetFailure("unsafe_export_file");
      if (!fingerprintedWebAsset(url)) continue;
      const { path, stats } = regularAssetFile(root, url, limits.fileBytes);
      bytes += stats.size;
      if (bytes > limits.graphBytes || entries.length + 2 > limits.graphFiles) throw assetFailure("graph_limit");
      const content = readFileSync(path);
      entries.push({ url, bytes: content.length, sha256: assetSha256(content), contentType: assetContentType(url) });
      if (/\.(?:js|css)$/.test(url)) contents.set(url, content.toString("utf8"));
    }
  }
  walk(root);
  const entryFile = regularAssetFile(root, "/index.html", 1024 * 1024);
  const html = readFileSync(entryFile.path, "utf8");
  contents.set("/index.html", html);
  const present = new Set(entries.map((entry) => entry.url));
  const stable = new Map();
  let inspectedBytes = bytes;
  const addStable = (url) => {
    if (stable.has(url)) return;
    if (stable.size >= 32 || !canonicalAssetUrl(url) || !/\.(?:js|css)$/.test(url)) throw assetFailure("incomplete_graph");
    const file = regularAssetFile(root, url, limits.fileBytes);
    inspectedBytes += file.stats.size;
    if (inspectedBytes > limits.graphBytes) throw assetFailure("graph_limit");
    const content = readFileSync(file.path);
    stable.set(url, { url, sha256: assetSha256(content) });
    contents.set(url, content.toString("utf8"));
  };
  for (const match of html.matchAll(/<(script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi)) {
    const url = match[2];
    if (match[1].toLowerCase() !== "script" && !/\.css(?:[?#]|$)/i.test(url)) continue;
    if (!canonicalAssetUrl(url)) throw assetFailure("nonlocal_initial_code");
    if (fingerprintedWebAsset(url)) {
      if (!present.has(url)) throw assetFailure("incomplete_graph");
    } else {
      addStable(url);
    }
  }
  for (const [url, text] of contents) {
    for (const reference of references(text, url)) {
      // Maps are diagnostic comments, never runtime dependencies or fallback.
      if (/\.map(?:[?#]|$)/i.test(reference)) continue;
      if (!fingerprintedWebAsset(reference)) { addStable(reference); continue; }
      if (!present.has(reference)) {
        throw Object.assign(assetFailure("incomplete_graph"), { assetUrl: reference, importer: url });
      }
    }
  }
  // Use code-point order everywhere, independent of the build host locale.
  entries.sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
  const body = { version: 1, entries, stableDependencies: [...stable.values()].sort((a, b) => a.url < b.url ? -1 : 1) };
  return validateWebAssetManifest({ ...body, graphId: assetSha256(JSON.stringify(body)) }, limits);
}
