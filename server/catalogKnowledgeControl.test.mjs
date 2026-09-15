import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { CATALOG_KNOWLEDGE_KEY, ensureCatalogKnowledgeControl, readCatalogKnowledgeControl,
  setCatalogKnowledgeMode, catalogKnowledgeLimits, reserveCatalogKnowledgeBudget, reserveCatalogKnowledgePass,
  catalogKnowledgeGrowthReady, collectCatalogKnowledgeControl } from "./catalogKnowledgeControl.js";

const AT = Date.parse("2026-09-15T12:00:00Z");
function fixture(t, env = {}) {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec("CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT)");
  ensureCatalogKnowledgeControl(database, { env, at: AT });
  return database;
}

test("defaults are bounded, catch-up is explicit, and invalid requested mode changes nothing", t => {
  const db = fixture(t);
  assert.equal(readCatalogKnowledgeControl(db, { at: AT }).mode, "maintenance");
  assert.throws(() => setCatalogKnowledgeMode(db, "unlimited", { at: AT }), TypeError);
  const control = setCatalogKnowledgeMode(db, "catch_up", { at: AT });
  assert.equal(control.limits.lanes, 3); assert.equal(control.limits.intervalMinutes, 2);
  const limits = catalogKnowledgeLimits("catch_up", { ARTIST_KNOWLEDGE_CATCHUP_BATCH: "999999",
    ARTIST_KNOWLEDGE_DAILY_ARTISTS: "999999", ARTIST_KNOWLEDGE_DAILY_REQUESTS: "999999" });
  assert.equal(limits.maxArtistsPerPass, 40); assert.equal(limits.maxAttemptsPerDay, 3000);
  assert.equal(limits.maxRequestsPerDay, 12000); assert.equal(limits.maxGrowthMiB, 256);
});

test("mode changes preserve daily counters, work due time, and storage baseline", t => {
  const db = fixture(t, { ARTIST_KNOWLEDGE_MODE: "catch_up" });
  assert.equal(reserveCatalogKnowledgePass(db, { at: AT }), true);
  assert.equal(reserveCatalogKnowledgeBudget(db, "attempts", { at: AT }), true);
  assert.equal(reserveCatalogKnowledgeBudget(db, "requests", { at: AT }), true);
  assert.equal(catalogKnowledgeGrowthReady(db, 1_000_000), true);
  for (const mode of ["paused", "maintenance", "catch_up"]) setCatalogKnowledgeMode(db, mode, { at: AT });
  const control = readCatalogKnowledgeControl(db, { at: AT });
  assert.equal(control.budget.attempts, 1); assert.equal(control.budget.requests, 1);
  assert.equal(control.nextPassAt, AT + 120_000); assert.equal(control.baselineBytes, 1_000_000);
  assert.equal(reserveCatalogKnowledgePass(db, { at: AT }), false);
  assert.equal(reserveCatalogKnowledgePass(db, { at: AT + 120_000 }), true);
});

test("budgets reset only on a later UTC day, not a backward clock or restart", t => {
  const db = fixture(t);
  const env = { ARTIST_KNOWLEDGE_DAILY_ARTISTS: "1", ARTIST_KNOWLEDGE_DAILY_REQUESTS: "1" };
  assert.equal(reserveCatalogKnowledgeBudget(db, "attempts", { env, at: AT }), true);
  assert.equal(reserveCatalogKnowledgeBudget(db, "attempts", { env, at: AT - 86400_000 }), false);
  ensureCatalogKnowledgeControl(db, { env, at: AT + 1000 });
  assert.equal(reserveCatalogKnowledgeBudget(db, "attempts", { env, at: AT + 1000 }), false);
  assert.equal(reserveCatalogKnowledgeBudget(db, "attempts", { env, at: AT + 86400_000 }), true);
  assert.equal(readCatalogKnowledgeControl(db, { env, at: AT + 86400_000 }).budget.utcDay, "2026-09-16");
  assert.equal(reserveCatalogKnowledgeBudget(db, "attempts", { env, at: AT }), false);
});

test("growth circuit never resets by pausing, maintenance, shrinkage or daily rollover", t => {
  const db = fixture(t);
  assert.equal(catalogKnowledgeGrowthReady(db, 100 * 1024 ** 2), true);
  assert.equal(catalogKnowledgeGrowthReady(db, 356 * 1024 ** 2), true);
  assert.equal(catalogKnowledgeGrowthReady(db, 357 * 1024 ** 2), false);
  setCatalogKnowledgeMode(db, "paused", { at: AT });
  setCatalogKnowledgeMode(db, "catch_up", { at: AT + 86400_000 });
  assert.equal(catalogKnowledgeGrowthReady(db, 357 * 1024 ** 2), false);
  assert.equal(catalogKnowledgeGrowthReady(db, 80 * 1024 ** 2), true);
  assert.equal(readCatalogKnowledgeControl(db, { at: AT }).baselineBytes, 100 * 1024 ** 2);
  assert.equal(catalogKnowledgeGrowthReady(db, null), false);
  assert.equal(catalogKnowledgeGrowthReady(db, NaN), false);
});

test("paused/corrupt control fails closed and never grants unlimited work", t => {
  const db = fixture(t);
  setCatalogKnowledgeMode(db, "paused", { at: AT });
  assert.equal(reserveCatalogKnowledgeBudget(db, "attempts", { at: AT }), false);
  assert.equal(reserveCatalogKnowledgePass(db, { at: AT }), false);
  db.prepare("UPDATE app_meta SET value=? WHERE key=?").run('{"version":1,"mode":"catch_up"}', CATALOG_KNOWLEDGE_KEY);
  assert.equal(readCatalogKnowledgeControl(db, { at: AT }), null);
  assert.equal(reserveCatalogKnowledgeBudget(db, "requests", { at: AT }), false);
  assert.throws(() => setCatalogKnowledgeMode(db, "catch_up", { at: AT }));
});

test("progress distinguishes exact IDs, malformed and missing identities, protection and unresolved records", t => {
  const db = fixture(t);
  db.exec(`CREATE TABLE artists(norm TEXT PRIMARY KEY,mbid TEXT,bio TEXT,country TEXT);
    CREATE TABLE artist_profiles(artist_key TEXT PRIMARY KEY);
    CREATE TABLE artist_knowledge_checks(artist_key TEXT PRIMARY KEY,mbid TEXT,status TEXT);
    INSERT INTO artists VALUES
      ('pending','11111111-1111-4111-8111-111111111111',NULL,NULL),
      ('unmatched','11111111-1111-4111-8111-111111111111',NULL,NULL),
      ('bad','11111111-1111-4111-8111-11111111111g',NULL,NULL),
      ('missing',NULL,NULL,NULL),
      ('complete','11111111-1111-4111-8111-111111111111','Bio','Canada'),
      ('claimed','11111111-1111-4111-8111-111111111111',NULL,'Canada');
    INSERT INTO artist_profiles VALUES ('claimed');
    INSERT INTO artist_knowledge_checks VALUES ('unmatched','11111111-1111-4111-8111-111111111111','no_match');`);
  const control = collectCatalogKnowledgeControl(db, { at: AT });
  assert.deepEqual({ ...control.progress }, { totalArtists: 6, totalTracked: 1, filled: 0,
    eligible: 2, needsIdentity: 2, alreadyComplete: 2,
    unprocessed: 1, unresolved: 1, retrying: 0, attempted: 1,
    fieldCoverage: { biographyPresent: 1, biographyMissing: 4, biographyProtected: 1, countryPresent: 2, countryMissing: 4 } });
  assert.doesNotMatch(JSON.stringify(control), /unmatched|claimed|11111111/);
});

test("disabled runtime is visible and cannot be enabled by changing persisted mode", t => {
  const env = { RENDER: "true" };
  const db = fixture(t, env);
  const result = setCatalogKnowledgeMode(db, "catch_up", { env, at: AT });
  assert.equal(result.mode, "catch_up"); assert.equal(result.effectiveMode, "disabled");
  assert.equal(reserveCatalogKnowledgeBudget(db, "attempts", { env, at: AT }), false);
  assert.equal(reserveCatalogKnowledgePass(db, { env, at: AT }), false);
  assert.equal(readCatalogKnowledgeControl(db, { env: { ...env, ARTIST_KNOWLEDGE_ENABLED: "true" }, at: AT }).effectiveMode, "catch_up");
});

test("read-only collection never initializes control or writes a database", t => {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec("CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT)");
  assert.equal(collectCatalogKnowledgeControl(db, { at: AT }), null);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM app_meta").get().n, 0);
});
