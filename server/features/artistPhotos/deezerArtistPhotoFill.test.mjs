import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { dominantNamesake, runDeezerPhotoPass, usableDeezerPicture } from "./deezerArtistPhotoFill.js";

const PIC = (hash) => `https://cdn-images.dzcdn.net/images/artist/${hash}/1000x1000-000000-80-0-0.jpg`;
const NOW = Date.parse("2026-09-25T12:00:00Z");

function world(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT,photo TEXT,source TEXT,popularity INTEGER,data TEXT,updated_at INTEGER);
    CREATE TABLE artist_profiles(artist_key TEXT,removed INTEGER DEFAULT 0,avatar_uri TEXT);
    CREATE TABLE tour_dates(id TEXT,artist_key TEXT,date TEXT);`);
  const add = (norm, name, extra = {}) => db.prepare("INSERT INTO artists VALUES (?,?,?,?,?,?,?)")
    .run(norm, name, extra.photo || null, extra.source || "musicbrainz", extra.popularity ?? 80, extra.data || "{}", 1);
  return { db, add };
}

test("only real pictures and a clearly dominant exact namesake are used", () => {
  assert.equal(usableDeezerPicture(PIC("eb0ed5b21d1ea5af021fc074ded0e91f")), PIC("eb0ed5b21d1ea5af021fc074ded0e91f"));
  assert.equal(usableDeezerPicture("https://cdn-images.dzcdn.net/images/artist//1000x1000-000000-80-0-0.jpg"), null, "the blank placeholder");
  assert.equal(usableDeezerPicture("https://evil.example/images/artist/eb0ed5b21d1ea5af021fc074ded0e91f/1.jpg"), null);
  const drakes = [{ name: "Drake", nb_fan: 161 }, { name: "Drake", nb_fan: 24_090_882 }, { name: "Drake", nb_fan: 115 }];
  assert.equal(dominantNamesake(drakes, "Drake").nb_fan, 24_090_882);
  assert.equal(dominantNamesake([{ name: "Twin", nb_fan: 5000 }, { name: "Twin", nb_fan: 4000 }], "Twin"), null, "two real acts share the name");
  assert.equal(dominantNamesake([{ name: "Coldplay Piano Covers", nb_fan: 661 }], "Coldplay"), null, "not an exact name");
  assert.equal(dominantNamesake([{ name: "Tiny", nb_fan: 12 }], "Tiny"), null, "no established audience");
});

test("a pass fills safe matches, marks misses, and never overwrites", async (t) => {
  const { db, add } = world(t);
  add("drake", "Drake");
  add("twin", "Twin");
  add("owned", "Owned");
  add("has photo", "Has Photo", { photo: "https://example.test/p.jpg" });
  add("self made", "Self Made", { source: "artist-created" });
  db.prepare("INSERT INTO artist_profiles VALUES ('owned',0,'https://example.test/avatar.jpg')").run();
  const lookups = [];
  const fetchJson = async (url) => {
    const name = decodeURIComponent(new URL(url).searchParams.get("q"));
    lookups.push(name);
    if (name === "Drake") return { data: [{ id: 246791, name: "Drake", nb_fan: 24_090_882, picture_xl: PIC("eb0ed5b21d1ea5af021fc074ded0e91f") }] };
    return { data: [{ name, nb_fan: 5000, picture_xl: PIC("aaaabbbbccccddddeeeeffff00001111") }, { name, nb_fan: 4000 }] };
  };
  const result = await runDeezerPhotoPass(db, { fetchJson, at: NOW });
  assert.deepEqual(lookups.sort(), ["Drake", "Twin"], "owner avatars, existing photos and self-made artists are skipped");
  assert.deepEqual(result, { checked: 2, filled: 1, noMatch: 1 });
  const drake = db.prepare("SELECT photo,data FROM artists WHERE norm='drake'").get();
  assert.equal(drake.photo, PIC("eb0ed5b21d1ea5af021fc074ded0e91f"));
  assert.equal(JSON.parse(drake.data).photoCredit, "Deezer");
  assert.equal(db.prepare("SELECT photo FROM artists WHERE norm='twin'").get().photo, null);
  assert.equal((await runDeezerPhotoPass(db, { fetchJson, at: NOW + 60_000 })).checked, 0, "a miss is not retried for two weeks");
});

test("a stored Deezer id is looked up directly and must still carry the artist's name", async (t) => {
  const { db, add } = world(t);
  add("coldplay", "Coldplay", { data: JSON.stringify({ deezerId: 892 }) });
  add("renamed", "Renamed", { data: JSON.stringify({ deezerId: 555 }) });
  const urls = [];
  const fetchJson = async (url) => {
    urls.push(url);
    if (url.endsWith("/artist/892")) return { id: 892, name: "Coldplay", nb_fan: 12_000_000, picture_xl: PIC("c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0") };
    if (url.endsWith("/artist/555")) return { id: 555, name: "Somebody Else", nb_fan: 90_000, picture_xl: PIC("5555555555555555aaaaaaaaaaaaaaaa") };
    throw new Error(`unexpected ${url}`);
  };
  const result = await runDeezerPhotoPass(db, { fetchJson, at: NOW });
  assert.deepEqual(result, { checked: 2, filled: 1, noMatch: 1 });
  assert.equal(urls.some((url) => url.includes("/search/")), false, "no name search when the id is known");
  assert.equal(db.prepare("SELECT photo FROM artists WHERE norm='coldplay'").get().photo, PIC("c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0"));
  assert.equal(db.prepare("SELECT photo FROM artists WHERE norm='renamed'").get().photo, null);
});

test("an artist whose page shows a Spotify photo gets a Discover-only Deezer image", async (t) => {
  const { db, add } = world(t);
  const spotify = { deezerId: 246791, spotifyId: "3TVXtAsR1Inumwj472S9r4", spotifyPhoto: "https://i.scdn.co/image/ab6761610000e5eb0000", photoSource: "spotify", photoCredit: "Spotify" };
  add("drake", "Drake", { data: JSON.stringify(spotify) });
  const fetchJson = async () => ({ id: 246791, name: "Drake", nb_fan: 24_090_882, picture_xl: PIC("eb0ed5b21d1ea5af021fc074ded0e91f") });
  assert.deepEqual(await runDeezerPhotoPass(db, { fetchJson, at: NOW }), { checked: 1, filled: 1, noMatch: 0 });
  const drake = db.prepare("SELECT photo,data FROM artists WHERE norm='drake'").get();
  const data = JSON.parse(drake.data);
  assert.equal(drake.photo, null, "the artist page keeps its Spotify photo");
  assert.deepEqual(data.discoverPhoto, { uri: PIC("eb0ed5b21d1ea5af021fc074ded0e91f"), credit: "Deezer" });
  assert.equal(data.photoSource, "spotify");
  assert.equal(data.photoCredit, "Spotify");
  assert.equal(data.spotifyPhoto, spotify.spotifyPhoto);
});

test("a legacy Spotify URL in the photo column still gets a Discover-only image and is kept", async (t) => {
  const { db, add } = world(t);
  const legacy = "https://i.scdn.co/image/ab6761610000e5eb1111";
  add("coldplay", "Coldplay", { photo: legacy, data: JSON.stringify({ deezerId: 892, photoCredit: "Spotify" }) });
  const fetchJson = async () => ({ id: 892, name: "Coldplay", nb_fan: 12_000_000, picture_xl: PIC("c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0") });
  assert.deepEqual(await runDeezerPhotoPass(db, { fetchJson, at: NOW }), { checked: 1, filled: 1, noMatch: 0 });
  const row = db.prepare("SELECT photo,data FROM artists WHERE norm='coldplay'").get();
  assert.equal(row.photo, legacy, "the artist page's Spotify image is left alone");
  assert.deepEqual(JSON.parse(row.data).discoverPhoto, { uri: PIC("c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0"), credit: "Deezer" });
});
