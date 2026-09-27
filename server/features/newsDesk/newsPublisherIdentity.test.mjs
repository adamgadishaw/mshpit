import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { NEWS_PUBLISHER_IDENTITY_KEY, resolveNewsPublisher } from "./newsPublisherIdentity.js";

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE app_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE users(id TEXT PRIMARY KEY,handle TEXT UNIQUE,is_banned INTEGER DEFAULT 0,dormant_at INTEGER,suspended_until INTEGER);
    CREATE TABLE posts(id TEXT PRIMARY KEY,user_id TEXT,removed INTEGER DEFAULT 0);
    CREATE TABLE news_stories(id TEXT PRIMARY KEY,post_id TEXT,status TEXT);
    INSERT INTO users(id,handle) VALUES ('publisher','news_mod'),('member','other');`);
  return database;
}
const resolve = (database, env = {}) => resolveNewsPublisher(database, { env, at: 5000 });
function history(database, author = "publisher", suffix = "1", status = "published") {
  database.prepare("INSERT INTO posts(id,user_id,removed) VALUES (?,?,1)").run(`post-${suffix}`, author);
  database.prepare("INSERT INTO news_stories(id,post_id,status) VALUES (?,?,?)").run(`story-${suffix}`, `post-${suffix}`, status);
}

test("a handle alone grants no publishing authority; explicit configuration bootstraps one durable ID", () => {
  const db = fixture();
  try {
    assert.equal(resolve(db).reason, "publisher_not_configured");
    assert.equal(db.prepare("SELECT count(*) n FROM app_meta").get().n, 0);
    assert.deepEqual(resolve(db, { NEWS_DESK_ACCOUNT_ID: "publisher" }), { ok: true, accountId: "publisher" });
    assert.deepEqual(resolve(db), { ok: true, accountId: "publisher" }, "restart needs no mutable handle lookup");
    assert.equal(resolve(db, { NEWS_DESK_ACCOUNT_ID: "member" }).reason, "publisher_config_mismatch");
    assert.equal(JSON.parse(db.prepare("SELECT value FROM app_meta WHERE key=?").get(NEWS_PUBLISHER_IDENTITY_KEY).value).userId, "publisher");
  } finally { db.close(); }
});

test("single historical author including withdrawn posts is trusted after rename, never the replacement handle", () => {
  const db = fixture();
  try {
    history(db, "publisher", "1", "declined");
    db.exec("UPDATE users SET handle='archive_mod' WHERE id='publisher'; UPDATE users SET handle='news_mod' WHERE id='member';");
    assert.deepEqual(resolve(db), { ok: true, accountId: "publisher" });
    assert.equal(JSON.parse(db.prepare("SELECT value FROM app_meta WHERE key=?").get(NEWS_PUBLISHER_IDENTITY_KEY).value).source, "history");
    db.exec("DELETE FROM news_stories; DELETE FROM posts; DELETE FROM users WHERE id='publisher';");
    assert.equal(resolve(db).reason, "publisher_account_unavailable", "deletion cannot transfer the durable identity");
    assert.equal(resolve(db, { NEWS_DESK_ACCOUNT_ID: "member" }).reason, "publisher_config_mismatch");
  } finally { db.close(); }
});

test("ambiguous history or configuration conflicting with history fails closed without a binding", () => {
  const db = fixture();
  try {
    history(db);
    assert.equal(resolve(db, { NEWS_DESK_ACCOUNT_ID: "member" }).reason, "publisher_config_mismatch");
    history(db, "member", "2");
    for (const env of [{}, { NEWS_DESK_ACCOUNT_ID: "publisher" }]) {
      assert.equal(resolve(db, env).reason, "publisher_history_ambiguous");
    }
    assert.equal(db.prepare("SELECT count(*) n FROM app_meta").get().n, 0);
  } finally { db.close(); }
});

test("every resolution rechecks banned, dormant and suspended state without forgetting the bound ID", () => {
  const db = fixture();
  try {
    resolve(db, { NEWS_DESK_ACCOUNT_ID: "publisher" });
    for (const restriction of ["is_banned=1", "dormant_at=1000", "suspended_until=6000"]) {
      db.exec(`UPDATE users SET ${restriction} WHERE id='publisher'`);
      assert.equal(resolve(db).reason, "publisher_account_unavailable");
      db.exec("UPDATE users SET is_banned=0,dormant_at=NULL,suspended_until=NULL WHERE id='publisher'");
      assert.equal(resolve(db).accountId, "publisher");
    }
    db.exec("UPDATE users SET suspended_until=4000 WHERE id='publisher'");
    assert.equal(resolve(db).accountId, "publisher", "expired suspension is not permanent");
  } finally { db.close(); }
});

test("malformed binding and invalid configuration never fall back to a current username", () => {
  const db = fixture();
  try {
    assert.equal(resolve(db, { NEWS_DESK_ACCOUNT_ID: "../../secret" }).reason, "publisher_config_mismatch");
    for (const value of ["bad-json", "{}", JSON.stringify({ version: 1, userId: "publisher", boundAt: -1, source: "history" })]) {
      db.prepare("INSERT INTO app_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(NEWS_PUBLISHER_IDENTITY_KEY, value);
      const result = resolve(db, { NEWS_DESK_ACCOUNT_ID: "publisher" });
      assert.equal(result.reason, "publisher_binding_invalid");
      assert.equal(result.message.includes("../../secret"), false);
    }
  } finally { db.close(); }
});

test("binding composes with publication transactions and rolls back with their owner", () => {
  const db = fixture();
  try {
    db.exec("BEGIN IMMEDIATE");
    assert.equal(resolve(db, { NEWS_DESK_ACCOUNT_ID: "publisher" }).accountId, "publisher");
    db.exec("ROLLBACK");
    assert.equal(db.prepare("SELECT count(*) n FROM app_meta").get().n, 0);
  } finally { db.close(); }
});
