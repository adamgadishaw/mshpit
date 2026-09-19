import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artistCatalogVisibleTo, publicArtistCatalogSql } from "./artistCatalogVisibility.js";

const directory = mkdtempSync(join(tmpdir(), "pit-artist-account-visibility-"));
process.env.PIT_DATA_DIR = directory;
const { db, q, artistStmts, artistRow } = await import("./db.js");
const { createPublicDocumentRepository } = await import("./features/seo/publicDocumentRepository.js");
const { createPublicCollectionRepository } = await import("./features/seo/publicCollectionRepository.js");
const { artistSitemapEntries } = await import("./features/seo/sitemapService.js");
const { seoHttpPlan } = await import("./seo.js");
const documents = createPublicDocumentRepository(db);
const collections = createPublicCollectionRepository(db);
const BIO = "A Toronto independent live music project playing original songs and arranging community concert nights with local musicians and touring acts.";
let sequence = 0;

after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

function addUser() {
  const id = `artist_visibility_${++sequence}`;
  q.insertUser.run(id, `${id}@example.com`, id, id, "fixture-hash", "artist", "Toronto", 43.65, -79.38, "AV", "#123456", Date.now());
  return q.userById.get(id);
}

function addPage({ bio = BIO, source = "artist-created" } = {}) {
  const owner = addUser();
  const name = `Visibility Act ${sequence}`;
  const row = artistRow(name.toLowerCase(), { name, rank_score: 1e12 }, source);
  artistStmts.upsert.run(row);
  db.prepare(`INSERT INTO artist_profiles(artist_key,owner_id,bio,feed_enabled,updated_at)
    VALUES(?,?,?,1,?)`).run(row.norm, owner.id, bio, Date.now());
  return { artist: artistStmts.byNorm.get(row.norm), owner };
}

function listed(artist) {
  return artistSitemapEntries(db, { candidates: { posts: [], upcomingEvents: [] } })
    .some(row => row.artistKey === artist.norm);
}

test("an empty self-created page is available but does not enter search indexing or sitemap", () => {
  const { artist } = addPage({ bio: "" });
  assert.equal(artistCatalogVisibleTo(db, artist), true);
  assert.ok(documents.readArtist({ artistKey: artist.norm }));
  assert.equal(listed(artist), false);
  const plan = seoHttpPlan(`/artist/${artist.public_slug}`);
  assert.equal(plan.status, 200);
  assert.equal(plan.indexable, false);
});

test("a substantive public self-created biography joins discovery and sitemap without provider metadata", () => {
  const { artist } = addPage();
  assert.equal(artist.mbid, null);
  assert.equal(artist.bio, null, "authored biography stays in the ownership-scoped profile");
  assert.ok(documents.readHome({ artistLimit: 12 }).artists.some(row => row.norm === artist.norm));
  assert.ok(documents.readDirectory({ kind: "artists", page: 1 }).artists.some(row => row.norm === artist.norm));
  assert.equal(listed(artist), true);
  const plan = seoHttpPlan(`/artist/${artist.public_slug}`);
  assert.equal(plan.indexable, true);
  assert.equal(plan.document.artist.bio, BIO);
});

for (const [label, column, value] of [
  ["banned", "is_banned", 1],
  ["dormant", "dormant_at", 1],
  ["suspended", "suspended_until", Date.now() + 86_400_000],
  ["private", "profile_audience", "only_me"],
  ["members-only", "profile_audience", "members"],
]) test(`self-created ${label} owners disappear from public HTML, discovery, archives and sitemap immediately`, () => {
  const { artist, owner } = addPage();
  db.prepare(`UPDATE users SET ${column}=? WHERE id=?`).run(value, owner.id);
  assert.equal(artistCatalogVisibleTo(db, artist), false);
  assert.equal(documents.readArtist({ artistKey: artist.norm }), null);
  assert.equal(documents.readArtistIdentity({ name: artist.name }), null);
  assert.equal(collections.readArtistConcerts({ artistKey: artist.norm }), null);
  assert.equal(listed(artist), false);
  assert.equal(seoHttpPlan(`/artist/${artist.public_slug}`).status, 404);
  assert.equal(documents.readHome({ artistLimit: 12 }).artists.some(row => row.norm === artist.norm), false);
  assert.equal(documents.readDirectory({ kind: "artists", page: 1 }).artists.some(row => row.norm === artist.norm), false);
});

test("deleted or removed ownership cannot leave a public member-created catalogue shell", () => {
  for (const removed of [false, true]) {
    const { artist } = addPage();
    if (removed) db.prepare("UPDATE artist_profiles SET removed=1 WHERE artist_key=?").run(artist.norm);
    else db.prepare("UPDATE artist_profiles SET owner_id=NULL WHERE artist_key=?").run(artist.norm);
    assert.equal(artistCatalogVisibleTo(db, artist), false);
    assert.equal(documents.readArtist({ artistKey: artist.norm }), null);
    assert.equal(listed(artist), false);
    assert.equal(seoHttpPlan(`/artist/${artist.public_slug}`).status, 404);
  }
});

test("private owners can manage their own page while other members and symmetric blocks stay isolated", () => {
  const { artist, owner } = addPage();
  const viewer = addUser();
  db.prepare("UPDATE users SET profile_audience='only_me' WHERE id=?").run(owner.id);
  assert.equal(artistCatalogVisibleTo(db, artist, owner), true);
  assert.equal(artistCatalogVisibleTo(db, artist, viewer), false);
  db.prepare("UPDATE users SET profile_audience='members' WHERE id=?").run(owner.id);
  assert.equal(artistCatalogVisibleTo(db, artist, viewer), true);
  for (const [blocker, blocked] of [[owner.id, viewer.id], [viewer.id, owner.id]]) {
    db.prepare("INSERT INTO blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)").run(blocker, blocked, Date.now());
    assert.equal(artistCatalogVisibleTo(db, artist, viewer), false);
    db.prepare("DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?").run(blocker, blocked);
  }
});

test("provider catalogue identities remain public after an attached owner is restricted", () => {
  const { artist, owner } = addPage({ source: "musicbrainz" });
  db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(owner.id);
  assert.equal(artistCatalogVisibleTo(db, artist), true);
  assert.ok(documents.readArtist({ artistKey: artist.norm }));
  assert.equal(db.prepare(`SELECT norm FROM artists a WHERE a.norm=? AND ${publicArtistCatalogSql("a")}`).get(artist.norm).norm, artist.norm);
});

test("provider enrichment cannot erase a self-created page's publication boundary", () => {
  const { artist } = addPage();
  artistStmts.upsert.run(artistRow(artist.norm, { name: artist.name, bio: BIO }, "musicbrainz"));
  assert.equal(artistStmts.byNorm.get(artist.norm).source, "artist-created");
  assert.throws(() => publicArtistCatalogSql("a; DROP TABLE users"), /Invalid SQL alias/);
});
