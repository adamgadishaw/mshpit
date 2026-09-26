import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "pit-return-to-catalogue-"));
process.env.PIT_DATA_DIR = directory;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { nextArtistsForDeezerPhoto } = await import("./features/artistPhotos/deezerArtistPhotoFill.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

let sequence = 0;
function account(role) {
  const id = `return_${role}_${++sequence}`;
  q.insertUser.run(id, `${id}@example.test`, `Return ${role}`, id, "fixture-hash", role,
    "Toronto", 43.65, -79.38, "RC", "#123456", Date.now());
  return q.userById.get(id);
}
const invoke = (user, key, body) => routes["POST /api/admin/artists/:key/return-to-catalogue"]({
  user, body, query: {}, ip: user.id, params: { key: encodeURIComponent(key) },
});

test("an admin can return a page claimed by mistake to a plain catalogue page", async () => {
  const admin = account("admin");
  const fan = account("fan");
  const seeder = account("admin");
  db.prepare("INSERT INTO artists (norm,name,public_slug,popularity,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run("accidental star", "Accidental Star", "accidental-star", 90, Date.now(), Date.now());
  db.prepare(`INSERT INTO artist_profiles (artist_key,owner_id,bio,avatar_uri,avatar_owner_id,banner,banner_owner_id,feed_enabled,updated_at)
    VALUES (?,?,?,?,?,?,?,1,?)`).run("accidental star", admin.id, "Set up by mistake.",
    "https://media.example.test/avatar.jpg", admin.id, "https://media.example.test/seeded-banner.jpg", seeder.id, Date.now());
  const reason = "Claimed by mistake while testing the artist page editor.";

  await assert.rejects(async () => invoke(fan, "accidental star", { reason }), (error) => error.status === 403);
  await assert.rejects(async () => invoke(admin, "accidental star", { reason: "" }), (error) => error.status === 400);
  assert.equal(nextArtistsForDeezerPhoto(db, { limit: 50 }).some((row) => row.norm === "accidental star"), false,
    "an owner's avatar keeps the photo filler away");

  assert.deepEqual(invoke(admin, "accidental-star", { reason }), { ok: true }, "the public slug works too");
  const page = db.prepare("SELECT * FROM artist_profiles WHERE artist_key=?").get("accidental star");
  assert.equal(page.owner_id, null);
  assert.equal(page.bio, null);
  assert.equal(page.feed_enabled, 0);
  assert.equal(page.avatar_uri, null, "the owner's own photo is removed");
  assert.equal(page.banner, "https://media.example.test/seeded-banner.jpg", "art someone else seeded stays");
  assert.equal(q.userById.get(admin.id).role, "admin", "returning a staff-created page never demotes staff");
  const logged = db.prepare("SELECT action,target_id,reason FROM moderation_actions WHERE action='artist_return_to_catalogue'").get();
  assert.deepEqual({ ...logged }, { action: "artist_return_to_catalogue", target_id: "accidental star", reason });
  assert.equal(nextArtistsForDeezerPhoto(db, { limit: 50 }).some((row) => row.norm === "accidental star"), true,
    "the photo filler can give the artist a picture again");

  await assert.rejects(async () => invoke(admin, "accidental star", { reason }), (error) => error.status === 404,
    "a page with no owner has nothing to return");
});

test("removing an artist owner revokes legacy reclaim, verification and active sessions atomically", async () => {
  const admin = account("admin");
  const owner = account("artist");
  const at = Date.now();
  const key = "revoked fixture";
  db.prepare("UPDATE users SET artist_name='Revoked Fixture',verified=1,email_verified_at=? WHERE id=?").run(at, owner.id);
  db.prepare("INSERT INTO artists(norm,name,public_slug,source,created_at,updated_at) VALUES (?,?,?,'musicbrainz',?,?)")
    .run(key, "Revoked Fixture", "revoked-fixture", at, at);
  db.prepare("INSERT INTO artist_profiles(artist_key,owner_id,feed_enabled,updated_at) VALUES (?,?,1,?)").run(key, owner.id, at);
  q.insertSession.run("revoked-fixture-session", owner.id, at, at + 60_000, "", "");
  db.prepare("INSERT INTO artist_requests(id,user_id,artist_name,status,created_at) VALUES ('revoked-fixture-request',?,'Revoked Fixture','pending',?)")
    .run(owner.id, at);
  db.prepare(`INSERT INTO artist_verification_challenges(id,user_id,artist_key,artist_name,instagram_handle,code,created_at,expires_at,status)
    VALUES ('revoked-fixture-proof',?,?,'Revoked Fixture','fixture','FIXTURE',?,?,'active')`).run(owner.id, key, at, at + 60_000);

  invoke(admin, key, { reason: "Withdraw the mistaken artist ownership." });
  const fresh = q.userById.get(owner.id);
  assert.equal(fresh.role, "fan");
  assert.equal(fresh.artist_name, null);
  assert.equal(fresh.verified, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM sessions WHERE user_id=?").get(owner.id).c, 0);
  assert.equal(db.prepare("SELECT status FROM artist_requests WHERE id='revoked-fixture-request'").get().status, "rejected");
  assert.equal(db.prepare("SELECT status FROM artist_verification_challenges WHERE id='revoked-fixture-proof'").get().status, "revoked");
  await assert.rejects(async () => routes["PATCH /api/artists/:key/profile"]({
    user: fresh, body: { bio: "Attempt to silently reclaim the revoked artist." }, params: { key }, ip: owner.id,
  }), (error) => error.status === 403);
  assert.equal(db.prepare("SELECT owner_id FROM artist_profiles WHERE artist_key=?").get(key).owner_id, null);
});

test("a failed moderation audit rolls back ownership, privilege and session revocation together", () => {
  const admin = account("admin");
  const owner = account("artist");
  const at = Date.now();
  const key = "revocation rollback";
  db.prepare("UPDATE users SET artist_name='Revocation Rollback',verified=1 WHERE id=?").run(owner.id);
  db.prepare("INSERT INTO artists(norm,name,public_slug,created_at,updated_at) VALUES (?,?,?, ?,?)")
    .run(key, "Revocation Rollback", "revocation-rollback", at, at);
  db.prepare("INSERT INTO artist_profiles(artist_key,owner_id,updated_at) VALUES (?,?,?)").run(key, owner.id, at);
  q.insertSession.run("rollback-fixture-session", owner.id, at, at + 60_000, "", "");
  db.exec("CREATE TRIGGER revocation_audit_failure BEFORE INSERT ON moderation_actions WHEN NEW.action='artist_return_to_catalogue' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
  try {
    assert.throws(() => invoke(admin, key, { reason: "Synthetic revocation rollback check." }), /synthetic audit failure/u);
    assert.equal(db.prepare("SELECT owner_id FROM artist_profiles WHERE artist_key=?").get(key).owner_id, owner.id);
    assert.equal(q.userById.get(owner.id).role, "artist");
    assert.equal(q.userById.get(owner.id).verified, 1);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM sessions WHERE user_id=?").get(owner.id).c, 1);
  } finally { db.exec("DROP TRIGGER revocation_audit_failure"); }
});
