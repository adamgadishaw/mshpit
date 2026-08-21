import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-seo-visibility-"));
process.env.PIT_DATA_DIR = dataDir;
process.env.PUBLIC_ORIGIN = "https://www.example.com";

const { db, q, normName } = await import("./db.js");
const { metadataFor, resolveEntity, headTagsFor, injectHead, sitemapXml } = await import("./seo.js");
const { artistPath, profilePath, showPath, venuePath } = await import("../src/domain/urls.mjs");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id, handle) {
  q.insertUser.run(id, `${handle}@example.com`, handle, handle, "hash", "fan", null, null, null, "SE", "#111111", Date.now());
  return q.userById.get(id);
}

function addPost(id, userId, { artist, venue, overall, room, createdAt }) {
  db.prepare(`INSERT INTO posts
    (id,user_id,artist,venue,city,date,overall,room,review,photos,photos_public,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,'[]',0,?)`)
    .run(id, userId, artist, venue, "Toronto", "2026-08-20", overall, room, `${artist} review by ${userId}`, createdAt);
}

test("SEO metadata, entity routing, and sitemap exclude restricted authors", () => {
  const active = addUser("u_seo_active", "seoactive");
  const suspended = addUser("u_seo_suspended", "seosuspended");
  const banned = addUser("u_seo_banned", "seobanned");
  db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 60_000, suspended.id);
  db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(banned.id);

  const artist = "SEO Race Band";
  db.prepare(`INSERT OR REPLACE INTO artists
    (norm,name,search_key,genre,photo,bio,popularity,rank_score,data,source,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(normName(artist), artist, "seoraceband", "Rock", null, "A catalogue-owned artist biography.", 10, 10, "{}", "test", 1, 1);
  addPost("seo_active_show", active.id, {
    artist, venue: "SEO Active Hall", overall: 5, room: 5, createdAt: 100,
  });
  addPost("seo_suspended_show", suspended.id, {
    artist, venue: "SEO Suspended Secret Hall", overall: 1, room: 1, createdAt: 200,
  });
  addPost("seo_banned_show", banned.id, {
    artist: "SEO Banned Band", venue: "SEO Banned Hall", overall: 1, room: 1, createdAt: 300,
  });

  assert.equal(metadataFor(profilePath(active.handle))?.kind, "profile");
  assert.equal(metadataFor(profilePath(suspended.handle)), null);
  assert.equal(resolveEntity(profilePath(suspended.handle)), null,
    "the client resolver cannot route to a profile its API would hide");
  assert.equal(metadataFor(profilePath(banned.handle)), null);
  const restrictedHead = headTagsFor(profilePath(suspended.handle));
  assert.match(restrictedHead, /og:type" content="website"/i);
  assert.match(restrictedHead, /PIT - Your life/);
  assert.doesNotMatch(restrictedHead, /reviews live music/i);
  const restrictedShell = injectHead("<html><head><title>Pit</title></head></html>", profilePath(suspended.handle));
  assert.match(restrictedShell, /PIT - Your life/,
    "the static share shell falls back instead of caching restricted identity copy");

  assert.equal(metadataFor(showPath("seo_active_show"))?.kind, "show");
  assert.equal(metadataFor(showPath("seo_suspended_show")), null);
  assert.equal(resolveEntity(showPath("seo_suspended_show")), null);
  assert.equal(metadataFor(showPath("seo_banned_show")), null);
  assert.equal(metadataFor(venuePath("SEO Suspended Secret Hall")), null);
  assert.equal(metadataFor(venuePath("SEO Banned Hall")), null);

  const artistMeta = metadataFor(artistPath(artist));
  assert.match(artistMeta.description, /5\.0\/5 across 1 logged night/i,
    "artist rich metadata counts only active authors");
  assert.doesNotMatch(artistMeta.description, /across 2 logged/i);

  const sitemap = sitemapXml();
  assert.match(sitemap, new RegExp(showPath("seo_active_show")));
  assert.doesNotMatch(sitemap, new RegExp(showPath("seo_suspended_show")));
  assert.doesNotMatch(sitemap, new RegExp(showPath("seo_banned_show")));
  assert.doesNotMatch(sitemap, new RegExp(venuePath("SEO Suspended Secret Hall")));
  assert.doesNotMatch(sitemap, new RegExp(venuePath("SEO Banned Hall")));
});
