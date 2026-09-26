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
  const logged = db.prepare("SELECT action,target_id,reason FROM moderation_actions WHERE action='artist_return_to_catalogue'").get();
  assert.deepEqual({ ...logged }, { action: "artist_return_to_catalogue", target_id: "accidental star", reason });
  assert.equal(nextArtistsForDeezerPhoto(db, { limit: 50 }).some((row) => row.norm === "accidental star"), true,
    "the photo filler can give the artist a picture again");

  await assert.rejects(async () => invoke(admin, "accidental star", { reason }), (error) => error.status === 404,
    "a page with no owner has nothing to return");
});
