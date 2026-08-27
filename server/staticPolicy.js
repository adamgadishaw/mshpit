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
