import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import { mapLibreServerEnabled } from "./mapLibreConfiguration.mjs";
import { createVenueMapCatalogueCache } from "./venueMapCatalogueCache.mjs";
import { ApiError } from "./errors.js";

// Execute the actual route with public-page dependencies, without importing the
// application database or starting any background providers.
const source = readFileSync(new URL("./api.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module" });
const routes = ast.program.body.find(node => node.type === "ExportNamedDeclaration" && node.declaration?.declarations?.some(entry => entry.id.name === "routes"))
  .declaration.declarations.find(entry => entry.id.name === "routes").init;
const route = routes.properties.find(entry => entry.key?.value === "GET /api/tourdates").value;
const cache = ast.program.body.find(node => node.type === "VariableDeclaration" && node.declarations.some(entry => entry.id.name === "venueMapCatalogue"))
  .declarations.find(entry => entry.id.name === "venueMapCatalogue").init;
function actualRoute(env, overrides = {}) {
  const dependencies = { now: () => Date.parse("2026-10-21T14:15:00Z"), process: { env }, mapLibreServerEnabled, createVenueMapCatalogueCache, ApiError,
    createVenueMapCatalogueResponse: value => value,
    tourDateAllUpcomingRequest: () => { throw new Error("normal query parser"); },
    tourDateJson: row => row, ...overrides };
  dependencies.venueMapCatalogue = overrides.venueMapCatalogue || new Function(...Object.keys(dependencies), `return (${source.slice(cache.start, cache.end)});`)(...Object.values(dependencies));
  return new Function(...Object.keys(dependencies), `return (${source.slice(route.start, route.end)});`)(...Object.values(dependencies));
}
test("the actual compact route is off in production, test and default environments", () => {
  for (const env of [{}, { NODE_ENV: "production", MSHPIT_WEB_MAPLIBRE_PREVIEW: "1" }, { NODE_ENV: "test", MSHPIT_WEB_MAPLIBRE_PREVIEW: "1" }, { NODE_ENV: "development" }]) {
    assert.throws(() => actualRoute(env)({ query: { view: "venue-map" } }), /normal query parser/u);
  }
});
test("the production-enabled route scans every public page once with a fixed timestamp and no viewer privileges", async () => {
  const parsed = [], reads = [];
  const handle = actualRoute({ NODE_ENV: "production", MSHPIT_WEB_MAPLIBRE_ENABLED: "1" }, {
    tourDateAllUpcomingRequest: ctx => { parsed.push(ctx.query); return ctx.query; },
    tourDateRangePage: (viewer, request, at) => {
      reads.push({ viewer, request, at });
      return request.after ? { rows: [{ id: "event-b", venue: "Second room", place: "Paris, France", date: "2027-01-01" }], nextCursor: null }
        : { rows: [{ id: "event-a", venue: "First room", place: "Toronto, Canada", date: "2027-01-01" }], nextCursor: "next_page" };
    },
  });
  const result = await handle({ user: { id: "private-viewer" }, query: { view: "venue-map", scope: "all-upcoming" } });
  assert.equal(result.complete, true); assert.equal(result.eventCount, 2); assert.equal(result.venueCount, 2);
  assert.equal(result.pages, 2); assert.equal(result.tourDates.length, 2);
  assert.deepEqual(parsed, [{ scope: "all-upcoming", limit: "500" }, { scope: "all-upcoming", limit: "500", after: "next_page" }]);
  assert.ok(reads.every(read => read.viewer === null && read.at === reads[0].at && read.request.providerOnly === true));
  const again = await handle({ user: { id: "another-viewer" }, query: { view: "venue-map", scope: "all-upcoming", refresh: "1", city: "ignored-cannot-narrow-global-cache" } });
  assert.equal(again, result); assert.equal(reads.length, 2);
});

test("preview still works and disconnect signals reach only the shared cache subscription", async () => {
  const controller = new AbortController(); let options;
  const handle = actualRoute({ NODE_ENV: "development", MSHPIT_WEB_MAPLIBRE_PREVIEW: "1" }, {
    venueMapCatalogue: { get: async value => { options = value; return { fixture: true }; } },
  });
  assert.deepEqual(await handle({ signal: controller.signal, query: { view: "venue-map", refresh: "1" } }), { fixture: true });
  assert.deepEqual(options, { signal: controller.signal });
});

test("production map failures expose a typed retryable error without internal details", async () => {
  const cause = Object.assign(new Error("private database detail"), { retryAt: Date.now() + 30000 });
  const handle = actualRoute({ NODE_ENV: "production", MSHPIT_WEB_MAPLIBRE_ENABLED: "1" }, { venueMapCatalogue: { get: async () => { throw cause; } } });
  await assert.rejects(handle({ query: { view: "venue-map" } }), error => {
    assert.ok(error instanceof ApiError); assert.equal(error.status, 503); assert.equal(error.retryAt, cause.retryAt);
    assert.equal(error.code, "DATABASE_UNAVAILABLE"); assert.equal(error.message.includes("private"), false); return true;
  });
});
