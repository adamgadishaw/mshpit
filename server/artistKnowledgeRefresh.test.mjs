import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createArtistKnowledgeRefresher, artistKnowledgeStorageReady, startArtistKnowledgeScheduler,
  artistKnowledgeMemoryReady, artistKnowledgeDatabaseBytes } from "./artistKnowledgeRefresh.js";
import { readCatalogKnowledgeControl, setCatalogKnowledgeMode, collectCatalogKnowledgeControl } from "./catalogKnowledgeControl.js";
import { ArtistKnowledgeProviderError } from "./artistKnowledgeProvider.js";
import { rememberDiscoverArtists, discoverArtistPriorityKeys, DISCOVER_PRIORITY_LIMIT } from "./discoverArtistPriority.js";

const MBID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const AT = 1_800_000_000_000;
const result = (mbid = MBID) => ({ mbid, wikidataId: "Q123", wikidataUrl: "https://www.wikidata.org/wiki/Q123",
  bio: "An independently identified musical group.", country: "Canada",
  bioSource: { provider: "wikipedia", url: "https://en.wikipedia.org/wiki/Example_(band)",
    revisionUrl: "https://en.wikipedia.org/w/index.php?oldid=123", license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/", modified: true,
    mbid, wikidataId: "Q123", retrievedAt: AT } });

function fixture(t, { fetchKnowledge = async () => result(), storageReady, memoryReady, databaseBytes, env = {}, now = () => AT } = {}) {
  const database = new DatabaseSync(":memory:");
  database.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT,mbid TEXT,bio TEXT,country TEXT,data TEXT,rank_score INTEGER,updated_at INTEGER);
    CREATE TABLE artist_profiles(artist_key TEXT PRIMARY KEY,bio TEXT,bio_staff_curated INTEGER);
    CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT);`);
  t.after(() => database.close());
  const insert = (norm = "example", options = {}) => database.prepare("INSERT INTO artists VALUES (?,?,?,?,?,?,?,?)")
    .run(norm, norm, options.mbid ?? MBID, options.bio ?? null, options.country ?? null,
      options.data ?? "{}", options.rank ?? 1, AT);
  const service = createArtistKnowledgeRefresher({ database, fetchKnowledge, now, storageReady, memoryReady, databaseBytes, env });
  return { database, service, insert, row: (key = "example") => database.prepare("SELECT * FROM artists WHERE norm=?").get(key),
    check: (key = "example") => database.prepare("SELECT * FROM artist_knowledge_checks WHERE artist_key=?").get(key) };
}

test("Discover artists get first attention without starving catalogue work or bypassing retry times", async (t) => {
  const calls = [];
  const f = fixture(t, { fetchKnowledge: async ({ mbid }) => { calls.push(mbid); return result(mbid); } });
  f.insert("ordinary", { rank: 100 });
  f.insert("discover-one", { mbid: OTHER, rank: 0 });
  f.insert("discover-two", { rank: 0 });
  rememberDiscoverArtists(f.database, [{ key: "discover-one" }, { key: "discover-two" }], AT);
  const stats = await f.service.runBatch({ limit: 2 });
  assert.deepEqual(calls, [OTHER, MBID]);
  assert.equal(stats.prioritized, 1);
  assert.equal(f.check("ordinary").status, "filled");
  assert.equal(f.check("discover-two"), undefined);
  f.database.prepare(`INSERT INTO artist_knowledge_checks VALUES (?,?,'failed',?,?,1,NULL)`)
    .run("discover-two", MBID, AT, AT + 3600000);
  assert.equal((await f.service.runBatch()).checked, 0, "Discover cannot override retry cooldowns");
});

test("fills only missing fields and persists exact source; second pass makes no calls", async (t) => {
  let calls = 0;
  const f = fixture(t, { fetchKnowledge: async () => { calls++; return result(); } });
  f.insert();
  const stats = await f.service.runBatch();
  assert.equal(stats.filled, 1); assert.equal(stats.bios, 1); assert.equal(stats.countries, 1);
  assert.equal(f.row().bio, result().bio);
  assert.equal(JSON.parse(f.row().data).artistKnowledge.bioSource.revisionUrl, result().bioSource.revisionUrl);
  assert.equal(f.check().status, "filled");
  await f.service.runBatch(); assert.equal(calls, 1);
});

test("interrupted checks finish before fresh low-value work evicts their source checkpoints", async t => {
  const f = fixture(t);
  f.insert("interrupted", { rank: 1 }); f.insert("new", { rank: 100 });
  f.database.prepare("INSERT INTO artist_knowledge_checks VALUES (?,?,'leased',?,?,0,NULL)")
    .run("interrupted", MBID, AT - 120000, AT);
  const stats = await f.service.runBatch({ limit: 1 });
  assert.equal(stats.filled, 1);
  assert.equal(f.check("interrupted").status, "filled");
  assert.equal(f.check("new"), undefined);
});

test("a worker pass retains its priority snapshot when newer Discover hints evict the originals", async (t) => {
  let calls = 0, f;
  f = fixture(t, { fetchKnowledge: async () => {
    if (++calls === 1) {
      for (let i = 0; i < DISCOVER_PRIORITY_LIMIT; i++) {
        rememberDiscoverArtists(f.database, [{ key: `new-discover-${i}` }], AT);
      }
    }
    return result();
  } });
  f.insert("ordinary", { rank: 100 });
  for (let i = 0; i < 4; i++) f.insert(`priority-${i}`, { rank: 0 });
  rememberDiscoverArtists(f.database, Array.from({ length: 4 }, (_, i) => ({ key: `priority-${i}` })), AT);
  const stats = await f.service.runBatch({ limit: 5 });
  assert.equal(stats.checked, 5);
  assert.equal(stats.prioritized, 4);
  assert.equal(f.check("ordinary").status, "filled");
  for (let i = 0; i < 4; i++) assert.equal(f.check(`priority-${i}`).status, "filled");
  assert.equal(discoverArtistPriorityKeys(f.database, AT).some(key => key.startsWith("priority-")), false);
});

test("new Discover hints cannot bypass exhausted artist or provider-request budgets", async (t) => {
  for (const cap of ["ARTIST_KNOWLEDGE_DAILY_ARTISTS", "ARTIST_KNOWLEDGE_DAILY_REQUESTS"]) {
    let requests = 0;
    const env = { [cap]: "2" };
    const f = fixture(t, { env, fetchKnowledge: async ({ beforeRequest }) => { beforeRequest(); requests++; return result(); } });
    for (let i = 0; i < 6; i++) f.insert(`priority-${i}`);
    rememberDiscoverArtists(f.database, Array.from({ length: 6 }, (_, i) => ({ key: `priority-${i}` })), AT);
    assert.equal((await f.service.runBatch()).budgetPaused, true);
    assert.equal(requests, 2);
    f.insert("new-discover");
    rememberDiscoverArtists(f.database, [{ key: "new-discover" }], AT);
    assert.equal((await f.service.runBatch()).budgetPaused, true);
    assert.equal(requests, 2);
    assert.equal(f.row("new-discover").bio, null);
  }
});

test("existing text and rich metadata survive; profile rows suppress biography downloads", async (t) => {
  const requests = [];
  const f = fixture(t, { fetchKnowledge: async (request) => { requests.push(request); return result(); } });
  f.insert("curated", { bio: "Staff biography", data: JSON.stringify({ biographyStaff: { revision: 7 }, tracks: [1] }) });
  f.insert("clear");
  f.database.prepare("INSERT INTO artist_profiles VALUES (?,NULL,1)").run("clear");
  await f.service.runBatch();
  assert.deepEqual(requests.map((x) => x.needBio), [false, false]);
  assert.equal(f.row("clear").bio, null); assert.equal(f.row("curated").bio, "Staff biography");
  assert.equal(JSON.parse(f.row("curated").data).biographyStaff.revision, 7);
});

test("a biography edit or profile claim during download wins", async (t) => {
  let f;
  f = fixture(t, { fetchKnowledge: async () => {
    f.database.prepare("UPDATE artists SET bio='New staff text',data=?").run(JSON.stringify({ edit: 1 }));
    f.database.prepare("INSERT INTO artist_profiles VALUES ('example',NULL,1)").run();
    return result();
  } });
  f.insert(); await f.service.runBatch();
  assert.equal(f.row().bio, "New staff text"); assert.equal(JSON.parse(f.row().data).edit, 1);
  assert.equal(f.row().country, "Canada");
});

test("identity correction or deletion during fetch cannot receive old metadata", async (t) => {
  let f;
  f = fixture(t, { fetchKnowledge: async () => { f.database.prepare("UPDATE artists SET mbid=?").run(OTHER); return result(); } });
  f.insert(); const stats = await f.service.runBatch();
  assert.equal(stats.stale, 1); assert.equal(f.row().bio, null); assert.equal(f.row().country, null);
  const g = fixture(t, { fetchKnowledge: async () => { g.database.exec("DELETE FROM artists"); return result(); } });
  g.insert(); assert.equal((await g.service.runBatch()).stale, 1);
  assert.equal(g.check(), undefined);
});

test("after an identity correction only stale imported fields become refillable", async (t) => {
  let identity = MBID;
  const f = fixture(t, { fetchKnowledge: async () => ({ ...result(identity), bio: identity === MBID ? "Original band." : "Corrected band.", country: identity === MBID ? "Canada" : "France" }) });
  f.insert(); await f.service.runBatch();
  identity = OTHER;
  f.database.prepare("UPDATE artists SET mbid=? WHERE norm='example'").run(OTHER);
  const stats = await f.service.runBatch();
  assert.equal(stats.bios, 1); assert.equal(stats.countries, 1);
  assert.equal(f.row().bio, "Corrected band."); assert.equal(f.row().country, "France");
  assert.equal(JSON.parse(f.row().data).artistKnowledge.mbid, OTHER);
});

test("partial or empty correction results cannot expose unreplaced old facts", async (t) => {
  for (const replacement of [{ ...result(OTHER), bio: undefined, bioSource: undefined, country: "France" },
    { ...result(OTHER), country: undefined, bio: "Replacement biography." }, null]) {
    let next = result(), clock = AT;
    const f = fixture(t, { fetchKnowledge: async () => next, now: () => clock });
    f.insert(); await f.service.runBatch();
    f.database.prepare("UPDATE artists SET mbid=?").run(OTHER); next = replacement;
    await f.service.runBatch();
    assert.equal(f.row().bio, replacement?.bio || null);
    assert.equal(f.row().country, replacement?.country || null);
    assert.equal(JSON.parse(f.row().data).artistKnowledgePrevious.mbid, MBID);
    clock += 31 * 86400_000; next = result(OTHER);
    assert.equal((await f.service.runBatch()).filled, 1);
    assert.equal(f.row().bio, replacement?.bio || next.bio); assert.equal(f.row().country, replacement?.country || next.country);
  }
});

test("a failed correction remains eligible after its new-identity claim cools down", async (t) => {
  let fail = false, identity = MBID, clock = AT;
  const f = fixture(t, { now: () => clock, fetchKnowledge: async () => {
    if (fail) throw new Error("upstream unavailable");
    return result(identity);
  } });
  f.insert(); await f.service.runBatch();
  identity = OTHER; fail = true; f.database.prepare("UPDATE artists SET mbid=?").run(OTHER);
  assert.equal((await f.service.runBatch()).failed, 1);
  clock += 3600_000; fail = false;
  assert.equal((await f.service.runBatch()).filled, 1);
  assert.equal(JSON.parse(f.row().data).artistKnowledge.mbid, OTHER);
});

test("wrong identity, unsafe attribution and corrupt existing JSON never publish biography", async (t) => {
  for (const invalid of [result(OTHER), { ...result(), wikidataUrl: "https://evil.example/Q123" },
    { ...result(), bioSource: { ...result().bioSource, url: "javascript:alert(1)" } }]) {
    const f = fixture(t, { fetchKnowledge: async () => invalid });
    f.insert(); await f.service.runBatch(); assert.equal(f.row().bio, null);
  }
  let calls = 0;
  const f = fixture(t, { fetchKnowledge: async () => { calls++; return result(); } });
  f.insert("corrupt", { data: "{not json" });
  await f.service.runBatch(); assert.equal(calls, 0); assert.equal(f.row("corrupt").data, "{not json");
});

test("outage stops the pass and persistent Retry-After survives a new service", async (t) => {
  let calls = 0, clock = AT;
  const fetchKnowledge = async () => { calls++; throw Object.assign(new Error("503"), { retryAt: AT + 8_000_000 }); };
  const f = fixture(t, { fetchKnowledge, now: () => clock }); f.insert(); f.insert("another");
  const stats = await f.service.runBatch();
  assert.equal(calls, 1); assert.equal(stats.failed, 1); assert.equal(f.check("another").status, "failed");
  assert.equal(f.row().bio, null);
  const restarted = createArtistKnowledgeRefresher({ database: f.database, fetchKnowledge, now: () => clock });
  assert.equal((await restarted.runBatch()).coolingDown, true); assert.equal(calls, 1);
  clock += 8_000_001; await restarted.runBatch(); assert.equal(calls, 2);
});

test("no-match and malformed IDs rotate out without outage cooldown", async (t) => {
  let calls = 0;
  const f = fixture(t, { fetchKnowledge: async () => { calls++; return null; } });
  f.insert("bad", { mbid: "x".repeat(36), rank: 100 }); f.insert("good");
  await f.service.runBatch({ limit: 1 }); assert.equal(calls, 0); assert.equal(f.check("bad").status, "skipped");
  await f.service.runBatch({ limit: 1 }); assert.equal(calls, 1); assert.equal(f.check("good").status, "no_match");
  await f.service.runBatch(); assert.equal(calls, 1);
});

test("batch size is capped and lack of storage starts no downloads", async (t) => {
  let calls = 0;
  const f = fixture(t, { fetchKnowledge: async () => { calls++; return null; } });
  for (let i = 0; i < 20; i++) f.insert(`artist-${i}`);
  await f.service.runBatch({ limit: 5000 }); assert.equal(calls, 10);
  const g = fixture(t, { storageReady: () => false, fetchKnowledge: async () => { throw new Error("must not call"); } });
  g.insert(); assert.equal((await g.service.runBatch()).storagePaused, true); assert.equal(g.check(), undefined);
});

test("a paused pass replaces old successful telemetry without changing the artist ledger", async (t) => {
  let clock = AT, ready = true;
  const f = fixture(t, { now: () => clock, storageReady: () => ready });
  f.insert(); await f.service.runBatch();
  const summary = () => JSON.parse(f.database.prepare("SELECT value FROM app_meta WHERE key='artist-knowledge:v1:last-pass'").get().value);
  assert.equal(summary().filled, 1);
  const priorCheck = { ...f.check() };
  clock += 900_000; ready = false;
  await f.service.runBatch();
  assert.equal(summary().storagePaused, true);
  assert.equal(summary().filled, 0);
  assert.equal(summary().at, clock);
  assert.deepEqual({ ...f.check() }, priorCheck);
  ready = true; clock += 900_000;
  f.database.prepare("INSERT INTO app_meta(key,value) VALUES ('artist-knowledge:v1:cooldown',?)").run(String(clock + 3600_000));
  await f.service.runBatch();
  assert.equal(summary().coolingDown, true);
  assert.equal(summary().storagePaused, false);
  assert.equal(summary().at, clock);
  assert.deepEqual({ ...f.check() }, priorCheck);
});

test("duplicate ticks share work; cancellation saves nothing and leaves a retryable ledger", async (t) => {
  let release, calls = 0;
  const f = fixture(t, { fetchKnowledge: async () => { calls++; return new Promise((resolve) => { release = resolve; }); } });
  f.insert(); const controller = new AbortController();
  const first = f.service.runBatch({ signal: controller.signal });
  assert.equal(f.service.runBatch(), first); assert.equal(calls, 1);
  controller.abort(); release(result());
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(f.row().bio, null); assert.equal(f.check().status, "leased");
  assert.equal(f.check().failures, 0); assert.equal(f.check().claim_token, null);
});

test("active leases prevent duplicate work across service instances; expiry resumes safely", async (t) => {
  let clock = AT;
  const f = fixture(t, { now: () => clock }); f.insert();
  f.database.prepare("INSERT INTO artist_knowledge_checks VALUES (?,?,'leased',?,?,0,'old-process')")
    .run("example", MBID, AT, AT + 600_000);
  assert.equal((await f.service.runBatch()).checked, 0);
  clock += 600_001; assert.equal((await f.service.runBatch()).filled, 1);
});

test("disk guard reserves backup headroom and fails closed on unknown metrics", () => {
  const options = (available, size) => ({ statfs: () => ({ bavail: available, bsize: 1 }), stat: () => ({ size }) });
  assert.equal(artistKnowledgeStorageReady("dir", "db", options(512 * 1024 ** 2, 100)), true);
  assert.equal(artistKnowledgeStorageReady("dir", "db", options(100, 100)), false);
  assert.equal(artistKnowledgeStorageReady("dir", "db", options(512 * 1024 ** 2, 400 * 1024 ** 2)), false);
  assert.equal(artistKnowledgeStorageReady("dir", "db", { statfs: () => { throw new Error("unavailable"); } }), false);
  assert.equal(artistKnowledgeStorageReady("dir", "db", {
    statfs: () => ({ bavail: 550 * 1024 ** 2, bsize: 1 }),
    stat: (path) => ({ size: path.endsWith("-wal") ? 200 * 1024 ** 2 : 100 * 1024 ** 2 }),
  }), false);
  assert.equal(artistKnowledgeStorageReady("dir", "db", {
    statfs: () => ({ bavail: 600 * 1024 ** 2, bsize: 1 }),
    stat: (path) => { if (path.endsWith("-wal")) throw Object.assign(new Error("absent"), { code: "ENOENT" }); return { size: 100 }; },
  }), true);
});

test("scheduler is explicit on hosted runtimes and uses shared admission and periodic lifecycle", async () => {
  const logger = { log() {}, error() {} };
  assert.equal(startArtistKnowledgeScheduler({ env: { RENDER: "true" }, logger }), null);
  assert.equal(startArtistKnowledgeScheduler({ env: { ARTIST_KNOWLEDGE_ENABLED: "typo" }, logger }), null);
  let options, coordinated = 0, received, clock = AT;
  const handle = {};
  assert.equal(startArtistKnowledgeScheduler({ env: { ARTIST_KNOWLEDGE_ENABLED: "true", ARTIST_KNOWLEDGE_BATCH: "999" }, logger,
    now: () => clock, schedule: (value) => { options = value; return handle; }, coordinate: async (job) => { coordinated++; return job(); },
    service: { runBatch: async (value) => { received = value; return { checked: 0 }; } } }), handle);
  assert.equal(options.intervalMs, 60_000); assert.equal(options.initialDelayMs, 180_000);
  const signal = new AbortController().signal;
  await options.run({ signal });
  clock += 60_000; await options.run({ signal });
  clock += 60_000; await options.run({ signal });
  assert.equal(coordinated, 0, "one-minute interval ticks must preserve the full cold-start grace");
  clock += 60_000; await options.run({ signal });
  assert.equal(coordinated, 1); assert.equal(received.signal, signal); assert.equal(received.respectCadence, true);
});

test("catch-up runs ten lanes, keeps all claims distinct, then returns to one maintenance lane", async (t) => {
  let active = 0, peak = 0;
  const f = fixture(t, { env: { ARTIST_KNOWLEDGE_MODE: "catch_up" }, fetchKnowledge: async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setImmediate(resolve));
    active--; return result();
  } });
  for (let i = 0; i < 19; i++) f.insert(`artist-${i}`);
  const stats = await f.service.runBatch();
  assert.equal(stats.checked, 19); assert.equal(stats.filled, 19); assert.equal(peak, 10);
  const control = collectCatalogKnowledgeControl(f.database, { at: AT });
  assert.equal(control.mode, "maintenance"); assert.equal(control.limits.lanes, 1);
  assert.equal(control.initialSweepFinishedAt, AT); assert.equal(control.budget.attempts, 19);
  assert.equal(control.progress.totalArtists, 19); assert.equal(control.progress.alreadyComplete, 19);
});

test("no match is unresolved, missing identity is review work, not a completed catalog", async (t) => {
  const f = fixture(t, { env: { ARTIST_KNOWLEDGE_MODE: "catch_up" }, fetchKnowledge: async () => null });
  f.insert(); f.insert("unknown", { mbid: "no-identity" });
  await f.service.runBatch();
  const control = collectCatalogKnowledgeControl(f.database, { at: AT });
  assert.equal(control.mode, "maintenance"); assert.equal(control.progress.unresolved, 1);
  assert.equal(control.progress.needsIdentity, 1); assert.equal(control.progress.alreadyComplete, 0);
});

test("daily attempt/request caps and due time survive pause/resume and worker recreation", async (t) => {
  let calls = 0, clock = AT;
  const env = { ARTIST_KNOWLEDGE_MODE: "catch_up", ARTIST_KNOWLEDGE_DAILY_ARTISTS: "2", ARTIST_KNOWLEDGE_DAILY_REQUESTS: "2" };
  const fetchKnowledge = async ({ beforeRequest }) => { beforeRequest(); calls++; return null; };
  const f = fixture(t, { env, now: () => clock, fetchKnowledge });
  for (let i = 0; i < 5; i++) f.insert(`artist-${i}`);
  const stats = await f.service.runBatch({ respectCadence: true });
  assert.equal(stats.budgetPaused, true); assert.equal(calls, 2);
  setCatalogKnowledgeMode(f.database, "paused", { at: clock, env });
  setCatalogKnowledgeMode(f.database, "catch_up", { at: clock, env });
  const restarted = createArtistKnowledgeRefresher({ database: f.database, env, now: () => clock, fetchKnowledge });
  assert.equal((await restarted.runBatch({ respectCadence: true })).waiting, true);
  clock += 600_001;
  assert.equal((await restarted.runBatch()).budgetPaused, true); assert.equal(calls, 2);
  const budget = readCatalogKnowledgeControl(f.database, { env, at: clock }).budget;
  assert.equal(budget.attempts, 2); assert.equal(budget.requests, 2);
  clock += 86400_000;
  await restarted.runBatch(); assert.equal(calls, 4);
});

test("disk/memory/growth/mode changes during requests stop writes, not just later batches", async (t) => {
  for (const kind of ["disk", "memory", "growth", "mode"]) {
    let ready = true, bytes = 1024;
    let f;
    f = fixture(t, { storageReady: () => kind !== "disk" || ready,
      memoryReady: () => kind !== "memory" || ready, databaseBytes: () => bytes,
      fetchKnowledge: async () => {
        ready = false; bytes += 257 * 1024 ** 2;
        if (kind === "mode") setCatalogKnowledgeMode(f.database, "paused", { at: AT });
        return result();
      } });
    f.insert(); const stats = await f.service.runBatch();
    assert.equal(f.row().bio, null); assert.equal(f.row().country, null);
    assert.equal(stats[{ disk: "storagePaused", memory: "memoryPaused", growth: "capPaused", mode: "modePaused" }[kind]], true);
    assert.equal(f.check().status, "leased");
  }
});

test("actual provider request budget can stop halfway through a lookup without publishing partial facts", async (t) => {
  let requests = 0;
  const f = fixture(t, { env: { ARTIST_KNOWLEDGE_DAILY_REQUESTS: "2" },
    fetchKnowledge: async ({ beforeRequest }) => {
      for (let i = 0; i < 4; i++) { beforeRequest(); requests++; }
      return result();
    } });
  f.insert(); const stats = await f.service.runBatch();
  assert.equal(stats.budgetPaused, true); assert.equal(requests, 2);
  assert.equal(f.row().bio, null); assert.equal(f.check().status, "leased");
});

test("runtime memory guard yields to uploads, queued interactions, and unavailable metrics", () => {
  const healthy = { limitBytes: 2048 * 1024 ** 2, usedBytes: 400 * 1024 ** 2, reservedBytes: 128 * 1024 ** 2,
    activeKinds: ["background"], queued: 0 };
  assert.equal(artistKnowledgeMemoryReady({ snapshot: () => healthy }), true);
  for (const change of [{ queued: 1 }, { activeKinds: ["background", "image"] }, { limitBytes: null },
    { usedBytes: 2000 * 1024 ** 2 }]) {
    assert.equal(artistKnowledgeMemoryReady({ snapshot: () => ({ ...healthy, ...change }) }), false);
  }
  assert.equal(artistKnowledgeMemoryReady({ snapshot: () => { throw new Error("unavailable"); } }), false);
});

test("growth accounting includes WAL and fails closed for inaccessible files", () => {
  assert.equal(artistKnowledgeDatabaseBytes("db", { stat: path => ({ size: path.endsWith("-wal") ? 200 : 100 }) }), 300);
  assert.equal(artistKnowledgeDatabaseBytes("db", { stat: path => {
    if (path.endsWith("-wal")) throw Object.assign(new Error("absent"), { code: "ENOENT" });
    return { size: 100 };
  } }), 100);
  assert.equal(artistKnowledgeDatabaseBytes("db", { stat: () => { throw new Error("unavailable"); } }), null);
});

test("normal pass deadline defers three healthy lanes without provider failures or long backoff", async (t) => {
  let clock = AT, slow = true;
  const env = { ARTIST_KNOWLEDGE_MODE: "catch_up" };
  const f = fixture(t, { env, now: () => clock, fetchKnowledge: async () => {
    if (slow) await new Promise(resolve => setTimeout(resolve, 1100));
    return result();
  } });
  for (let i = 0; i < 3; i++) f.insert(`artist-${i}`);
  const stats = await f.service.runBatch({ budgetMs: 1000, respectCadence: true });
  assert.equal(stats.checked, 3); assert.equal(stats.failed, 0); assert.equal(stats.deferred, 3);
  assert.equal(stats.stoppedEarly, true); assert.equal(stats.failureCategory, null);
  assert.equal(f.database.prepare("SELECT value FROM app_meta WHERE key='artist-knowledge:v1:cooldown'").get(), undefined);
  for (let i = 0; i < 3; i++) {
    const row = f.check(`artist-${i}`);
    assert.equal(row.status, "leased"); assert.equal(row.failures, 0);
    assert.equal(row.claim_token, null); assert.equal(row.next_attempt_at, AT + 120_000);
    assert.equal(f.row(`artist-${i}`).bio, null);
  }
  clock += 120_000; slow = false;
  const resumed = await f.service.runBatch({ respectCadence: true });
  assert.equal(resumed.filled, 3);
  assert.equal(readCatalogKnowledgeControl(f.database, { env, at: clock }).budget.attempts, 6);
});

test("a real outage backs off only its failing row; cancelled neighbours keep prior failure counts", async (t) => {
  let calls = 0;
  const retryAt = AT + 3_600_000;
  const f = fixture(t, { env: { ARTIST_KNOWLEDGE_MODE: "catch_up" },
    fetchKnowledge: async ({ signal }) => {
      if (++calls === 1) throw new ArtistKnowledgeProviderError("private provider body", {
        code: "wikidata_unavailable", status: 503, retryAt });
      await new Promise(resolve => setImmediate(resolve));
      if (signal.aborted) throw signal.reason;
      return result();
    } });
  f.insert("a"); f.insert("b"); f.insert("c");
  f.database.prepare("INSERT INTO artist_knowledge_checks VALUES (?,?,'failed',?,?,2,NULL)")
    .run("c", MBID, AT - 1000, AT);
  const stats = await f.service.runBatch({ respectCadence: true });
  assert.equal(stats.failed, 1); assert.equal(stats.deferred, 2);
  assert.equal(stats.failureCategory, "wikidata_unavailable"); assert.equal(stats.cooldownUntil, retryAt);
  assert.equal(f.check("a").status, "failed"); assert.equal(f.check("a").failures, 1);
  assert.equal(f.check("a").next_attempt_at, retryAt);
  assert.equal(f.check("b").status, "leased"); assert.equal(f.check("b").failures, 0);
  assert.equal(f.check("c").status, "leased"); assert.equal(f.check("c").failures, 2);
  assert.equal(f.check("b").claim_token, null); assert.equal(f.check("c").claim_token, null);
  const cooling = await f.service.runBatch();
  assert.equal(cooling.coolingDown, true); assert.equal(cooling.cooldownUntil, retryAt);
  assert.equal(calls, 3);
});

test("provider failure diagnostics are fixed categories, never raw messages or arbitrary codes", async (t) => {
  const f = fixture(t, { fetchKnowledge: async () => {
    throw Object.assign(new Error("secret provider body"), { code: "token@example.test/private" });
  } });
  f.insert(); const stats = await f.service.runBatch();
  assert.equal(stats.failureCategory, "provider_error");
  assert.equal(stats.cooldownUntil, AT + 30 * 60_000);
  assert.doesNotMatch(JSON.stringify(stats), /secret|token|example/);
});

test("scheduler logs no-match separately from interrupted work and exposes idle pause reasons", async () => {
  let options, clock = AT;
  const lines = [];
  startArtistKnowledgeScheduler({
    env: { ARTIST_KNOWLEDGE_ENABLED: "true" }, now: () => clock,
    logger: { log: line => lines.push(line), error() {} },
    schedule: value => { options = value; return {}; }, coordinate: async job => job(),
    service: { runBatch: async () => ({ lanes: 3, checked: 5, filled: 2, bios: 2, countries: 0,
      unmatched: 1, deferred: 2, failed: 0, failureCategory: null, cooldownUntil: clock + 60_000,
      coolingDown: true, stoppedEarly: true, modePaused: false,
      storagePaused: false, memoryPaused: false, budgetPaused: false, capPaused: false }) },
  });
  clock += 180_000; await options.run({ signal: new AbortController().signal });
  assert.match(lines.at(-1), /noMatch=1 deferred=2 providerFailures=0/);
  assert.match(lines.at(-1), /failureCategory=none cooldownUntil=\d+ coolingDown=true stoppedEarly=true modePaused=false/);
});
