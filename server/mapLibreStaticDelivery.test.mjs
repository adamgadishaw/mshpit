import assert from "node:assert/strict";
import test from "node:test";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";
import { finished } from "node:stream/promises";
import { parse } from "@babel/parser";
import { staticAssetCacheControl } from "./staticAssetCache.js";
import { missingStaticAssetResponse, privateStaticAssetResponse } from "./staticPolicy.js";

// Execute the real production static handler against the checked-in public
// assets. Do not import the application server, open its DB or start providers.
const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const declarations = parse(source, { sourceType: "module" }).program.body;
const declaration = name => declarations.find(node => node.type === "VariableDeclaration"
  && node.declarations.some(entry => entry.id.name === name))?.declarations.find(entry => entry.id.name === name)?.init;
const mime = declaration("MIME");
const headers = declaration("HEADERS");
const noSniff = headers.properties.find(property => property.key?.value === "X-Content-Type-Options")?.value?.value;
const handler = declarations.find(node => node.type === "FunctionDeclaration" && node.id.name === "serveStatic");
assert.ok(mime && handler, "actual MIME table and static handler must be present");
const publicDirectory = fileURLToPath(new URL("../public", import.meta.url));
const dependencies = {
  DIST: publicDirectory, existsSync, statSync, normalize, join, sep, extname, readFileSync, createReadStream,
  MIME: new Function(`return (${source.slice(mime.start, mime.end)});`)(),
  HEADERS: { "X-Content-Type-Options": noSniff },
  staticAssetCacheControl, missingStaticAssetResponse, privateStaticAssetResponse,
  safeRequestFailureContext: () => ({ cause: "static-read-failed" }),
  send: (response, status, body, extra = {}) => {
    response.writeHead(status, { "Content-Type": "application/json", ...extra });
    response.end(JSON.stringify(body));
  },
};
const serveStatic = new Function(...Object.keys(dependencies), `return (${source.slice(handler.start, handler.end)});`)(...Object.values(dependencies));

async function request(pathname, method = "GET") {
  const chunks = [];
  const response = new Writable({ write(chunk, encoding, next) { chunks.push(Buffer.from(chunk)); next(); } });
  response.writeHead = (status, responseHeaders) => { response.status = status; response.headers = responseHeaders; };
  const complete = finished(response);
  assert.ok(serveStatic({ method }, response, pathname));
  await complete;
  return { status: response.status, headers: response.headers, body: Buffer.concat(chunks) };
}

test("production static handler serves the map module graph and worker as JavaScript under nosniff", async () => {
  for (const name of ["renderer.mjs", "cluster-model.mjs", "maplibre-gl-worker.mjs"]) {
    const response = await request(`/mshpit-maplibre/${name}`);
    const bytes = readFileSync(join(publicDirectory, "mshpit-maplibre", name));
    assert.equal(response.status, 200, name);
    assert.equal(response.headers["Content-Type"], "text/javascript", name);
    assert.equal(response.headers["X-Content-Type-Options"], "nosniff", name);
    assert.equal(response.headers["Cache-Control"], "no-cache", name);
    assert.equal(response.headers["Content-Length"], bytes.length, name);
    assert.deepEqual(response.body, bytes, name);
  }
});

test("worker HEAD and map data/style retain correct MIME and revalidation behavior", async () => {
  for (const [name, contentType] of [
    ["maplibre-gl-worker.mjs", "text/javascript"],
    ["card.css", "text/css"], ["venue-catalogue.json", "application/json"],
  ]) {
    const response = await request(`/mshpit-maplibre/${name}`, "HEAD");
    assert.equal(response.status, 200, name);
    assert.equal(response.headers["Content-Type"], contentType, name);
    assert.equal(response.headers["Cache-Control"], "no-cache", name);
    assert.ok(response.headers["Content-Length"] > 0, name);
    assert.equal(response.body.length, 0, name);
  }
});

test("a missing map module remains a real uncached 404 instead of an HTML shell", async () => {
  const response = await request("/mshpit-maplibre/missing-module.mjs");
  assert.equal(response.status, 404);
  assert.equal(response.headers["Content-Type"], "application/json");
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.deepEqual(JSON.parse(response.body), { error: "Asset not found." });
});
