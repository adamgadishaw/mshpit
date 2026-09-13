import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { registerPitSqliteFunctions } from "../server/sqliteFunctions.js";

const SCRIPT = fileURLToPath(new URL("./integrity-check.mjs", import.meta.url));

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "pit-integrity-shared-email-"));
  const databasePath = join(directory, "pit.db");
  const database = new DatabaseSync(databasePath);
  database.exec(`CREATE TABLE users(
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    handle TEXT NOT NULL,
    genres TEXT,
    favorite_artists TEXT,
    extras TEXT,
    created_at INTEGER,
    email_verified_at INTEGER,
    email_verify_hash TEXT,
    email_verify_expires INTEGER
  )`);
  const insert = database.prepare(`INSERT INTO users(
    id,email,handle,genres,favorite_artists,extras,created_at,email_verified_at,
    email_verify_hash,email_verify_expires
  ) VALUES(?,?,?,?,?,?,?,?,?,?)`);
  return { directory, databasePath, database, insert };
}

function run(databasePath) {
  const result = spawnSync(process.execPath, [SCRIPT, databasePath, "--json"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  return { ...result, report: JSON.parse(result.stdout) };
}

function addUser(insert, id, email) {
  insert.run(id, email, id, "[]", "[]", "{}", Date.now(), Date.now(), null, null);
}

test("integrity audit accepts an intentional shared-email pair and rejects account three", () => {
  const state = fixture();
  try {
    addUser(state.insert, "one", "shared@example.test");
    addUser(state.insert, "two", "SHARED@example.test");
    let result = run(state.databasePath);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.report.ok, true);
    assert.equal(result.report.findings.find((entry) => entry.name === "email account limit exceeded")?.count, 0);

    addUser(state.insert, "three", "shared@example.test");
    result = run(state.databasePath);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.report.ok, false);
    assert.equal(result.report.findings.find((entry) => entry.name === "email account limit exceeded")?.count, 1);
  } finally {
    state.database.close();
    rmSync(state.directory, { recursive: true, force: true });
  }
});

test("email capacity uses the same case-and-whitespace normalization as account migration", () => {
  const state = fixture();
  try {
    addUser(state.insert, "one", "shared@example.test");
    addUser(state.insert, "two", "  SHARED@example.test  ");
    assert.equal(run(state.databasePath).status, 0);
    addUser(state.insert, "three", "shared@example.test");
    const result = run(state.databasePath);
    assert.equal(result.status, 1);
    assert.equal(result.report.findings.find((entry) => entry.name === "email account limit exceeded")?.count, 1);
    assert.equal(result.stdout.includes("shared@example.test"), false);
  } finally {
    state.database.close();
    rmSync(state.directory, { recursive: true, force: true });
  }
});

test("text audit labels a zero-count errored check as ERR and prints its sanitized failure note", () => {
  const state = fixture();
  try {
    // The table exists but lacks user_id, forcing this check to fail rather
    // than confusing an unavailable audit with a healthy zero finding count.
    state.database.exec("CREATE TABLE sessions(token_hash TEXT); INSERT INTO sessions VALUES('private-token-hash')");
    const json = run(state.databasePath);
    const finding = json.report.findings.find((entry) => entry.name === "orphan sessions");
    assert.equal(finding?.severity, "error");
    assert.equal(finding?.count, 0);
    const result = spawnSync(process.execPath, [SCRIPT, state.databasePath], { encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /ERR\s+orphan sessions\r?\n\s+check failed \([A-Za-z0-9_]+\)/);
    assert.doesNotMatch(result.stdout, /\bok\s+orphan sessions/);
    assert.equal(result.stdout.includes("private-token-hash"), false);
  } finally {
    state.database.close();
    rmSync(state.directory, { recursive: true, force: true });
  }
});

test("integrity audit catches declared foreign-key violations outside its historical join list", () => {
  const state = fixture();
  try {
    state.database.exec(`PRAGMA foreign_keys=OFF; CREATE TABLE new_account_records(user_id TEXT REFERENCES users(id));
      INSERT INTO new_account_records VALUES('private-missing-account')`);
    const result = run(state.databasePath);
    assert.equal(result.status, 1);
    assert.equal(result.report.findings.find((entry) => entry.name === "SQLite foreign key violations")?.count, 1);
    assert.equal(result.stdout.includes("private-missing-account"), false);
  } finally {
    state.database.close();
    rmSync(state.directory, { recursive: true, force: true });
  }
});

function socialTables(database) {
  database.exec(`CREATE TABLE posts(id TEXT PRIMARY KEY,user_id TEXT,photos TEXT,setlist TEXT,tags TEXT,dims TEXT,
      overall REAL,band REAL,room REAL,date TEXT);
    CREATE TABLE comments(id TEXT PRIMARY KEY,post_id TEXT,user_id TEXT,parent_id TEXT);
    CREATE TABLE likes(post_id TEXT,user_id TEXT);
    CREATE TABLE follows(follower_id TEXT,followee_id TEXT);
    CREATE TABLE notifications(id TEXT PRIMARY KEY,user_id TEXT,actor_id TEXT,type TEXT,post_id TEXT);
    CREATE TABLE post_media(post_id TEXT,asset_id TEXT);
    CREATE TABLE post_user_tags(post_id TEXT,user_id TEXT,author_id TEXT);
    CREATE TABLE media_assets(id TEXT PRIMARY KEY,owner_id TEXT,source_key TEXT);
    CREATE TABLE media_variants(id TEXT PRIMARY KEY,asset_id TEXT,object_key TEXT);
    CREATE TABLE media_objects(object_key TEXT PRIMARY KEY,owner_id TEXT,status TEXT);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,expires_at INTEGER);
    CREATE TABLE linked_account_pairs(user_a_id TEXT,user_b_id TEXT);
    CREATE TABLE linked_account_session_grants(token_hash TEXT,user_a_id TEXT,user_b_id TEXT,expires_at INTEGER);
    INSERT INTO posts(id,user_id,overall) VALUES('post-one','one',4),('post-two','two',4);
    INSERT INTO comments VALUES('parent','post-one','one',NULL);
    INSERT INTO media_objects VALUES('source-key','one','associated');
    INSERT INTO media_assets VALUES('asset-one','one','source-key');
    INSERT INTO media_variants VALUES('variant-one','asset-one','source-key');
    INSERT INTO sessions VALUES('sensitive-token-hash','three',9999999999999);
    INSERT INTO linked_account_pairs VALUES('one','two');`);
}

test("integrity audit catches both ends and cross-account relationships even without foreign keys", () => {
  const state = fixture();
  try {
    for (const id of ["one", "two", "three"]) addUser(state.insert, id, `${id}@example.test`);
    socialTables(state.database);
    state.database.exec(`INSERT INTO comments VALUES('cross-post','post-two','one','parent'),('orphan-author','post-one','missing',NULL);
      INSERT INTO likes VALUES('post-one','missing');
      INSERT INTO follows VALUES('missing','one'),('one','missing');
      INSERT INTO notifications VALUES('n1','missing','one','follow',NULL),('n2','one','missing','follow',NULL);
      INSERT INTO post_media VALUES('post-two','asset-one');
      INSERT INTO post_user_tags VALUES('post-two','one','one');
      INSERT INTO linked_account_session_grants VALUES('sensitive-token-hash','one','two',9999999999999);
      UPDATE media_objects SET owner_id='two' WHERE object_key='source-key';`);
    const result = run(state.databasePath);
    assert.equal(result.status, 1);
    const expected = {
      "orphan comment authors": 1, "orphan like owners": 1,
      "orphan follow endpoints": 2, "orphan notification endpoints": 2,
      "comment reply belongs to another post": 1, "post media ownership mismatch": 1,
      "post tag author mismatch": 1, "media source ledger ownership mismatch": 1,
      "media variant ledger ownership mismatch": 1, "linked grant session owner mismatch": 1,
      "linked pair email mismatch": 1,
    };
    for (const [name, count] of Object.entries(expected)) {
      assert.equal(result.report.findings.find((entry) => entry.name === name)?.count, count, name);
    }
    assert.equal(result.stdout.includes("sensitive-token-hash"), false);
    assert.equal(result.stdout.includes("one@example.test"), false);
  } finally {
    state.database.close();
    rmSync(state.directory, { recursive: true, force: true });
  }
});

test("integrity output identifies capped counts without exposing or modifying records", () => {
  const state = fixture();
  try {
    addUser(state.insert, "one", "one@example.test");
    socialTables(state.database);
    for (let index = 0; index < 24; index++) state.database.prepare("INSERT INTO likes VALUES(?,?)").run("post-one", `private-orphan-${index}`);
    const result = run(state.databasePath);
    const finding = result.report.findings.find((entry) => entry.name === "orphan like owners");
    assert.equal(finding?.count, 20);
    assert.equal(finding?.countCapped, true);
    assert.equal(result.stdout.includes("private-orphan"), false);
    assert.equal(state.database.prepare("SELECT COUNT(*) count FROM likes").get().count, 24);
  } finally {
    state.database.close();
    rmSync(state.directory, { recursive: true, force: true });
  }
});

test("valid linked grants, media ownership, nullable notification actors and expression indexes pass", () => {
  const state = fixture();
  try {
    registerPitSqliteFunctions(state.database);
    addUser(state.insert, "one", "shared@example.test");
    addUser(state.insert, "two", "SHARED@example.test");
    addUser(state.insert, "three", "third@example.test");
    socialTables(state.database);
    state.database.exec(`CREATE INDEX fixture_handle_expression ON users(pit_public_slug(handle));
      UPDATE sessions SET user_id='one';
      INSERT INTO linked_account_session_grants VALUES('sensitive-token-hash','one','two',9999999999999);
      INSERT INTO notifications VALUES('notice','one',NULL,'system',NULL);
      INSERT INTO post_media VALUES('post-one','asset-one');
      INSERT INTO post_user_tags VALUES('post-one','two','one');`);
    const result = run(state.databasePath);
    assert.equal(result.status, 0, result.stdout);
    assert.equal(result.report.ok, true);
    assert.equal(result.report.findings.filter((entry) => entry.severity === "error").length, 0);
    state.database.exec("UPDATE linked_account_session_grants SET expires_at=10000000000000");
    const invalid = run(state.databasePath);
    assert.equal(invalid.status, 1);
    assert.equal(invalid.report.findings.find((entry) => entry.name === "linked grant exceeds session expiry")?.count, 1);
  } finally {
    state.database.close();
    rmSync(state.directory, { recursive: true, force: true });
  }
});
