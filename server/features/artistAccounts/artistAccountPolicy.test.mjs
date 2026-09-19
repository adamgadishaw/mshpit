import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { artistPageName, artistSignupIntent, pendingArtistSignupIntent, ensureArtistAccountSchema } from "./artistAccountPolicy.js";

test("artist signup is a bounded private intent, not arbitrary account authority", () => {
  assert.deepEqual(artistSignupIntent({ artistName: "  Night Room  " }), { artistName: "Night Room" });
  assert.equal(artistSignupIntent(null), null);
  for (const value of [true, [], {}, { artistName: "Night Room", verified: true }, { artistName: "Night\nRoom" }, { artistName: "A" }, { artistName: "https://example.com" }]) {
    assert.throws(() => artistSignupIntent(value), (error) => error.code === "VALIDATION_FAILED");
  }
  assert.equal(artistPageName("Ｎｉｇｈｔ Room"), "Night Room");
  assert.equal(pendingArtistSignupIntent({ pendingArtistIntent: { artistName: "Night Room", role: "admin" } }), null);
  assert.deepEqual(pendingArtistSignupIntent({ pendingArtistIntent: { artistName: "Night Room" } }), { artistName: "Night Room" });
});

test("legacy artist checks require approved ownership evidence and never reappear after revocation", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`CREATE TABLE app_meta (key TEXT PRIMARY KEY,value TEXT);
      CREATE TABLE users (id TEXT PRIMARY KEY,role TEXT,artist_name TEXT,verified INTEGER);
      CREATE TABLE artist_requests (id TEXT PRIMARY KEY,user_id TEXT,artist_name TEXT,status TEXT,created_at INTEGER);
      CREATE TABLE artist_profiles (artist_key TEXT PRIMARY KEY,owner_id TEXT);
      CREATE TABLE moderation_actions (target_type TEXT,target_id TEXT,action TEXT);
      INSERT INTO users VALUES ('approved','artist','First Act',0),('role-only','artist','Second Act',0),
        ('revoked','artist','Third Act',0),('wrong-owner','artist','Fourth Act',0);
      INSERT INTO artist_requests VALUES ('r1','approved','First Act','approved',1),
        ('r2','revoked','Third Act','approved',2),('r3','wrong-owner','Fourth Act','approved',3);
      INSERT INTO artist_profiles VALUES ('first act','approved'),('second act','role-only'),
        ('third act','revoked'),('fourth act','someone-else');
      INSERT INTO moderation_actions VALUES ('user','revoked','remove_verification');`);
    ensureArtistAccountSchema(database, 123);
    const states = Object.fromEntries(database.prepare("SELECT id,verified FROM users").all().map((row) => [row.id, row.verified]));
    assert.deepEqual(states, { approved: 1, "role-only": 0, revoked: 0, "wrong-owner": 0 });
    database.prepare("UPDATE users SET verified=0 WHERE id='approved'").run();
    ensureArtistAccountSchema(database, 456);
    assert.equal(database.prepare("SELECT verified FROM users WHERE id='approved'").get().verified, 0);
  } finally { database.close(); }
});
