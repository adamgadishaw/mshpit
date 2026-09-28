import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { publicArtistPhoto } from "../../artistPhotoCatalog.js";
import { photoCreditPathFromArtwork } from "../../photoCredits.js";
import { NEWS_ILLUSTRATION_ARTWORK, NEWS_ILLUSTRATION_CONTEXT } from "../../newsIllustration.js";
import { createNewsCardArtworkResolver } from "./newsCardArtwork.js";

const MBID = "d8fd8d9b-473b-4f06-83c8-869b1bb9de89";
const ENV = { MEDIA_PUBLIC_BASE_URL: "https://media.mshpit.test/public" };
const EMPTY = { fallbackArtwork: [], artworkContext: "" };
const ILLUSTRATED = { fallbackArtwork: [NEWS_ILLUSTRATION_ARTWORK], artworkContext: NEWS_ILLUSTRATION_CONTEXT };
const STORY = { artists: [{ key: "bryson tiller", name: "Untrusted stale name", photo: "https://i.scdn.co/image/not-exportable" }] };
function fixture(t) {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec("CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT,mbid TEXT)");
  database.prepare("INSERT INTO artists VALUES (?,?,?)").run("bryson tiller", "Bryson Tiller", MBID);
  return database;
}
function registeredPhoto() {
  const photo = publicArtistPhoto("bryson tiller", { artistMbid: MBID, mediaPublicBaseUrl: ENV.MEDIA_PUBLIC_BASE_URL });
  assert.ok(photo?.creditPath, "use the existing rights-reviewed renderer fixture");
  return photo;
}

test("news artwork uses a fresh exact database identity and a registered licensed photo", t => {
  const database = fixture(t);
  const calls = [];
  const resolve = createNewsCardArtworkResolver({ database, env: ENV, resolvePhoto: (key, options) => {
    calls.push([key, options]);
    return publicArtistPhoto(key, options);
  } });
  const result = resolve(STORY);
  assert.equal(result.artworkContext, "Artist photo: Bryson Tiller");
  assert.equal(result.fallbackArtwork.length, 2);
  assert.deepEqual(result.fallbackArtwork[1], NEWS_ILLUSTRATION_ARTWORK);
  const photo = registeredPhoto(), art = result.fallbackArtwork[0];
  assert.equal(art.url, photo.uri);
  assert.equal(art.source, "licensed-media");
  for (const key of ["title", "creator", "license", "licenseUrl", "sourcePage", "modificationNotice", "creditPath", "focalPoint"]) assert.deepEqual(art[key], photo[key]);
  assert.equal(photoCreditPathFromArtwork(art), photo.creditPath);
  assert.deepEqual(calls, [["bryson tiller", { artistMbid: MBID, mediaPublicBaseUrl: ENV.MEDIA_PUBLIC_BASE_URL }]]);
  for (const key of ["BRYSON TILLER", "bryson tiller tribute", "bryson tiller "]) assert.deepEqual(resolve({ artists: [{ key }] }), ILLUSTRATED);
});

test("news artwork rechecks canonical identity and never keeps stale artwork after identity removal or reassignment", t => {
  const database = fixture(t);
  const resolve = createNewsCardArtworkResolver({ database, env: ENV });
  assert.equal(resolve(STORY).fallbackArtwork.length, 2);
  for (const mbid of ["11111111-1111-4111-8111-111111111111", null, "bad-id"]) {
    database.prepare("UPDATE artists SET mbid=?").run(mbid);
    assert.deepEqual(resolve(STORY), ILLUSTRATED);
  }
  database.prepare("UPDATE artists SET mbid=?").run(MBID);
  assert.equal(resolve(STORY).fallbackArtwork.length, 2);
  database.exec("DELETE FROM artists");
  assert.deepEqual(resolve(STORY), ILLUSTRATED);
});

test("news artwork scans at most three exact keys and labels only the first valid artist", t => {
  const database = fixture(t);
  for (const key of ["first", "second", "third"]) database.prepare("INSERT INTO artists VALUES (?,?,?)").run(key, key, MBID);
  let lookups = 0;
  const observed = { prepare: sql => { const statement = database.prepare(sql); return { get: key => { lookups += 1; return statement.get(key); } }; } };
  const resolve = createNewsCardArtworkResolver({ database: observed, env: ENV });
  assert.deepEqual(resolve({ artists: ["first", "second", "third", "bryson tiller"].map(key => ({ key })) }), ILLUSTRATED);
  assert.equal(lookups, 3);
  lookups = 0;
  const result = resolve({ artists: [{ key: "first" }, ...STORY.artists, { key: "third" }] });
  assert.equal(lookups, 2);
  assert.equal(result.fallbackArtwork.length, 2);
  assert.equal(result.artworkContext, "Artist photo: Bryson Tiller");
  assert.deepEqual(createNewsCardArtworkResolver({ database, env: ENV, resolvePhoto: registeredPhoto })({ artists: [{ key: "first" }] }), ILLUSTRATED,
    "another artist cannot borrow a real registered portrait");
});

test("news artwork rejects untrusted delivery, incomplete or conflicting credits, and client image fields", t => {
  const database = fixture(t);
  const photo = registeredPhoto();
  for (const override of [
    { uri: photo.uri.replace("https://media.mshpit.test", "https://evil.test") },
    { uri: "https://i.scdn.co/image/provider" }, { uri: "https://cdn-images.dzcdn.net/images/artist/provider" },
    { uri: photo.uri.replace("https:", "http:") }, { uri: "https://media.mshpit.test/private/image.webp" },
    { title: "" }, { licenseUrl: "" }, { creator: "Someone else" }, { sourcePage: "https://evil.test/forged-credit" },
  ]) assert.deepEqual(createNewsCardArtworkResolver({ database, env: ENV, resolvePhoto: () => ({ ...photo, ...override }) })(STORY), ILLUSTRATED);
  assert.deepEqual(createNewsCardArtworkResolver({ database, env: {} })(STORY), ILLUSTRATED, "no trusted public media base means only the bundled illustration");
  assert.deepEqual(createNewsCardArtworkResolver({ database, env: ENV })({ artists: [], image: photo.uri, fallbackArtwork: [photo] }), ILLUSTRATED);
  assert.deepEqual(createNewsCardArtworkResolver({ database, env: ENV, resolvePhoto: () => { throw new Error("private detail"); } })(STORY), ILLUSTRATED);
  assert.deepEqual(createNewsCardArtworkResolver()({ artists: STORY.artists }), ILLUSTRATED);
  for (const invalid of [null, undefined, [], "news", 1]) assert.deepEqual(createNewsCardArtworkResolver({ database, env: ENV })(invalid), EMPTY);
});
