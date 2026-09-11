import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { missingStaticAssetResponse, privateStaticAssetResponse } from "./staticPolicy.js";

test("fatal process errors retain Node's fail-fast behavior", async () => {
  const source = await readFile(new URL("./index.js", import.meta.url), "utf8");
  assert.match(source, /process\.on\("uncaughtExceptionMonitor"/);
  assert.doesNotMatch(source, /process\.on\(["']uncaughtException["']\s*,/);
  assert.doesNotMatch(source, /process\.on\(["']unhandledRejection["']\s*,/);
});

test("index delegates missing static files to the executable no-store policy", async () => {
  const source = await readFile(new URL("./index.js", import.meta.url), "utf8");
  assert.match(source, /missingStaticAssetResponse\(pathname\)/);
  assert.match(source, /send\(res, missingAsset\.status, missingAsset\.body, missingAsset\.headers\)/);

  assert.deepEqual(missingStaticAssetResponse("/_expo/static/js/app-deadbeef.js"), {
    status: 404,
    body: { error: "Asset not found." },
    headers: { "Cache-Control": "no-store" },
  });
  assert.deepEqual(missingStaticAssetResponse("/assets/app-deadbeef.css"), {
    status: 404,
    body: { error: "Asset not found." },
    headers: { "Cache-Control": "no-store" },
  });
  assert.equal(missingStaticAssetResponse("/concert/show.opaque_key"), null,
    "dotted opaque concert keys are classified by the SEO/app router instead of the static-asset policy");
  assert.equal(missingStaticAssetResponse("/event/provider.event-id"), null,
    "dotted provider event ids remain application routes");
});

test("source maps are private even though every bundle names its map", async () => {
  const source = await readFile(new URL("./index.js", import.meta.url), "utf8");
  assert.match(source, /privateStaticAssetResponse\(pathname\)/);
  assert.match(source, /send\(res, privateAsset\.status, privateAsset\.body, privateAsset\.headers\)/);
  const serveStatic = source.slice(source.indexOf("function serveStatic("));
  assert.ok(serveStatic.indexOf("privateStaticAssetResponse(pathname)") < serveStatic.indexOf("createReadStream"),
    "the refusal must run before any file is streamed");
  const refused = { status: 404, body: { error: "Asset not found." }, headers: { "Cache-Control": "no-store" } };
  for (const path of [
    "/_expo/static/js/web/index-0123456789abcdef0123456789abcdef.js.map",
    "/_expo/static/js/web/INDEX-0123456789ABCDEF0123456789ABCDEF.JS.MAP",
    "/_expo/static/js/web/index.js.m%61p",
    "/_expo/static/js/web/index.js.map/",
    "/_expo/static/js/web/index.js.map?download=1",
  ]) {
    assert.deepEqual(privateStaticAssetResponse(path), refused, path);
  }
  for (const path of ["/_expo/static/js/web/index-0123456789abcdef0123456789abcdef.js", "/sitemap.xml", "/concert/show.map-key"]) {
    assert.equal(privateStaticAssetResponse(path), null, path);
  }
});
