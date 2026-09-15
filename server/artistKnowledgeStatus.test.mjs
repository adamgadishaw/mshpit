import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { collectArtistKnowledgeStatus, artistKnowledgeWatchCodes, formatArtistKnowledgeStatus } from "./artistKnowledgeStatus.js";

const AT = 1_800_000_000_000;
const env = { RENDER: "true", ARTIST_KNOWLEDGE_ENABLED: "true" };
const pass = (changes = {}) => ({ at: AT, checked: 3, filled: 2, bios: 2, countries: 1, unmatched: 1,
  failed: 0, stale: 0, coolingDown: false, storagePaused: false, stoppedEarly: false, ...changes });
function fixture(t) {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec(`CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE artist_knowledge_checks(artist_key TEXT PRIMARY KEY,status TEXT);`);
  const set = (key, value) => database.prepare("INSERT OR REPLACE INTO app_meta VALUES (?,?)")
    .run(`artist-knowledge:v1:${key}`, typeof value === "string" ? value : JSON.stringify(value));
  return { database, set };
}

test("disabled and not-yet-initialized worker status never creates schema or starts work", (t) => {
  const database = new DatabaseSync(":memory:"); t.after(() => database.close());
  assert.equal(collectArtistKnowledgeStatus(database, { at: AT, env: { RENDER: "true" } }).state, "disabled");
  assert.equal(collectArtistKnowledgeStatus(database, { at: AT, env }).state, "awaiting_first_pass");
  assert.deepEqual(artistKnowledgeWatchCodes(collectArtistKnowledgeStatus(database, { at: AT, env })), ["artist_knowledge_unverified"]);
  assert.equal(database.prepare("SELECT COUNT(*) n FROM sqlite_master").get().n, 0);
});

test("status exposes sanitized aggregate progress, not stored identities or arbitrary metadata", (t) => {
  const f = fixture(t);
  f.set("last-pass", pass({ privateNote: "secret@example.test", url: "https://private.test/a" }));
  for (const [key, status] of [["private artist 1", "filled"], ["private artist 2", "filled"], ["private artist 3", "no_match"], ["private artist 4", "failed"]]) {
    f.database.prepare("INSERT INTO artist_knowledge_checks VALUES (?,?)").run(key, status);
  }
  const status = collectArtistKnowledgeStatus(f.database, { env, at: AT + 120_000 });
  assert.equal(status.state, "recent"); assert.equal(status.lastPassAgeMinutes, 2);
  assert.deepEqual(status.ledger, { tracked: 4, filled: 2, no_match: 1, skipped: 0, failed: 1, leased: 0 });
  assert.equal(status.lastPass.filled, 2);
  assert.equal(status.limits.maxAttemptsPerDay, 960);
  assert.doesNotMatch(JSON.stringify(status), /secret|private|https:/);
  assert.match(formatArtistKnowledgeStatus(status), /not complete artist\/venue\/event pages/);
});

test("provider cooldown survives stale summaries and disk-paused state is not called healthy", (t) => {
  const f = fixture(t); f.set("last-pass", pass()); f.set("cooldown", String(AT + 4 * 3600_000));
  const cooling = collectArtistKnowledgeStatus(f.database, { env, at: AT + 3600_000 });
  assert.equal(cooling.state, "cooling_down");
  assert.deepEqual(artistKnowledgeWatchCodes(cooling), ["artist_knowledge_provider_cooldown"]);
  f.set("cooldown", "0"); f.set("last-pass", pass({ storagePaused: true }));
  const disk = collectArtistKnowledgeStatus(f.database, { env, at: AT + 60_000 });
  assert.equal(disk.state, "storage_paused");
  assert.deepEqual(artistKnowledgeWatchCodes(disk), ["artist_knowledge_storage_paused"]);
  const stale = collectArtistKnowledgeStatus(f.database, { env, at: AT + 46 * 60_000 });
  assert.equal(stale.state, "stale");
  assert.deepEqual(artistKnowledgeWatchCodes(stale), ["artist_knowledge_stale"]);
});

test("idle means the last pass checked no candidates, not catalog completion", (t) => {
  const f = fixture(t); f.set("last-pass", pass({ checked: 0, filled: 0, bios: 0, countries: 0, unmatched: 0 }));
  const status = collectArtistKnowledgeStatus(f.database, { env, at: AT });
  assert.equal(status.state, "idle");
  assert.doesNotMatch(formatArtistKnowledgeStatus(status), /catalog (?:is )?complete/i);
  assert.equal(collectArtistKnowledgeStatus(f.database, { env: { ...env, ARTIST_KNOWLEDGE_BATCH: "999" }, at: AT }).limits.maxArtistsPerPass, 10);
});

test("interrupted checks stay separate from provider failures; old passes do not invent a count", (t) => {
  const f = fixture(t);
  f.set("last-pass", pass());
  assert.equal(collectArtistKnowledgeStatus(f.database, { env, at: AT }).lastPass.deferred, null);
  f.set("last-pass", pass({ deferred: 3, stoppedEarly: true, failed: 0 }));
  const status = collectArtistKnowledgeStatus(f.database, { env, at: AT });
  assert.equal(status.lastPass.deferred, 3);
  assert.equal(status.lastPass.failed, 0);
  assert.equal(status.state, "deferred");
  for (const deferred of [-1, "3", null]) {
    f.set("last-pass", pass({ deferred }));
    assert.equal(collectArtistKnowledgeStatus(f.database, { env, at: AT }).state, "unavailable");
  }
});

test("corrupt and future telemetry is unavailable rather than invented successful progress", (t) => {
  const f = fixture(t);
  for (const value of ["broken", "[]", pass({ at: AT + 1 }), pass({ filled: -1 }), pass({ checked: "10" }), pass({ storagePaused: "false" }), "x".repeat(5000)]) {
    f.set("last-pass", value);
    const status = collectArtistKnowledgeStatus(f.database, { env, at: AT });
    assert.equal(status.state, "unavailable");
    assert.deepEqual(artistKnowledgeWatchCodes(status), ["artist_knowledge_status_unavailable"]);
  }
  f.set("last-pass", pass()); f.set("cooldown", "not a timestamp");
  assert.equal(collectArtistKnowledgeStatus(f.database, { env, at: AT }).state, "unavailable");
});

test("unavailable database fails closed without leaking exception text", () => {
  const database = { prepare() { throw new Error("database /private/account token secret"); } };
  const status = collectArtistKnowledgeStatus(database, { env, at: AT });
  assert.equal(status.state, "unavailable");
  assert.doesNotMatch(JSON.stringify(status), /private|token|secret/);
  assert.equal(collectArtistKnowledgeStatus(database, { env, at: NaN }).state, "unavailable");
});

test("repeated staff polling bounds ledger scans to one per minute", (t) => {
  const f = fixture(t); f.set("last-pass", pass());
  let reads = 0;
  const database = { prepare(sql) { if (sql.includes("GROUP BY status")) reads++; return f.database.prepare(sql); } };
  collectArtistKnowledgeStatus(database, { env, at: AT });
  collectArtistKnowledgeStatus(database, { env, at: AT + 59_999 });
  assert.equal(reads, 1);
  collectArtistKnowledgeStatus(database, { env, at: AT + 60_000 });
  assert.equal(reads, 2);
});

test("resource, daily budget and owner pause states stay distinct from successful work", t => {
  const f = fixture(t);
  for (const [flag, state] of [["memoryPaused", "memory_paused"], ["capPaused", "growth_paused"],
    ["budgetPaused", "budget_paused"], ["modePaused", "paused"]]) {
    f.set("last-pass", pass({ [flag]: true, lanes: 3 }));
    const status = collectArtistKnowledgeStatus(f.database, { env, at: AT });
    assert.equal(status.state, state); assert.equal(status.lastPass.lanes, 3);
  }
  f.set("last-pass", pass({ capPaused: "yes" }));
  assert.equal(collectArtistKnowledgeStatus(f.database, { env, at: AT }).state, "unavailable");
});
