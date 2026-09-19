import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { assessArtistIdentityRisk, assertMemberIdentityAllowed, artistIdentityRiskKey } from "./artistIdentityRisk.js";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT,search_key TEXT);
    CREATE INDEX artist_key_lookup ON artists(search_key);
    CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT,verified INTEGER,artist_name TEXT);
    CREATE TABLE artist_profiles(artist_key TEXT PRIMARY KEY,owner_id TEXT,removed INTEGER);
    INSERT INTO artists VALUES('drake','Drake','drake');
    INSERT INTO artists VALUES('other act','Other Act','otheract');`);
  return db;
}

test("catalogue spelling, lookalikes, qualifiers and reviewed aliases are review signals, never ownership", () => {
  const db = fixture();
  try {
    for (const name of ["Drake", "DRAKE", "D.r.a.k.e", "Dráké", "Ｄｒａｋｅ", "Drаke", "Drake Official", "OfficialDrakeVerified", "the_real_Drake"]) {
      const risk = assessArtistIdentityRisk(db, { name });
      assert.equal(risk.requiresReview, true, name);
      assert.equal(risk.matches[0]?.artistKey, "drake", name);
    }
    assert.ok(assessArtistIdentityRisk(db, { name: "Drаke" }).reasons.includes("lookalike_artist_name"));
    assert.equal(assessArtistIdentityRisk(db, { name: "ASAP Rocky" }).requiresReview, true);
    assert.equal(assessArtistIdentityRisk(db, { name: "Russ" }).requiresReview, true);
    assert.equal(assessArtistIdentityRisk(db, { name: "An Independent Ensemble" }).requiresReview, false);
    assert.equal(assessArtistIdentityRisk(db, { name: "New Band Official" }).requiresReview, true);
    assert.equal(artistIdentityRiskKey("Ｄrаké"), "drake");
  } finally { db.close(); }
});

test("same personal names remain usable, protected handles and deceptive display names do not", () => {
  const db = fixture();
  try {
    assert.doesNotThrow(() => assertMemberIdentityAllowed(db, { name: "Drake", handle: "my_concert_diary" }));
    assert.doesNotThrow(() => assertMemberIdentityAllowed(db, { name: "Russ", handle: "russ_fan_diary" }));
    for (const body of [{ handle: "drake" }, { handle: "official_drake" }, { name: "Drаke" }, { name: "Drake Official" }]) {
      assert.throws(() => assertMemberIdentityAllowed(db, body), { status: 409, code: "ARTIST_IDENTITY_REVIEW_REQUIRED" });
    }
  } finally { db.close(); }
});

test("only the stored verified owner has an exemption and it cannot cover another artist", () => {
  const db = fixture();
  try {
    db.exec("INSERT INTO users VALUES('owner','artist',0,'Drake'); INSERT INTO artist_profiles VALUES('drake','owner',0)");
    assert.equal(assessArtistIdentityRisk(db, { handle: "drake", ownerId: "owner" }).requiresReview, true);
    db.exec("UPDATE users SET verified=1 WHERE id='owner'");
    assert.equal(assessArtistIdentityRisk(db, { handle: "drake", ownerId: "owner" }).requiresReview, false);
    assert.equal(assessArtistIdentityRisk(db, { name: "Drake Official", ownerId: "owner" }).requiresReview, false);
    assert.equal(assessArtistIdentityRisk(db, { handle: "other_act", ownerId: "owner" }).requiresReview, true);
    assert.equal(assessArtistIdentityRisk(db, { name: "Unrelated Official", ownerId: "owner" }).requiresReview, true);
    db.exec("UPDATE artist_profiles SET removed=1");
    assert.equal(assessArtistIdentityRisk(db, { handle: "drake", ownerId: "owner" }).requiresReview, true);
  } finally { db.close(); }
});
