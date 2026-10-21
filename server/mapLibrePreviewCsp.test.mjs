import test from "node:test";
import assert from "node:assert/strict";
import { mapLibrePreviewCspSources } from "./mapLibrePreviewCsp.js";

const CLOSED = { script: [], style: [], connect: [] };

test("preview CSP needs both an explicit development environment and the exact server flag", () => {
  for (const env of [
    {},
    null,
    { NODE_ENV: "development" },
    { MSHPIT_WEB_MAPLIBRE_PREVIEW: "1" },
    { NODE_ENV: "development", MSHPIT_WEB_MAPLIBRE_PREVIEW: true },
    { NODE_ENV: "development", MSHPIT_WEB_MAPLIBRE_PREVIEW: "true" },
    { NODE_ENV: "development", MSHPIT_WEB_MAPLIBRE_PREVIEW: " 1" },
    { NODE_ENV: "development", MSHPIT_WEB_MAPLIBRE_PREVIEW: "0" },
    { NODE_ENV: "test", MSHPIT_WEB_MAPLIBRE_PREVIEW: "1" },
    { NODE_ENV: "development", EXPO_PUBLIC_WEB_MAP_RENDERER: "maplibre" },
  ]) assert.deepEqual(mapLibrePreviewCspSources(env), CLOSED);
});

test("production never expands even when the server preview and client renderer flags are set", () => {
  assert.deepEqual(mapLibrePreviewCspSources({
    NODE_ENV: "production",
    MSHPIT_WEB_MAPLIBRE_PREVIEW: "1",
    EXPO_PUBLIC_WEB_MAP_RENDERER: "maplibre",
  }), CLOSED);
});

test("reviewed production authority is explicit, exact, and independent of public/preview flags", () => {
  const approved = mapLibrePreviewCspSources({ NODE_ENV: "production", MSHPIT_WEB_MAPLIBRE_ENABLED: "1" });
  assert.deepEqual(approved, mapLibrePreviewCspSources({ NODE_ENV: "development", MSHPIT_WEB_MAPLIBRE_PREVIEW: "1" }));
  for (const value of [undefined, "0", "true", true, " 1"]) {
    assert.deepEqual(mapLibrePreviewCspSources({ NODE_ENV: "production", MSHPIT_WEB_MAPLIBRE_ENABLED: value }), CLOSED);
  }
  assert.deepEqual(mapLibrePreviewCspSources({ NODE_ENV: "test", MSHPIT_WEB_MAPLIBRE_ENABLED: "1" }), CLOSED);
  assert.deepEqual(mapLibrePreviewCspSources({ NODE_ENV: "development", MSHPIT_WEB_MAPLIBRE_ENABLED: "1" }), CLOSED);
});

test("development expansion contains only the pinned package path and approved tile origin", () => {
  const sources = mapLibrePreviewCspSources({ NODE_ENV: "development", MSHPIT_WEB_MAPLIBRE_PREVIEW: "1" });
  assert.deepEqual(sources, {
    script: ["https://unpkg.com/maplibre-gl@6.15.0/dist/"],
    style: ["https://unpkg.com/maplibre-gl@6.15.0/dist/"],
    connect: ["https://tiles.openfreemap.org"],
  });
  for (const value of [...sources.script, ...sources.style, ...sources.connect]) {
    assert.equal(value.includes("*"), false);
    assert.equal(value.includes("unsafe-"), false);
    assert.equal(value, new URL(value).href.replace(/\/$/, value.endsWith("/") ? "/" : ""));
  }
});

test("one caller cannot mutate the next caller's policy arrays", () => {
  const env = { NODE_ENV: "development", MSHPIT_WEB_MAPLIBRE_PREVIEW: "1" };
  const first = mapLibrePreviewCspSources(env);
  first.script.push("https://untrusted.example");
  assert.deepEqual(mapLibrePreviewCspSources(env).script, ["https://unpkg.com/maplibre-gl@6.15.0/dist/"]);
  const disabled = mapLibrePreviewCspSources({});
  disabled.connect.push("https://untrusted.example");
  assert.deepEqual(mapLibrePreviewCspSources({}), CLOSED);
});
