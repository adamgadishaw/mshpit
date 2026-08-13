import { extname } from "node:path";

// Missing versioned/static assets must never fall through to index.html. The
// no-store response also prevents a CDN or browser from pinning a deployment
// race after the next build publishes a chunk at the same URL.
export function missingStaticAssetResponse(pathname) {
  const path = String(pathname || "");
  if (!path.startsWith("/_expo/") && !extname(path)) return null;
  return {
    status: 404,
    body: { error: "Asset not found." },
    headers: { "Cache-Control": "no-store" },
  };
}
