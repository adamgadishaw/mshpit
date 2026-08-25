import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createArtistMemorialRepository } from "../artistMemorials/artistMemorialRepository.js";
import { createArtistMemorialService } from "../artistMemorials/artistMemorialService.js";

const MEMORIAL_MBID = "42345678-1234-4234-8234-123456789abc";

const dataDir = mkdtempSync(join(tmpdir(), "pit-seo-sitemaps-"));
process.env.PIT_DATA_DIR = dataDir;
process.env.PUBLIC_ORIGIN = "https://www.example.com/";

const { db, q, normName } = await import("../../db.js");
const {
  SITEMAP_PATHS,
  sitemapIndexXml,
  sitemapXmlFor,
} = await import("./sitemapService.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id, handle, { bio = "", banned = false } = {}) {
  q.insertUser.run(id, `${handle}@example.test`, handle, handle, "hash", "fan", null, null, null, "SE", "#111111", 1_700_000_000_000);
  db.prepare("UPDATE users SET bio=?,is_banned=? WHERE id=?").run(bio, banned ? 1 : 0, id);
  return q.userById.get(id);
}

function addPost(id, userId, { artist, review, createdAt, removed = false } = {}) {
  db.prepare(`INSERT INTO posts
    (id,user_id,artist,artist_key,venue,venue_key,city,date,overall,review,photos,photos_public,removed,created_at,updated_at,kind)
    VALUES (?,?,?,?,?,?,?,?,?,?,'[]',0,?,?,?,?)`)
    .run(id, userId, artist, normName(artist), "Sitemap Hall", normName("Sitemap Hall"), "Toronto", "2026-08-20", 4,
      review, removed ? 1 : 0, createdAt, createdAt + 1_000, "status");
}

function addArtist(name, publicSlug, { bio = "", mbid = null, updatedAt = 1_700_000_000_000 } = {}) {
  db.prepare(`INSERT OR REPLACE INTO artists
    (norm,name,public_slug,search_key,genre,photo,bio,mbid,popularity,rank_score,data,source,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(normName(name), name, publicSlug, normName(name).replace(/\s/g, ""), "Rock", null, bio, mbid, 1, 1, "{}", "test", updatedAt, updatedAt);
}

test("the root sitemap is an index of canonical segmented maps", () => {
  const xml = sitemapIndexXml({ PUBLIC_ORIGIN: "https://www.example.com/" });
  assert.match(xml, /<sitemapindex/);
  assert.deepEqual(SITEMAP_PATHS, [
    "/sitemaps/pages.xml",
    "/sitemaps/artists.xml",
    "/sitemaps/posts.xml",
    "/sitemaps/profiles.xml",
  ]);
  for (const path of SITEMAP_PATHS) assert.match(xml, new RegExp(`https://www\\.example\\.com${path.replace(".", "\\.")}`));
  assert.doesNotMatch(xml, /events\.xml|changefreq|priority/);
});

test("segmented sitemaps contain only substantive canonical public pages", () => {
  const richBio = "A substantive artist biography with enough original detail to make this public page useful to music fans and search visitors.";
  const profileBio = "Concert obsessive documenting memorable rooms, performances, and crowd stories from every tour stop.";
  const active = addUser("u_sitemap_active", "sitemapactive");
  addUser("u_sitemap_profile", "sitemapprofile", { bio: profileBio });
  const banned = addUser("u_sitemap_banned", "sitemapbanned", { banned: true });
  addUser("u_sitemap_thin", "sitemapthin");

  addArtist("Rich Sitemap Artist", "rich-sitemap-artist", { bio: richBio, updatedAt: 1_710_000_000_000 });
  addArtist("Reviewed Sitemap Artist", "reviewed-sitemap-artist");
  addArtist("Thin Sitemap Artist", "thin-sitemap-artist");
  addArtist("Banned Sitemap Artist", "banned-sitemap-artist");
  addArtist("Touring Sitemap Artist", "touring-sitemap-artist");
  addArtist("Memorial Sitemap Artist", "memorial-sitemap-artist", { mbid: MEMORIAL_MBID });
  addArtist("Draft Memorial Sitemap Artist", "draft-memorial-sitemap-artist", {
    mbid: "52345678-1234-4234-8234-123456789abc",
  });

  const memorials = createArtistMemorialService({ repository: createArtistMemorialRepository(db) });
  const memorialPayload = {
    status: "published",
    deathDate: "2024-08-20",
    summary: "A lasting musical legacy remembered by listeners and the communities their performances brought together.",
    thankYou: "Thank you for the music and memories.",
    accomplishments: ["A lasting catalogue"],
    sourceUrl: "https://news.example.org/sitemap-memorial",
    sourceTitle: "Verified public announcement",
    confirmedIndividual: true,
    restartSpotlight: false,
  };
  assert.equal(memorials.upsert(memorialPayload, {
    artistKey: normName("Memorial Sitemap Artist"),
    artistName: "Memorial Sitemap Artist",
    artistMbid: MEMORIAL_MBID,
    at: 1_725_000_000_000,
  }).ok, true);
  assert.equal(memorials.upsert({ ...memorialPayload, status: "draft" }, {
    artistKey: normName("Draft Memorial Sitemap Artist"),
    artistName: "Draft Memorial Sitemap Artist",
    artistMbid: "52345678-1234-4234-8234-123456789abc",
    at: 1_725_000_000_000,
  }).ok, true);

  addPost("p_sitemap_public", active.id, {
    artist: "Reviewed Sitemap Artist",
    review: "An original, detailed post about the performance, crowd, sound, and the moment the whole room came alive.",
    createdAt: 1_720_000_000_000,
  });
  addPost("p_sitemap_short", active.id, {
    artist: "Thin Sitemap Artist",
    review: "Short note",
    createdAt: 1_720_000_010_000,
  });
  addPost("p_sitemap_banned", banned.id, {
    artist: "Banned Sitemap Artist",
    review: "This otherwise substantial post belongs to an account that is not publicly visible and must stay out.",
    createdAt: 1_720_000_020_000,
  });
  db.prepare(`INSERT INTO tour_dates
    (id,artist,venue,place,date,source,updated_at,release_at)
    VALUES (?,?,?,?,?,?,?,0)`).run("td_sitemap_public", "Touring Sitemap Artist", "World Hall", "London, UK", "2026-12-01", "test", 1_730_000_000_000);

  const artists = sitemapXmlFor("/sitemaps/artists.xml", { database: db, now: 1_725_000_000_000 });
  assert.match(artists, /\/artist\/rich-sitemap-artist/);
  assert.match(artists, /\/artist\/reviewed-sitemap-artist/);
  assert.match(artists, /\/artist\/touring-sitemap-artist/);
  assert.match(artists, /\/artist\/memorial-sitemap-artist/);
  assert.doesNotMatch(artists, /thin-sitemap-artist|banned-sitemap-artist|draft-memorial-sitemap-artist/);
  assert.match(
    artists,
    /<loc>https:\/\/www\.example\.com\/artist\/memorial-sitemap-artist<\/loc>\s*<lastmod>2024-08-30<\/lastmod>/,
    "the identity-bound memorial revision contributes the canonical artist lastmod",
  );
  assert.match(artists, /<lastmod>2024-10-27<\/lastmod>/, "lastmod comes from useful source changes, not sitemap generation time");

  const posts = sitemapXmlFor("/sitemaps/posts.xml", { database: db });
  assert.match(posts, /\/post\/p_sitemap_public/);
  assert.doesNotMatch(posts, /p_sitemap_short|p_sitemap_banned|\/show\//);

  const profiles = sitemapXmlFor("/sitemaps/profiles.xml", { database: db });
  assert.match(profiles, /\/u\/sitemapactive/);
  assert.match(profiles, /\/u\/sitemapprofile/);
  assert.doesNotMatch(profiles, /sitemapthin|sitemapbanned/);

  const pages = sitemapXmlFor("/sitemaps/pages.xml", { database: db });
  for (const path of ["/", "/privacy", "/terms", "/support", "/account-deletion"]) {
    assert.match(pages, new RegExp(`<loc>https://www\\.example\\.com${path.replace("/", "\\/")}`));
  }
  assert.doesNotMatch(pages, /changefreq|priority/);
  assert.equal(sitemapXmlFor("/sitemaps/events.xml", { database: db }), null);
});
