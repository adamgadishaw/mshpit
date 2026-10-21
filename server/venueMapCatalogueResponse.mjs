import { gzip } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);
const MAX_BYTES = 12 * 1024 * 1024;
const responses = new WeakMap();
const projections = new WeakMap();

/** One serialized/compressed representation per complete immutable snapshot. */
export async function createVenueMapCatalogueResponse(projection) {
  if (!projection || projection.complete !== true || projection.venueMapCatalogue !== true
    || !Array.isArray(projection.tourDates) || !Object.isFrozen(projection)) {
    throw new TypeError("A complete immutable venue-map snapshot is required.");
  }
  if (!projections.has(projection)) {
    projections.set(projection, (async () => {
      const json = JSON.stringify(projection);
      if (Buffer.byteLength(json) > MAX_BYTES) throw new RangeError("The venue-map response exceeds its byte budget.");
      const identity = Buffer.from(json);
      const compressed = await gzipAsync(identity, { level: 4 });
      const response = Object.freeze({});
      responses.set(response, { identity, gzip: compressed });
      return response;
    })());
  }
  return projections.get(projection);
}

function encodingQuality(header, encoding) {
  const preferences = new Map();
  for (const item of String(header || "").toLowerCase().split(",")) {
    const [name, ...parameters] = item.trim().split(";").map(part => part.trim());
    if (!name || preferences.has(name)) continue;
    const q = parameters.find(part => part.startsWith("q="));
    const quality = q == null ? 1 : /^q=(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(q) ? Number(q.slice(2)) : 0;
    preferences.set(name, quality);
  }
  if (preferences.has(encoding)) return preferences.get(encoding);
  // Identity is available unless explicitly excluded (or *;q=0 excludes it).
  if (encoding === "identity") return preferences.get("*") === 0 ? 0 : 1;
  return preferences.get("*") ?? 0;
}

/** HTTP boundary only: ordinary route objects cannot activate this byte path. */
export function venueMapCatalogueResponsePayload(response, acceptEncoding = "") {
  const stored = response && typeof response === "object" ? responses.get(response) : null;
  if (!stored) return null;
  const gzipQuality = encodingQuality(acceptEncoding, "gzip"), identityQuality = encodingQuality(acceptEncoding, "identity");
  if (gzipQuality <= 0 && identityQuality <= 0) return { status: 406, bytes: Buffer.alloc(0), headers: {
    "Content-Type": "application/json; charset=utf-8", "Content-Length": "0", "Cache-Control": "no-store", Vary: "Accept-Encoding",
  } };
  const compressed = gzipQuality > 0 && gzipQuality >= identityQuality;
  const bytes = compressed ? stored.gzip : stored.identity;
  return { status: 200, bytes, headers: {
    "Content-Type": "application/json; charset=utf-8", "Content-Length": String(bytes.length),
    // The shared in-process cache owns freshness. HTTP caches must not extend it.
    "Cache-Control": "no-store", Vary: "Accept-Encoding", ...(compressed ? { "Content-Encoding": "gzip" } : {}),
  } };
}
