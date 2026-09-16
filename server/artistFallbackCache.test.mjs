import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  ARTIST_FALLBACK_CACHE_MAX_ROWS,
  ARTIST_FALLBACK_CACHE_TTL_MS,
  createArtistFallbackCache,
} from "./artistFallbackCache.js";

function database(path = ":memory:") {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS provider_cache (
    key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS artists (name TEXT PRIMARY KEY, data TEXT);
    INSERT OR IGNORE INTO artists VALUES ('Catalogue Fixture','authoritative');`);
  return db;
}

function fixture(context, { clock = () => 1_000 } = {}) {
  const db = database();
  context.after(() => db.close());
  return { db, cache: createArtistFallbackCache(db, { clock }) };
}

const count = (db) => db.prepare("SELECT COUNT(*) n FROM provider_cache WHERE key >= 'dzresolve:v1:' AND key < 'dzresolve:v1;'").get().n;
const insert = (db) => db.prepare("INSERT OR REPLACE INTO provider_cache VALUES (?,?,?,?)");

test("durable recovery survives close/reopen and stores only the exact provider identity", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-fallback-cache-"));
  const path = join(directory, "cache.db");
  let db = database(path);
  try {
    const cache = createArtistFallbackCache(db, { clock: () => 1_000 });
    assert.equal(cache.remember("Durable Fixture", { name: "Durable Fixture", deezerId: 42,
      photo: "https://example.invalid/photo", bio: "must not persist", userId: "private", mbid: "not-authority" }), true);
    assert.deepEqual(JSON.parse(db.prepare("SELECT data FROM provider_cache").get().data), { name: "Durable Fixture", deezerId: "42" });
    db.close();
    db = new DatabaseSync(path);
    const reopened = createArtistFallbackCache(db, { clock: () => 2_000 });
    assert.deepEqual(reopened.get(" durable fixture "), { name: "Durable Fixture", deezerId: "42" });
    assert.deepEqual(db.prepare("SELECT * FROM artists").all().map((row) => ({ ...row })),
      [{ name: "Catalogue Fixture", data: "authoritative" }]);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("normalization preserves Unicode, accents and punctuation without guessed aliases", (context) => {
  const { cache } = fixture(context);
  for (const [name, deezerId] of [["宇多田ヒカル", "42"], ["Zoé", "43"], ["Zoe", "44"], ["A$AP Fixture", "45"]]) {
    assert.equal(cache.remember(name, { name, deezerId }), true);
    assert.equal(cache.get(name).deezerId, deezerId);
  }
  assert.equal(cache.get("ASAP Fixture"), null);
  assert.equal(cache.remember("Ｆｉｘｔｕｒｅ", { name: "Fixture", deezerId: "46" }), true);
  assert.deepEqual(cache.get("fixture"), { name: "Fixture", deezerId: "46" });
  assert.equal(cache.remember("Zoé", { name: "Zoe", deezerId: "44" }), false);
});

test("invalid or mismatched names and IDs cause no writes", (context) => {
  const { db, cache } = fixture(context);
  db.exec("CREATE TRIGGER no_cache_writes BEFORE INSERT ON provider_cache BEGIN SELECT RAISE(ABORT,'unexpected write'); END");
  for (const name of [undefined, null, {}, "", " ", "x".repeat(121), "\u0000bad", "line\nbreak", "\ud800", "\ufb03".repeat(41)]) {
    assert.equal(cache.remember(name, { name, deezerId: "1" }), false);
    assert.equal(cache.get(name), null);
  }
  for (const deezerId of [undefined, null, {}, [], true, 0, -1, 1.5, NaN, Infinity, "", "0", "01", "-1", "+1", " 1", "1 ",
    "1.0", "1e3", "9007199254740992", Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(cache.remember("Fixture", { name: "Fixture", deezerId }), false);
  }
  assert.equal(cache.remember("Fixture", { name: "Different Fixture", deezerId: "1" }), false);
  assert.equal(count(db), 0);
  assert.throws(() => cache.remember("Fixture", { name: "Fixture", deezerId: "1" }), /unexpected write/);
});

test("reads are read-only and the hard 24-hour TTL does not slide", (context) => {
  let at = 1_000;
  const { db, cache } = fixture(context, { clock: () => at });
  assert.equal(cache.remember("Fixture", { name: "Fixture", deezerId: "42" }), true);
  const before = db.prepare("SELECT * FROM provider_cache").get();
  db.exec("PRAGMA query_only=ON");
  at += ARTIST_FALLBACK_CACHE_TTL_MS - 1;
  assert.equal(cache.get("Fixture").deezerId, "42");
  at += 1;
  assert.equal(cache.get("Fixture"), null);
  assert.equal(cache.get("Missing"), null);
  assert.deepEqual(db.prepare("SELECT * FROM provider_cache").get(), before);
  db.exec("PRAGMA query_only=OFF");
  db.prepare("DELETE FROM provider_cache WHERE expires_at<=?").run(at);
  assert.equal(count(db), 0, "the normal provider expiry path can remove these records");
});

test("corrupt, extra-field, mismatched, oversized and invalid-time rows are cache misses", (context) => {
  const { db, cache } = fixture(context);
  const set = insert(db);
  const expiry = 1_000 + ARTIST_FALLBACK_CACHE_TTL_MS;
  const valid = JSON.stringify({ name: "Fixture", deezerId: "42" });
  for (const data of ["{", "null", "[]", "{}", "x".repeat(1_025),
    JSON.stringify({ name: "Different", deezerId: "42" }), JSON.stringify({ name: "Fixture", deezerId: "0" }),
    JSON.stringify({ name: "Fixture", deezerId: "42", userId: "private" })]) {
    set.run("dzresolve:v1:fixture", data, 1_000, expiry);
    assert.equal(cache.get("Fixture"), null);
  }
  for (const [updatedAt, expiresAt] of [[1_001, expiry + 1], [-1, ARTIST_FALLBACK_CACHE_TTL_MS - 1], [1_000, expiry + 1], [1_000, 999]]) {
    set.run("dzresolve:v1:fixture", valid, updatedAt, expiresAt);
    assert.equal(cache.get("Fixture"), null);
  }
  assert.equal(count(db), 1, "invalid cache reads do not clean up or mutate storage");
});

test("namespace cap evicts oldest entries atomically using the bounded recency index", (context) => {
  const { db, cache } = fixture(context, { clock: () => 10_000 });
  const set = insert(db);
  db.exec("BEGIN");
  for (let index = 0; index < ARTIST_FALLBACK_CACHE_MAX_ROWS; index += 1) {
    set.run(`dzresolve:v1:old ${index}`, "{}", index, index + ARTIST_FALLBACK_CACHE_TTL_MS);
  }
  set.run("mbresolve:v1:preserved", "{}", 0, 1);
  set.run("unrelated", "{}", 0, 1);
  db.exec("COMMIT");
  assert.equal(cache.remember("Newest", { name: "Newest", deezerId: "42" }), true);
  assert.equal(count(db), ARTIST_FALLBACK_CACHE_MAX_ROWS);
  assert.equal(db.prepare("SELECT 1 FROM provider_cache WHERE key='dzresolve:v1:old 0'").get(), undefined);
  assert.ok(db.prepare("SELECT 1 FROM provider_cache WHERE key='mbresolve:v1:preserved'").get());
  assert.ok(db.prepare("SELECT 1 FROM provider_cache WHERE key='unrelated'").get());
  assert.equal(cache.remember("Newest", { name: "Newest", deezerId: "43" }), true);
  assert.equal(count(db), ARTIST_FALLBACK_CACHE_MAX_ROWS);
  assert.equal(cache.get("Newest").deezerId, "43");
  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT key FROM provider_cache INDEXED BY idx_provider_cache_deezer_resolution_recency
    WHERE key >= 'dzresolve:v1:' AND key < 'dzresolve:v1;' ORDER BY updated_at DESC,key ASC LIMIT 500 OFFSET 5000`).all();
  assert.match(plan.map((row) => row.detail).join(" "), /idx_provider_cache_deezer_resolution_recency/);
});

test("an oversized externally populated cache cannot force unbounded eviction or a partial write", (context) => {
  const { db, cache } = fixture(context, { clock: () => 10_000 });
  const set = insert(db);
  db.exec("BEGIN");
  for (let index = 0; index < ARTIST_FALLBACK_CACHE_MAX_ROWS + 500; index += 1) {
    set.run(`dzresolve:v1:old ${index}`, "{}", index, index + ARTIST_FALLBACK_CACHE_TTL_MS);
  }
  db.exec("COMMIT");
  assert.equal(cache.remember("Newest", { name: "Newest", deezerId: "42" }), false);
  assert.equal(count(db), ARTIST_FALLBACK_CACHE_MAX_ROWS + 500);
  assert.equal(cache.get("Newest"), null);
  assert.ok(db.prepare("SELECT 1 FROM provider_cache WHERE key='dzresolve:v1:old 0'").get());
  assert.equal(db.isTransaction, false);
});

test("optional read-only cache writes do not fail an otherwise successful lookup", (context) => {
  const { db, cache } = fixture(context);
  cache.remember("Fixture", { name: "Fixture", deezerId: "42" });
  db.exec("PRAGMA query_only=ON");
  assert.equal(cache.remember("Another", { name: "Another", deezerId: "43" }), false);
  assert.equal(cache.get("Fixture").deezerId, "42");
  assert.equal(count(db), 1);
  assert.equal(db.isTransaction, false);
});

test("SQLite storage pressure is optional but corruption and schema errors surface", (context) => {
  const db = database();
  context.after(() => db.close());
  let failure;
  const wrapped = {
    exec: (sql) => db.exec(sql),
    get isTransaction() { return db.isTransaction; },
    prepare(sql) {
      const statement = db.prepare(sql);
      return sql.startsWith("INSERT") ? { run() { throw failure; } } : statement;
    },
  };
  const cache = createArtistFallbackCache(wrapped, { clock: () => 1_000 });
  for (const errcode of [5, 6, 8, 13, 261, 264]) {
    failure = Object.assign(new Error("private sqlite details"), { code: "ERR_SQLITE_ERROR", errcode });
    assert.equal(cache.remember("Fixture", { name: "Fixture", deezerId: "42" }), false);
    assert.equal(db.isTransaction, false);
  }
  for (const errcode of [1, 11, 26]) {
    failure = Object.assign(new Error("private sqlite details"), { code: "ERR_SQLITE_ERROR", errcode });
    assert.throws(() => cache.remember("Fixture", { name: "Fixture", deezerId: "42" }), (error) => error === failure);
    assert.equal(db.isTransaction, false);
  }
  assert.equal(count(db), 0);
});

test("read-only initialization retains reads without enabling unindexed cache writes", (context) => {
  const db = database();
  context.after(() => db.close());
  insert(db).run("dzresolve:v1:fixture", JSON.stringify({ name: "Fixture", deezerId: "42" }), 1_000,
    1_000 + ARTIST_FALLBACK_CACHE_TTL_MS);
  db.exec("PRAGMA query_only=ON");
  const cache = createArtistFallbackCache(db, { clock: () => 1_000 });
  assert.equal(cache.get("Fixture").deezerId, "42");
  db.exec("PRAGMA query_only=OFF");
  assert.equal(cache.remember("Another", { name: "Another", deezerId: "43" }), false);
  assert.equal(count(db), 1);
});

test("a failed eviction rolls back its cache write without rolling back an outer transaction", (context) => {
  const db = database();
  context.after(() => db.close());
  const wrapped = {
    exec: (sql) => db.exec(sql),
    get isTransaction() { return db.isTransaction; },
    prepare(sql) {
      const statement = db.prepare(sql);
      return sql.startsWith("DELETE") ? { run() {
        throw Object.assign(new Error("disk full"), { code: "ERR_SQLITE_ERROR", errcode: 13 });
      } } : statement;
    },
  };
  const cache = createArtistFallbackCache(wrapped, { clock: () => 1_000 });
  db.exec("BEGIN; INSERT INTO artists VALUES('Outer transaction','preserved')");
  assert.equal(cache.remember("Fixture", { name: "Fixture", deezerId: "42" }), false);
  assert.equal(count(db), 0);
  assert.equal(db.isTransaction, true);
  assert.equal(db.prepare("SELECT data FROM artists WHERE name='Outer transaction'").get().data, "preserved");
  db.exec("ROLLBACK");
});
