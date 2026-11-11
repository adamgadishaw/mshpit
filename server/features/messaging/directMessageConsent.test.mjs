import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { directMessageConsentFor, ensureDirectMessageConsentSchema } from "./directMessageConsent.js";

function legacyDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE follows(follower_id TEXT,followee_id TEXT,PRIMARY KEY(follower_id,followee_id));
    CREATE TABLE dms(id TEXT PRIMARY KEY,from_id TEXT,to_id TEXT,text TEXT,removed INTEGER DEFAULT 0,created_at INTEGER);
    INSERT INTO users VALUES ('a'),('b'),('c'),('d'),('e');
    INSERT INTO dms VALUES ('one','a','b','unchanged',0,10),('two','c','b','also unchanged',0,20);
    INSERT INTO follows VALUES ('b','c'),('d','e');`);
  return db;
}

test("migration preserves only the viewer's own existing consent evidence", () => {
  const db = legacyDatabase();
  try {
    const original = db.prepare("SELECT * FROM dms ORDER BY id").all();
    db.exec("BEGIN IMMEDIATE");
    ensureDirectMessageConsentSchema(db, 100);
    db.exec("COMMIT");
    assert.equal(directMessageConsentFor(db, "a", "b").requestState, "accepted", "authored history is durable consent");
    assert.equal(directMessageConsentFor(db, "b", "a").requestState, "pending", "receiving alone is not consent");
    assert.equal(directMessageConsentFor(db, "b", "c").requestState, "accepted", "existing followed conversation keeps its inbox classification");
    assert.equal(directMessageConsentFor(db, "d", "e").requestState, "none", "following without a conversation cannot invent one");
    assert.deepEqual(db.prepare("SELECT * FROM dms ORDER BY id").all(), original);
    db.exec("DELETE FROM follows WHERE follower_id='b' AND followee_id='c'");
    ensureDirectMessageConsentSchema(db, 200);
    assert.equal(directMessageConsentFor(db, "b", "c").requestState, "accepted", "restart/unfollow does not erase already established acceptance");
    assert.equal(db.prepare("SELECT accepted_at FROM dm_acceptances WHERE user_id='b' AND other_id='c'").get().accepted_at, 100);
  } finally { db.close(); }
});

test("legacy writes participate atomically and later follows preserve consent", () => {
  const db = legacyDatabase();
  try {
    ensureDirectMessageConsentSchema(db);
    db.exec("BEGIN");
    db.exec("INSERT INTO dms VALUES ('rolled','d','a','failed transaction',0,30)");
    db.exec("ROLLBACK");
    assert.equal(directMessageConsentFor(db, "d", "a").requestState, "none");
    db.exec("INSERT INTO dms VALUES ('new','d','e','first contact',0,40)");
    assert.equal(directMessageConsentFor(db, "d", "e").requestState, "accepted");
    assert.equal(directMessageConsentFor(db, "e", "d").requestState, "pending");
    db.exec("INSERT INTO follows VALUES ('e','d')");
    assert.equal(directMessageConsentFor(db, "e", "d").requestState, "accepted");
    db.exec("DELETE FROM follows WHERE follower_id='e' AND followee_id='d'");
    db.exec("UPDATE dms SET removed=1 WHERE id='new'");
    assert.equal(directMessageConsentFor(db, "e", "d").requestState, "accepted");
    db.exec("DELETE FROM users WHERE id='e'");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM dm_acceptances WHERE user_id='e' OR other_id='e'").get().n, 0);
  } finally { db.close(); }
});
