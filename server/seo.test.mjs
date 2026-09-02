import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createArtistMemorialRepository } from "./features/artistMemorials/artistMemorialRepository.js";
import { createArtistMemorialService } from "./features/artistMemorials/artistMemorialService.js";
import { archiveShowKey } from "./features/artistArchive/artistArchiveKeys.js";
import { renderPublicDocumentMain } from "./features/seo/publicDocumentRenderer.js";

const dataDir = mkdtempSync(join(tmpdir(), "pit-seo-visibility-"));
process.env.PIT_DATA_DIR = dataDir;
process.env.PUBLIC_ORIGIN = "https://www.example.com";

const { db, q, normName } = await import("./db.js");
const { enforceHtmlRobotsMeta, metadataFor, resolveEntity, headTagsFor, injectHead, renderNotFoundDocument, refreshSitemapSnapshot, sitemapXml, sitemapForPath, seoHttpPlan } = await import("./seo.js");
const { postSitemapEntries, profileSitemapEntries } = await import("./features/seo/sitemapService.js");
const { artistPath, concertPath, eventPath, profilePath, showPath, venuePath } = await import("../src/domain/urls.mjs");

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

test("home artist cards call review counts reviews", () => {
  const html = renderPublicDocumentMain({
    kind: "home",
    artists: [{
      name: "Clear Copy Artist",
      path: "/artist/clear-copy-artist",
      genre: [],
      description: "",
      reviewCount: 2,
    }],
    posts: [],
  });
  assert.match(html, />2 reviews<\/p>/u);
  assert.doesNotMatch(html, /fan reviews?/iu);
});

test("SEO metadata, entity routing, and sitemap exclude restricted authors", async () => {
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
  assert.match(restrictedHead, /Mshpit — Concert reviews, photos and live music discovery/);
  assert.doesNotMatch(restrictedHead, /reviews live music/i);
  const restrictedShell = injectHead("<html><head><title>Pit</title></head></html>", profilePath(suspended.handle));
  assert.match(restrictedShell, /Mshpit — Concert reviews, photos and live music discovery/,
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
  assert.match(artistShell, /Reviews<\/dt><dd>1<\/dd>/,
    "artist aggregates count only active authors");
  assert.doesNotMatch(artistShell, /SEO Suspended Secret Hall|SEO Banned Hall/);

  assert.equal((await refreshSitemapSnapshot({ force: true })).ok, true);
  assert.match(sitemapXml(), /sitemapindex/);
  const postSitemap = sitemapForPath("/sitemaps/posts.xml");
  assert.match(postSitemap, new RegExp(showPath("seo_active_show")));
  assert.doesNotMatch(postSitemap, new RegExp(showPath("seo_suspended_show")));
  assert.doesNotMatch(postSitemap, new RegExp(showPath("seo_banned_show")));
  assert.equal(seoHttpPlan(profilePath(suspended.handle)).status, 404);
});

test("member search-indexing opt-out serves the app noindex while public posts stay indexable", () => {
  const member = addUser("u_seo_search_private", "seosearchprivate");
  db.prepare("UPDATE users SET name=?,bio=?,extras=? WHERE id=?").run(
    "Search Privacy Person",
    "A detailed personal concert diary that would otherwise qualify as a substantive public member profile.",
    JSON.stringify({ searchIndexingOptOut: true }),
    member.id,
  );
  addPost("seo_search_private_post", member.id, {
    artist: "Search Privacy Artist", venue: "Search Privacy Hall", overall: 5, room: 4, createdAt: 350,
  });

  const path = profilePath(member.handle);
  const plan = seoHttpPlan(path);
  assert.equal(plan.type, "app");
  assert.equal(plan.status, 200);
  assert.equal(metadataFor(path), null);
  assert.equal(resolveEntity(path)?.id, member.id,
    "the member remains reachable inside Pit; this setting controls external indexing only");
  assert.match(headTagsFor(path), /name="robots" content="noindex,follow"/);
  assert.doesNotMatch(headTagsFor(path), /Search Privacy Person|detailed personal concert diary/i);
  assert.equal(profileSitemapEntries(db).some((entry) => entry.path === path), false);

  assert.equal(seoHttpPlan(showPath("seo_search_private_post")).type, "document");
  assert.equal(postSitemapEntries(db).some((entry) => entry.path === showPath("seo_search_private_post")), true);

  db.prepare("UPDATE users SET extras=? WHERE id=?")
    .run(JSON.stringify({ searchIndexingOptOut: false }), member.id);
  assert.equal(seoHttpPlan(path).type, "document", "opting back in restores the canonical public profile document");
  assert.equal(profileSitemapEntries(db).some((entry) => entry.path === path), true);
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
  assert.equal(seoHttpPlan("/search").type, "document");
  assert.equal(seoHttpPlan("/search").indexable, false);
  assert.equal(seoHttpPlan("/does-not-exist/extra").status, 404);
  assert.equal(seoHttpPlan("/artist/%E0%A4%A").status, 404);
  assert.match(headTagsFor("/does-not-exist/extra"), /name="robots" content="noindex,follow"/);
});

test("staging HTML has one noindex,nofollow directive while production public documents remain indexable", () => {
  const source = `<!doctype html><html><head><title>Pit</title>
    <meta name="robots" content="index,follow" /></head><body><div id="root"></div></body></html>`;
  const stagingEnv = { PIT_ENV: "staging" };
  for (const path of ["/", "/search"]) {
    const html = injectHead(source, path, seoHttpPlan(path), stagingEnv);
    const robots = [...html.matchAll(/<meta\b(?=[^>]*\bname=["']robots["'])[^>]*>/gi)];
    assert.equal(robots.length, 1, `${path} must not render conflicting robots metadata`);
    assert.match(robots[0][0], /content="noindex,nofollow"/);
    assert.doesNotMatch(html, /content="index,follow/);
  }

  const stagingAppHead = headTagsFor("/search", stagingEnv);
  assert.match(stagingAppHead, /name="robots" content="noindex,nofollow"/);
  assert.equal([...stagingAppHead.matchAll(/name="robots"/g)].length, 1);
  const stagingNotFound = renderNotFoundDocument(stagingEnv);
  const recoveredStaticHtml = enforceHtmlRobotsMeta(source, { env: stagingEnv });
  assert.equal([...recoveredStaticHtml.matchAll(/name="robots"/g)].length, 1);
  assert.match(recoveredStaticHtml, /name="robots" content="noindex,nofollow"/);

  assert.match(stagingNotFound, /name="robots" content="noindex,nofollow"/);

  const productionPublicHead = headTagsFor("/", { PIT_ENV: "production" });
  assert.match(
    productionPublicHead,
    /name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"/,
  );
  const productionFallback = headTagsFor("/search", { PIT_ENV: "production" });
  assert.match(productionFallback, /<title>Search artists, concerts and fans \| Mshpit<\/title>/);
  assert.match(productionFallback, /name="robots" content="noindex,follow"/);
});

test("a verified memorial makes only its canonical artist page crawlable", () => {
  const artist = "SEO Memorial Only Artist";
  const artistKey = normName(artist);
  const artistMbid = "32345678-1234-4234-8234-123456789abc";
  db.prepare(`INSERT OR REPLACE INTO artists
    (norm,name,public_slug,search_key,genre,photo,bio,mbid,popularity,rank_score,data,source,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(artistKey, artist, "seo-memorial-only-artist", "seomemorialonlyartist", null, null, "",
      artistMbid, 1, 1, "{}", "test", 1, 1);
  const at = Date.parse("2026-08-25T12:00:00.000Z");
  const memorials = createArtistMemorialService({ repository: createArtistMemorialRepository(db) });
  const saved = memorials.upsert({
    status: "published",
    deathDate: "2026-08-25",
    summary: "A beloved songwriter remembered through the music, performances, and community they brought together.",
    thankYou: "Thank you for everything you gave listeners.",
    accomplishments: ["A lasting catalogue", "Performances remembered by generations"],
    sourceUrl: "https://news.example.org/seo-memorial-confirmation",
    sourceTitle: "Verified public announcement",
    confirmedIndividual: true,
    restartSpotlight: false,
  }, { artistKey, artistName: artist, artistMbid, at });
  assert.equal(saved.ok, true);

  const path = artistPath({ name: artist, publicSlug: "seo-memorial-only-artist" });
  const plan = seoHttpPlan(path);
  assert.equal(plan.type, "document", "the permanent memorial is substantive public artist content");
  assert.equal(plan.document.memorial.deathDate, "2026-08-25");
  const shell = injectHead(
    '<html><head><title>Pit</title></head><body><div id="root"></div></body></html>',
    path,
  );
  assert.match(shell, /Remembering SEO Memorial Only Artist/);
  assert.match(shell, /Verified public announcement/);
  assert.match(shell, /"@type":"Person"/);
  assert.match(shell, /"deathDate":"2026-08-25"/);

  const legacy = seoHttpPlan("/seo-memorial-only-artist");
  assert.deepEqual(
    { type: legacy.type, location: legacy.location, hasDocument: Object.hasOwn(legacy, "document") },
    { type: "redirect", location: path, hasDocument: false },
  );
});

test("crawlable HTML contains semantic content and keeps the interactive bundle", () => {
  const template = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const shell = template.replace(
    "</body>",
    '<script src="/_expo/static/js/web/index-test.js" defer></script>\n</body>',
  );
  const html = injectHead(shell, "/");
  assert.match(html, /<h1>The shows you saw\.<br \/><em>The taste you built\.<\/em><\/h1>/);
  assert.match(html, /REMEMBER THE NIGHT\. FIND WHAT&#39;S NEXT\./);
  assert.match(html, /<script src="\/mshpit-web-boot-v1\.js"><\/script>/);
  assert.match(html, /<script src="\/_expo\/static\/js\/web\/index-test\.js" defer><\/script>/);
  assert.match(html, /https:\/\/www\.example\.com\/og\.png/);
  assert.match(html, /data-mshpit-public-document/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.example\.com\/" \/>/);
  assert.match(html, /<script type="application\/ld\+json">[\s\S]*?"@type":"WebSite"/);
  assert.match(html, /<a href="\/artists">Artists<\/a>/);
  assert.match(html, /<a href="\/events">Events<\/a>/);
  assert.match(html, /<div class="seo-document">/);
  assert.doesNotMatch(html, /<html[^>]*data-mshpit-web-boot/i);
  assert.doesNotMatch(html, /<div class="seo-document"[^>]*(?:hidden|aria-hidden)/i);
  assert.doesNotMatch(html, /You need to enable JavaScript/);
});

test("events, durable venues, historical concerts, and directories form one crawlable graph", () => {
  const member = addUser("u_seo_event_fan", "seoeventfan");
  const artist = "SEO Global Tour Artist";
  db.prepare(`INSERT OR REPLACE INTO artists
    (norm,name,public_slug,search_key,genre,photo,bio,popularity,rank_score,data,source,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(normName(artist), artist, "seo-global-tour-artist", "seoglobaltourartist", "Pop", null,
      "A touring artist with a sufficiently detailed public biography for the connected event and archive test surface.",
      10, 10, "{}", "test", 1, 1);
  db.prepare(`INSERT INTO tour_dates
    (id,provider_event_id,event_name,artist,venue,place,date,start_date_time,start_local_time,event_timezone,
      event_status,ticket_url,sold_out,source,updated_at,release_at,venue_provider_id,venue_address_line1,
      venue_city,venue_region,venue_postal_code,venue_country_code,venue_country,provider_active,last_seen_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "seo_event_world", "tm-seo-event", `${artist} World Tour`, artist, "SEO World Arena", "London, United Kingdom",
    "2026-12-10", "2026-12-10T20:00:00.000Z", "20:00:00", "Europe/London", "onsale",
    "https://www.ticketmaster.co.uk/event/seo-event", 0, "ticketmaster", Date.now(), 0, "KovZ-seo-world",
    "1 Arena Way", "London", "England", "E20 2ST", "GB", "United Kingdom", 1, Date.now(),
  );
  const addSameNameProviderEvent = db.prepare(`INSERT INTO tour_dates
    (id,provider_event_id,event_name,artist,venue,place,date,source,updated_at,release_at,
      venue_provider_id,venue_city,provider_active)
    VALUES (?,?,?,?,?,?,?,?,?,0,?,?,1)`);
  addSameNameProviderEvent.run(
    "seo_twin_north", "tm-seo-twin-north", `${artist} North`, artist, "SEO Twin Arena",
    "Toronto, Canada", "2026-12-11", "ticketmaster", Date.now(), "twin-north", "Toronto",
  );
  addSameNameProviderEvent.run(
    "seo_twin_south", "tm-seo-twin-south", `${artist} South`, artist, "SEO Twin Arena",
    "London, United Kingdom", "2026-12-12", "ticketmaster", Date.now(), "twin-south", "London",
  );
  db.prepare(`INSERT INTO posts
    (id,user_id,artist,artist_key,venue,venue_key,city,date,overall,room,review,photos,photos_public,kind,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'[]',0,'review',?,?)`).run(
    "seo_archive_review", member.id, artist, normName(artist), "SEO Archive Hall", normName("SEO Archive Hall"),
    "Toronto", "2026-08-20", 4.5, 4,
    "A detailed firsthand review of the sound, crowd, staging, and encore from this exact concert night.",
    Date.now() - 10_000, Date.now() - 5_000,
  );
  addPost("seo_twin_unattributed", member.id, {
    artist, venue: "SEO Twin Arena", overall: 4, room: 4, createdAt: Date.now() - 4_000,
  });


  const eventRoute = eventPath("seo_event_world");
  const eventPlan = seoHttpPlan(eventRoute);
  assert.equal(eventPlan.type, "document");
  assert.equal(eventPlan.document.kind, "event");
  assert.equal(eventPlan.document.event.ticketUrl, "https://www.ticketmaster.co.uk/event/seo-event");
  assert.match(injectHead('<html><head><title>Pit</title></head><body><div id="root"></div></body></html>', eventRoute), /MusicEvent/);
  assert.equal(resolveEntity(eventRoute)?.performanceEvent, true);

  const durableVenue = venuePath({ name: "SEO World Arena", source: "ticketmaster", providerVenueId: "KovZ-seo-world" });
  assert.equal(seoHttpPlan(durableVenue).type, "document");
  assert.equal(seoHttpPlan("/venue/seo-world-arena").location, durableVenue,
    "a legacy name-only venue URL upgrades to the provider-stable canonical");
  const northVenue = venuePath({ name: "SEO Twin Arena", source: "ticketmaster", providerVenueId: "twin-north" });
  const southVenue = venuePath({ name: "SEO Twin Arena", source: "ticketmaster", providerVenueId: "twin-south" });
  const northPlan = seoHttpPlan(northVenue);
  const southPlan = seoHttpPlan(southVenue);
  assert.equal(northPlan.type, "document");
  assert.equal(southPlan.type, "document");
  assert.deepEqual(northPlan.document.events.map((event) => event.path), [eventPath("seo_twin_north")]);
  assert.deepEqual(southPlan.document.events.map((event) => event.path), [eventPath("seo_twin_south")]);
  assert.deepEqual(northPlan.document.posts, [],
    "provider venue pages omit name-only fan posts whose provider identity cannot be proven");
  assert.deepEqual(southPlan.document.posts, []);
  assert.equal(seoHttpPlan("/venue/seo-twin-arena").type, "not-found",
    "a duplicate venue name never redirects to an arbitrary provider identity");
  assert.equal(seoHttpPlan("/seo-twin-arena").type, "not-found",
    "the legacy root fallback also fails closed for an ambiguous venue name");


  const key = archiveShowKey({
    artistIdentity: normName(artist),
    venueIdentity: normName("SEO Archive Hall"),
    date: "2026-08-20",
  });
  const concertRoute = concertPath(key);
  const concertPlan = seoHttpPlan(concertRoute);
  assert.equal(concertPlan.type, "document");
  assert.equal(concertPlan.document.kind, "concert");
  assert.equal(concertPlan.document.concert.ratingCount, 1);
  assert.equal(resolveEntity(concertRoute)?.archiveShowKey, key);

  for (const path of ["/artists", "/events", "/venues", "/concerts", "/discover"]) {
    const plan = seoHttpPlan(path);
    assert.equal(plan.type, "document");
    assert.equal(plan.document.kind, path === "/discover" ? "discover" : "directory");
    assert.match(injectHead('<html><head><title>Pit</title></head><body><div id="root"></div></body></html>', path), /BreadcrumbList/);
  }
});

test("thin public entities keep unique SSR at 200/noindex while real event evidence earns indexation", async () => {
  const thinArtist = "SEO Thin Public Artist";
  const thinVenue = "SEO Thin Public Hall";
  const thinDate = "2036-01-10";
  db.prepare(`INSERT OR REPLACE INTO artists
    (norm,name,public_slug,search_key,genre,photo,bio,popularity,rank_score,data,source,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    normName(thinArtist), thinArtist, "seo-thin-public-artist", "seothinpublicartist", null, null,
    "", 1, 1, "{}", "test", 1, 1,
  );
  db.prepare(`INSERT INTO tour_dates
    (id,event_name,artist,venue,place,date,source,updated_at,release_at,provider_active)
    VALUES (?,?,?,?,?,?,?,?,0,1)`).run(
    "seo_thin_public_event", `${thinArtist} Live`, thinArtist, thinVenue, "Toronto, Canada",
    thinDate, "test", Date.now(),
  );

  const removedAuthor = addUser("u_seo_thin_removed", "seothinremoved");
  addPost("seo_thin_removed_review", removedAuthor.id, {
    artist: thinArtist, venue: thinVenue, overall: 4, room: 4, createdAt: Date.now(),
  });
  db.prepare("UPDATE posts SET venue=?,venue_key=?,date=?,kind='review',removed=1 WHERE id=?")
    .run(thinVenue, normName(thinVenue), thinDate, "seo_thin_removed_review");

  const bannedAuthor = addUser("u_seo_thin_banned", "seothinbanned");
  db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(bannedAuthor.id);
  addPost("seo_thin_banned_review", bannedAuthor.id, {
    artist: thinArtist, venue: thinVenue, overall: 4, room: 4, createdAt: Date.now() + 1,
  });
  db.prepare("UPDATE posts SET venue=?,venue_key=?,date=?,kind='review' WHERE id=?")
    .run(thinVenue, normName(thinVenue), thinDate, "seo_thin_banned_review");

  const thinPath = eventPath("seo_thin_public_event");
  const thinPlan = seoHttpPlan(thinPath);
  assert.equal(thinPlan.type, "document");
  assert.equal(thinPlan.status, 200);
  assert.equal(thinPlan.indexable, false);
  assert.equal(thinPlan.document.kind, "event");
  assert.deepEqual(thinPlan.document.posts, [],
    "removed and restricted fan content cannot promote a thin event");
  assert.match(thinPlan.document.title, /SEO Thin Public Artist at SEO Thin Public Hall/);

  const thinHtml = injectHead(
    '<html><head><title>Pit</title><meta name="robots" content="index,follow" /></head><body><div id="root"></div></body></html>',
    thinPath,
    thinPlan,
    { PIT_ENV: "production" },
  );
  assert.match(thinHtml, /data-mshpit-public-document/);
  assert.match(thinHtml, /SEO Thin Public Artist/);
  assert.match(thinHtml, /SEO Thin Public Hall/);
  assert.equal([...thinHtml.matchAll(/name="robots"/g)].length, 1);
  assert.match(thinHtml, /name="robots" content="noindex,follow"/);
  assert.doesNotMatch(thinHtml, /content="index,follow/);
  assert.equal([...thinHtml.matchAll(/rel="canonical"/g)].length, 1);
  assert.match(thinHtml, /rel="canonical" href="https:\/\/www\.example\.com\/event\/seo_thin_public_event"/);

  const catalogThinArtist = "SEO Catalog Thin Artist";
  db.prepare(`INSERT OR REPLACE INTO artists
    (norm,name,public_slug,search_key,genre,photo,bio,popularity,rank_score,data,source,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    normName(catalogThinArtist), catalogThinArtist, "seo-catalog-thin-artist", "seocatalogthinartist",
    null, null, "", 1, 1, "{}", "test", 1, 1,
  );
  const thinArtistPath = artistPath({ name: catalogThinArtist, publicSlug: "seo-catalog-thin-artist" });
  const thinArtistPlan = seoHttpPlan(thinArtistPath);
  assert.equal(thinArtistPlan.type, "document");
  assert.equal(thinArtistPlan.status, 200);
  assert.equal(thinArtistPlan.indexable, false,
    "a legitimate thin artist keeps its public SSR instead of degrading to the generic app shell");

  const fan = addUser("u_seo_event_evidence", "seoeventevidence");
  const fanArtist = "SEO Fan Evidence Artist";
  const fanVenue = "SEO Fan Evidence Hall";
  const fanDate = "2036-01-11";
  db.prepare(`INSERT INTO tour_dates
    (id,event_name,artist,venue,place,date,source,updated_at,release_at,provider_active)
    VALUES (?,?,?,?,?,?,?,?,0,1)`).run(
    "seo_fan_evidence_event", `${fanArtist} Live`, fanArtist, fanVenue, "Montreal, Canada",
    fanDate, "test", Date.now() + 2,
  );
  addPost("seo_fan_evidence_review", fan.id, {
    artist: fanArtist, venue: fanVenue, overall: 5, room: 4, createdAt: Date.now() + 3,
  });
  db.prepare("UPDATE posts SET venue=?,venue_key=?,city='Montreal',date=?,kind='review' WHERE id=?")
    .run(fanVenue, normName(fanVenue), fanDate, "seo_fan_evidence_review");

  const fanPath = eventPath("seo_fan_evidence_event");
  const fanPlan = seoHttpPlan(fanPath);
  assert.equal(fanPlan.type, "document");
  assert.equal(fanPlan.status, 200);
  assert.equal(fanPlan.indexable, true);
  assert.ok(fanPlan.document.posts.some((post) => post.text.length >= 40));

  const suspendedOwner = addUser("u_seo_event_suspended", "seoeventsuspended");
  db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 60_000, suspendedOwner.id);
  db.prepare(`INSERT INTO tour_dates
    (id,event_name,artist,venue,place,date,source,owner_id,updated_at,release_at,provider_active)
    VALUES (?,?,?,?,?,?,?,?,?,0,1)`).run(
    "seo_restricted_owner_event", "Restricted Owner Live", "Restricted Owner Artist",
    "Restricted Owner Hall", "Toronto, Canada", "2036-01-12", "manual", suspendedOwner.id, Date.now() + 4,
  );
  assert.equal(seoHttpPlan(eventPath("seo_restricted_owner_event")).status, 404,
    "restricted owners remain fail-closed rather than receiving thin SSR");

  db.prepare(`INSERT INTO tour_dates
    (id,event_name,artist,venue,place,date,source,updated_at,release_at,provider_active)
    VALUES (?,?,?,?,?,?,?,?,0,0)`).run(
    "seo_inactive_provider_event", "Inactive Provider Live", "Inactive Provider Artist",
    "Inactive Provider Hall", "Toronto, Canada", "2036-01-13", "ticketmaster", Date.now() + 5,
  );
  assert.equal(seoHttpPlan(eventPath("seo_inactive_provider_event")).status, 404,
    "provider-moderated future events remain excluded");

  assert.equal((await refreshSitemapSnapshot({ force: true })).ok, true);
  const eventSitemap = sitemapForPath("/sitemaps/events.xml");
  assert.match(eventSitemap, /\/event\/seo_fan_evidence_event/);
  assert.doesNotMatch(
    eventSitemap,
    /seo_thin_public_event|seo_restricted_owner_event|seo_inactive_provider_event/,
  );
});

test("artist and event directory pages are canonical, crawlable, and fail closed", () => {
  const insertArtist = db.prepare(`INSERT OR REPLACE INTO artists
    (norm,name,public_slug,search_key,genre,photo,bio,popularity,rank_score,data,source,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertEvent = db.prepare(`INSERT OR REPLACE INTO tour_dates
    (id,provider_event_id,event_name,artist,artist_key,venue,place,date,source,updated_at,release_at,
      venue_provider_id,venue_city,venue_country_code,venue_country,provider_active)
    VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,1)`);
  for (let index = 1; index <= 30; index += 1) {
    const suffix = String(index).padStart(2, "0");
    const artist = `SEO Page Artist ${suffix}`;
    const artistKey = normName(artist);
    insertArtist.run(
      artistKey, artist, `seo-page-artist-${suffix}`, `seopageartist${suffix}`, "Live", null,
      "A substantive artist biography created to verify stable server-rendered pagination for public music discovery pages.",
      1, 1, "{}", "test", 1, 1,
    );
    insertEvent.run(
      `seo_page_event_${suffix}`, `tm-seo-page-${suffix}`, `${artist} Live`, artist, artistKey,
      `SEO Page Hall ${suffix}`, "Toronto, Canada", `2035-01-${suffix}`, "ticketmaster", Date.now(),
      `seo-page-venue-${suffix}`, "Toronto", "CA", "Canada",
    );
  }

  for (const kind of ["artists", "events"]) {
    const rootPath = `/${kind}`;
    const pagePath = `/${kind}/page/2`;
    assert.deepEqual(
      { type: seoHttpPlan(`${rootPath}/page/1`).type, status: seoHttpPlan(`${rootPath}/page/1`).status,
        location: seoHttpPlan(`${rootPath}/page/1`).location },
      { type: "redirect", status: 301, location: rootPath },
      "page one has only one canonical URL",
    );

    for (const alias of [`/${kind.toUpperCase()}`, `${rootPath}/`]) {
      const aliasPlan = seoHttpPlan(alias);
      assert.deepEqual(
        { type: aliasPlan.type, status: aliasPlan.status, location: aliasPlan.location },
        { type: "redirect", status: 301, location: rootPath },
        `${alias} must consolidate on the exact collection canonical`,
      );
    }

    const plan = seoHttpPlan(pagePath);
    assert.equal(plan.type, "document");
    assert.equal(plan.status, 200);
    assert.equal(plan.indexable, true);
    assert.equal(plan.canonicalPath, pagePath);
    assert.equal(plan.document.canonicalUrl, `https://www.example.com${pagePath}`);
    const html = injectHead(
      '<html><head><title>Pit</title></head><body><div id="root"></div></body></html>',
      pagePath,
      plan,
      { PIT_ENV: "production" },
    );
    assert.match(html, new RegExp(`<link rel="canonical" href="https://www\\.example\\.com${pagePath}"`));
    assert.match(html, /name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1"/);
    assert.match(html, new RegExp(`href="${rootPath}"[^>]*>Previous page</a>`));
    assert.match(html, kind === "artists" ? /href="\/artist\// : /href="\/event\//,
      "the server HTML contains ordinary crawlable entity anchors");
  }

  for (const path of [
    "/artists/page/no", "/events/page/0", "/artists/page/2/extra",
    "/artists/page/1001", "/events/page/1001", "/artists/page/1000", "/events/page/1000",
  ]) {
    assert.equal(seoHttpPlan(path).status, 404, `${path} must fail closed`);
  }
});

test("event and concert routes reject impossible calendar dates", () => {
  db.prepare(`INSERT OR REPLACE INTO tour_dates
    (id,event_name,artist,venue,place,date,source,updated_at,release_at,provider_active)
    VALUES (?,?,?,?,?,?,?, ?,0,1)`).run(
    "seo_invalid_date_event", "Impossible Date Live", "Impossible Date Artist", "Calendar Hall",
    "Toronto, Canada", "2026-02-30", "ticketmaster", Date.now(),
  );
  assert.equal(seoHttpPlan(eventPath("seo_invalid_date_event")).status, 404);

  const member = addUser("u_seo_invalid_date", "seoinvaliddate");
  db.prepare(`INSERT INTO posts
    (id,user_id,artist,artist_key,venue,venue_key,city,date,overall,room,review,photos,photos_public,kind,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'[]',0,'review',?,?)`).run(
    "seo_invalid_date_review", member.id, "Impossible Date Artist", normName("Impossible Date Artist"),
    "Calendar Hall", normName("Calendar Hall"), "Toronto", "2026-02-30", 4, 4,
    "A detailed review that would otherwise make this impossible calendar date look publishable.", Date.now(), Date.now(),
  );
  const invalidKey = archiveShowKey({
    artistIdentity: normName("Impossible Date Artist"),
    venueIdentity: normName("Calendar Hall"),
    date: "2026-02-30",
  });
  assert.equal(seoHttpPlan(concertPath(invalidKey)).status, 404);
});

test("public city and artist collection routes are canonical, thresholded, linked, and hostile-path safe", () => {
  const member = addUser("u_seo_collection_route", "seocollectionroute");
  const artist = "SEO Route Artist";
  const artistKey = normName(artist);
  db.prepare("INSERT OR REPLACE INTO artists (norm,name,public_slug,search_key,genre,photo,bio,popularity,rank_score,data,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(artistKey, artist, "seo-route-artist", "seorouteartist", "Rock", null,
      "A substantive route-test artist biography covering live performances, touring history, and fan concert archives.",
      10, 10, "{}", "test", 1, 1);

  const insertEvent = db.prepare("INSERT INTO tour_dates (id,provider_event_id,event_name,artist,artist_key,venue,date,source,updated_at,release_at,venue_provider_id,venue_address_line1,venue_city,venue_region,venue_postal_code,venue_country_code,venue_country,provider_active) VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,1)");
  for (let index = 1; index <= 3; index += 1) {
    const venueNumber = index === 3 ? 1 : index;
    insertEvent.run(
      "seo_route_future_" + index,
      "seo-route-future-provider-" + index,
      artist + " Future " + index,
      artist,
      artistKey,
      "Route Venue " + venueNumber,
      "2037-01-0" + index,
      "ticketmaster",
      Date.now(),
      "route-venue-" + venueNumber,
      index + " Future Street",
      "Routeville",
      "Ontario",
      "K1A 0B" + index,
      "CA",
      "Canada",
    );
  }

  const insertReview = db.prepare("INSERT INTO posts (id,user_id,artist,artist_key,venue,venue_key,city,date,overall,room,review,photos,photos_public,kind,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'[]',0,'review',?,?)");
  const review = "A detailed firsthand account of the sound, crowd, staging, musicianship, and encore at this concert.";
  for (let index = 1; index <= 13; index += 1) {
    const cityShow = index <= 3;
    const venueNumber = cityShow ? (index === 3 ? 1 : index) : index;
    const venue = cityShow ? "Route Archive Hall " + venueNumber : "Artist Archive Hall " + venueNumber;
    const date = cityShow ? "2026-07-0" + index : "2026-06-" + String(index).padStart(2, "0");
    insertReview.run(
      "seo_route_review_" + index,
      member.id,
      artist,
      artistKey,
      venue,
      normName(venue),
      cityShow ? "Routeville" : "Elsewhere",
      date,
      4.5,
      4,
      review,
      Date.now() + index,
      Date.now() + index,
    );
    if (cityShow) {
      insertEvent.run(
        "seo_route_past_" + index,
        "seo-route-past-provider-" + index,
        artist + " Archive " + index,
        artist,
        artistKey,
        venue,
        date,
        "ticketmaster",
        Date.now(),
        "route-archive-venue-" + venueNumber,
        index + " Archive Street",
        "Routeville",
        "Ontario",
        "K2A 0B" + index,
        "CA",
        "Canada",
      );
    }
  }

  insertEvent.run(
    "seo_route_thin_1", "seo-route-thin-provider-1", artist + " Thin 1", artist, artistKey,
    "Thin Route Hall", "2037-02-01", "ticketmaster", Date.now(), "thin-route-hall",
    "1 Thin Street", "Thinville", "Ontario", "K3A 0B1", "CA", "Canada",
  );
  insertEvent.run(
    "seo_route_thin_2", "seo-route-thin-provider-2", artist + " Thin 2", artist, artistKey,
    "Thin Route Hall", "2037-02-02", "ticketmaster", Date.now(), "thin-route-hall",
    "1 Thin Street", "Thinville", "Ontario", "K3A 0B1", "CA", "Canada",
  );

  for (const pair of [
    ["/venues/ca/routeville/page/1", "/venues/ca/routeville"],
    ["/concerts/ca/routeville/page/1", "/concerts/ca/routeville"],
    ["/artist/seo-route-artist/concerts/page/1", "/artist/seo-route-artist/concerts"],
  ]) {
    const plan = seoHttpPlan(pair[0]);
    assert.deepEqual({ type: plan.type, status: plan.status, location: plan.location },
      { type: "redirect", status: 301, location: pair[1] });
  }

  const cityVenues = seoHttpPlan("/venues/ca/routeville");
  const cityConcerts = seoHttpPlan("/concerts/ca/routeville");
  const artistPageTwo = seoHttpPlan("/artist/seo-route-artist/concerts/page/2");
  assert.equal(cityVenues.type, "document");
  assert.equal(cityConcerts.type, "document");
  assert.equal(artistPageTwo.type, "document");
  assert.equal(artistPageTwo.canonicalPath, "/artist/seo-route-artist/concerts/page/2");
  assert.equal(artistPageTwo.document.concerts.length, 1);

  const venueHtml = injectHead('<html><head><title>Pit</title></head><body><div id="root"></div></body></html>',
    "/venues/ca/routeville", cityVenues, { PIT_ENV: "production" });
  const concertHtml = injectHead('<html><head><title>Pit</title></head><body><div id="root"></div></body></html>',
    "/concerts/ca/routeville", cityConcerts, { PIT_ENV: "production" });
  assert.equal(venueHtml.includes('href="/concerts/ca/routeville"'), true);
  assert.equal(concertHtml.includes('href="/venues/ca/routeville"'), true);

  const caseRedirect = seoHttpPlan("/venues/CA/Routeville");
  assert.deepEqual({ type: caseRedirect.type, status: caseRedirect.status, location: caseRedirect.location },
    { type: "redirect", status: 301, location: "/venues/ca/routeville" });

  for (const path of [
    "/venues/ca/thinville",
    "/concerts/ca/thinville",
    "/artist/unknown-route-artist/concerts",
    "/venues/ca/routeville/page/no",
    "/concerts/ca/routeville/page/1001",
    "/artist/seo-route-artist/concerts/page/0",
    "/artist/%2F/concerts",
    "/venues/ca/routeville/extra",
  ]) {
    assert.equal(seoHttpPlan(path).status, 404, path + " must fail closed");
  }
});
