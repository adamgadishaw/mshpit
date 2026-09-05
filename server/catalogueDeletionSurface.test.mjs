import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("background catalogue maintenance cannot delete durable artists or events", () => {
  const maintenanceSources = [
    "./tourdates.js",
    "./catalogSeed.js",
    "./cacheWarmer.js",
    "./index.js",
  ].map(read).join("\n");

  assert.doesNotMatch(maintenanceSources, /\bDELETE\s+FROM\s+(?:artists|tour_dates)\b/i,
    "provider refresh, seeding, and scheduled maintenance must reconcile with upserts or visibility flags, never delete catalogue truth");
  assert.doesNotMatch(maintenanceSources, /\bDROP\s+TABLE\s+(?:artists|tour_dates)\b/i,
    "background or startup maintenance must never rebuild a critical catalogue table destructively");
});

test("the sole artist-row deletion remains an explicit admin-only action", () => {
  const database = read("./db.js");
  const api = read("./api.js");
  const artistDeletes = database.match(/\bDELETE\s+FROM\s+artists\b/gi) || [];

  assert.equal(artistDeletes.length, 1,
    "adding another artist deletion path requires a deliberate integrity review");
  assert.match(database, /purge:\s*db\.prepare\("DELETE FROM artists WHERE norm = \?"\)/);

  const routeStart = api.indexOf('"POST /api/admin/artists/purge"');
  const nextRoute = api.indexOf('"POST /api/admin/catalog/seed"', routeStart);
  assert.ok(routeStart >= 0 && nextRoute > routeStart, "the explicit purge route remains present and bounded");
  const purgeRoute = api.slice(routeStart, nextRoute);
  assert.match(purgeRoute, /requireAdmin\(ctx\)/,
    "catalogue deletion must remain staff-authenticated");
  assert.equal((api.match(/artistStmts\.purge\.run\(/g) || []).length, 1,
    "no unrelated API route may gain artist-row deletion authority");
});

test("missing-search retention only trims the queue, never the artist catalogue", () => {
  const database = read("./db.js");
  const start = database.indexOf("export function pruneMissingArtists");
  const end = database.indexOf("\npruneMissingArtists();", start);
  assert.ok(start >= 0 && end > start);
  const retention = database.slice(start, end);

  assert.match(retention, /pruneMissingBefore\.run/);
  assert.match(retention, /trimMissingAfter\.run/);
  assert.doesNotMatch(retention, /artistStmts\.purge|DELETE\s+FROM\s+artists/i,
    "an hourly typo/search-queue sweep must not become an artist-catalogue sweep");
});
