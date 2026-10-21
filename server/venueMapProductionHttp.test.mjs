import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parse } from "@babel/parser";
import { mapLibrePreviewCspSources } from "./mapLibrePreviewCsp.js";
import { createVenueMapCatalogueResponse, venueMapCatalogueResponsePayload } from "./venueMapCatalogueResponse.mjs";

// Exercise the actual response block/security headers over ordinary loopback
// HTTP. Do not import db.js, start application schedulers or acquire any data.
const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module" });
const declaration = name => ast.program.body.find(node => node.type === "VariableDeclaration" && node.declarations.some(value => value.id.name === name))
  ?.declarations.find(value => value.id.name === name)?.init;
const headers = declaration("HEADERS");
const sender = ast.program.body.find(node => node.type === "FunctionDeclaration" && node.id.name === "send");
const start = source.indexOf("const venueMap = venueMapCatalogueResponsePayload(result,");
const end = source.indexOf("const binary = binaryApiResponsePayload(result);", start);
assert.ok(headers && sender && start > 0 && end > start, "actual map HTTP response path must be present");

async function withServer(env, action) {
  const context = { PROD: true, MUSIC_PLAYER_ENABLED: false, MEDIA_CONNECT_ORIGIN: null, MAPLIBRE_PREVIEW_CSP: mapLibrePreviewCspSources(env) };
  const HEADERS = new Function(...Object.keys(context), `return (${source.slice(headers.start, headers.end)});`)(...Object.values(context));
  const send = new Function("HEADERS", `return (${source.slice(sender.start, sender.end)});`)(HEADERS);
  const emit = new Function("result", "req", "res", "requestAbort", "extra", "venueMapCatalogueResponsePayload", "send", source.slice(start, end));
  const snapshot = Object.freeze({ complete: true, venueMapCatalogue: true, tourDates: [], eventCount: 0, venueCount: 0,
    pages: 1, fetchedAt: "2026-10-21T16:06:16.293Z", expiresAt: "2026-10-21T17:06:16.293Z" });
  const result = await createVenueMapCatalogueResponse(snapshot);
  const server = createServer((req, res) => emit(result, req, res, new AbortController(), { "X-Request-Id": "fixture-id" }, venueMapCatalogueResponsePayload, send));
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    await action({ port: server.address().port, snapshot });
  } finally { await new Promise(resolve => server.close(resolve)); }
}

function get(port, acceptEncoding) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/api/tourdates?view=venue-map", headers: { "Accept-Encoding": acceptEncoding } }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("error", reject); req.end();
  });
}

test("actual production HTTP response delivers exact gzip/identity JSON with source clock and security headers", async () => {
  await withServer({ NODE_ENV: "production", MSHPIT_WEB_MAPLIBRE_ENABLED: "1" }, async ({ port, snapshot }) => {
    const gzip = await get(port, "gzip"), identity = await get(port, "gzip;q=0");
    assert.equal(gzip.status, 200); assert.equal(identity.status, 200);
    assert.equal(gzip.headers["content-encoding"], "gzip"); assert.equal(identity.headers["content-encoding"], undefined);
    assert.deepEqual(gunzipSync(gzip.bytes), identity.bytes); assert.deepEqual(JSON.parse(identity.bytes), snapshot);
    for (const result of [gzip, identity]) {
      assert.equal(result.headers["cache-control"], "no-store"); assert.equal(result.headers.vary, "Accept-Encoding");
      assert.equal(Number(result.headers["content-length"]), result.bytes.length);
      assert.equal(result.headers["x-content-type-options"], "nosniff"); assert.equal(result.headers["x-request-id"], "fixture-id");
      const csp = result.headers["content-security-policy"];
      assert.ok(csp.includes("https://unpkg.com/maplibre-gl@6.15.0/dist/"));
      assert.ok(csp.includes("https://tiles.openfreemap.org")); assert.equal(csp.includes("unsafe-eval"), false);
    }
    const unacceptable = await get(port, "identity;q=0,gzip;q=0");
    assert.equal(unacceptable.status, 406); assert.equal(unacceptable.bytes.length, 0);
  });
});

test("production defaults and preview/public flags do not expand production HTTP policy", async () => {
  await withServer({ NODE_ENV: "production", MSHPIT_WEB_MAPLIBRE_PREVIEW: "1", EXPO_PUBLIC_WEB_MAP_RENDERER: "maplibre" }, async ({ port }) => {
    const result = await get(port, "identity");
    assert.equal(result.headers["content-security-policy"].includes("openfreemap"), false);
    assert.equal(result.headers["content-security-policy"].includes("unpkg.com"), false);
  });
});
