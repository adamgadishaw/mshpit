import { closeSync, constants, createReadStream, fstatSync, openSync } from "node:fs";
import { privateStaticAssetResponse } from "./staticPolicy.js";
import { staticAssetCacheControl } from "./staticAssetCache.js";
import { assetContentType, fingerprintedWebAsset, regularAssetFile } from "./webAssetManifest.js";

function missing(req, res, headers) {
  const body = JSON.stringify({ error: "Asset not found." });
  res.writeHead(404, { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" });
  res.end(req.method === "HEAD" ? undefined : body);
  return true;
}

// Shared with isolated HTTP/browser regressions. Stable files and HTML retain
// the existing server path; only immutable public web assets get a fallback.
export function serveFingerprintAsset(req, res, pathname, { distDir, archive = null, headers = {} }) {
  if (privateStaticAssetResponse(pathname)) return missing(req, res, headers);
  if (!fingerprintedWebAsset(pathname)) return false;
  let file;
  let retained = null;
  try { file = regularAssetFile(distDir, pathname, Infinity); }
  catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR") return missing(req, res, headers);
    retained = archive?.lookup(pathname);
    if (!retained) return missing(req, res, headers);
    try { file = regularAssetFile(retained.root, pathname); }
    catch { return missing(req, res, headers); }
  }
  let fd;
  try {
    fd = openSync(file.path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const opened = fstatSync(fd);
    const expected = retained || { bytes: file.stats.size, ino: file.stats.ino, mtimeMs: file.stats.mtimeMs };
    if (!opened.isFile() || opened.nlink > 1 || opened.size !== expected.bytes
      || opened.ino !== expected.ino || opened.mtimeMs !== expected.mtimeMs) {
      closeSync(fd); fd = undefined;
      return missing(req, res, headers);
    }
    res.writeHead(200, {
      ...headers, "Content-Type": assetContentType(pathname),
      "Content-Length": opened.size, "Cache-Control": staticAssetCacheControl(pathname),
    });
    if (req.method === "HEAD") { closeSync(fd); fd = undefined; res.end(); return true; }
    const stream = createReadStream(file.path, { fd, autoClose: true });
    fd = undefined;
    stream.on("error", () => res.destroy());
    stream.pipe(res);
    return true;
  } catch {
    if (fd !== undefined) closeSync(fd);
    if (res.headersSent) { res.destroy(); return true; }
    return missing(req, res, headers);
  }
}
