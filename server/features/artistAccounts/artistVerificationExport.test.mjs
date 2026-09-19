import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ensureArtistVerificationSchema } from "./artistVerification.js";
import { exportArtistVerification } from "./artistVerificationExport.js";

test("verification exports are owner-scoped and deleting an account removes its proof records", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE users(id TEXT PRIMARY KEY);
      CREATE TABLE artist_requests(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,created_at INTEGER);
      CREATE TABLE artist_profiles(artist_key TEXT PRIMARY KEY,owner_id TEXT REFERENCES users(id) ON DELETE SET NULL);
      INSERT INTO users VALUES('member'),('other');
      INSERT INTO artist_requests VALUES('request','member',10),('other-request','other',11);
      INSERT INTO artist_profiles VALUES('member band','member'),('other band','other');`);
    ensureArtistVerificationSchema(db);
    const insert = db.prepare(`INSERT INTO artist_verification_challenges
      (id,user_id,artist_key,artist_name,instagram_handle,code,created_at,expires_at,status,request_id)
      VALUES(?,?,?,?,?,?,10,100,'submitted',?)`);
    insert.run("proof", "member", "member band", "Member Band", "member_band", "PRIVATE-CHALLENGE", "request");
    insert.run("other-proof", "other", "other band", "Other Band", "other_band", "OTHER-CODE", "other-request");
    db.exec(`INSERT INTO artist_request_evidence(request_id,method,challenge_id,story_url,reviewed_by)
      VALUES('request','instagram_story','proof','https://www.instagram.com/stories/member_band/12345/','internal-reviewer'),
        ('other-request','instagram_story','other-proof','https://www.instagram.com/stories/other_band/12345/','internal-reviewer');`);
    const result = exportArtistVerification(db, "member");
    assert.equal(result.verificationChallenges.length, 1);
    assert.equal(result.verificationChallenges[0].instagramHandle, "member_band");
    assert.equal(result.verificationEvidence[0].requestId, "request");
    assert.equal(result.identityReviews[0].artistKey, "member band");
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE-CHALLENGE|OTHER-CODE|other_band|internal-reviewer/);
    assert.deepEqual(exportArtistVerification(db, "absent"), { verificationChallenges: [], verificationEvidence: [], identityReviews: [] });
    db.prepare("DELETE FROM users WHERE id=?").run("member");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM artist_request_evidence WHERE request_id='request'").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM artist_verification_challenges WHERE user_id='member'").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM artist_verification_challenges WHERE user_id='other'").get().n, 1);
  } finally { db.close(); }
});
