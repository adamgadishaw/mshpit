import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { spotifyArtistPhotoModel } from "../src/domain/spotifyArtistPhoto.mjs";

const directory = mkdtempSync(join(tmpdir(), "pit-artist-profile-read-"));
process.env.PIT_DATA_DIR = directory;
const { db, artistRow, artistStmts, q } = await import("./db.js");
const { routes } = await import("./api.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

const name = "Profile Cache Fixture";
const key = "profile cache fixture";
const read = (reference, user = null) => routes["GET /api/artists/:key/profile"]({
  user, ip: "artist-profile-read-test", params: { key: encodeURIComponent(reference) }, setHeader() {},
});

test("opening a stored artist returns its current catalog metadata with zero provider calls", () => {
  artistStmts.upsert.run(artistRow(key, { name, bio: "Stored biography", photo: "https://images.example.org/artist.jpg" }, "test"));
  const row = artistStmts.byNorm.get(key);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("Profile reads must stay local"); };
  try {
    for (const reference of [name, key, row.public_slug]) {
      const response = read(reference);
      assert.equal(response.artist.key, key);
      assert.equal(response.artist.publicSlug, row.public_slug);
      assert.equal(response.artist.bio, "Stored biography");
      assert.equal(response.legacyProfile, false);
      assert.deepEqual(response.posts, []);
    }
    db.prepare("UPDATE artists SET bio=? WHERE norm=?").run("Fresh background biography", key);
    assert.equal(read(key).artist.bio, "Fresh background biography", "profile refresh does not retain an old search snapshot");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("blocked owner overrides stay hidden while public catalog metadata remains available", () => {
  for (const id of ["profile-read-owner", "profile-read-viewer"]) {
    q.insertUser.run(id, `${id}@example.com`, id, id, "test-hash", "fan", "Toronto", 43.65, -79.38, "PR", "#123456", Date.now());
  }
  db.prepare("INSERT INTO artist_profiles(artist_key,owner_id,bio,feed_enabled,updated_at) VALUES(?,?,?,?,?)")
    .run(key, "profile-read-owner", "Blocked owner biography", 1, Date.now());
  db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)")
    .run("profile-read-viewer", "profile-read-owner", Date.now());
  const response = read(key, q.userById.get("profile-read-viewer"));
  assert.equal(response.artist.key, key);
  assert.equal(response.artist.bio, "Fresh background biography");
  assert.equal(response.profile, null);
  assert.deepEqual(response.posts, []);
});

test("the local profile snapshot preserves trusted Spotify attribution without exposing generic crop fields", () => {
  const spotifyId = "1234567890ABCDEFGHIJKL";
  const spotifyPhoto = "https://i.scdn.co/image/trusted123";
  const photoKey = "spotify profile snapshot fixture";
  artistStmts.upsert.run(artistRow(photoKey, {
    name: "Spotify Profile Snapshot Fixture", spotifyId, spotifyPhoto, photo: spotifyPhoto,
    photoSource: "spotify", photoCredit: "Spotify", photoDisplayPolicy: "original",
  }, "test"));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("Profile reads must stay local"); };
  try {
    const { artist } = read(photoKey);
    assert.equal(artist.photo, null, "Spotify imagery cannot enter a generic cropped/avatar path");
    assert.deepEqual(spotifyArtistPhotoModel(artist), {
      uri: spotifyPhoto, sourceUrl: `https://open.spotify.com/artist/${spotifyId}`, credit: "Spotify",
    });
    db.prepare("UPDATE artists SET photo=NULL,data=? WHERE norm=?").run(JSON.stringify({
      photoSource: "spotify", spotifyPhoto: "https://attacker.example/image/trusted123",
      photoCredit: "Spotify", photoDisplayPolicy: "original",
    }), photoKey);
    assert.equal(spotifyArtistPhotoModel(read(photoKey).artist), null,
      "an untrusted stored image never becomes renderable attributed Spotify imagery");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});
