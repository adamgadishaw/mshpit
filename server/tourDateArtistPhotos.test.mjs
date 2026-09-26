import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createTourDateArtistPhotoReader } from "./tourDateArtistPhotos.js";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY,is_banned INTEGER DEFAULT 0,suspended_until INTEGER,dormant_at INTEGER,
      profile_audience TEXT DEFAULT 'everyone',extras TEXT DEFAULT '{}',role TEXT DEFAULT 'fan',created_at INTEGER DEFAULT 0);
    CREATE TABLE artists (norm TEXT PRIMARY KEY,name TEXT,photo TEXT,data TEXT,source TEXT);
    CREATE TABLE artist_profiles (artist_key TEXT PRIMARY KEY,owner_id TEXT,removed INTEGER DEFAULT 0,identity_review_status TEXT DEFAULT 'clear');`);
  const add = db.prepare("INSERT INTO artists (norm,name,photo,data,source) VALUES (?,?,?,?,?)");
  add.run("idles", "IDLES", "https://cdn-images.dzcdn.net/images/artist/a/500x500.jpg", JSON.stringify({ photoCredit: "Deezer" }), null);
  add.run("hidden", "Hidden", "https://cdn.test/hidden.jpg", JSON.stringify({ photoCredit: "Deezer" }), null);
  add.run("uncredited", "Uncredited", "https://cdn.test/u.jpg", JSON.stringify({}), null);
  add.run("broken", "Broken", "https://cdn.test/b.jpg", "{not json", null);
  add.run("self-made", "Self Made", "https://cdn.test/s.jpg", JSON.stringify({ photoCredit: "Deezer" }), "artist-created");
  add.run("plain", "Plain", "http://cdn.test/p.jpg", JSON.stringify({ photoCredit: "Spotify" }), null);
  db.prepare("INSERT INTO artist_profiles (artist_key,removed) VALUES (?,1)").run("hidden");
  return db;
}

test("Discover range rows borrow only a public, credited catalogue artist photo", () => {
  const db = database();
  try {
    const withPhotos = createTourDateArtistPhotoReader(db);
    const rows = withPhotos(["idles", "hidden", "uncredited", "broken", "self-made", "plain", null]
      .map((artistKey, index) => ({ id: `e${index}`, artistKey })));
    assert.deepEqual(rows[0].artistPhoto, { uri: "https://cdn-images.dzcdn.net/images/artist/a/500x500.jpg", credit: "Deezer" });
    for (const row of rows.slice(1)) assert.equal(row.artistPhoto, undefined, row.artistKey);
    assert.deepEqual(withPhotos([]), []);
  } finally {
    db.close();
  }
});
