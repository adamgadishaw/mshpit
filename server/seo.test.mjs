import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-seo-visibility-"));
process.env.PIT_DATA_DIR = dataDir;
process.env.PUBLIC_ORIGIN = "https://www.example.com";

const { db, q, normName } = await import("./db.js");
const { metadataFor, resolveEntity, headTagsFor, injectHead, sitemapXml, sitemapForPath, seoHttpPlan } = await import("./seo.js");
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
    (id,user_id,artist,venue,venue_key,city,date,overall,room,review,photos,photos_public,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,'[]',0,?)`)
    .run(id, userId, artist, venue, normName(venue), "Toronto", "2026-08-20", overall, room,
      `${artist} review by ${userId}, with enough first-hand detail to be useful.`, createdAt);
}

test("SEO metadata, entity routing, and sitemap exclude restricted authors", () => {
  const active = addUser("u_seo_active", "seoactive");
  const suspended = addUser("u_seo_suspended", "seosuspended");
  const banned = addUser("u_seo_banned", "seobanned");
  db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 60_000, suspended.id);
  db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(banned.id);

  const artist = "SEO Race Band";
  db.prepare(`INSERT OR REPLACE INTO artists
    (norm,name,public_slug,search_key,genre,photo,bio,popularity,rank_score,data,source,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(normName(artist), artist, "seo-race-band", "seoraceband", "Rock", null,
      "A catalogue-owned artist biography with enough original detail for a useful public discovery page and live-review context.",
      10, 10, "{}", "test", 1, 1);
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
  assert.match(restrictedHead, /Mshpit — Your life/);
  assert.doesNotMatch(restrictedHead, /reviews live music/i);
  const restrictedShell = injectHead("<html><head><title>Pit</title></head></html>", profilePath(suspended.handle));
  assert.match(restrictedShell, /Mshpit — Your life/,
    "the static share shell falls back instead of caching restricted identity copy");

  assert.equal(metadataFor(showPath("seo_active_show"))?.kind, "show");
  assert.equal(metadataFor(showPath("seo_suspended_show")), null);
  assert.equal(resolveEntity(showPath("seo_suspended_show")), null);
  assert.equal(metadataFor(showPath("seo_banned_show")), null);
  assert.equal(metadataFor(venuePath("SEO Suspended Secret Hall")), null);
  assert.equal(metadataFor(venuePath("SEO Banned Hall")), null);

  const artistMeta = metadataFor(artistPath(artist));
  assert.match(artistMeta.description, /catalogue-owned artist biography/i);
  const artistShell = injectHead("<html><head><title>Pit</title></head><body><div id=\"root\"></div></body></html>", artistPath(artist));
  assert.match(artistShell, /Fan reviews<\/dt><dd>1<\/dd>/,
    "artist aggregates count only active authors");
  assert.doesNotMatch(artistShell, /SEO Suspended Secret Hall|SEO Banned Hall/);

  assert.match(sitemapXml(), /sitemapindex/);
  const postSitemap = sitemapForPath("/sitemaps/posts.xml");
  assert.match(postSitemap, new RegExp(showPath("seo_active_show")));
  assert.doesNotMatch(postSitemap, new RegExp(showPath("seo_suspended_show")));
  assert.doesNotMatch(postSitemap, new RegExp(showPath("seo_banned_show")));
  assert.equal(seoHttpPlan(profilePath(suspended.handle)).status, 404);
});

test("profile share metadata drops legacy user-hosted images but keeps catalog provider art", () => {
  const user = addUser("u_seo_legacy_media", "seolegacymedia");
  const attackerUrl = "https://attacker.example/tracking-avatar.jpg";
  db.prepare("UPDATE users SET avatar_uri=? WHERE id=?").run(attackerUrl, user.id);

  const profile = metadataFor(profilePath(user.handle));
  assert.equal(profile.image, null);
  assert.doesNotMatch(headTagsFor(profilePath(user.handle)), /attacker\.example/i);

  addPost("seo_legacy_media_show", user.id, {
    artist: "Legacy Media Artist", venue: "Legacy Media Hall", overall: 4, room: 4, createdAt: 400,
  });
  db.prepare("UPDATE posts SET photos=?,photos_public=1 WHERE id=?")
    .run(JSON.stringify([attackerUrl]), "seo_legacy_media_show");
  const show = metadataFor(showPath("seo_legacy_media_show"));
  assert.equal(show.image, null);
  assert.equal(show.show.photos, undefined, "metadata objects do not retain the untrusted storage column");
  assert.doesNotMatch(headTagsFor(showPath("seo_legacy_media_show")), /attacker\.example/i);

  const artist = "Provider Image Artist";
  const providerImage = "https://catalog-provider.example/artist.jpg";
  db.prepare(`INSERT OR REPLACE INTO artists
    (norm,name,public_slug,search_key,genre,photo,bio,popularity,rank_score,data,source,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(normName(artist), artist, "provider-image-artist", "providerimageartist", "Rock", providerImage,
      "Provider-authored catalog biography with enough original context to make this artist page substantive for live music discovery.",
      10, 10, "{}", "test", 1, 1);
  assert.equal(metadataFor(artistPath({ name: artist, publicSlug: "provider-image-artist" })).image, null,
    "unverified external provider art is not republished as user-controlled page media");
  assert.match(headTagsFor(artistPath({ name: artist, publicSlug: "provider-image-artist" })), /https:\/\/www\.example\.com\/og\.png/);
});

test("public route policy redirects legacy identities and fails unknown or malformed paths closed", () => {
  assert.deepEqual(
    { type: seoHttpPlan("/seo-race-band").type, location: seoHttpPlan("/seo-race-band").location },
    { type: "redirect", location: "/artist/seo-race-band" },
  );
  assert.equal(seoHttpPlan("/show/seo_active_show").location, "/post/seo_active_show");
  assert.equal(seoHttpPlan("/search").type, "app");
  assert.equal(seoHttpPlan("/does-not-exist/extra").status, 404);
  assert.equal(seoHttpPlan("/artist/%E0%A4%A").status, 404);
  assert.match(headTagsFor("/does-not-exist/extra"), /name="robots" content="noindex,follow"/);
});

test("crawlable HTML contains semantic content and keeps the interactive bundle", () => {
  const shell = `<!doctype html><html><head><title>Pit</title></head><body><div id="root"></div><script src="/app.js" defer></script></body></html>`;
  const html = injectHead(shell, "/");
  assert.match(html, /<h1>Remember every show/);
  assert.match(html, /<script src="\/app\.js" defer><\/script>/);
  assert.match(html, /https:\/\/www\.example\.com\/og\.png/);
  assert.match(html, /data-mshpit-public-document/);
  assert.doesNotMatch(html, /You need to enable JavaScript/);
});
