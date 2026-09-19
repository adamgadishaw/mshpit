import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createVenuePhotoRefresher, venuePhotoEnrichmentEnabled, readVenuePhotoEnrichmentStatus,
  revokeRuntimeVenuePhoto, VENUE_PHOTO_LIMITS } from "./venuePhotoEnrichment.js";
import { setCatalogKnowledgeMode } from "./catalogKnowledgeControl.js";
import { publicVenuePhotoPool, registerRuntimeVenuePhotoReader } from "./venuePhotoCatalog.js";
import { createRuntimeVenuePhotoReader } from "./runtimeVenuePhotoReader.js";

const BASE = 1_800_000_000_000, DAY = 86_400_000, MiB = 1024 ** 2;
const env = { RENDER: "true", ARTIST_KNOWLEDGE_ENABLED: "true", MEDIA_PUBLIC_BASE_URL: "https://media.example/base" };
const source = { uri: "https://upload.wikimedia.org/example.jpg", sourcePage: "https://commons.wikimedia.org/wiki/File:Fixture.jpg",
  creator: "Fixture Photographer", license: "CC-BY-4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", source: "commons" };
const digest = "a".repeat(64), objectKey = "venues/licensed/fixture-room-12345678/" + digest.slice(0, 48) + ".webp";
const photo = { ...source, uri: env.MEDIA_PUBLIC_BASE_URL + "/" + objectKey, mirroredFrom: source.uri,
  modificationNotice: "Converted to WebP and resized when needed by MSHpit for delivery.",
  mirror: { objectKey, contentType: "image/webp", byteSize: 1024, sha256: digest, width: 1280, height: 800 } };

function fixture(options = {}) {
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT);"
    + "CREATE TABLE tour_dates(id TEXT PRIMARY KEY,venue TEXT,source TEXT,venue_provider_id TEXT,venue_city TEXT,"
    + "venue_country_code TEXT,place TEXT,lat REAL,lng REAL,date TEXT,owner_id TEXT);");
  let clock = BASE, lookups = 0, mirrors = 0;
  const add = (id, providerId = id, fields = {}) => database.prepare("INSERT INTO tour_dates VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, fields.name || "Fixture Concert Hall", fields.source || "ticketmaster", providerId,
      fields.city || "Toronto", fields.country || "CA", "Toronto, Ontario, Canada", fields.lat ?? 43.6, fields.lng ?? -79.3, "2099-01-01", fields.owner || null);
  add("one");
  const defaults = { database, env, now: () => clock, configured: () => true, controlsIdentity: () => false, wait: async () => {},
    lookup: async () => { lookups++; return source; }, mirror: async () => { mirrors++; return photo; } };
  const worker = createVenuePhotoRefresher({ ...defaults, ...options });
  return { database, worker, add, counts: () => ({ lookups, mirrors }), advance: (ms = 16 * 60_000) => { clock += ms; },
    restart: (more = {}) => createVenuePhotoRefresher({ ...defaults, ...options, ...more }) };
}
const state = f => f.database.prepare("SELECT * FROM venue_photo_budget").get();
const ledger = f => f.database.prepare("SELECT * FROM venue_photo_enrichment ORDER BY venue_key").all();

test("hosted venue work inherits an existing catalogue opt-in; explicit override and typos fail closed", () => {
  assert.equal(venuePhotoEnrichmentEnabled({ RENDER: "true" }), false);
  assert.equal(venuePhotoEnrichmentEnabled(env), true);
  assert.equal(venuePhotoEnrichmentEnabled({ ...env, VENUE_PHOTO_ENRICHMENT_ENABLED: "false" }), false);
  assert.equal(venuePhotoEnrichmentEnabled({ ...env, VENUE_PHOTO_ENRICHMENT_ENABLED: "tru" }), false);
  assert.equal(venuePhotoEnrichmentEnabled({ RENDER: "true", ARTIST_KNOWLEDGE_ENABLED: "tru" }), false);
});

test("successful photos are durable, attributed, scoped and charge only confirmed bytes", async () => {
  const f = fixture();
  assert.deepEqual(await f.worker.run(), { checked: 1, filled: 1 });
  assert.equal(state(f).total_bytes, 1024); assert.equal(state(f).daily_bytes, 1024);
  assert.equal(f.worker.readPhoto("provider:ticketmaster:one").creator, source.creator);
  const restart = f.restart(); f.advance(); await restart.run();
  assert.deepEqual(f.counts(), { lookups: 1, mirrors: 1 });
  const unregister = registerRuntimeVenuePhotoReader(restart.readPhoto);
  try {
    assert.equal(publicVenuePhotoPool("Fixture Concert Hall", { source: "ticketmaster", providerVenueId: "one" }).length, 1);
    assert.equal(publicVenuePhotoPool("Fixture Concert Hall", { source: "other", providerVenueId: "one" }).length, 0);
    assert.equal(publicVenuePhotoPool("Fixture Concert Hall", { catalog: { "provider:ticketmaster:one": { galleryPool: [] } }, source: "ticketmaster", providerVenueId: "one" }).length, 0);
    assert.equal(revokeRuntimeVenuePhoto(f.database, "provider:ticketmaster:one"), true);
    assert.equal(publicVenuePhotoPool("Fixture Concert Hall", { source: "ticketmaster", providerVenueId: "one" }).length, 0);
  } finally { unregister(); }
  f.advance(40 * DAY); await restart.run();
  assert.deepEqual(f.counts(), { lookups: 1, mirrors: 1 }, "revocations are never retried automatically");
});

test("identity correction after publication hides the image immediately", async () => {
  const f = fixture(); await f.worker.run();
  f.database.prepare("UPDATE tour_dates SET venue_city='Ottawa'").run();
  assert.equal(f.worker.readPhoto("provider:ticketmaster:one"), null);
});

test("isolated photo reader requires no writes and preserves revocation and identity checks", async () => {
  const f = fixture(); await f.worker.run();
  f.database.exec("PRAGMA query_only=ON");
  const read = createRuntimeVenuePhotoReader(f.database, { env });
  assert.equal(read("provider:ticketmaster:one").uri, photo.uri);
  assert.equal(read("provider:other:one"), null);
  assert.equal(createRuntimeVenuePhotoReader(f.database, { env: {} })("provider:ticketmaster:one"), null);
  f.database.exec("PRAGMA query_only=OFF");
  revokeRuntimeVenuePhoto(f.database, "provider:ticketmaster:one");
  assert.equal(read("provider:ticketmaster:one"), null);
  const blank = new DatabaseSync(":memory:");
  blank.exec("PRAGMA query_only=ON");
  assert.equal(createRuntimeVenuePhotoReader(blank)("provider:ticketmaster:one"), null);
  assert.equal(blank.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get().n, 0);
  blank.close();
});

test("unconfigured storage and resource pressure stop visibly before network work", async () => {
  for (const [options, expected] of [[{ configured: () => false }, "storage_unconfigured"], [{ memoryReady: () => false }, "resources_deferred"], [{ storageReady: () => false }, "resources_deferred"]]) {
    const f = fixture(options); assert.equal(await f.worker.run(), false);
    assert.equal(state(f).last_status, expected); assert.equal(f.counts().lookups, 0);
  }
});

test("paused upkeep preserves photo budgets and executes no network work", async () => {
  const f = fixture(); setCatalogKnowledgeMode(f.database, "paused", { env, at: BASE });
  f.database.prepare("UPDATE venue_photo_budget SET total_bytes=1234,attempts=8").run();
  assert.equal(await f.worker.run(), false); assert.equal(state(f).last_status, "paused");
  assert.equal(state(f).total_bytes, 1234); assert.equal(state(f).attempts, 8);
});

test("daily request cap survives restart; next day resets only daily counters", async () => {
  const f = fixture(); f.database.prepare("UPDATE venue_photo_budget SET attempts=100,total_bytes=1234").run();
  await f.worker.run(); assert.equal(state(f).last_status, "daily_attempt_limit");
  assert.equal(f.counts().lookups, 0); f.advance(DAY); await f.restart().run();
  assert.equal(f.counts().lookups, 1); assert.equal(state(f).attempts, 1); assert.equal(state(f).total_bytes, 2258);
});

test("daily and lifetime image ceilings reserve before upload and never overshoot", async () => {
  for (const column of ["daily_bytes", "total_bytes"]) {
    const f = fixture(), cap = column === "daily_bytes" ? VENUE_PHOTO_LIMITS.dailyBytes : VENUE_PHOTO_LIMITS.totalBytes;
    f.database.prepare("UPDATE venue_photo_budget SET " + column + "=?").run(cap - MiB + 1);
    await f.worker.run(); assert.equal(f.counts().lookups, 1); assert.equal(f.counts().mirrors, 0);
    assert.equal(state(f).last_status, "image_budget_limit"); assert.equal(state(f)[column], cap - MiB + 1);
  }
});

test("ambiguous failed upload reservations remain charged through restart and later days", async () => {
  const f = fixture({ mirror: async () => { throw new Error("uncertain PUT"); } });
  await f.worker.run(); assert.equal(state(f).total_bytes, MiB); assert.equal(ledger(f)[0].status, "failed");
  f.advance(DAY); await f.restart().run(); assert.equal(state(f).total_bytes, 2 * MiB);
});

test("batch, single-flight and durable schedule bound work across restart", async () => {
  const f = fixture(); for (let n = 2; n <= 8; n++) f.add(String(n));
  const first = f.worker.run(); assert.equal(f.worker.run(), first); await first;
  assert.equal(f.counts().lookups, 3); await f.restart().run(); assert.equal(f.counts().lookups, 3);
});

test("no-match cooldown advances the catalogue rather than retrying empty venues", async () => {
  const f = fixture({ lookup: async () => null }); await f.worker.run();
  assert.equal(ledger(f)[0].status, "no_match"); assert.equal(ledger(f)[0].next_attempt_at, BASE + 30 * DAY);
  f.advance(); f.add("two"); assert.equal((await f.worker.run()).checked, 1);
});

test("conflicting coordinates and member-owned rows cannot be published", async () => {
  const f = fixture(); f.add("conflict", "one", { lat: 42 }); f.add("private", "private", { owner: "user-one" });
  assert.deepEqual(await f.worker.run(), { checked: 0, filled: 0 }); assert.equal(f.counts().lookups, 0);
});

test("staff controls, deleted identities and revocation during lookup prevent publication", async () => {
  for (const mutation of [f => f.database.exec("DELETE FROM tour_dates"), f => revokeRuntimeVenuePhoto(f.database, "provider:ticketmaster:one")]) {
    let f; f = fixture({ lookup: async () => { mutation(f); return source; } });
    await f.worker.run(); assert.equal(f.counts().mirrors, 0); assert.equal(f.worker.readPhoto("provider:ticketmaster:one"), null);
  }
  const protectedFixture = fixture({ controlsIdentity: () => true }); await protectedFixture.worker.run();
  assert.equal(protectedFixture.counts().lookups, 0); assert.equal(ledger(protectedFixture)[0].status, "protected");
});

test("memory pressure after lookup defers before image download", async () => {
  let pressure = false;
  const f = fixture({ lookup: async () => { pressure = true; return source; }, memoryReady: () => !pressure });
  await f.worker.run(); assert.equal(f.counts().mirrors, 0); assert.equal(state(f).last_status, "resources_deferred");
  assert.equal(ledger(f)[0].status, "leased"); assert.equal(ledger(f)[0].claim_token, null);
});

test("an empty result after abort, pause or resource pressure remains resumable", async () => {
  for (const expected of ["interrupted", "paused", "resources_deferred"]) {
    const controller = new AbortController();
    let pressure = false, f;
    f = fixture({
      lookup: async () => {
        if (expected === "interrupted") controller.abort();
        if (expected === "paused") setCatalogKnowledgeMode(f.database, "paused", { env, at: BASE });
        if (expected === "resources_deferred") pressure = true;
        return null;
      },
      memoryReady: () => !pressure,
    });
    await f.worker.run({ signal: controller.signal });
    assert.equal(state(f).last_status, expected);
    assert.equal(ledger(f)[0].status, "leased");
    assert.equal(ledger(f)[0].next_attempt_at, BASE + 15 * 60_000);
    assert.equal(f.counts().mirrors, 0);
  }
});

test("abort after upload retains reservation with a resumable short lease", async () => {
  const abort = new AbortController();
  const f = fixture({ mirror: async () => { abort.abort(); return photo; } });
  await f.worker.run({ signal: abort.signal });
  assert.equal(state(f).last_status, "interrupted"); assert.equal(state(f).total_bytes, MiB);
  assert.equal(ledger(f)[0].status, "leased"); assert.equal(ledger(f)[0].next_attempt_at, BASE + 15 * 60_000);
});

test("provider cooldown persists and failures are not hidden by an earlier fill", async () => {
  let calls = 0;
  const f = fixture({ lookup: async () => { if (++calls === 1) return source; throw Object.assign(new Error("backoff"), { retryAt: BASE + 2 * 3600_000 }); } });
  f.add("two"); assert.deepEqual(await f.worker.run(), { checked: 2, filled: 1 });
  assert.equal(state(f).last_status, "provider_or_storage_failed"); assert.equal(state(f).next_pass_at, BASE + 2 * 3600_000);
  f.advance(); assert.equal(await f.restart().run(), false);
});

test("status reads without schema are non-mutating and honest", () => {
  const database = new DatabaseSync(":memory:");
  assert.equal(readVenuePhotoEnrichmentStatus(database, { env }).state, "not_started");
  assert.equal(database.prepare("SELECT count(*) AS n FROM sqlite_master").get().n, 0);
});

test("unavailable status cannot fail the moderation read or repair schema", () => {
  const f = fixture();
  f.database.exec("DROP TABLE venue_photo_enrichment");
  const schemaBefore = f.database.prepare("SELECT count(*) AS n FROM sqlite_master").get().n;
  assert.equal(readVenuePhotoEnrichmentStatus(f.database, { env }).state, "unavailable");
  assert.equal(f.database.prepare("SELECT count(*) AS n FROM sqlite_master").get().n, schemaBefore);
  f.database.close();
  assert.equal(readVenuePhotoEnrichmentStatus(f.database, { env }).state, "unavailable");
});

test("identity revalidation uses a selective expression index rather than scanning tour dates", () => {
  const f = fixture();
  const plan = f.database.prepare("EXPLAIN QUERY PLAN SELECT MIN(venue) FROM tour_dates WHERE source='ticketmaster' AND owner_id IS NULL AND lower(trim(venue_provider_id))=?").all("one");
  assert.ok(plan.some(row => /SEARCH.*idx_tourdates_venue_photo_identity/u.test(row.detail)), JSON.stringify(plan));
});
