import { extname } from "node:path";

// Public entity identifiers are opaque by design and may contain dots. In
// particular, historical concert keys use `show.<base64url>`. These explicit
// namespaces belong to the application router even when extname() would make
// the final segment look like a missing static file.
const EXPLICIT_PUBLIC_ENTITY_PATH = /^\/(?:artist|venue|u|post|show|event|concert)\//i;

// Missing versioned/static assets must never fall through to index.html. The
// no-store response also prevents a CDN or browser from pinning a deployment
// race after the next build publishes a chunk at the same URL.
export function missingStaticAssetResponse(pathname) {
  const path = String(pathname || "");
  if (EXPLICIT_PUBLIC_ENTITY_PATH.test(path)) return null;
  if (!path.startsWith("/_expo/") && !extname(path)) return null;
  return {
    status: 404,
    body: { error: "Asset not found." },
    headers: { "Cache-Control": "no-store" },
  };
}

// Source maps are private. The web build emits one beside every bundle so the
// server can turn a minified crash location into a source file and line, and
// every bundle names its map in a sourceMappingURL comment. Serving them would
// publish the full original client source, comments included, to anyone.
export function privateStaticAssetResponse(pathname) {
  let path;
  try { path = decodeURIComponent(String(pathname || "")); }
  catch { path = String(pathname || ""); }
  path = path.split(/[?#]/, 1)[0].replace(/\/+$/, "").toLowerCase();
  if (!path.endsWith(".map")) return null;
  return {
    status: 404,
    body: { error: "Asset not found." },
    headers: { "Cache-Control": "no-store" },
  };
}
