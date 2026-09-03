import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import {
  artistConcertsPath, artistsPath, cityConcertsPath, cityVenuesPath, concertPath,
  concertsPath, eventsPath, parsePublicCollectionPath, venuesPath,
} from "../../../src/domain/urls.mjs";
import { createPublicCollectionRepository } from "./publicCollectionRepository.js";
import { createPublicDocumentRepository } from "./publicDocumentRepository.js";
import { archiveShowKey } from "../artistArchive/artistArchiveKeys.js";
import { createArtistMemorialRepository } from "../artistMemorials/artistMemorialRepository.js";
import { createArtistMemorialService } from "../artistMemorials/artistMemorialService.js";
import { ensureLegacyMediaFinalizeSchema } from "../../mediaLegacyFinalize.js";

const MEMORIAL_MBID = "42345678-1234-4234-8234-123456789abc";

const dataDir = mkdtempSync(join(tmpdir(), "pit-seo-sitemaps-"));
process.env.PIT_DATA_DIR = dataDir;
process.env.PUBLIC_ORIGIN = "https://www.example.com/";

const { db, q, normName } = await import("../../db.js");
const {
  SITEMAP_PATHS,
  SITEMAP_MAX_BYTES,
  SITEMAP_MAX_SOURCE_ROWS,
  SITEMAP_MAX_URLS,
  buildSitemapDatasets,
  createSitemapSnapshot,
  isSitemapRequestPath,
  materializeSitemapCandidates,
  pageSitemapEntries,
  paginationEntries,
  sitemapIndexXml,
  sitemapXmlFor,
  urlsetParts,
} = await import("./sitemapService.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id, handle, { bio = "", banned = false, searchIndexingOptOut = false } = {}) {
  q.insertUser.run(id, `${handle}@example.test`, handle, handle, "hash", "fan", null, null, null, "SE", "#111111", 1_700_000_000_000);
  db.prepare("UPDATE users SET bio=?,is_banned=?,extras=? WHERE id=?")
    .run(bio, banned ? 1 : 0, JSON.stringify(searchIndexingOptOut ? { searchIndexingOptOut: true } : {}), id);
  return q.userById.get(id);
}

function addPost(id, userId, { artist, review, createdAt, removed = false, kind = "status" } = {}) {
  db.prepare(`INSERT INTO posts
    (id,user_id,artist,artist_key,venue,venue_key,city,date,overall,review,photos,photos_public,removed,created_at,updated_at,kind)
    VALUES (?,?,?,?,?,?,?,?,?,?,'[]',0,?,?,?,?)`)
    .run(id, userId, artist, normName(artist), "Sitemap Hall", normName("Sitemap Hall"), "Toronto", "2026-08-20", 4,
      review, removed ? 1 : 0, createdAt, createdAt + 1_000, kind);
}

function addArtist(name, publicSlug, { bio = "", mbid = null, updatedAt = 1_700_000_000_000 } = {}) {
  db.prepare(`INSERT OR REPLACE INTO artists
    (norm,name,public_slug,search_key,genre,photo,bio,mbid,popularity,rank_score,data,source,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(normName(name), name, publicSlug, normName(name).replace(/\s/g, ""), "Rock", null, bio, mbid, 1, 1, "{}", "test", updatedAt, updatedAt);
}

function addFinalizedProfileImage({ descriptorId, ownerId, purpose, url }) {
  ensureLegacyMediaFinalizeSchema(db);
  const at = 1_725_000_000_000;
  const stagingKey = `users/${ownerId}/${purpose}/${descriptorId}-source.jpg`;
  const outputKey = `users/${ownerId}/${purpose}/${descriptorId}.jpg`;
  const width = purpose === "banner" ? 1800 : 1024;
  const height = purpose === "banner" ? 600 : 1024;
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,associated_at,updated_at)
    VALUES (?,?,?,?,900,'associated',?,?,?)`)
    .run(outputKey, ownerId, "public", purpose, at, at, at);
  db.prepare(`INSERT INTO legacy_media_finalize_descriptors
    (id,owner_id,token_hash,purpose,staging_object_key,staging_mime_type,staging_byte_size,
      output_mime_type,output_object_key,output_url,output_byte_size,width,height,status,
      expires_at,consumed_at,finalized_at,created_at,updated_at)
    VALUES (?,?,?,?,?,'image/jpeg',1000,'image/jpeg',?,?,?,?,?,'finalized',?,?,?,?,?)`).run(
    descriptorId,
    ownerId,
    "0".repeat(64),
    purpose,
    stagingKey,
    outputKey,
    url,
    900,
    width,
    height,
    at + 86_400_000,
    at,
    at,
    at,
    at,
  );
}

function addReadySitemapMedia({ assetId, ownerId, postId, kind }) {
  const sourceKey = `users/${ownerId}/post/${assetId}-source.${kind === "video" ? "mp4" : "jpg"}`;
  const renderKey = `users/${ownerId}/post/${assetId}-render.${kind === "video" ? "mp4" : "jpg"}`;
  const posterKey = `users/${ownerId}/post/${assetId}-poster.jpg`;
  const renderId = `render-${assetId}`;
  const posterId = `poster-${assetId}`;
  const at = 1_720_000_000_000;
  const addObject = (key, scope, bytes) => db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,associated_at,updated_at)
    VALUES (?,?,?,?,?,'associated',?,?,?)`).run(key, ownerId, scope, "post", bytes, at, at, at);
  addObject(sourceKey, "private", kind === "video" ? 1_000 : 100);
  addObject(renderKey, "public", kind === "video" ? 900 : 90);
  if (kind === "video") addObject(posterKey, "public", 80);
  db.prepare(`INSERT INTO media_assets
    (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,
      original_name,mime_type,byte_size,width,height,duration_ms,metadata_status,codec_status,codec_verified_at,
      alt_text,status,edit_recipe,recipe_version,source_verified_at,render_state,render_variant_id,poster_variant_id,
      created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    assetId, ownerId, `client-${assetId}`, `create-${assetId}`, "post", kind, sourceKey,
    `https://private.example.test/${assetId}`, "private", `${assetId}.${kind === "video" ? "mp4" : "jpg"}`,
    kind === "video" ? "video/mp4" : "image/jpeg", kind === "video" ? 1_000 : 100,
    1280, 720, kind === "video" ? 45_000 : null, "declared", kind === "video" ? "verified" : "not_applicable",
    kind === "video" ? at : null, kind === "video" ? "Crowd singing the encore" : "Stage lights over the crowd",
    "ready", kind === "video" ? JSON.stringify({ coverMs: 1_000 }) : "{}", 1, at, "ready", renderId,
    kind === "video" ? posterId : null, at, at,
  );
  const addVariant = ({ id, role, key, url, mime, bytes, timeMs = null, origin }) => db.prepare(`INSERT INTO media_variants
    (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,time_ms,
      status,verified_at,verification_origin,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'verified',?,?,?,?)`).run(
    id, assetId, `client-${id}`, `create-${id}`, role, key, url, mime, bytes, 1280, 720, timeMs, at, origin, at, at,
  );
  addVariant({
    id: renderId,
    role: "render",
    key: renderKey,
    url: `https://media.example.test/${assetId}.${kind === "video" ? "mp4" : "jpg"}`,
    mime: kind === "video" ? "video/mp4" : "image/jpeg",
    bytes: kind === "video" ? 900 : 90,
    origin: kind === "video" ? "video_verifier_v1" : "private_derivative_v1",
  });
  if (kind === "video") addVariant({
    id: posterId,
    role: "poster",
    key: posterKey,
    url: `https://media.example.test/${assetId}-poster.jpg`,
    mime: "image/jpeg",
    bytes: 80,
    timeMs: 1_000,
    origin: "private_derivative_v1",
  });
  db.prepare("INSERT INTO post_media (post_id,asset_id,position,created_at) VALUES (?,?,?,?)")
    .run(postId, assetId, kind === "video" ? 1 : 0, at);
}

test("the root sitemap is an index of canonical segmented maps", () => {
  const xml = sitemapIndexXml({ PUBLIC_ORIGIN: "https://www.example.com/" });
  assert.match(xml, /<sitemapindex/);
  assert.deepEqual(SITEMAP_PATHS, [
    "/sitemaps/pages.xml",
    "/sitemaps/artists.xml",
    "/sitemaps/events.xml",
    "/sitemaps/venues.xml",
    "/sitemaps/cities.xml",
    "/sitemaps/concerts.xml",
    "/sitemaps/posts.xml",
    "/sitemaps/profiles.xml",
  ]);
  for (const path of SITEMAP_PATHS) assert.match(xml, new RegExp(`https://www\\.example\\.com${path.replace(".", "\\.")}`));
  assert.doesNotMatch(xml, /changefreq|priority/);
});

test("URL sets shard deterministically at Google's uncompressed limits", () => {
  assert.equal(SITEMAP_MAX_URLS, 50_000);
  assert.equal(SITEMAP_MAX_BYTES, 50 * 1024 * 1024);
  const entries = Array.from({ length: 5 }, (_, index) => ({ path: `/post/shard-${index + 1}` }));
  const parts = urlsetParts(entries, "https://www.example.com", { maxUrls: 2 });
  assert.deepEqual(parts.map((xml) => [...xml.matchAll(/<url>/g)].length), [2, 2, 1]);
  assert.deepEqual(
    parts.flatMap((xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])),
    entries.map((entry) => `https://www.example.com${entry.path}`),
  );
  assert.deepEqual(parts, urlsetParts(entries, "https://www.example.com", { maxUrls: 2 }));

  const byteParts = urlsetParts([
    { path: "/post/a" },
    { path: "/post/b" },
    { path: "/post/c" },
  ], "https://www.example.com", { maxBytes: 256 });
  assert.equal(byteParts.reduce((total, xml) => total + [...xml.matchAll(/<url>/g)].length, 0), 3);
  for (const xml of byteParts) {
    assert.ok(Buffer.byteLength(xml, "utf8") <= 256, "each uncompressed shard stays within its byte limit");
  }
});

test("static discovery and pagination respect content and router bounds", () => {
  assert.equal(pageSitemapEntries({ includeDiscover: false }).some((row) => row.path === "/discover"), false);
  assert.equal(pageSitemapEntries({ includeDiscover: true }).some((row) => row.path === "/discover"), true);
  // A sitemap advertises the collection's entry point, not every slice. Emitting
  // page 2 onward previously put 1,640 near-duplicate pages into the index, with
  // identical descriptions and titles reading "Page 485", which took the site's
  // sitelinks away from real content. Later pages stay crawlable through in-page
  // rel=next and are marked noindex,follow by the directory document.
  const pages = paginationEntries({
    itemCount: 50_000,
    includeFirst: true,
    pathFor: (page) => page === 1 ? "/events" : `/events/page/${page}`,
  });
  assert.equal(pages.length, 1);
  assert.equal(pages[0].path, "/events");
  assert.equal(pages.some((row) => row.path.includes("/page/")), false,
    "no /page/N URL may be advertised in a sitemap");

  // An empty collection still advertises nothing at all.
  assert.deepEqual(paginationEntries({
    itemCount: 0,
    includeFirst: true,
    pathFor: (page) => page === 1 ? "/events" : `/events/page/${page}`,
  }), []);
});

test("candidate keysets preserve more than fifty thousand rows and fail closed before unsafe accumulation", () => {
  assert.equal(SITEMAP_MAX_SOURCE_ROWS, 100_000);
  const tours = Array.from({ length: 50_025 }, (_, index) => ({
    id: `scale-${String(index).padStart(5, "0")}`,
    artist: "Scale Artist",
    artist_key: "scale artist",
    venue: `Scale Hall ${index % 25}`,
    source: "test",
    venue_provider_id: `scale-venue-${index % 25}`,
    date: "2026-12-20",
    updated_at: 1_725_000_000_000 + index,
    owner_id: null,
    provider_active: 1,
    venue_city: "Toronto",
    venue_country_code: "CA",
  }));
  let postReads = 0;
  let tourReads = 0;
  const fakeDatabase = {
    prepare(sql) {
      if (sql.includes("FROM posts p JOIN users u")) {
        return { all() { postReads += 1; return []; } };
      }
      if (sql.includes("FROM tour_dates td INDEXED BY idx_tourdates_sitemap_cursor")) {
        return {
          all(...args) {
            tourReads += 1;
            const cursorId = args[5];
            const limit = args[6];
            const start = cursorId == null ? 0 : tours.findIndex((row) => row.id === cursorId) + 1;
            return tours.slice(start, start + limit);
          },
        };
      }
      throw new Error(`unexpected scale query: ${sql.slice(0, 80)}`);
    },
  };

  const candidates = materializeSitemapCandidates(fakeDatabase, { now: 1_725_000_000_000 });
  assert.equal(candidates.tourDates.length, tours.length);
  assert.equal(candidates.upcomingEvents.length, tours.length);
  assert.equal(new Set(candidates.tourDates.map((row) => row.id)).size, tours.length);
  assert.equal(candidates.tourDates.at(-1).id, tours.at(-1).id);
  assert.equal(postReads, 1);
  assert.equal(tourReads, Math.ceil(tours.length / 500));
  assert.throws(
    () => materializeSitemapCandidates(fakeDatabase, {
      now: 1_725_000_000_000,
      maximumSourceRows: 50_000,
    }),
    /SITEMAP_SOURCE_ROW_LIMIT/,
    "the explicit memory ceiling rejects the build instead of returning a partial sitemap",
  );
});

test("segmented sitemaps contain only substantive canonical public pages", async () => {
  const richBio = "A substantive artist biography with enough original detail to make this public page useful to music fans and search visitors.";
  const profileBio = "Concert obsessive documenting memorable rooms, performances, and crowd stories from every tour stop.";
  const active = addUser("u_sitemap_active", "sitemapactive");
  const profile = addUser("u_sitemap_profile", "sitemapprofile", { bio: profileBio });
  addFinalizedProfileImage({ descriptorId: "lm_seo_profile_avatar", ownerId: profile.id, purpose: "avatar", url: "https://media.example.test/profile-avatar.jpg" });
  addFinalizedProfileImage({ descriptorId: "lm_seo_profile_banner", ownerId: profile.id, purpose: "banner", url: "https://media.example.test/profile-banner.jpg" });
  db.prepare("UPDATE users SET avatar_uri=?,banner=? WHERE id=?").run("https://media.example.test/profile-avatar.jpg", "https://media.example.test/profile-banner.jpg", profile.id);
  db.prepare("UPDATE users SET avatar_uri=? WHERE id=?").run("https://raw.example.test/unverified-profile.jpg", active.id);
  const searchPrivate = addUser("u_sitemap_search_private", "sitemapsearchprivate", {
    bio: profileBio,
    searchIndexingOptOut: true,
  });
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
  addPost("p_sitemap_concert", active.id, {
    artist: "Reviewed Sitemap Artist",
    review: "A detailed concert-night review with enough firsthand context to form a durable historical archive page.",
    createdAt: 1_720_000_005_000,
    kind: "review",
  });
  addReadySitemapMedia({ assetId: "seo-image", ownerId: active.id, postId: "p_sitemap_public", kind: "image" });
  addReadySitemapMedia({ assetId: "seo-video", ownerId: active.id, postId: "p_sitemap_concert", kind: "video" });
  addPost("p_sitemap_short", active.id, {
    artist: "Thin Sitemap Artist",
    review: "Short note",
    createdAt: 1_720_000_010_000,
  });
  addPost("p_sitemap_search_private", searchPrivate.id, {
    artist: "Reviewed Sitemap Artist",
    review: "This independently public post remains eligible even though its author's member profile is hidden from search engines.",
    createdAt: 1_720_000_015_000,
  });
  addPost("p_sitemap_banned", banned.id, {
    artist: "Banned Sitemap Artist",
    review: "This otherwise substantial post belongs to an account that is not publicly visible and must stay out.",
    createdAt: 1_720_000_020_000,
  });
  db.prepare(`INSERT INTO tour_dates
    (id,artist,venue,place,date,source,ticket_url,updated_at,release_at)
    VALUES (?,?,?,?,?,?,?,?,0)`).run(
    "td_sitemap_public",
    "Touring Sitemap Artist",
    "World Hall",
    "London, UK",
    "2026-12-01",
    "test",
    "https://www.ticketmaster.com/event/td-sitemap-public",
    1_730_000_000_000,
  );
  db.prepare(`INSERT INTO tour_dates
    (id,artist,venue,place,date,source,updated_at,release_at)
    VALUES (?,?,?,?,?,?,?,0)`).run(
    "td_sitemap_thin_event", "Thin Event Artist", "Thin Event Hall", "Toronto, Canada",
    "2026-12-05", "test", 1_730_000_000_100,
  );
  addPost("p_sitemap_event_fan", active.id, {
    artist: "Fan Evidence Artist",
    review: "A detailed first-hand review of the crowd, sound, staging, set list, and encore at this exact event.",
    createdAt: 1_730_000_000_200,
    kind: "review",
  });
  db.prepare("UPDATE posts SET venue='Fan Evidence Hall',venue_key=?,date='2026-12-06' WHERE id='p_sitemap_event_fan'")
    .run(normName("Fan Evidence Hall"));
  db.prepare(`INSERT INTO tour_dates
    (id,artist,venue,place,date,source,venue_city,venue_country_code,updated_at,release_at)
    VALUES (?,?,?,?,?,?,?,?,?,0)`).run(
    "td_sitemap_fan_event", "Fan Evidence Artist", "Fan Evidence Hall", "Toronto, Canada",
    "2026-12-06", "test", "Toronto", "CA", 1_730_000_000_300,
  );
  db.prepare(`INSERT INTO tour_dates
    (id,artist,venue,place,date,source,start_date_time,venue_address_line1,venue_city,
      venue_country_code,updated_at,release_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,0)`).run(
    "td_sitemap_rich_event", "Rich Evidence Artist", "Rich Evidence Hall", "Toronto, Canada",
    "2026-12-07", "test", "2026-12-07T20:00:00-05:00", "1 Music Way", "Toronto", "CA",
    1_730_000_000_400,
  );
  db.prepare(`INSERT INTO tour_dates
    (id,artist,venue,place,date,source,start_date_time,venue_address_line1,venue_city,
      venue_country_code,updated_at,release_at,music_qualified)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`).run(
    "td_sitemap_non_music", "Arena Spectacle", "Rich Evidence Hall", "Toronto, Canada",
    "2026-12-07", "ticketmaster", "2026-12-07T18:00:00-05:00", "1 Music Way", "Toronto", "CA",
    1_730_000_000_450, 0,
  );
  db.prepare(`INSERT INTO tour_dates
    (id,artist,venue,place,date,source,ticket_url,event_status,updated_at,release_at)
    VALUES (?,?,?,?,?,?,?,?,?,0)`).run(
    "td_sitemap_offsale_event", "Offsale Artist", "Offsale Hall", "Toronto, Canada",
    "2026-12-08", "test", "https://www.ticketmaster.com/event/td-sitemap-offsale", "offsale",
    1_730_000_000_500,
  );
  const addProviderVenueEvent = db.prepare(`INSERT INTO tour_dates
    (id,artist,venue,place,date,source,venue_provider_id,venue_city,updated_at,release_at)
    VALUES (?,?,?,?,?,?,?,?,?,0)`);
  addProviderVenueEvent.run(
    "td_venue_unique",
    "Touring Sitemap Artist",
    "Unity Hall",
    "Paris, France",
    "2026-12-02",
    "ticketmaster",
    "venue-unity",
    "Paris",
    1_721_000_000_000,
  );
  addProviderVenueEvent.run(
    "td_venue_shared_north",
    "Touring Sitemap Artist",
    "Shared Arena",
    "Toronto, Canada",
    "2026-12-03",
    "ticketmaster",
    "shared-north",
    "Toronto",
    1_721_000_000_000,
  );
  addProviderVenueEvent.run(
    "td_venue_shared_south",
    "Touring Sitemap Artist",
    "Shared Arena",
    "Vancouver, Canada",
    "2026-12-04",
    "ticketmaster",
    "shared-south",
    "Vancouver",
    1_721_000_000_000,
  );
  const venueReview = "A detailed venue review covering the room, sound, sightlines, crowd flow, and the full concert experience.";
  addPost("p_venue_unique", active.id, { artist: "Reviewed Sitemap Artist", review: venueReview, createdAt: 1_724_100_000_000, kind: "review" });
  addPost("p_venue_collision_a", active.id, { artist: "Reviewed Sitemap Artist", review: venueReview, createdAt: 1_724_000_000_000, kind: "review" });
  addPost("p_venue_collision_b", active.id, { artist: "Reviewed Sitemap Artist", review: venueReview, createdAt: 1_723_000_000_000, kind: "review" });
  db.prepare("UPDATE posts SET venue='Unity Hall',venue_key=?,city='Paris' WHERE id='p_venue_unique'").run(normName("Unity Hall"));
  db.prepare("UPDATE posts SET venue='Community Centre',venue_key=?,city='Toronto' WHERE id='p_venue_collision_a'").run(normName("Community Centre"));
  db.prepare("UPDATE posts SET venue='Community Centre',venue_key=?,city='London' WHERE id='p_venue_collision_b'").run(normName("Community Centre"));

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
  assert.match(posts, /\/post\/p_sitemap_search_private/,
    "profile search visibility does not make independently public posts disappear");
  assert.doesNotMatch(posts, /p_sitemap_short|p_sitemap_banned|\/show\//);
  assert.match(posts, /xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1"/);
  assert.match(posts, /<image:loc>https:\/\/media\.example\.test\/seo-image\.jpg<\/image:loc>/);
  assert.doesNotMatch(posts, /image:caption/, "deprecated image captions stay in visible HTML, not sitemap XML");
  assert.match(posts, /xmlns:video="http:\/\/www\.google\.com\/schemas\/sitemap-video\/1\.1"/);
  assert.match(posts, /<video:thumbnail_loc>https:\/\/media\.example\.test\/seo-video-poster\.jpg<\/video:thumbnail_loc>/);
  assert.match(posts, /<video:content_loc>https:\/\/media\.example\.test\/seo-video\.mp4<\/video:content_loc>/);
  assert.match(posts, /<video:duration>45<\/video:duration>/);

  const profiles = sitemapXmlFor("/sitemaps/profiles.xml", { database: db });
  assert.match(profiles, /\/u\/sitemapactive/);
  assert.match(profiles, /\/u\/sitemapprofile/);
  assert.doesNotMatch(profiles, /sitemapthin|sitemapbanned|sitemapsearchprivate/);
  assert.match(profiles, /xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1"/);
  assert.match(profiles, /<image:loc>https:\/\/media\.example\.test\/profile-banner\.jpg<\/image:loc>/);
  assert.match(profiles, /<image:loc>https:\/\/media\.example\.test\/profile-avatar\.jpg<\/image:loc>/);
  assert.doesNotMatch(profiles, /raw\.example\.test/, "unverified profile URLs stay out of image sitemaps");

  const pages = sitemapXmlFor("/sitemaps/pages.xml", { database: db });
  for (const path of ["/", "/discover", "/artists", "/events", "/venues", "/concerts", "/about", "/contact", "/community-guidelines", "/ratings-methodology", "/privacy", "/terms", "/support", "/account-deletion"]) {
    assert.match(pages, new RegExp(`<loc>https://www\\.example\\.com${path.replace("/", "\\/")}`));
  }
  assert.doesNotMatch(pages, /<loc>[^<]*\/search(?:[?<]|$)/, "internal search pages do not belong in the sitemap");
  assert.doesNotMatch(pages, /changefreq|priority/);
  const events = sitemapXmlFor("/sitemaps/events.xml", { database: db, now: 1_725_000_000_000 });
  assert.match(events, /\/event\/td_sitemap_public/);
  assert.match(events, /\/event\/td_sitemap_fan_event/);
  assert.match(events, /\/event\/td_sitemap_rich_event/);
  assert.doesNotMatch(events, /td_sitemap_thin_event|td_sitemap_offsale_event|td_sitemap_non_music/);
  const venues = sitemapXmlFor("/sitemaps/venues.xml", { database: db, now: 1_725_000_000_000 });
  assert.match(venues, /\/venue\/world-hall/);
  assert.match(venues, /\/venue\/sitemap-hall/);
  assert.match(venues, /\/venue\/ticketmaster-venue-unity/);
  assert.doesNotMatch(venues, /\/venue\/unity-hall/);
  assert.match(venues, /\/venue\/ticketmaster-shared-north/);
  assert.match(venues, /\/venue\/ticketmaster-shared-south/);
  assert.doesNotMatch(venues, /\/venue\/(?:shared-arena|community-centre)/);
  const providerVenueDay = new Date(1_721_000_000_000).toISOString().slice(0, 10);
  const unattributedVenuePostDay = new Date(1_724_100_001_000).toISOString().slice(0, 10);
  const unityVenueEntry = [...venues.matchAll(/<url>[\s\S]*?<\/url>/g)]
    .map((match) => match[0])
    .find((entry) => entry.includes("/venue/ticketmaster-venue-unity"));
  assert.ok(unityVenueEntry, "the provider-backed Unity Hall leaf is present");
  assert.match(unityVenueEntry, new RegExp(`<lastmod>${providerVenueDay}</lastmod>`));
  assert.doesNotMatch(
    unityVenueEntry,
    new RegExp(`<lastmod>${unattributedVenuePostDay}</lastmod>`),
    "an unattributed same-name post does not change a provider venue's lastmod",
  );

  const { seoHttpPlan } = await import("../../seo.js");
  const venuePaths = [...venues.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname);
  for (const path of venuePaths) {
    const plan = seoHttpPlan(path);
    assert.equal(plan.type, "document", `${path} must resolve directly to an indexable document`);
    assert.equal(plan.canonicalPath, path, `${path} must already be canonical`);
  }

  const concerts = sitemapXmlFor("/sitemaps/concerts.xml", { database: db, now: Date.parse("2026-08-25T00:00:00.000Z") });
  assert.match(concerts, /\/concert\/show\./);

  const shardingOptions = {
    database: db,
    now: 1_725_000_000_000,
    maxUrls: 2,
  };
  const shardedIndex = sitemapXmlFor("/sitemap.xml", shardingOptions);
  const indexedPaths = [...shardedIndex.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => new URL(match[1]).pathname);
  assert.ok(indexedPaths.some((path) => /\/posts-2\.xml$/.test(path)), "large datasets add deterministic shard URLs");
  assert.deepEqual(shardedIndex, sitemapXmlFor("/sitemap.xml", shardingOptions));
  for (const path of indexedPaths) {
    const shard = sitemapXmlFor(path, shardingOptions);
    assert.ok(shard, `the index must not advertise a missing shard: ${path}`);
    assert.ok([...shard.matchAll(/<url>/g)].length <= 2, `${path} stays within its configured URL limit`);
    assert.ok(Buffer.byteLength(shard, "utf8") <= SITEMAP_MAX_BYTES);
  }
  assert.equal(sitemapXmlFor("/sitemaps/posts-999999.xml", shardingOptions), null);

  assert.equal(isSitemapRequestPath("/sitemap.xml"), true);
  assert.equal(isSitemapRequestPath("/sitemaps/posts-50000.xml"), true);
  assert.equal(isSitemapRequestPath("/sitemaps/posts-1.xml"), false);
  assert.equal(isSitemapRequestPath("/sitemaps/posts-50001.xml"), false);
  assert.equal(isSitemapRequestPath("/sitemaps/posts-999999999999999999999.xml"), false);
  let rejectedPrepares = 0;
  assert.equal(sitemapXmlFor("/sitemaps/posts-999999999999999999999.xml", {
    database: {
      prepare() {
        rejectedPrepares += 1;
        throw new Error("a rejected suffix must not reach the database");
      },
    },
  }), null);
  assert.equal(rejectedPrepares, 0, "pathological suffixes are rejected before dataset materialization");

  let prepareCalls = 0;
  let postCandidatePrepares = 0;
  let tourCandidatePrepares = 0;
  const countedDatabase = new Proxy(db, {
    get(target, property) {
      if (property === "prepare") {
        return (...args) => {
          prepareCalls += 1;
          const sql = String(args[0] || "");
          if (sql.includes("SELECT p.id,p.user_id,p.artist,p.artist_key")
            && sql.includes("(? IS NULL OR p.created_at<? OR (p.created_at=? AND p.id<?))")
            && sql.includes("ORDER BY p.created_at DESC,p.id DESC LIMIT ?")) {
            postCandidatePrepares += 1;
          }
          if (sql.includes("SELECT td.id,td.provider_event_id,td.artist,td.artist_key")
            && sql.includes("(? IS NULL OR td.date>? OR (td.date=? AND td.id>?))")
            && sql.includes("ORDER BY td.date ASC,td.id ASC LIMIT ?")) {
            tourCandidatePrepares += 1;
          }
          return target.prepare(...args);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const snapshot = createSitemapSnapshot({
    ...shardingOptions,
    database: countedDatabase,
  });
  const preparesAfterSnapshot = prepareCalls;
  assert.ok(preparesAfterSnapshot > 0, "the snapshot materializes each dataset once");
  assert.equal(postCandidatePrepares, 1, "all post-derived datasets share one keyset candidate read");
  assert.equal(tourCandidatePrepares, 1, "all event, venue, city, and archive datasets share one tour candidate read");
  assert.match(snapshot.xmlFor("/sitemap.xml"), /<sitemapindex/);
  assert.match(snapshot.xmlFor(indexedPaths[0]), /<urlset/);
  assert.equal(snapshot.xmlFor("/sitemaps/posts-50000.xml"), null);
  assert.equal(snapshot.xmlFor("/sitemaps/posts-50000.xml"), null, "missing shards are negative-cached");
  assert.equal(prepareCalls, preparesAfterSnapshot,
    "valid and invalid shard reads reuse the materialized five-minute snapshot");
});

test("qualified collection, city, and artist archive pages are complete, canonical, and date-safe", () => {
  const author = addUser("u_sitemap_directories", "sitemapdirectories");
  const artist = "Directory Scale Artist";
  const artistKey = normName(artist);
  addArtist(artist, "directory-scale-artist", {
    bio: "A substantive artist biography documenting a long live career, evolving performances, landmark tours, and the communities formed around those shows.",
    updatedAt: Date.parse("2026-08-01T00:00:00.000Z"),
  });

  for (let index = 0; index < 13; index += 1) {
    const day = String(index + 1).padStart(2, "0");
    const date = `2026-07-${day}`;
    const venue = index % 2 ? "Archive North" : "Archive South";
    const postId = `p_directory_archive_${index}`;
    addPost(postId, author.id, {
      artist,
      review: `A detailed firsthand review number ${index} describing the set, sound, crowd, venue, and a distinctive live moment worth preserving.`,
      createdAt: Date.parse(`2026-07-${day}T20:00:00.000Z`),
      kind: "review",
    });
    db.prepare("UPDATE posts SET venue=?,venue_key=?,city='Toronto',date=? WHERE id=?")
      .run(venue, normName(venue), date, postId);
    db.prepare(`INSERT INTO tour_dates
      (id,artist,artist_key,venue,place,date,source,venue_provider_id,venue_city,
        venue_country_code,updated_at,release_at,provider_active)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(
      `td_directory_archive_${index}`,
      artist,
      artistKey,
      venue,
      "Toronto, Canada",
      date,
      "ticketmaster",
      `archive-${index % 2}`,
      "Toronto",
      "CA",
      Date.parse(`2026-07-${day}T21:00:00.000Z`),
      0,
    );
  }

  for (let index = 0; index < 13; index += 1) {
    const day = String(index + 1).padStart(2, "0");
    db.prepare(`INSERT INTO tour_dates
      (id,artist,artist_key,venue,place,date,source,venue_provider_id,venue_city,
        venue_country_code,updated_at,release_at,provider_active)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(
      `td_directory_upcoming_${index}`,
      artist,
      artistKey,
      `Future Hall ${index}`,
      "Toronto, Canada",
      `2026-12-${day}`,
      "ticketmaster",
      `future-${index}`,
      "Toronto",
      "CA",
      Date.parse(`2026-08-${day}T10:00:00.000Z`),
      0,
    );
  }

  // Thirteen eligible events at only two visible venues qualify the city
  // directory, but still render a single 2-row venue page.
  for (let index = 0; index < 13; index += 1) {
    const day = String(index + 1).padStart(2, "0");
    const venueIndex = index % 2;
    db.prepare(`INSERT INTO tour_dates
      (id,artist,artist_key,venue,place,date,source,venue_provider_id,venue_city,
        venue_country_code,updated_at,release_at,provider_active)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(
      `td_city_venue_row_boundary_${index}`,
      artist,
      artistKey,
      `Ottawa Venue ${venueIndex}`,
      "Ottawa, Canada",
      `2027-01-${day}`,
      "ticketmaster",
      `ottawa-venue-${venueIndex}`,
      "Ottawa",
      "CA",
      Date.parse(`2026-08-${day}T11:00:00.000Z`),
      0,
    );
  }

  for (let index = 0; index < 3; index += 1) {
    const day = String(index + 20).padStart(2, "0");
    const date = `2026-06-${day}`;
    const venue = index % 2 ? "Collision Room North" : "Collision Room South";
    const postId = `p_sitemap_city_collision_${index}`;
    addPost(postId, author.id, {
      artist,
      review: "A detailed review whose same-name/date provider records disagree on structured city and therefore cannot safely seed a city directory.",
      createdAt: Date.parse(`2026-06-${day}T20:00:00.000Z`),
      kind: "review",
    });
    db.prepare("UPDATE posts SET venue=?,venue_key=?,date=? WHERE id=?")
      .run(venue, normName(venue), date, postId);
    for (const location of [
      { suffix: "north", city: "North Collision", country: "CA" },
      { suffix: "south", city: "South Collision", country: "US" },
    ]) {
      db.prepare(`INSERT INTO tour_dates
        (id,artist,artist_key,venue,place,date,source,venue_provider_id,venue_city,
          venue_country_code,updated_at,release_at,provider_active)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(
        `td_sitemap_city_collision_${index}_${location.suffix}`,
        artist,
        artistKey,
        venue,
        `${location.city}, ${location.country}`,
        date,
        "ticketmaster",
        `collision-${index}-${location.suffix}`,
        location.city,
        location.country,
        Date.parse(`2026-06-${day}T21:00:00.000Z`),
        0,
      );
    }
  }

  addPost("p_sitemap_impossible_date", author.id, {
    artist,
    review: "A detailed but impossible calendar date must never manufacture a public concert archive or sitemap entry.",
    createdAt: Date.parse("2026-08-15T00:00:00.000Z"),
    kind: "review",
  });
  db.prepare("UPDATE posts SET venue='Impossible Hall',venue_key=?,date='2026-02-31' WHERE id='p_sitemap_impossible_date'")
    .run(normName("Impossible Hall"));
  db.prepare(`INSERT INTO tour_dates
    (id,artist,artist_key,venue,place,date,source,venue_city,venue_country_code,updated_at,release_at,provider_active)
    VALUES (?,?,?,?,?,?,?,?,?,?,0,1)`).run(
    "td_sitemap_impossible_date",
    artist,
    artistKey,
    "Impossible Hall",
    "Toronto, Canada",
    "2026-02-31",
    "test",
    "Toronto",
    "CA",
    Date.parse("2026-08-15T00:00:00.000Z"),
  );

  const options = { now: Date.parse("2026-08-25T00:00:00.000Z") };
  const candidates = materializeSitemapCandidates(db, options);
  assert.equal(candidates.tourDates.some((row) => row.id === "td_sitemap_impossible_date"), false);
  const first = buildSitemapDatasets(db, options);
  const second = buildSitemapDatasets(db, options);
  const paths = (name, source = first) => source.get(name).map((row) => row.path);
  assert.deepEqual(paths("pages"), paths("pages", second), "collection pagination is deterministic");
  assert.deepEqual(paths("cities"), paths("cities", second), "qualified city ordering is deterministic");

  for (const root of ["/artists", "/events", "/venues", "/concerts"]) {
    assert.ok(paths("pages").includes(root), `${root} is present when its eligible collection is nonempty`);
  }
  // Only the entry point of each collection is advertised. Slices stay crawlable
  // via in-page rel=next and are marked noindex,follow by the directory document,
  // so the crawler still reaches every leaf without 1,640 near-duplicate URLs
  // competing for the site's sitelinks.
  assert.equal(paths("pages").some((path) => path.includes("/page/")), false,
    "no collection slice may be advertised in a sitemap");

  assert.ok(paths("cities").includes("/venues/ca/toronto"));
  assert.ok(paths("cities").includes("/venues/ca/ottawa"));
  assert.ok(paths("cities").includes("/concerts/ca/toronto"));
  assert.equal(paths("cities").some((path) => path.includes("/page/")), false,
    "city collections advertise their entry point only");
  assert.equal(paths("cities").includes("/concerts/ca/north-collision"), false);
  assert.equal(paths("cities").includes("/concerts/us/south-collision"), false);
  assert.ok(paths("concerts").includes("/artist/directory-scale-artist/concerts"));
  assert.equal(paths("concerts").some((path) => path.includes("/concerts/page/")), false,
    "artist archives advertise their entry point only");

  const impossibleKey = archiveShowKey({
    artistIdentity: artistKey,
    venueIdentity: normName("Impossible Hall"),
    date: "2026-02-31",
  });
  assert.equal(paths("events").includes("/event/td_sitemap_impossible_date"), false);
  assert.equal(paths("concerts").includes(concertPath(impossibleKey)), false);

  const cityXml = sitemapXmlFor("/sitemaps/cities.xml", { database: db, ...options });
  assert.match(cityXml, /<loc>https:\/\/www\.example\.com\/concerts\/ca\/toronto<\/loc>/);
  assert.doesNotMatch(cityXml, /\/page\/1<\/loc>/);
  assert.deepEqual(cityXml, sitemapXmlFor("/sitemaps/cities.xml", { database: db, ...options }));
});

test("artist archive name fallback is allowed only for one unambiguous catalogue identity", () => {
  const author = addUser("u_sitemap_duplicate_artist_name", "sitemapduplicateartist");
  const displayName = "Shared Catalogue Display Name";
  const firstKey = "catalog:shared-display-one";
  const secondKey = "catalog:shared-display-two";
  const insertArtist = db.prepare(`INSERT INTO artists
    (norm,name,public_slug,search_key,genre,photo,bio,popularity,rank_score,data,source,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const bio = "A substantive catalogue biography long enough to make this distinct artist identity publicly indexable for live music discovery.";
  insertArtist.run(
    firstKey, displayName, "shared-display-one", "shareddisplayone", "Rock", null, bio,
    1, 2, "{}", "test", 1, 1,
  );
  insertArtist.run(
    secondKey, displayName, "shared-display-two", "shareddisplaytwo", "Rock", null, bio,
    1, 1, "{}", "test", 1, 1,
  );

  addPost("p_sitemap_ambiguous_artist_archive", author.id, {
    artist: displayName,
    review: "A detailed review tied only to a shared display name cannot choose between two catalogue artist identities.",
    createdAt: Date.parse("2026-07-01T20:00:00.000Z"),
    kind: "review",
  });
  db.prepare(`UPDATE posts SET artist_key=NULL,venue='Ambiguous Identity Hall',venue_key=?,
      city='Toronto',date='2026-07-01' WHERE id='p_sitemap_ambiguous_artist_archive'`)
    .run(normName("Ambiguous Identity Hall"));

  const options = { now: Date.parse("2026-08-25T00:00:00.000Z") };
  const ambiguousPaths = buildSitemapDatasets(db, options).get("concerts").map((row) => row.path);
  assert.equal(ambiguousPaths.includes("/artist/shared-display-one/concerts"), false);
  assert.equal(ambiguousPaths.includes("/artist/shared-display-two/concerts"), false,
    "a duplicate display name never assigns its archive to whichever catalogue row was read last");

  addPost("p_sitemap_keyed_artist_archive", author.id, {
    artist: displayName,
    review: "A second detailed review carries the durable catalogue key and therefore belongs to one exact artist archive.",
    createdAt: Date.parse("2026-07-02T20:00:00.000Z"),
    kind: "review",
  });
  db.prepare(`UPDATE posts SET artist_key=?,venue='Keyed Identity Hall',venue_key=?,
      city='Toronto',date='2026-07-02' WHERE id='p_sitemap_keyed_artist_archive'`)
    .run(firstKey, normName("Keyed Identity Hall"));

  const keyedPaths = buildSitemapDatasets(db, options).get("concerts").map((row) => row.path);
  assert.ok(keyedPaths.includes("/artist/shared-display-one/concerts"),
    "a durable artist_key takes precedence even when the display name is duplicated");
  assert.equal(keyedPaths.includes("/artist/shared-display-two/concerts"), false);
});

test("profile sitemap lastmod includes profile_updated_at", () => {
  const profileUpdatedAt = Date.parse("2026-07-04T18:30:00.000Z");
  addUser("u_sitemap_profile_lastmod", "sitemapprofilelastmod", {
    bio: "A substantive member biography about documenting concerts, artists, venues, and memorable live music experiences.",
  });
  db.prepare("UPDATE users SET profile_updated_at=? WHERE id=?")
    .run(profileUpdatedAt, "u_sitemap_profile_lastmod");

  const profiles = sitemapXmlFor("/sitemaps/profiles.xml", { database: db });
  assert.match(
    profiles,
    /<loc>https:\/\/www\.example\.com\/u\/sitemapprofilelastmod<\/loc>\s*<lastmod>2026-07-04<\/lastmod>/,
  );
});

test("artist sitemap lastmod includes the public artist profile and feed-enabled official posts", () => {
  const owner = addUser("u_sitemap_official_artist", "sitemapofficialartist");
  const artistName = "Official Sitemap Artist";
  const artistKey = normName(artistName);
  const profileUpdatedAt = Date.parse("2026-05-03T12:00:00.000Z");
  const officialPostAt = Date.parse("2026-06-07T12:00:00.000Z");
  addArtist(artistName, "official-sitemap-artist", { updatedAt: 1_700_000_000_000 });
  db.prepare(`INSERT INTO artist_profiles
    (artist_key,owner_id,bio,feed_enabled,removed,updated_at)
    VALUES (?,?,?,1,0,?)`).run(
    artistKey,
    owner.id,
    "An official artist profile with substantive original biography details for fans following releases and live performances.",
    profileUpdatedAt,
  );

  const profileOnly = sitemapXmlFor("/sitemaps/artists.xml", {
    database: db,
    now: Date.parse("2026-08-25T00:00:00.000Z"),
  });
  assert.match(
    profileOnly,
    /<loc>https:\/\/www\.example\.com\/artist\/official-sitemap-artist<\/loc>\s*<lastmod>2026-05-03<\/lastmod>/,
  );

  db.prepare(`INSERT INTO artist_posts
    (id,artist_key,user_id,text,removed,created_at)
    VALUES (?,?,?,?,0,?)`).run(
    "ap_sitemap_official_lastmod",
    artistKey,
    owner.id,
    "An official public update for fans.",
    officialPostAt,
  );
  const withOfficialPost = sitemapXmlFor("/sitemaps/artists.xml", {
    database: db,
    now: Date.parse("2026-08-25T00:00:00.000Z"),
  });
  assert.match(
    withOfficialPost,
    /<loc>https:\/\/www\.example\.com\/artist\/official-sitemap-artist<\/loc>\s*<lastmod>2026-06-07<\/lastmod>/,
  );

  db.prepare("UPDATE artist_profiles SET feed_enabled=0 WHERE artist_key=?").run(artistKey);
  const feedDisabled = sitemapXmlFor("/sitemaps/artists.xml", {
    database: db,
    now: Date.parse("2026-08-25T00:00:00.000Z"),
  });
  assert.match(
    feedDisabled,
    /<loc>https:\/\/www\.example\.com\/artist\/official-sitemap-artist<\/loc>\s*<lastmod>2026-05-03<\/lastmod>/,
    "an official post only contributes while the public artist feed is enabled",
  );
});

test("artist post and tour updates resolve through the canonical artist norm", () => {
  const author = addUser("u_sitemap_artist_identity", "sitemapartistidentity");
  const artistName = "Canonical Display Identity";
  const artistNorm = "catalog:canonical-display-identity";
  const postAt = Date.parse("2026-04-10T12:00:00.000Z");
  const tourAt = Date.parse("2026-05-11T12:00:00.000Z");
  addArtist(artistName, "canonical-display-identity", { updatedAt: 1_700_000_000_000 });
  db.prepare("UPDATE artists SET norm=? WHERE public_slug=?")
    .run(artistNorm, "canonical-display-identity");
  assert.notEqual(artistName.toLowerCase(), artistNorm);

  addPost("p_sitemap_artist_identity", author.id, {
    artist: artistName,
    review: "A substantive public account of this artist's performance, sound, crowd, set, and the lasting concert memory.",
    createdAt: postAt,
  });
  db.prepare("UPDATE posts SET artist_key=? WHERE id=?")
    .run(artistNorm, "p_sitemap_artist_identity");
  const withPost = sitemapXmlFor("/sitemaps/artists.xml", {
    database: db,
    now: Date.parse("2026-08-25T00:00:00.000Z"),
  });
  assert.match(
    withPost,
    /<loc>https:\/\/www\.example\.com\/artist\/canonical-display-identity<\/loc>\s*<lastmod>2026-04-10<\/lastmod>/,
  );

  db.prepare(`INSERT INTO tour_dates
    (id,artist,venue,place,date,source,updated_at,release_at)
    VALUES (?,?,?,?,?,?,?,0)`).run(
    "td_sitemap_artist_identity",
    artistName,
    "Identity Hall",
    "Berlin, Germany",
    "2026-12-20",
    "test",
    tourAt,
  );
  const withTour = sitemapXmlFor("/sitemaps/artists.xml", {
    database: db,
    now: Date.parse("2026-08-25T00:00:00.000Z"),
  });
  assert.match(
    withTour,
    /<loc>https:\/\/www\.example\.com\/artist\/canonical-display-identity<\/loc>\s*<lastmod>2026-05-11<\/lastmod>/,
  );
});


test("collection sitemaps use exact qualified totals and every emitted page is nonempty", () => {
  const author = addUser("u_sitemap_candidate_mismatch", "sitemapcandidatemismatch");
  for (let index = 0; index < 100; index += 1) {
    const id = "p_sitemap_post_only_venue_" + index;
    const venue = "Post Only Venue " + String(index).padStart(3, "0");
    addPost(id, author.id, {
      artist: "Directory Scale Artist",
      review: "A detailed public review creates a legitimate venue leaf candidate but not an upcoming venue-directory row.",
      createdAt: Date.parse("2026-08-24T12:00:00.000Z") + index,
      kind: "review",
    });
    db.prepare("UPDATE posts SET venue=?,venue_key=?,city=? WHERE id=?")
      .run(venue, normName(venue), "Toronto", id);
  }

  const options = { now: Date.parse("2026-08-25T00:00:00.000Z") };
  const datasets = buildSitemapDatasets(db, options);
  const directoryRepository = createPublicDocumentRepository(db);
  const collectionRepository = createPublicCollectionRepository(db);
  const pagePaths = datasets.get("pages").map((row) => row.path);
  const globalKinds = {
    artists: { build: artistsPath, rows: "artists" },
    events: { build: eventsPath, rows: "events" },
    venues: { build: venuesPath, rows: "venues" },
    concerts: { build: concertsPath, rows: "concerts" },
  };

  for (const [kind, contract] of Object.entries(globalKinds)) {
    const first = directoryRepository.readDirectory({
      kind, page: 1, at: options.now, today: "2026-08-25",
    });
    // Only the entry point is advertised now, so a nonempty collection
    // contributes exactly one URL regardless of how many rows it holds.
    const expectedPages = first.total > 0 ? 1 : 0;
    const emitted = pagePaths.filter((path) => parsePublicCollectionPath(path)?.type === kind);
    assert.equal(emitted.length, expectedPages, kind + " pagination comes from exact rendered rows");
    for (const path of emitted) {
      const parsed = parsePublicCollectionPath(path);
      const result = directoryRepository.readDirectory({
        kind, page: parsed.page, at: options.now, today: "2026-08-25",
      });
      assert.ok(result?.[contract.rows]?.length > 0, path + " resolves a nonempty directory page");
      assert.equal(path, contract.build(parsed.page), path + " is self-canonical");
    }
  }

  const venueLeafCount = datasets.get("venues").length;
  const exactVenueTotal = directoryRepository.readDirectory({
    kind: "venues", page: 1, at: options.now, today: "2026-08-25",
  }).total;
  assert.ok(venueLeafCount > exactVenueTotal,
    "post-only venue leaf candidates outnumber the stricter upcoming venue directory");
  assert.equal(
    pagePaths.filter((path) => parsePublicCollectionPath(path)?.type === "venues").length,
    exactVenueTotal > 0 ? 1 : 0,
    "broader leaf candidates never manufacture an empty venue page",
  );

  const collectionPaths = [
    ...datasets.get("cities").map((row) => row.path),
    ...datasets.get("concerts").map((row) => row.path),
  ].filter((path) => {
    const type = parsePublicCollectionPath(path)?.type;
    return type === "city-venues" || type === "city-concerts" || type === "artist-concerts";
  });
  for (const path of collectionPaths) {
    const parsed = parsePublicCollectionPath(path);
    let result;
    let canonical;
    if (parsed.type === "city-venues") {
      result = collectionRepository.readCityVenues({
        countryCode: parsed.countryCode, citySlug: parsed.citySlug, page: parsed.page,
        at: options.now, today: "2026-08-25",
      });
      canonical = cityVenuesPath({
        countryCode: parsed.countryCode, city: parsed.citySlug,
      }, parsed.page);
      assert.ok(result?.venues?.length > 0, path + " resolves visible venues");
    } else if (parsed.type === "city-concerts") {
      result = collectionRepository.readCityConcerts({
        countryCode: parsed.countryCode, citySlug: parsed.citySlug, page: parsed.page,
        at: options.now, today: "2026-08-25",
      });
      canonical = cityConcertsPath({
        countryCode: parsed.countryCode, city: parsed.citySlug,
      }, parsed.page);
      assert.ok(result?.concerts?.length > 0, path + " resolves visible concerts");
    } else {
      result = collectionRepository.readArtistConcerts({
        publicSlug: parsed.artistSlug, page: parsed.page,
        at: options.now, today: "2026-08-25",
      });
      canonical = artistConcertsPath(parsed.artistSlug, parsed.page);
      assert.ok(result?.concerts?.length > 0, path + " resolves visible artist concerts");
    }
    assert.equal(path, canonical, path + " uses the shared canonical route helper");
  }
});
