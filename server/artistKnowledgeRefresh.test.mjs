import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createArtistKnowledgeRefresher, artistKnowledgeStorageReady, startArtistKnowledgeScheduler } from "./artistKnowledgeRefresh.js";

const MBID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const AT = 1_800_000_000_000;
const result = (mbid = MBID) => ({ mbid, wikidataId: "Q123", wikidataUrl: "https://www.wikidata.org/wiki/Q123",
  bio: "An independently identified musical group.", country: "Canada",
  bioSource: { provider: "wikipedia", url: "https://en.wikipedia.org/wiki/Example_(band)",
    revisionUrl: "https://en.wikipedia.org/w/index.php?oldid=123", license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/", modified: true,
    mbid, wikidataId: "Q123", retrievedAt: AT } });

function fixture(t, { fetchKnowledge = async () => result(), storageReady, now = () => AT } = {}) {
  const database = new DatabaseSync(":memory:");
  database.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT,mbid TEXT,bio TEXT,country TEXT,data TEXT,rank_score INTEGER,updated_at INTEGER);
    CREATE TABLE artist_profiles(artist_key TEXT PRIMARY KEY,bio TEXT,bio_staff_curated INTEGER);
    CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT);`);
  t.after(() => database.close());
  const insert = (norm = "example", options = {}) => database.prepare("INSERT INTO artists VALUES (?,?,?,?,?,?,?,?)")
    .run(norm, norm, options.mbid ?? MBID, options.bio ?? null, options.country ?? null,
      options.data ?? "{}", options.rank ?? 1, AT);
  const service = createArtistKnowledgeRefresher({ database, fetchKnowledge, now, storageReady });
  return { database, service, insert, row: (key = "example") => database.prepare("SELECT * FROM artists WHERE norm=?").get(key),
    check: (key = "example") => database.prepare("SELECT * FROM artist_knowledge_checks WHERE artist_key=?").get(key) };
}

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

test("duplicate ticks share work; cancellation saves nothing and leaves a retryable ledger", async (t) => {
  let release, calls = 0;
  const f = fixture(t, { fetchKnowledge: async () => { calls++; return new Promise((resolve) => { release = resolve; }); } });
  f.insert(); const controller = new AbortController();
  const first = f.service.runBatch({ signal: controller.signal });
  assert.equal(f.service.runBatch(), first); assert.equal(calls, 1);
  controller.abort(); release(result());
  await assert.rejects(first, { name: "AbortError" });
  assert.equal(f.row().bio, null); assert.equal(f.check().status, "failed");
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
    statfs: () => ({ bavail: 500 * 1024 ** 2, bsize: 1 }),
    stat: (path) => ({ size: path.endsWith("-wal") ? 200 * 1024 ** 2 : 100 * 1024 ** 2 }),
  }), false);
  assert.equal(artistKnowledgeStorageReady("dir", "db", {
    statfs: () => ({ bavail: 500 * 1024 ** 2, bsize: 1 }),
    stat: (path) => { if (path.endsWith("-wal")) throw Object.assign(new Error("absent"), { code: "ENOENT" }); return { size: 100 }; },
  }), true);
});

test("scheduler is explicit on hosted runtimes and uses shared admission and periodic lifecycle", async () => {
  const logger = { log() {}, error() {} };
  assert.equal(startArtistKnowledgeScheduler({ env: { RENDER: "true" }, logger }), null);
  assert.equal(startArtistKnowledgeScheduler({ env: { ARTIST_KNOWLEDGE_ENABLED: "typo" }, logger }), null);
  let options, coordinated = 0, received;
  const handle = {};
  assert.equal(startArtistKnowledgeScheduler({ env: { ARTIST_KNOWLEDGE_ENABLED: "true", ARTIST_KNOWLEDGE_BATCH: "999" }, logger,
    schedule: (value) => { options = value; return handle; }, coordinate: async (job) => { coordinated++; return job(); },
    service: { runBatch: async (value) => { received = value; return { checked: 0 }; } } }), handle);
  assert.equal(options.intervalMs, 900_000); assert.equal(options.initialDelayMs, 180_000);
  const signal = new AbortController().signal; await options.run({ signal });
  assert.equal(coordinated, 1); assert.equal(received.signal, signal); assert.equal(received.limit, 10);
});
