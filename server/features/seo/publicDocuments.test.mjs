import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createArtistMemorialRepository } from "../artistMemorials/artistMemorialRepository.js";
import { createArtistMemorialService } from "../artistMemorials/artistMemorialService.js";
import { archiveShowKey } from "../artistArchive/artistArchiveKeys.js";
import { ensureLegacyMediaFinalizeSchema } from "../../mediaLegacyFinalize.js";
import { createPublicDocumentService } from "./publicDocuments.js";
import { serializePublicStructuredData } from "./publicDocumentRenderer.js";

const ARTIST_MBID = "12345678-1234-4234-8234-123456789abc";
const OTHER_MBID = "22345678-1234-4234-8234-123456789abc";
const NOW = Date.parse("2026-08-25T12:00:00.000Z");

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,name TEXT NOT NULL,handle TEXT NOT NULL,artist_name TEXT,bio TEXT,
      avatar_uri TEXT,banner TEXT,created_at INTEGER NOT NULL,is_banned INTEGER NOT NULL DEFAULT 0,
      suspended_until INTEGER,extras TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE artists (
      norm TEXT PRIMARY KEY,name TEXT NOT NULL,public_slug TEXT,genre TEXT,data TEXT,bio TEXT,mbid TEXT,country TEXT,formed TEXT,
      popularity INTEGER,rank_score INTEGER NOT NULL DEFAULT 0,updated_at INTEGER
    );
    CREATE TABLE artist_memorials (
      artist_key TEXT PRIMARY KEY,artist_mbid TEXT,artist_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft','published')),death_date TEXT NOT NULL,
      summary TEXT NOT NULL,thank_you TEXT NOT NULL,accomplishments TEXT NOT NULL,
      source_url TEXT NOT NULL,source_title TEXT,published_at INTEGER,spotlight_started_at INTEGER,
      created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,reviewer_secret TEXT,
      CHECK (
        (status='draft' AND published_at IS NULL AND spotlight_started_at IS NULL)
        OR (status='published' AND published_at IS NOT NULL AND spotlight_started_at IS NOT NULL)
      )
    );
    CREATE TABLE posts (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,artist TEXT NOT NULL,artist_key TEXT,artist_mbid TEXT,venue TEXT NOT NULL,
      venue_key TEXT,city TEXT,date TEXT,overall REAL,review TEXT,setlist TEXT NOT NULL DEFAULT '[]',tour TEXT,photos TEXT NOT NULL DEFAULT '[]',
      photos_public INTEGER NOT NULL DEFAULT 0,kind TEXT DEFAULT 'review',removed INTEGER NOT NULL DEFAULT 0,
      experience_type TEXT NOT NULL DEFAULT 'in_person',online_title TEXT,youtube_url TEXT,youtube_video_id TEXT,
      like_count INTEGER NOT NULL DEFAULT 0,comment_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,updated_at INTEGER
    );
    CREATE TABLE likes (post_id TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(post_id,user_id));
    CREATE TABLE comments (
      id TEXT PRIMARY KEY,post_id TEXT NOT NULL,user_id TEXT NOT NULL,parent_id TEXT,text TEXT NOT NULL,
      removed INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL
    );
    CREATE TABLE follows (follower_id TEXT NOT NULL,followee_id TEXT NOT NULL,PRIMARY KEY(follower_id,followee_id));
    CREATE TABLE artist_profiles (
      artist_key TEXT PRIMARY KEY,bio TEXT,banner TEXT,banner_owner_id TEXT,
      avatar_uri TEXT,avatar_owner_id TEXT,feed_enabled INTEGER NOT NULL DEFAULT 0,
      owner_id TEXT,removed INTEGER NOT NULL DEFAULT 0,updated_at INTEGER
    );
    CREATE TABLE artist_posts (
      id TEXT PRIMARY KEY,artist_key TEXT NOT NULL,user_id TEXT,text TEXT NOT NULL,
      removed INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL
    );
    CREATE TABLE tour_dates (
      id TEXT PRIMARY KEY,artist TEXT NOT NULL,artist_key TEXT,venue TEXT,place TEXT,lat REAL,lng REAL,date TEXT,ticket_url TEXT,
      sold_out INTEGER NOT NULL DEFAULT 0,source TEXT,updated_at INTEGER NOT NULL DEFAULT 0,
      owner_id TEXT,release_at INTEGER NOT NULL DEFAULT 0,provider_event_id TEXT,event_name TEXT,
      start_date_time TEXT,start_local_time TEXT,event_timezone TEXT,event_status TEXT,venue_provider_id TEXT,
      venue_address_line1 TEXT,venue_address_line2 TEXT,venue_city TEXT,venue_region TEXT,
      venue_postal_code TEXT,venue_country_code TEXT,venue_country TEXT,
      provider_active INTEGER NOT NULL DEFAULT 1,last_seen_at INTEGER,
      event_kind TEXT NOT NULL DEFAULT 'concert',music_qualified INTEGER NOT NULL DEFAULT 1,
      music_evidence TEXT,billed_artists TEXT NOT NULL DEFAULT '[]',event_end_date TEXT,
      event_source_url TEXT,event_image_url TEXT,event_image_attribution TEXT,
      event_image_width INTEGER,event_image_height INTEGER
    );
    CREATE TABLE media_objects (
      object_key TEXT PRIMARY KEY,owner_id TEXT NOT NULL,storage_scope TEXT NOT NULL,
      purpose TEXT,status TEXT NOT NULL
    );
    CREATE TABLE media_assets (
      id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,purpose TEXT NOT NULL,kind TEXT NOT NULL,
      source_key TEXT NOT NULL,source_url TEXT NOT NULL,source_storage_scope TEXT,source_etag TEXT,
      original_name TEXT,mime_type TEXT,byte_size INTEGER,width INTEGER,height INTEGER,duration_ms INTEGER,
      orientation INTEGER DEFAULT 0,metadata_status TEXT,codec_status TEXT,alt_text TEXT,status TEXT,
      edit_recipe TEXT DEFAULT '{}',recipe_version INTEGER DEFAULT 1,source_verified_at INTEGER,
      render_state TEXT,render_variant_id TEXT,poster_variant_id TEXT,created_at INTEGER,updated_at INTEGER
    );
    CREATE TABLE media_variants (
      id TEXT PRIMARY KEY,asset_id TEXT NOT NULL,role TEXT NOT NULL,object_key TEXT NOT NULL,
      public_url TEXT NOT NULL,mime_type TEXT,byte_size INTEGER,width INTEGER,height INTEGER,time_ms INTEGER,
      status TEXT,verification_origin TEXT
    );
    CREATE TABLE post_media (
      post_id TEXT NOT NULL,asset_id TEXT NOT NULL,position INTEGER NOT NULL,created_at INTEGER,
      PRIMARY KEY(post_id,asset_id)
    );
    CREATE TABLE venue_reviews (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,venue_key TEXT NOT NULL,rating REAL,text TEXT,
      photos TEXT NOT NULL DEFAULT '[]',photos_public INTEGER NOT NULL DEFAULT 0,
      removed INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL
    );
  `);
  return database;
}

function addUser(database, id, { name = id, handle = id, banned = false, suspended = false, bio = "", searchIndexingOptOut = false } = {}) {
  database.prepare(`INSERT INTO users
    (id,name,handle,artist_name,bio,avatar_uri,banner,created_at,is_banned,suspended_until,extras)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, name, handle, null, bio, null, null, 100, banned ? 1 : 0,
    suspended ? Date.now() + 86_400_000 : null,
    JSON.stringify(searchIndexingOptOut ? { searchIndexingOptOut: true } : {}),
  );
}

function addArtist(database, {
  key = "alpha", name = "Alpha", bio = "A real artist biography.", genre = "Rock", mbid = ARTIST_MBID,
  data = {},
} = {}) {
  database.prepare(`INSERT INTO artists
    (norm,name,public_slug,genre,data,bio,mbid,country,formed,popularity,rank_score,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(key, name, key, genre, JSON.stringify(data), bio, mbid, "Canada", "2012", 90, 100, 200);
}

function saveMemorial(database, overrides = {}) {
  const memorials = createArtistMemorialService({ repository: createArtistMemorialRepository(database) });
  return memorials.upsert({
    status: "published",
    deathDate: "2026-08-25",
    summary: "A generous songwriter whose work gave generations a place to gather and remember.",
    thankYou: "Thank you for the songs and the rooms they filled.",
    accomplishments: ["A lasting songbook", "Decades of memorable performances"],
    sourceUrl: "https://news.example.org/artist/confirmed",
    sourceTitle: "Verified public announcement",
    confirmedIndividual: true,
    restartSpotlight: false,
    ...overrides,
  }, {
    artistKey: "alpha",
    artistName: "Alpha",
    artistMbid: ARTIST_MBID,
    at: NOW,
  });
}

function addPost(database, {
  id,
  userId = "active",
  artist = "Alpha",
  artistKey = "alpha",
  venue = "History",
  review = "An unforgettable night.",
  setlist = [],
  tour = null,
  photos = [],
  photosPublic = true,
  kind = "review",
  removed = false,
  createdAt = 1_000,
  overall = 4.5,
  date = "2026-08-20",
  city = "Toronto",
  experienceType = "in_person",
  onlineTitle = null,
  youtubeUrl = null,
  youtubeVideoId = null,
} = {}) {
  database.prepare(`INSERT INTO posts
    (id,user_id,artist,artist_key,venue,venue_key,city,date,overall,review,setlist,tour,photos,photos_public,kind,removed,
      experience_type,online_title,youtube_url,youtube_video_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, userId, artist, artistKey, venue, venue.toLowerCase(), city, date, overall, review,
    typeof setlist === "string" ? setlist : JSON.stringify(setlist), tour,
    JSON.stringify(photos), photosPublic ? 1 : 0, kind, removed ? 1 : 0,
    experienceType, onlineTitle, youtubeUrl, youtubeVideoId, createdAt, createdAt + 1,
  );
}

function addReadyImage(database, { assetId, ownerId, url, postId = null, purpose = "post" }) {
  const sourceKey = `private/${assetId}`;
  const renderKey = `public/${assetId}.jpg`;
  const variantId = `variant-${assetId}`;
  database.prepare("INSERT INTO media_objects (object_key,owner_id,storage_scope,purpose,status) VALUES (?,?,?,?,?)")
    .run(sourceKey, ownerId, "private", purpose, "associated");
  database.prepare("INSERT INTO media_objects (object_key,owner_id,storage_scope,purpose,status) VALUES (?,?,?,?,?)")
    .run(renderKey, ownerId, "public", purpose, "associated");
  database.prepare(`INSERT INTO media_assets
    (id,owner_id,purpose,kind,source_key,source_url,source_storage_scope,original_name,mime_type,byte_size,
      width,height,metadata_status,codec_status,alt_text,status,edit_recipe,source_verified_at,render_state,
      render_variant_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    assetId, ownerId, purpose, "image", sourceKey, `https://private.example/${assetId}`,
    "private", `${assetId}.jpg`, "image/jpeg", 100, 1200, 900, "declared", "not_applicable",
    "Fan photo", "ready", "{}", 10, "ready", variantId, 10, 10,
  );
  database.prepare(`INSERT INTO media_variants
    (id,asset_id,role,object_key,public_url,mime_type,byte_size,width,height,status,verification_origin)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    variantId, assetId, "render", renderKey, url, "image/jpeg", 90, 1200, 900,
    "verified", "private_derivative_v1",
  );
  if (postId) database.prepare("INSERT INTO post_media (post_id,asset_id,position,created_at) VALUES (?,?,0,10)").run(postId, assetId);
}

function addVenueReview(database, {
  id,
  userId = "active",
  venueKey = "freeform hall",
  rating = 4,
  text = "A detailed account of the room, sound, sightlines, staff, atmosphere, and accessibility.",
  photos = [],
  photosPublic = false,
  removed = false,
  createdAt = 1_000,
} = {}) {
  database.prepare(`INSERT INTO venue_reviews
    (id,user_id,venue_key,rating,text,photos,photos_public,removed,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(
    id, userId, venueKey, rating, text, JSON.stringify(photos), photosPublic ? 1 : 0, removed ? 1 : 0, createdAt,
  );
}

function addFinalizedProfileImage(database, {
  descriptorId,
  ownerId,
  url,
  purpose = "avatar",
  mimeType = "image/jpeg",
  width = 640,
  height = 640,
}) {
  ensureLegacyMediaFinalizeSchema(database);
  const stagingKey = `private/profile/${descriptorId}`;
  const outputKey = `public/profile/${descriptorId}`;
  database.prepare("INSERT INTO media_objects (object_key,owner_id,storage_scope,purpose,status) VALUES (?,?,?,?,?)")
    .run(outputKey, ownerId, "public", purpose, "associated");
  database.prepare(`INSERT INTO legacy_media_finalize_descriptors
    (id,owner_id,token_hash,purpose,staging_object_key,staging_mime_type,staging_byte_size,
      output_mime_type,output_object_key,output_url,output_byte_size,width,height,status,
      expires_at,consumed_at,finalized_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'finalized',?,?,?,?,?)`).run(
    descriptorId,
    ownerId,
    "0".repeat(64),
    purpose,
    stagingKey,
    mimeType,
    1_000,
    mimeType,
    outputKey,
    url,
    900,
    width,
    height,
    NOW + 86_400_000,
    NOW,
    NOW,
    NOW,
    NOW,
  );
}

function addReadyVideo(database, { assetId, ownerId, url, posterUrl, postId }) {
  const sourceKey = `private/${assetId}`;
  const renderKey = `public/${assetId}.mp4`;
  const posterKey = `public/${assetId}-poster.jpg`;
  const renderId = `render-${assetId}`;
  const posterId = `poster-${assetId}`;
  for (const [key, scope] of [[sourceKey, "private"], [renderKey, "public"], [posterKey, "public"]]) {
    database.prepare("INSERT INTO media_objects (object_key,owner_id,storage_scope,purpose,status) VALUES (?,?,?,?,?)")
      .run(key, ownerId, scope, "post", "associated");
  }
  database.prepare(`INSERT INTO media_assets
    (id,owner_id,purpose,kind,source_key,source_url,source_storage_scope,original_name,mime_type,byte_size,
      width,height,duration_ms,metadata_status,codec_status,alt_text,status,edit_recipe,source_verified_at,
      render_state,render_variant_id,poster_variant_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    assetId, ownerId, "post", "video", sourceKey, `https://private.example/${assetId}`, "private",
    `${assetId}.mp4`, "video/mp4", 1_000, 1280, 720, 45_000, "declared", "verified",
    "The encore from the crowd", "ready", JSON.stringify({ coverMs: 1_000 }), 10,
    "ready", renderId, posterId, 10, 10,
  );
  database.prepare(`INSERT INTO media_variants
    (id,asset_id,role,object_key,public_url,mime_type,byte_size,width,height,time_ms,status,verification_origin)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    renderId, assetId, "render", renderKey, url, "video/mp4", 900, 1280, 720, null,
    "verified", "video_verifier_v1",
  );
  database.prepare(`INSERT INTO media_variants
    (id,asset_id,role,object_key,public_url,mime_type,byte_size,width,height,time_ms,status,verification_origin)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    posterId, assetId, "poster", posterKey, posterUrl, "image/jpeg", 90, 1280, 720, 1_000,
    "verified", "private_derivative_v1",
  );
  database.prepare("INSERT INTO post_media (post_id,asset_id,position,created_at) VALUES (?,?,0,10)")
    .run(postId, assetId);
}

function service(database) {
  return createPublicDocumentService({ database, origin: "https://www.example.com" });
}

test("home document is substantive, contains WebSite JSON-LD, and excludes restricted authors without a member-count claim", () => {
  const database = createDatabase();
  try {
    addUser(database, "active", { name: "Active Fan", handle: "activefan" });
    addUser(database, "banned", { name: "Banned Secret", banned: true });
    addArtist(database);
    addPost(database, { id: "visible", review: "Crowd energy & joy <b>all night</b>, with a finale worth remembering." });
    addPost(database, { id: "hidden", userId: "banned", review: "BANNED PRIVATE COPY THAT MUST NEVER REACH A PUBLIC DOCUMENT" });
    addReadyImage(database, {
      assetId: "asset-home-post",
      ownerId: "active",
      url: "https://media.example/public/not-homepage-consented.jpg",
      postId: "visible",
    });

    const documents = service(database);
    const document = documents.homeDocument();
    const html = documents.render(document);

    assert.equal(document.jsonLd[0]["@type"], "WebSite");
    assert.equal(document.jsonLd[1]["@type"], "Organization");
    assert.equal(document.jsonLd[1].alternateName, "PIT");
    assert.equal(document.jsonLd[1].logo.url, "https://www.example.com/logo.svg");
    assert.equal(document.jsonLd[1].contactPoint.email, "support@mshpit.com");
    assert.equal(document.posts.length, 1);
    assert.deepEqual(document.posts[0].media, [], "ordinary post media is not republished by the marketing homepage");
    assert.match(html, /Crowd energy &amp; joy &lt;b&gt;all night&lt;\/b&gt;/);
    assert.doesNotMatch(html, /BANNED PRIVATE COPY/);
    assert.doesNotMatch(html, /\b\d[\d,]* members\b/i);
    assert.match(html, /<h1>The shows you saw\.<br \/><em>The taste you built\.<\/em><\/h1>/);
    assert.match(html, />Create an account<\/a>/);
    assert.match(html, />Browse shows and artists<\/a>/);
    assert.doesNotMatch(html, /Remember every show\.<br \/><em>Find your people/);
  } finally {
    database.close();
  }
});

test("crawler-readable artist surfaces never publish an unstructured legacy genre", () => {
  const database = createDatabase();
  try {
    const bio = "A substantive artist biography covering live history, recordings, tours, collaborators, venues, and fan context.";
    addArtist(database, {
      key: "legacy-alternative",
      name: "Legacy Alternative",
      bio,
      genre: "Alternative",
      data: {},
    });
    addArtist(database, {
      key: "verified-classical",
      name: "Verified Classical",
      bio,
      genre: "Alternative",
      data: { genreClaims: [{ value: "Classical", source: "staff", at: 2 }] },
    });

    const documents = service(database);
    const surfaces = [
      documents.homeDocument(),
      documents.discoverDocument({ at: NOW, today: "2026-08-25" }),
      documents.directoryDocument({ kind: "artists", at: NOW, today: "2026-08-25" }),
    ];
    for (const document of surfaces) {
      const legacy = document.artists.find((artist) => artist.name === "Legacy Alternative");
      const verified = document.artists.find((artist) => artist.name === "Verified Classical");
      assert.deepEqual(legacy?.genre, []);
      assert.deepEqual(verified?.genre, ["Classical"]);
      const html = documents.render(document);
      assert.doesNotMatch(html, />Alternative</);
      assert.match(html, /Classical/);
    }

    const legacyArtist = documents.artistDocument({ artistKey: "legacy-alternative", at: NOW });
    const verifiedArtist = documents.artistDocument({ artistKey: "verified-classical", at: NOW });
    assert.deepEqual(legacyArtist.artist.genres, []);
    assert.deepEqual(verifiedArtist.artist.genres, ["Classical"]);
    assert.doesNotMatch(documents.render(legacyArtist), />Alternative</);
  } finally {
    database.close();
  }
});

test("artist titles identify ambiguous names as music artists", () => {
  const database = createDatabase();
  try {
    addUser(database, "active", { name: "Active Fan", handle: "activefan" });
    const documents = service(database);
    for (const [key, name] of [["sports", "Sports."], ["automatic", "Automatic"]]) {
      addArtist(database, { key, name, bio: "" });
      addPost(database, {
        id: `${key}-review`,
        artist: name,
        artistKey: key,
        review: "A detailed concert review covering the performance, sound, crowd, and encore.",
      });
      const document = documents.artistDocument({ artistKey: key, at: NOW });
      assert.equal(document.title, `${name} — music artist reviews, photos & tour dates | Mshpit`);
      assert.equal(
        document.description,
        `Music artist page for ${name} on Mshpit: concert reviews, fan photos, ratings and upcoming tour dates. 4.5/5 live rating from 1 review.`,
      );
      assert.equal(document.description.length <= 160, true);
      assert.doesNotMatch(document.title, new RegExp(`^${name.replace(".", "\\.")} live\\b`, "iu"));
      assert.match(documents.render(document), /music artist reviews/);
    }
  } finally {
    database.close();
  }
});

test("artist document uses only active UGC and references Event leaf pages without duplicating MusicEvent", () => {
  const database = createDatabase();
  try {
    addUser(database, "active", { name: "Active Fan", handle: "activefan" });
    addUser(database, "artist-owner", { name: "Alpha", handle: "alphaofficial" });
    addUser(database, "banned", { name: "Banned Secret", banned: true });
    addArtist(database, { bio: "Catalog bio" });
    addPost(database, {
      id: "visible",
      review: "Wild lights </script><script>alert('x')</script>",
      photos: ["https://attacker.example/tracker.jpg"],
    });
    addPost(database, { id: "hidden", userId: "banned", review: "HIDDEN REVIEW" });
    addPost(database, { id: "private-gallery", review: "Text stays public but its gallery opt-in is off.", photosPublic: false, createdAt: 900 });
    const safeUrl = "https://media.example/public/visible.jpg";
    addReadyImage(database, { assetId: "asset-visible", ownerId: "active", url: safeUrl, postId: "visible" });
    addReadyImage(database, {
      assetId: "asset-private-gallery",
      ownerId: "active",
      url: "https://media.example/public/private-gallery.jpg",
      postId: "private-gallery",
    });
    const avatarUrl = "https://media.example/public/artist-avatar.jpg";
    addReadyImage(database, { assetId: "asset-avatar", ownerId: "artist-owner", url: avatarUrl, purpose: "review" });
    database.prepare(`INSERT INTO artist_profiles
      (artist_key,bio,banner,avatar_uri,feed_enabled,owner_id,removed,updated_at)
      VALUES (?,?,?,?,1,?,0,?)`).run("alpha", "Official artist bio", null, avatarUrl, "artist-owner", 300);
    database.prepare("INSERT INTO artist_posts (id,artist_key,user_id,text,removed,created_at) VALUES (?,?,?,?,0,?)")
      .run("update-visible", "alpha", "artist-owner", "New record out now.", 400);
    database.prepare("INSERT INTO artist_posts (id,artist_key,user_id,text,removed,created_at) VALUES (?,?,?,?,0,?)")
      .run("update-hidden", "alpha", "banned", "HIDDEN UPDATE", 500);
    database.prepare("INSERT INTO tour_dates (id,artist,venue,place,date,start_date_time,sold_out,owner_id,release_at,venue_city,venue_country_code) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run("event-public", "Alpha", "Global Hall", "London, UK", "2026-09-01", "2026-09-01T20:00:00+01:00", 0, null, 0, "London", "GB");
    database.prepare("INSERT INTO tour_dates (id,artist,venue,place,date,sold_out,owner_id,release_at) VALUES (?,?,?,?,?,?,?,?)")
      .run("event-hidden", "Alpha", "Secret Hall", "Nowhere", "2026-09-02", 0, "banned", 0);
    addArtist(database, { key: "bad-mbid", name: "Bad MBID", mbid: "not-a-musicbrainz-id" });

    const documents = service(database);
    const document = documents.artistDocument({ artistKey: "alpha", today: "2026-08-25", at: Date.now() });
    const html = documents.render(document);
    const eventDocument = documents.eventDocument({ id: "event-public", today: "2026-08-25", at: Date.now() });
    const invalidMbidDocument = documents.artistDocument({ artistKey: "bad-mbid", today: "2026-08-25", at: Date.now() });

    assert.equal(document.jsonLd[0]["@type"], "CollectionPage");
    assert.equal(document.jsonLd[0].about["@type"], "Thing");
    assert.equal(document.jsonLd[0].about["@id"], "https://www.example.com/artist/alpha#artist");
    assert.equal(document.jsonLd[0].about.disambiguatingDescription, "Music artist");
    assert.deepEqual(document.jsonLd[0].mainEntity, { "@id": "https://www.example.com/artist/alpha#artist" });
    assert.deepEqual(document.jsonLd[0].about.sameAs, [`https://musicbrainz.org/artist/${ARTIST_MBID}`]);
    assert.equal(Object.hasOwn(invalidMbidDocument.jsonLd[0].about, "sameAs"), false);
    assert.deepEqual(document.reviews.map((review) => review.id), ["visible", "private-gallery"]);
    assert.deepEqual(document.events.map((event) => event.id), ["event-public"]);
    assert.deepEqual(document.updates.map((update) => update.id), ["update-visible"]);
    assert.equal(document.reviews[0].media[0].url, safeUrl);
    assert.deepEqual(document.reviews[1].media, [], "artist aggregation honors the author's public-photo consent");
    assert.equal(document.image, avatarUrl);
    assert.equal(document.imageProvenance, "entity-profile");
    assert.equal(documents.postDocument({ id: "visible" }).imageProvenance, "same-post");
    assert.match(html, /media\.example\/public\/visible\.jpg/);
    assert.doesNotMatch(html, /attacker\.example|HIDDEN REVIEW|HIDDEN UPDATE|Secret Hall/);
    assert.doesNotMatch(html, /MusicEvent/, "the artist collection references the canonical event page instead of duplicating it");
    assert.match(html, /event-public/);
    assert.match(html, /class="stats artist-facts"/);
    assert.match(html, /<dt>Upcoming<\/dt><dd>1 show<\/dd>/);
    assert.match(html, /class="artist-next"[\s\S]*?Next show[\s\S]*?Global Hall/);
    assert.equal(document.jsonLd[0].hasPart[0]["@id"], "https://www.example.com/event/event-public#page");
    assert.equal(eventDocument.jsonLd[0]["@type"], "WebPage");
    assert.equal(eventDocument.event.address.addressLocality, "London");
    assert.equal(eventDocument.event.address.addressCountry, "GB");
    assert.equal(Object.hasOwn(eventDocument.jsonLd[0], "mainEntity"), false);
    assert.equal(eventDocument.jsonLd.some((node) => node["@type"] === "MusicEvent"), false);
    assert.doesNotMatch(html, /preload="metadata"/);
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;\/script&gt;&lt;script&gt;alert/);
    assert.equal(
      serializePublicStructuredData({ text: "</script><script>alert(1)</script>" }),
      '{"text":"\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e"}',
      "JSON-LD serialization cannot terminate its script element",
    );
  } finally {
    database.close();
  }
});

test("finalized profile images are owner and purpose bound and expose only trusted SEO metadata", () => {
  const database = createDatabase();
  try {
    addUser(database, "profile-owner", { name: "Profile Owner", handle: "profileowner" });
    addUser(database, "artist-owner", { name: "Alpha Artist", handle: "alphaartist" });
    addUser(database, "other-owner", { name: "Other Owner", handle: "otherowner" });
    addUser(database, "wrong-owner", { name: "Wrong Owner", handle: "wrongowner" });
    addUser(database, "wrong-purpose", { name: "Wrong Purpose", handle: "wrongpurpose" });
    addUser(database, "external-image", { name: "External Image", handle: "externalimage" });
    addArtist(database);

    const memberAvatarUrl = "https://media.example/public/profile-member-avatar.webp";
    const artistBannerUrl = "https://media.example/public/profile-artist-banner.jpg";
    const artistWrongAvatarUrl = "https://media.example/public/profile-artist-wrong-avatar.jpg";
    const seededArtistAvatarUrl = "https://media.example/public/profile-seeded-artist-avatar.jpg";
    const wrongOwnerUrl = "https://media.example/public/profile-other-owner.jpg";
    const wrongPurposeUrl = "https://media.example/public/profile-wrong-purpose.jpg";
    addFinalizedProfileImage(database, {
      descriptorId: "lm_profilememberavatar000001",
      ownerId: "profile-owner",
      url: memberAvatarUrl,
      purpose: "avatar",
      mimeType: "image/webp",
      width: 640,
      height: 640,
    });
    addFinalizedProfileImage(database, {
      descriptorId: "lm_profileartistbanner000001",
      ownerId: "artist-owner",
      url: artistBannerUrl,
      purpose: "banner",
      width: 1_600,
      height: 600,
    });
    addFinalizedProfileImage(database, {
      descriptorId: "lm_profileartistavatarwrong01",
      ownerId: "artist-owner",
      url: artistWrongAvatarUrl,
      purpose: "banner",
    });
    addFinalizedProfileImage(database, {
      descriptorId: "lm_profileseededartist000001",
      ownerId: "profile-owner",
      url: seededArtistAvatarUrl,
      purpose: "avatar",
    });
    addFinalizedProfileImage(database, {
      descriptorId: "lm_profileotherowner00000001",
      ownerId: "other-owner",
      url: wrongOwnerUrl,
      purpose: "avatar",
    });
    addFinalizedProfileImage(database, {
      descriptorId: "lm_profilewrongpurpose000001",
      ownerId: "wrong-purpose",
      url: wrongPurposeUrl,
      purpose: "banner",
    });

    database.prepare("UPDATE users SET avatar_uri=?,banner=? WHERE id=?")
      .run(memberAvatarUrl, "https://attacker.example/profile-banner.jpg", "profile-owner");
    database.prepare("UPDATE users SET avatar_uri=? WHERE id=?").run(wrongOwnerUrl, "wrong-owner");
    database.prepare("UPDATE users SET avatar_uri=? WHERE id=?").run(wrongPurposeUrl, "wrong-purpose");
    database.prepare("UPDATE users SET avatar_uri=? WHERE id=?")
      .run("https://attacker.example/profile-avatar.jpg", "external-image");
    database.prepare(`INSERT INTO artist_profiles
      (artist_key,bio,banner,avatar_uri,feed_enabled,owner_id,removed,updated_at)
      VALUES (?,?,?,?,1,?,0,?)`).run(
      "alpha",
      "Official artist profile",
      artistBannerUrl,
      artistWrongAvatarUrl,
      "artist-owner",
      NOW,
    );
    addArtist(database, { key: "seeded-artist", name: "Seeded Artist" });
    database.prepare(`INSERT INTO artist_profiles
      (artist_key,bio,avatar_uri,avatar_owner_id,feed_enabled,owner_id,removed,updated_at)
      VALUES (?,?,?,?,0,NULL,0,?)`).run(
      "seeded-artist", "Staff-seeded catalog profile", seededArtistAvatarUrl, "profile-owner", NOW,
    );
    addPost(database, { id: "profile-image-comment-post", userId: "profile-owner" });
    database.prepare("INSERT INTO comments (id,post_id,user_id,text,removed,created_at) VALUES (?,?,?,?,0,?)")
      .run("profile-image-comment", "profile-image-comment-post", "wrong-purpose", "Purpose-bound avatar check.", NOW);

    const documents = service(database);
    const member = documents.memberDocument({ handle: "profileowner" });
    const memberHtml = documents.render(member);
    assert.equal(database.prepare("SELECT COUNT(*) total FROM media_assets WHERE owner_id IN (?,?)")
      .get("profile-owner", "artist-owner").total, 0, "the regression fixture uses finalized descriptors, not stable media assets");
    assert.equal(member.member.avatar, memberAvatarUrl);
    assert.equal(member.member.banner, null);
    assert.equal(member.image, memberAvatarUrl);
    assert.equal(member.imageWidth, 640);
    assert.equal(member.imageHeight, 640);
    assert.equal(member.imageMimeType, "image/webp");
    assert.deepEqual(member.jsonLd[0].mainEntity.image, {
      "@type": "ImageObject",
      contentUrl: memberAvatarUrl,
      url: memberAvatarUrl,
      name: "Profile Owner profile photo",
      width: 640,
      height: 640,
      encodingFormat: "image/webp",
    });
    assert.match(memberHtml, /<meta property="og:image:width" content="640"/);
    assert.match(memberHtml, /<meta property="og:image:height" content="640"/);
    assert.match(memberHtml, /<meta property="og:image:type" content="image\/webp"/);
    assert.doesNotMatch(memberHtml, /attacker\.example/);

    const artist = documents.artistDocument({ artistKey: "alpha", today: "2026-08-25", at: NOW });
    assert.equal(artist.image, artistBannerUrl);
    assert.equal(artist.imageWidth, 1_600);
    assert.equal(artist.imageHeight, 600);
    assert.equal(artist.imageMimeType, "image/jpeg");
    assert.deepEqual(artist.jsonLd[0].about.image, {
      "@type": "ImageObject",
      contentUrl: artistBannerUrl,
      url: artistBannerUrl,
      name: "Alpha profile banner",
      width: 1_600,
      height: 600,
      encodingFormat: "image/jpeg",
    });
    assert.doesNotMatch(JSON.stringify(artist), /profile-artist-wrong-avatar/);
    const seededArtist = documents.artistDocument({ artistKey: "seeded-artist", today: "2026-08-25", at: NOW });
    assert.equal(seededArtist.image, seededArtistAvatarUrl,
      "an unclaimed artist page projects staff-seeded art under the slot uploader");
    assert.equal(seededArtist.imageProvenance, "entity-profile");

    const wrongOwner = documents.memberDocument({ handle: "wrongowner" });
    const wrongPurpose = documents.memberDocument({ handle: "wrongpurpose" });
    const external = documents.memberDocument({ handle: "externalimage" });
    assert.equal(wrongOwner.member.avatar, null);
    assert.equal(wrongOwner.image, null);
    assert.equal(wrongPurpose.member.avatar, null);
    assert.equal(wrongPurpose.image, null);
    assert.equal(external.member.avatar, null);
    assert.equal(external.image, null);

    const post = documents.postDocument({ id: "profile-image-comment-post" });
    assert.equal(post.comments[0].author.avatar, null, "comment avatars enforce the avatar purpose too");
    assert.doesNotMatch(JSON.stringify(post), /profile-wrong-purpose/);
  } finally {
    database.close();
  }
});

test("canonical artist documents expose only an identity-bound published memorial", () => {
  const database = createDatabase();
  try {
    addArtist(database, { bio: "" });
    addUser(database, "active", { name: "Archive Fan", handle: "archivefan" });
    addPost(database, {
      id: "memorial-rated-history",
      review: "A detailed memory of the songs, the room, and the people who shared that historical concert night.",
      overall: 4.5,
      date: "2026-08-20",
      venue: "Archive Hall",
    });
    assert.equal(saveMemorial(database, {
      summary: "A generous <script>songwriter</script> whose work gave generations a place to gather and remember.",
      thankYou: "Thank you for the <strong>songs</strong> and the rooms they filled.",
      accomplishments: ["A <b>lasting</b> songbook", "Decades of memorable performances"],
      sourceTitle: "Verified <public> & announcement",
    }).ok, true);
    addPost(database, {
      id: "memorial-ratingless-memory",
      kind: "status",
      review: "A permanent fan memory about how these songs became part of our lives and brought people together.",
      overall: 0,
      date: "",
      venue: "",
    });
    database.prepare("UPDATE posts SET artist_mbid=? WHERE id=?")
      .run(ARTIST_MBID, "memorial-ratingless-memory");
    database.prepare(`INSERT INTO tour_dates
      (id,artist,artist_key,venue,place,date,ticket_url,source,updated_at,release_at,provider_active)
      VALUES (?,?,?,?,?,?,?,?,?,?,1)`).run(
      "memorial-future", "Alpha", "alpha", "Future Hall", "Toronto, Canada", "2026-09-25",
      "https://tickets.example/memorial-future", "ticketmaster", NOW, 0,
    );
    database.prepare(`INSERT INTO tour_dates
      (id,artist,artist_key,venue,place,date,source,updated_at,release_at,provider_active)
      VALUES (?,?,?,?,?,?,?,?,?,1)`).run(
      "memorial-past", "Alpha", "alpha", "Archive Hall", "Toronto, Canada", "2026-08-20",
      "ticketmaster", NOW, 0,
    );
    database.prepare("UPDATE artist_memorials SET reviewer_secret=? WHERE artist_key=?")
      .run("PRIVATE REVIEWER AND AUDIT MATERIAL", "alpha");

    const documents = service(database);
    const canonical = documents.artistDocument({ artistKey: "alpha", at: NOW });
    const html = documents.render(canonical);
    assert.deepEqual(canonical.events, [], "a memorialized artist has no future tour dates");
    assert.equal(canonical.stats.averageRating, null, "the memorial profile does not project a live score");
    assert.equal(canonical.stats.reviewCount, 2, "historical writing and ratingless memories remain visible");
    assert.equal(canonical.concerts[0].averageRating, null);
    assert.equal(canonical.concerts[0].ratingCount, null);
    assert.equal(canonical.concerts[0].reviewCount, 1);
    assert.equal(canonical.reviews.some((post) => post.id === "memorial-ratingless-memory" && post.kind === "status" && post.rating == null), true);
    assert.equal(documents.eventDocument({ id: "memorial-future", today: "2026-08-25", at: NOW }), null);
    assert.ok(documents.eventDocument({ id: "memorial-past", today: "2026-08-25", at: NOW }),
      "historical event documents remain available");
    assert.deepEqual(canonical.memorial, {
      deathDate: "2026-08-25",
      summary: "A generous <script>songwriter</script> whose work gave generations a place to gather and remember.",
      thankYou: "Thank you for the <strong>songs</strong> and the rooms they filled.",
      accomplishments: ["A <b>lasting</b> songbook", "Decades of memorable performances"],
      citation: {
        url: "https://news.example.org/artist/confirmed",
        title: "Verified <public> & announcement",
      },
    });
    assert.equal(canonical.jsonLd[0].about["@type"], "Person");
    assert.equal(canonical.jsonLd[0].about.deathDate, "2026-08-25");
    assert.equal(canonical.jsonLd[0].about.subjectOf.citation.url, "https://news.example.org/artist/confirmed");
    assert.equal(canonical.jsonLd[0].dateModified, new Date(NOW).toISOString());
    assert.match(html, /id="memorial"/);
    assert.match(html, /Died <time datetime="2026-08-25">August 25, 2026<\/time>/);
    assert.match(html, /A generous &lt;script&gt;songwriter&lt;\/script&gt;/);
    assert.match(html, /A &lt;b&gt;lasting&lt;\/b&gt; songbook/);
    assert.match(html, /Thank you for the &lt;strong&gt;songs&lt;\/strong&gt;/);
    assert.match(html, /Verified &lt;public&gt; &amp; announcement/);
    assert.match(html, /Verified source: <a href="https:\/\/news\.example\.org\/artist\/confirmed"/);
    assert.match(html, /\\u003cscript\\u003esongwriter\\u003c\/script\\u003e/);
    assert.doesNotMatch(html, /<script>songwriter<\/script>|<strong>songs<\/strong>|<b>lasting<\/b>/);
    assert.doesNotMatch(html, /PRIVATE REVIEWER AND AUDIT MATERIAL|restartSpotlight|spotlightStartedAt/);
    assert.match(html, /<p class="eyebrow">In memory<\/p>/);
    assert.match(html, /<h2>Concert history<\/h2>/);
    assert.match(html, /<h2>Fan memories<\/h2>/);
    assert.match(html, /A permanent fan memory about how these songs/);
    assert.doesNotMatch(html, /Live rating|Top-rated concert nights|Top live reviews|Rated 4\.5 out of 5|4\.5<span>\/5<\/span>/);

    const historicalConcert = documents.concertDocument({
      showKey: canonical.concerts[0].key,
      today: "2026-08-25",
      at: NOW,
    });
    assert.equal(historicalConcert.concert.averageRating, 4.5,
      "the exact historical concert retains its real rating outside the memorial profile rollup");

    const nonCanonical = documents.artistDocument({
      artistKey: "alpha", canonicalPath: "/alpha", at: NOW,
    });
    assert.equal(nonCanonical.memorial, null);
    assert.equal(nonCanonical.jsonLd[0].about["@type"], "Thing");
    assert.equal(Object.hasOwn(nonCanonical.jsonLd[0].about, "deathDate"), false);

    database.prepare(`UPDATE artist_memorials SET status='draft',published_at=NULL,
      spotlight_started_at=NULL WHERE artist_key=?`).run("alpha");
    const draft = documents.artistDocument({ artistKey: "alpha", at: NOW });
    assert.equal(draft.memorial, null);
    assert.equal(draft.jsonLd[0].about["@type"], "Thing");

    database.prepare(`UPDATE artist_memorials SET status='published',published_at=?,
      spotlight_started_at=?,artist_mbid=? WHERE artist_key=?`).run(NOW, NOW, OTHER_MBID, "alpha");
    const mismatched = documents.artistDocument({ artistKey: "alpha", at: NOW });
    assert.equal(mismatched.memorial, null);
    assert.equal(mismatched.jsonLd[0].about["@type"], "Thing");
  } finally {
    database.close();
  }
});

test("member and post documents fail closed for restricted accounts and expose only active comments", () => {
  const database = createDatabase();
  try {
    addUser(database, "active", { name: "A & B", handle: "musicfan", bio: "I remember every room." });
    addUser(database, "commenter", { name: "Visible Commenter", handle: "visiblecomment" });
    addUser(database, "banned", { name: "Banned Secret", banned: true });
    addUser(database, "suspended", { name: "Suspended Secret", handle: "suspended", suspended: true });
    addUser(database, "search-private", { name: "Search Private", handle: "searchprivate", searchIndexingOptOut: true });
    addArtist(database);
    addPost(database, {
      id: "visible",
      review: "The encore was perfect.",
      photos: ["https://attacker.example/legacy.jpg"],
    });
    addPost(database, { id: "restricted-post", userId: "suspended", review: "PRIVATE SUSPENDED POST" });
    database.prepare("INSERT INTO comments (id,post_id,user_id,text,removed,created_at) VALUES (?,?,?,?,0,?)")
      .run("comment-visible", "visible", "commenter", "Same — that finale!", 2_000);
    database.prepare("INSERT INTO comments (id,post_id,user_id,parent_id,text,removed,created_at) VALUES (?,?,?,?,?,0,?)")
      .run("comment-reply", "visible", "commenter", "comment-visible", "Exactly — the whole room sang.", 2_001);
    database.prepare("INSERT INTO comments (id,post_id,user_id,text,removed,created_at) VALUES (?,?,?,?,0,?)")
      .run("comment-hidden", "visible", "banned", "HIDDEN COMMENT", 2_001);
    database.prepare("INSERT INTO likes (post_id,user_id) VALUES (?,?)").run("visible", "commenter");
    database.prepare("INSERT INTO likes (post_id,user_id) VALUES (?,?)").run("visible", "banned");

    const documents = service(database);
    const member = documents.memberDocument({ handle: "musicfan" });
    const post = documents.postDocument({ id: "visible" });
    const html = documents.render(post);

    assert.equal(member.member.name, "A & B");
    assert.equal(documents.memberDocument({ handle: "searchprivate" }), null,
      "the document service honors the account's explicit search-indexing opt-out");
    assert.equal(documents.memberDocument({ handle: "suspended" }), null);
    assert.equal(documents.postDocument({ id: "restricted-post" }), null);
    assert.deepEqual(post.jsonLd[0]["@type"], ["DiscussionForumPosting", "SocialMediaPosting"]);
    assert.equal(Object.hasOwn(member.jsonLd[0], "interactionStatistic"), false);
    assert.equal(member.jsonLd[0].mainEntity.interactionStatistic[0].interactionType, "https://schema.org/FollowAction");
    assert.equal(post.jsonLd[0].comment.length, 1, "only root comments are attached directly to the posting");
    assert.equal(post.jsonLd[0].comment[0].comment[0]["@id"], "https://www.example.com/post/visible#comment-comment-reply");
    assert.equal(Object.hasOwn(post.jsonLd[0].comment[0], "dateCreated"), false);
    assert.equal(post.jsonLd[0].comment[0].datePublished, new Date(2_000).toISOString());
    assert.equal(post.post.likes, 1, "restricted likes never enter public interaction totals");
    assert.equal(post.post.comments, 2, "restricted comments never enter public interaction totals");
    assert.deepEqual(post.comments.map((comment) => comment.id), ["comment-visible", "comment-reply"]);
    assert.equal(post.post.media.length, 0, "unverified legacy URLs fail closed");
    assert.match(html, /Same — that finale!/);
    assert.match(html, /Exactly — the whole room sang\./);
    assert.doesNotMatch(html, /HIDDEN COMMENT|attacker\.example|PRIVATE SUSPENDED POST|MusicEvent/);
  } finally {
    database.close();
  }
});

test("historical concert documents expose only real 1-to-5 fan ratings", () => {
  const database = createDatabase();
  try {
    addUser(database, "active", { name: "Active Fan", handle: "activefan" });
    addUser(database, "gallery", { name: "Gallery Fan", handle: "galleryfan" });
    addArtist(database);
    addPost(database, {
      id: "archive-review",
      review: "A detailed firsthand review of the room, performance, crowd, and encore that night.",
      setlist: ["Opening Song", "Finale"],
      tour: "Summer Lights Tour",
    });
    addPost(database, {
      id: "archive-media-only",
      userId: "gallery",
      review: "",
      overall: null,
      createdAt: 2_000,
    });
    addReadyImage(database, { assetId: "archive-photo", ownerId: "gallery", postId: "archive-media-only", url: "https://media.example/public/archive-photo.jpg" });
    database.prepare("INSERT INTO tour_dates (id,artist,venue,place,date,start_date_time,release_at,venue_city,venue_country_code) VALUES (?,?,?,?,?,?,?,?,?)")
      .run("archive-event", "Alpha", "History", "Toronto, Canada", "2026-08-20", "2026-08-20T20:00:00-04:00", 0, "Toronto", "CA");
    database.prepare("UPDATE tour_dates SET venue_address_line1=? WHERE id=?").run("123 Archive Street", "archive-event");
    const showKey = archiveShowKey({
      artistIdentity: "alpha",
      venueIdentity: "history",
      date: "2026-08-20",
    });
    const documents = service(database);
    const document = documents.concertDocument({ showKey, today: "2026-08-25" });
    const html = documents.render(document);
    const event = document.jsonLd[0];
    assert.equal(event["@type"], "MusicEvent");
    assert.equal(event.aggregateRating.ratingValue, 4.5);
    assert.equal(event.aggregateRating.ratingCount, 1);
    assert.equal(event.aggregateRating.reviewCount, 2);
    assert.equal(Object.hasOwn(event, "eventStatus"), false, "past events never claim EventScheduled");
    assert.equal(document.jsonLd[1]["@type"], "CollectionPage");
    assert.equal(event.aggregateRating.worstRating, 1);
    assert.equal(event.aggregateRating.bestRating, 5);
    assert.equal(event.review.length, 1, "media-only memories without a rating remain HTML but are not Review schema");
    assert.equal(event.review[0].reviewRating.worstRating, 1);
    assert.equal(event.review[0].itemReviewed["@id"], event["@id"]);
    assert.equal(event.review.every((review) => review.reviewRating.ratingValue >= 1 && review.reviewRating.ratingValue <= 5), true);
    assert.equal(Object.hasOwn(document.jsonLd[1], "hasPart"), false, "the collection never points at undefined #review nodes");
    assert.equal(document.reviews.some((review) => review.id === "archive-media-only" && review.media.length === 1), true);
    assert.equal(html.includes("Summer Lights Tour"), true);
    assert.equal(html.includes("Setlist shared by"), true);
    assert.equal(html.includes("Opening Song"), true);
    assert.equal(html.includes("Finale"), true);
    assert.equal(html.includes("123 Archive Street"), true);
    assert.equal(html.includes('href="/concerts"'), true);
    assert.equal(JSON.stringify(document.jsonLd).includes("EventSeries"), false);
    assert.match(html, /archive-photo\.jpg/);
  } finally {
    database.close();
  }
});


test("concert aggregates count distinct people and use each person's latest valid rating", () => {
  const database = createDatabase();
  try {
    addArtist(database);
    const review = "A detailed firsthand account of the performance, crowd, sound, lights, and encore.";
    for (let index = 0; index < 12; index += 1) {
      const userId = `five-star-fan-${index}`;
      addUser(database, userId, { name: `Five Star Fan ${index}`, handle: `fivefan${index}` });
      addPost(database, {
        id: `five-star-${index}`,
        userId,
        review,
        overall: 5,
        date: "2026-08-19",
        createdAt: 1_000 + index,
      });
    }
    addUser(database, "mixed-rater", { name: "Mixed Rater", handle: "mixedrater" });
    addUser(database, "legacy-rater", { name: "Legacy Rater", handle: "legacyrater" });
    addPost(database, { id: "mixed-old-valid", userId: "mixed-rater", review, overall: 1, date: "2026-08-19", createdAt: 4_000 });
    addPost(database, { id: "mixed-latest-valid", userId: "mixed-rater", review, overall: 3, date: "2026-08-19", createdAt: 5_000 });
    addPost(database, { id: "mixed-newer-invalid", userId: "mixed-rater", review, overall: 0, date: "2026-08-19", createdAt: 6_000 });
    addPost(database, { id: "legacy-zero", userId: "legacy-rater", review, overall: 0, date: "2026-08-19", createdAt: 5 });
    database.prepare("INSERT INTO tour_dates (id,artist,venue,date,start_date_time,release_at,venue_city,venue_country_code) VALUES (?,?,?,?,?,?,?,?)")
      .run("skew-event", "Alpha", "History", "2026-08-19", "2026-08-19T20:00:00-04:00", 0, "Toronto", "CA");
    database.prepare("UPDATE tour_dates SET venue_address_line1=? WHERE id=?").run("123 Archive Street", "skew-event");

    const showKey = archiveShowKey({
      artistIdentity: "alpha",
      venueIdentity: "history",
      date: "2026-08-19",
    });
    const documents = service(database);
    const document = documents.concertDocument({ showKey, today: "2026-08-25" });
    const artistDocument = documents.artistDocument({ artistKey: "alpha", today: "2026-08-25" });
    const event = document.jsonLd[0];

    assert.equal(document.reviews.length, 12);
    assert.equal(document.concert.reviewCount, 14);
    assert.equal(document.concert.ratingCount, 13);
    assert.ok(Math.abs(document.concert.averageRating - (63 / 13)) < 1e-9);
    assert.equal(event.aggregateRating.ratingValue, 4.85);
    assert.equal(event.aggregateRating.ratingCount, 13);
    assert.equal(event.aggregateRating.reviewCount, 14);
    assert.equal(event.review.every((item) => item.reviewRating.ratingValue >= 1 && item.reviewRating.ratingValue <= 5), true);
    const authorRefs = event.review.map((item) => item.author.alternateName);
    assert.equal(new Set(authorRefs).size, authorRefs.length, "one member cannot contribute duplicate Review nodes");
    const mixedReview = event.review.find((item) => item.author.alternateName === "@mixedrater");
    assert.equal(mixedReview.reviewRating.ratingValue, 3, "the latest valid rating wins and a newer legacy zero cannot erase it");
    const artistArchive = artistDocument.concerts.find((concert) => concert.date === "2026-08-19");
    assert.equal(artistArchive.reviewCount, 14);
    assert.equal(artistArchive.ratingCount, 13);
    assert.ok(Math.abs(artistArchive.averageRating - (63 / 13)) < 1e-9);
  } finally {
    database.close();
  }
});
test("concert pages keep media visible but emit no Review schema without an address-backed event", () => {
  const database = createDatabase();
  try {
    addUser(database, "rated-memory", { name: "Rated Memory", handle: "ratedmemory" });
    addUser(database, "gallery-memory", { name: "Gallery Memory", handle: "gallerymemory" });
    addPost(database, {
      id: "unlisted-rated",
      userId: "rated-memory",
      artist: "Unlisted Artist",
      artistKey: null,
      venue: "Archive Room",
      date: "2026-08-18",
      review: "A detailed firsthand review of an unlisted artist, the room, the crowd, and the encore.",
    });
    addPost(database, {
      id: "unlisted-gallery",
      userId: "gallery-memory",
      artist: "Unlisted Artist",
      artistKey: null,
      venue: "Archive Room",
      date: "2026-08-18",
      review: "",
      overall: null,
      createdAt: 2_000,
    });
    addReadyImage(database, { assetId: "unlisted-photo", ownerId: "gallery-memory", postId: "unlisted-gallery", url: "https://media.example/public/unlisted-photo.jpg" });
    const showKey = archiveShowKey({
      artistIdentity: "Unlisted Artist",
      venueIdentity: "Archive Room",
      date: "2026-08-18",
    });
    const documents = service(database);
    const document = documents.concertDocument({ showKey, today: "2026-08-25" });
    const html = documents.render(document);
    const serialized = JSON.stringify(document.jsonLd);

    assert.deepEqual(document.jsonLd.map((item) => item["@type"]), ["CollectionPage", "BreadcrumbList"]);
    assert.doesNotMatch(serialized, /"@type":"Review"/);
    assert.doesNotMatch(serialized, /#review/);
    assert.equal(document.concert.artistPath, null);
    assert.equal(Object.hasOwn(document.jsonLd[0].about[0], "url"), false);
    assert.equal(document.breadcrumbs.some((crumb) => crumb.name === "Unlisted Artist"), false);
    assert.equal(document.reviews.some((review) => review.id === "unlisted-gallery" && review.media.length === 1), true);
    assert.match(html, /Unlisted Artist/);
    assert.match(html, /unlisted-photo\.jpg/);
    assert.doesNotMatch(html, /href="\/artist\//);
  } finally {
    database.close();
  }
});
test("event ticket offers require a supported future purchasable state and missing artists stay plain text", () => {
  const database = createDatabase();
  try {
    database.prepare(`INSERT INTO tour_dates
      (id,artist,venue,date,start_date_time,ticket_url,event_status,venue_city,venue_country_code,release_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      "unknown-event",
      "Unlisted Touring Artist",
      "World Hall",
      "2026-09-01",
      "2026-09-01T20:00:00-04:00",
      "https://www.ticketmaster.ca/event/100",
      "scheduled",
      "Toronto",
      "CA",
      0,
    );
    const documents = service(database);
    const options = { id: "unknown-event", today: "2026-08-25", at: NOW };
    database.prepare("UPDATE tour_dates SET venue_address_line1=?,venue_address_line2=?,venue_region=?,venue_postal_code=?,venue_country=? WHERE id=?").run("100 World Hall Way", "Suite 2", "Ontario", "M5V 2T6", "Canada", "unknown-event");
    const scheduled = documents.eventDocument(options);
    const scheduledHtml = documents.render(scheduled);

    assert.equal(scheduled.jsonLd[0]["@type"], "MusicEvent");
    assert.equal(scheduled.jsonLd[0].location["@type"], "Place");
    assert.deepEqual(scheduled.jsonLd[0].performer, [{
      "@type": "MusicGroup",
      name: "Unlisted Touring Artist",
    }]);
    assert.equal(scheduled.jsonLd[0].offers.url, "https://www.ticketmaster.ca/event/100");
    assert.equal(Object.hasOwn(scheduled.jsonLd[0].offers, "availability"), false);
    assert.equal(scheduled.event.ticketUrl, "https://www.ticketmaster.ca/event/100");
    assert.equal(scheduled.event.artistPath, null);
    assert.equal(scheduled.breadcrumbs.some((crumb) => crumb.name === "Unlisted Touring Artist"), false);
    assert.match(scheduledHtml, /Unlisted Touring Artist/);
    assert.equal(scheduledHtml.includes("100 World Hall Way, Suite 2"), true);
    assert.equal(scheduledHtml.includes("Toronto, Ontario M5V 2T6"), true);
    assert.equal(scheduledHtml.includes(">CA<"), true);
    assert.doesNotMatch(scheduledHtml, /href="\/artist\//);

    database.prepare("UPDATE tour_dates SET event_status=? WHERE id=?").run("offSale", "unknown-event");
    const offSale = documents.eventDocument(options);
    assert.equal(Object.hasOwn(offSale.jsonLd[0], "offers"), false);
    assert.equal(offSale.event.ticketUrl, null);
    assert.doesNotMatch(documents.render(offSale), /Buy tickets/);

    database.prepare("UPDATE tour_dates SET event_status=? WHERE id=?").run("unavailable", "unknown-event");
    const unavailable = documents.eventDocument(options);
    assert.equal(Object.hasOwn(unavailable.jsonLd[0], "offers"), false);
    assert.equal(unavailable.event.ticketUrl, null);

    database.prepare("UPDATE tour_dates SET event_status=? WHERE id=?").run("cancelled", "unknown-event");
    const cancelled = documents.eventDocument(options);
    assert.equal(Object.hasOwn(cancelled.jsonLd[0], "offers"), false);
    assert.equal(cancelled.event.ticketUrl, null);

    database.prepare("UPDATE tour_dates SET event_status=?,date=? WHERE id=?").run("scheduled", "2026-08-20", "unknown-event");
    const past = documents.eventDocument(options);
    assert.equal(past.jsonLd[0]["@type"], "MusicEvent");
    assert.equal(Object.hasOwn(past.jsonLd[0], "offers"), false);
    assert.equal(past.event.ticketUrl, null);
    assert.doesNotMatch(documents.render(past), /Buy tickets/);
  } finally {
    database.close();
  }
});

test("online concert reviews stay standalone and never become physical show or venue evidence", () => {
  const database = createDatabase();
  try {
    addUser(database, "active", { name: "Online Fan", handle: "onlinefan" });
    addArtist(database, { bio: "A detailed public artist biography with enough real information for this focused projection test." });
    addPost(database, {
      id: "online-review",
      experienceType: "online",
      onlineTitle: "Live from the Basement",
      youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      youtubeVideoId: "dQw4w9WgXcQ",
      review: "A thoughtful online concert review covering the performance, arrangement, and camera direction.",
      venue: "Should Never Render",
      city: "Nowhere",
      date: "2026-08-20",
      setlist: ["Should not become a physical setlist"],
      tour: "Should not become a physical tour",
    });

    const documents = service(database);
    const post = documents.postDocument({ id: "online-review" });
    const html = documents.render(post);
    assert.equal(post.post.experienceType, "online");
    assert.equal(post.post.onlineTitle, "Live from the Basement");
    assert.equal(post.post.youtubeUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.equal(post.post.venue, null);
    assert.equal(post.post.venuePath, null);
    assert.equal(post.post.city, null);
    assert.equal(post.post.showDate, null);
    assert.deepEqual(post.post.setlist, []);
    assert.equal(post.post.tour, null);
    assert.match(post.title, /Live from the Basement.*online concert review/i);
    assert.match(html, />Online concert</);
    assert.match(html, />Watch on YouTube</);
    assert.match(html, /target="_blank" rel="ugc nofollow noopener noreferrer"/);
    assert.doesNotMatch(html, /Should Never Render|Should not become a physical|MusicEvent|startDate|MusicVenue/);
    assert.equal(documents.concertDocument({
      showKey: archiveShowKey({ artistIdentity: "alpha", venueIdentity: "should never render", date: "2026-08-20" }),
      today: "2026-08-25",
    }), null);

    const artist = documents.artistDocument({ artistKey: "alpha", at: NOW });
    assert.equal(artist.reviews.some((review) => review.id === "online-review"), true,
      "online reviews remain useful artist fan activity");
    assert.equal(artist.stats.reviewCount, 0,
      "online scores never enter the artist's physical live rating");
  } finally {
    database.close();
  }
});

test("provider-evidenced festivals expose cohesive visible and structured event data", () => {
  const database = createDatabase();
  try {
    database.prepare(`INSERT INTO tour_dates
      (id,artist,venue,place,date,start_date_time,event_name,event_kind,music_qualified,
        music_evidence,billed_artists,event_end_date,venue_address_line1,venue_city,
        venue_country_code,source,provider_event_id,ticket_url,event_image_url,
        event_image_attribution,event_image_width,event_image_height,release_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`).run(
      "festival-event", "Headliner One", "Festival Park", "Chicago, IL",
      "2026-09-01", "2026-09-01T16:00:00-05:00", "Lollapalooza",
      "festival", 1, "ticketmaster:classification:music",
      JSON.stringify(["Headliner One", "Headliner Two"]), "2026-09-04",
      "1 Festival Way", "Chicago", "US", "ticketmaster", "tm-festival-1",
      "https://www.ticketmaster.com/event/tm-festival-1",
      "https://s1.ticketm.net/dam/a/festival.jpg", "Ticketmaster / promoter",
      1920, 1080,
    );
    const documents = service(database);
    const document = documents.eventDocument({
      id: "festival-event", today: "2026-08-25", at: NOW,
    });
    const html = documents.render(document);
    const schema = document.jsonLd.find((node) => node["@type"] === "MusicEvent");
    assert.equal(document.title, "Lollapalooza at Festival Park — 2026-09-01 | Mshpit");
    assert.equal(document.event.eventKind, "festival");
    assert.deepEqual(document.event.billedArtists, ["Headliner One", "Headliner Two"]);
    assert.equal(schema.name, "Lollapalooza");
    assert.equal(schema.endDate, "2026-09-04");
    assert.equal(schema.location["@type"], "Place");
    assert.deepEqual(schema.performer, [
      { "@type": "MusicGroup", name: "Headliner One" },
      { "@type": "MusicGroup", name: "Headliner Two" },
    ]);
    assert.deepEqual(schema.image, ["https://s1.ticketm.net/dam/a/festival.jpg"]);
    assert.equal(document.image, "https://s1.ticketm.net/dam/a/festival.jpg");
    assert.equal(document.imageProvenance, "provider");
    assert.equal(document.imageWidth, 1920);
    assert.equal(document.imageHeight, 1080);
    assert.match(html, /<h1>Lollapalooza<\/h1>/);
    assert.match(html, /Lineup:<\/strong> Headliner One · Headliner Two/);
    assert.match(html, /src="https:\/\/s1\.ticketm\.net\/dam\/a\/festival\.jpg"/);
    assert.match(html, /Ticketmaster \/ promoter · <a href="https:\/\/www\.ticketmaster\.com\/event\/tm-festival-1"/);

    database.prepare("UPDATE tour_dates SET music_qualified=0 WHERE id=?").run("festival-event");
    assert.equal(documents.eventDocument({ id: "festival-event", today: "2026-08-25", at: NOW }), null);
  } finally {
    database.close();
  }
});

test("a public review links to its concert projection without copying provider art into the post", () => {
  const database = createDatabase();
  try {
    addUser(database, "active", { name: "Active Fan", handle: "activefan" });
    addArtist(database);
    addPost(database, {
      id: "provider-art-review",
      review: "A detailed review of a memorable set with enough public context for the concert archive.",
      date: "2026-08-20",
    });
    database.prepare(`INSERT INTO tour_dates
      (id,artist,artist_key,venue,place,date,source,provider_event_id,ticket_url,
        event_image_url,event_image_attribution,event_image_width,event_image_height,
        venue_city,venue_country_code,release_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`).run(
      "provider-art-event", "Alpha", "alpha", "History", "Toronto, Ontario, Canada",
      "2026-08-20", "ticketmaster", "tm-provider-art",
      "https://www.ticketmaster.com/event/tm-provider-art",
      "https://s1.ticketm.net/dam/a/provider-art.jpg", "Ticketmaster / promoter",
      1920, 1080, "Toronto", "CA",
    );
    const documents = service(database);
    const post = documents.postDocument({ id: "provider-art-review" });
    const key = archiveShowKey({ artistIdentity: "alpha", venueIdentity: "history", date: "2026-08-20" });
    assert.equal(post.post.concertPath, `/concert/${encodeURIComponent(key)}`);
    assert.equal(post.image, null, "provider art is not misrepresented as media uploaded with the review");

    const concert = documents.concertDocument({ showKey: key, today: "2026-08-25" });
    assert.deepEqual(concert.concert.providerImage, {
      url: "https://s1.ticketm.net/dam/a/provider-art.jpg",
      attribution: "Ticketmaster / promoter",
      width: 1920,
      height: 1080,
      sourcePage: "https://www.ticketmaster.com/event/tm-provider-art",
    });
  } finally {
    database.close();
  }
});
test("a verified prominent clip emits matching VideoObject, Open Graph, dimensions, and visible HTML", () => {
  const database = createDatabase();
  try {
    addUser(database, "active", { name: "Clip Fan", handle: "clipfan" });
    addPost(database, {
      id: "video-post",
      review: "A detailed account of the finale, stage production, crowd reaction, and the encore captured in this clip.",
    });
    addReadyVideo(database, {
      assetId: "asset-video",
      ownerId: "active",
      postId: "video-post",
      url: "https://media.example/public/encore.mp4",
      posterUrl: "https://media.example/public/encore-poster.jpg",
    });
    const documents = service(database);
    const document = documents.postDocument({ id: "video-post" });
    const html = documents.render(document);
    const videoObject = document.jsonLd[0].video[0];
    assert.equal(videoObject.contentUrl, "https://media.example/public/encore.mp4");
    assert.deepEqual(videoObject.thumbnailUrl, ["https://media.example/public/encore-poster.jpg"]);
    assert.equal(videoObject.duration, "PT45S");
    assert.match(html, /<meta property="og:video" content="https:\/\/media\.example\/public\/encore\.mp4"/);
    assert.match(html, /<video controls preload="metadata" playsinline poster="https:\/\/media\.example\/public\/encore-poster\.jpg" width="1280" height="720"/);
    assert.match(html, /<figcaption>The encore from the crowd<\/figcaption>/);
  } finally {
    database.close();
  }
});

test("incomplete legacy media does not emit an incomplete posting schema", () => {
  const database = createDatabase();
  try {
    addUser(database, "active", { name: "Legacy Fan", handle: "legacyfan" });
    addPost(database, {
      id: "legacy-empty",
      review: "",
      photos: ["https://attacker.example/unverified-legacy.mp4"],
    });

    const document = service(database).postDocument({ id: "legacy-empty" });
    assert.ok(document);
    assert.equal(document.post.media.length, 0);
    assert.deepEqual(document.jsonLd.map((item) => item["@type"]), ["BreadcrumbList"]);
  } finally {
    database.close();
  }
});

test("verified post images are ImageObjects and the public artist directory is substantive and bounded", () => {
  const database = createDatabase();
  try {
    addUser(database, "active", { name: "Image Fan", handle: "imagefan" });
    addPost(database, {
      id: "image-post",
      review: "A detailed account of the sound, crowd, stage production, set list, and memorable encore.",
    });
    addReadyImage(database, {
      assetId: "schema-image",
      ownerId: "active",
      postId: "image-post",
      url: "https://media.example/public/schema-image.jpg",
    });
    const imageDocument = service(database).postDocument({ id: "image-post" });
    assert.equal(imageDocument.jsonLd[0].image[0]["@type"], "ImageObject");
    assert.equal(imageDocument.jsonLd[0].image[0].contentUrl, "https://media.example/public/schema-image.jpg");
    assert.equal(Object.hasOwn(imageDocument.jsonLd[0], "associatedMedia"), false);

    const longBio = "A substantive artist biography covering live history, musical style, recordings, tours, collaborators, and fan context.";
    for (let index = 0; index < 205; index += 1) {
      const key = `artist-${String(index).padStart(3, "0")}`;
      addArtist(database, { key, name: key, bio: longBio });
    }
    addArtist(database, { key: "thin-only", name: "thin-only", bio: "Thin catalog row" });

    const documents = service(database);
    const directory = documents.directoryDocument({ kind: "artists", at: NOW, today: "2026-08-25" });
    assert.equal(directory.artists.length, 12);
    const firstPage = documents.directoryDocument({ kind: "artists", limit: 12, page: 1, at: NOW, today: "2026-08-25" });
    const secondPage = documents.directoryDocument({ kind: "artists", limit: 12, page: 2, at: NOW, today: "2026-08-25" });
    assert.equal(firstPage.nextPath, "/artists/page/2");
    assert.equal(secondPage.previousPath, "/artists");
    assert.notEqual(firstPage.artists[0].name, secondPage.artists[0].name);
    assert.match(documents.render(secondPage), /href="\/artists">Previous page<\/a>/);

    // Page 1 is the collection's canonical entry point; every later slice is the
    // same boilerplate title and description over a different window of rows.
    // Indexing them produced 1,640 near-duplicate pages whose "Page 485" titles
    // won the site's sitelinks away from real content. noindex,follow keeps the
    // crawler walking the list through to each leaf while dropping the slices.
    assert.equal(firstPage.indexable, true);
    assert.equal(secondPage.indexable, false);
    const firstHtml = documents.render(firstPage);
    const secondHtml = documents.render(secondPage);
    assert.match(firstHtml, /name="robots" content="index,follow/);
    assert.match(firstHtml, /rel="canonical" href="[^"]*\/artists"/);
    assert.match(secondHtml, /name="robots" content="noindex,follow"/);
    // `follow` is what keeps every leaf entity reachable from the slice.
    assert.doesNotMatch(secondHtml, /content="noindex,nofollow"/);

    assert.equal(directory.artists.some((artist) => artist.name === "thin-only"), false);
    for (const artist of directory.artists.slice(0, 3)) {
      const resolved = documents.artistDocument({ artistKey: artist.name, at: NOW });
      assert.ok(resolved);
      assert.ok(resolved.description.length >= 80);
    }
  } finally {
    database.close();
  }
});

test("Discover is a substantive public hub while Search stays useful and noindex", () => {
  const database = createDatabase();
  try {
    addUser(database, "active", { name: "Discovery Fan", handle: "discoveryfan" });
    addUser(database, "banned", { name: "Restricted Fan", handle: "restrictedfan", banned: true });
    addArtist(database, {
      key: "discover-artist",
      name: "Discover Artist",
      bio: "A substantive artist biography about recordings, tours, collaborators, live performance history, and the community around the music.",
    });
    addPost(database, {
      id: "discover-review",
      artist: "Discover Artist",
      artistKey: "discover-artist",
      review: "A detailed fan review of the sound, crowd, musicianship, stage production, and an encore everyone kept talking about.",
    });
    addPost(database, {
      id: "restricted-discover-review",
      userId: "banned",
      artist: "Discover Artist",
      artistKey: "discover-artist",
      review: "RESTRICTED DISCOVERY COPY THAT MUST NEVER BE PUBLISHED",
    });
    database.prepare(`INSERT INTO tour_dates
      (id,artist,venue,place,date,source,release_at,venue_city,venue_country_code,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      "discover-event", "Discover Artist", "Discovery Hall", "London, United Kingdom",
      "2026-12-05", "ticketmaster", 0, "London", "GB", NOW,
    );

    const documents = service(database);
    const discover = documents.discoverDocument({ at: NOW, today: "2026-08-25" });
    assert.equal(discover.kind, "discover");
    assert.equal(discover.indexable, true);
    assert.equal(discover.artists.some((artist) => artist.name === "Discover Artist"), true);
    assert.equal(discover.events.some((event) => event.id === "discover-event"), true);
    assert.equal(discover.posts.some((post) => post.id === "discover-review"), true);
    const discoverHtml = documents.render(discover);
    assert.match(discoverHtml, /Discover music through the people who were there/);
    assert.match(discoverHtml, /Discover Artist|Discovery Hall/);
    assert.doesNotMatch(discoverHtml, /RESTRICTED DISCOVERY COPY/);
    assert.match(discoverHtml, /name="robots" content="index,follow/);

    const search = documents.searchDocument();
    const searchHtml = documents.render(search);
    assert.equal(search.kind, "search");
    assert.equal(search.indexable, false);
    assert.match(searchHtml, /Search across the whole community/);
    assert.match(searchHtml, /name="robots" content="noindex,follow"/);
    assert.doesNotMatch(searchHtml, /rel="canonical"/);
  } finally {
    database.close();
  }
});

test("artist and event directories reject impossible future dates before pagination", () => {
  const database = createDatabase();
  try {
    const substantiveBio = "A substantive artist biography covering recordings, tours, live performance history, collaborators, and fan context.";
    addArtist(database, {
      key: "valid-directory-artist",
      name: "Valid Directory Artist",
      bio: substantiveBio,
      mbid: OTHER_MBID,
    });
    addArtist(database, {
      key: "invalid-date-only",
      name: "Invalid Date Only",
      bio: "",
      mbid: null,
    });

    const insertEvent = database.prepare(`INSERT INTO tour_dates
      (id,artist,artist_key,venue,place,date,source,venue_provider_id,venue_city,
        venue_country_code,venue_address_line1,release_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (let index = 1; index <= 12; index += 1) {
      const day = String(index).padStart(2, "0");
      insertEvent.run(
        `valid-directory-event-${day}`,
        "Valid Directory Artist",
        "valid-directory-artist",
        `Valid Hall ${day}`,
        "Toronto, Canada",
        `2026-09-${day}`,
        "ticketmaster",
        `valid-provider-${day}`,
        "Toronto",
        "CA",
        `${index} Music Way`,
        0,
        NOW + index,
      );
    }
    insertEvent.run(
      "invalid-future-date",
      "Invalid Date Only",
      "invalid-date-only",
      "Impossible Future Hall",
      "Toronto, Canada",
      "2037-02-31",
      "ticketmaster",
      "invalid-future-provider",
      "Toronto",
      "CA",
      "31 Invalid Road",
      0,
      NOW + 100,
    );

    const documents = service(database);
    const eventPageOne = documents.directoryDocument({ kind: "events", page: 1, at: NOW, today: "2026-08-25" });
    assert.equal(eventPageOne.events.length, 12);
    assert.equal(eventPageOne.hasNext, false);
    assert.equal(eventPageOne.nextPath, null);
    assert.equal(documents.directoryDocument({ kind: "events", page: 2, at: NOW, today: "2026-08-25" }), null);
    assert.equal(eventPageOne.events.some((event) => event.id === "invalid-future-date"), false);

    const artistDirectory = documents.directoryDocument({ kind: "artists", page: 1, at: NOW, today: "2026-08-25" });
    assert.equal(artistDirectory.artists.some((artist) => artist.name === "Valid Directory Artist"), true);
    assert.equal(artistDirectory.artists.some((artist) => artist.name === "Invalid Date Only"), false);
  } finally {
    database.close();
  }
});

test("global venue and concert directories are bounded, canonical, substantive, and exclude ambiguous or invalid rows", () => {
  const database = createDatabase();
  try {
    addUser(database, "active", { name: "Archive Fan", handle: "archivefan" });
    addUser(database, "banned", { name: "Restricted Fan", handle: "restrictedfan", banned: true });
    addArtist(database, {
      bio: "A substantive artist biography covering recordings, tours, live performance history, collaborators, and fan context.",
    });

    const insertEvent = database.prepare(`INSERT INTO tour_dates
      (id,artist,venue,place,date,source,venue_provider_id,venue_city,venue_country_code,
        venue_address_line1,release_at,updated_at,owner_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (let index = 1; index <= 14; index += 1) {
      const day = String(index).padStart(2, "0");
      insertEvent.run(
        `directory-event-${day}`,
        "Alpha",
        `Provider Hall ${day}`,
        `Toronto, Canada`,
        `2026-09-${day}`,
        "ticketmaster",
        `provider-${day}`,
        "Toronto",
        "CA",
        `${index} Music Way`,
        0,
        NOW + index,
        null,
      );
    }
    insertEvent.run("unique-room", "Alpha", "Unique Room", "Ottawa, Canada", "2026-10-01", null, null, "Ottawa", "CA", "1 Stage Road", 0, NOW + 20, null);
    insertEvent.run("shared-north", "Alpha", "Shared Room", "Toronto, Canada", "2026-10-02", null, null, "Toronto", "CA", "2 North Road", 0, NOW + 21, null);
    insertEvent.run("shared-south", "Alpha", "Shared Room", "Chicago, United States", "2026-10-03", null, null, "Chicago", "US", "3 South Road", 0, NOW + 22, null);
    insertEvent.run("impossible-event", "Alpha", "Impossible Hall", "Nowhere", "2026-99-99", "ticketmaster", "impossible", "Nowhere", "CA", "4 Invalid Road", 0, NOW + 23, null);
    insertEvent.run("restricted-event", "Alpha", "Restricted Hall", "Toronto, Canada", "2026-10-04", "ticketmaster", "restricted", "Toronto", "CA", "5 Hidden Road", 0, NOW + 24, "banned");

    const documents = service(database);
    const venuePageOne = documents.directoryDocument({ kind: "venues", page: 1, at: NOW, today: "2026-08-25" });
    const venuePageTwo = documents.directoryDocument({ kind: "venues", page: 2, at: NOW, today: "2026-08-25" });
    assert.equal(venuePageOne.venues.length, 12);
    assert.equal(venuePageTwo.venues.length, 3);
    assert.equal(venuePageOne.nextPath, "/venues/page/2");
    assert.equal(venuePageTwo.previousPath, "/venues");
    assert.equal(venuePageTwo.canonicalPath, "/venues/page/2");
    assert.match(venuePageTwo.title, /Page 2/);
    assert.equal(documents.directoryDocument({ kind: "venues", page: 3, at: NOW, today: "2026-08-25" }), null);
    assert.equal(documents.directoryDocument({ kind: "venues", page: 1_001, at: NOW, today: "2026-08-25" }), null);
    assert.equal([...venuePageOne.venues, ...venuePageTwo.venues].some((venue) => venue.name === "Shared Room"), false);
    assert.equal([...venuePageOne.venues, ...venuePageTwo.venues].some((venue) => venue.name === "Impossible Hall"), false);
    assert.equal([...venuePageOne.venues, ...venuePageTwo.venues].some((venue) => venue.name === "Restricted Hall"), false);
    const providerVenue = venuePageOne.venues.find((venue) => venue.name === "Provider Hall 01");
    assert.equal(providerVenue.path, "/venue/ticketmaster-provider-01");
    assert.equal(providerVenue.featuredEvent.path, "/event/directory-event-01");
    assert.equal(providerVenue.featuredArtistPath, "/artist/alpha");
    const venueHtml = documents.render(venuePageTwo);
    assert.match(venueHtml, /<h1>Concert venues on Mshpit — Page 2<\/h1>/);
    assert.match(venueHtml, /href="\/venues">Previous page<\/a>/);
    assert.match(venueHtml, /href="\/event\//);
    assert.match(venueHtml, /href="\/artist\/alpha"/);

    const substantiveReview = "A detailed fan account of the sound, crowd, musicianship, stage production, and memorable encore.";
    for (let index = 1; index <= 13; index += 1) {
      addPost(database, {
        id: `archive-directory-${index}`,
        venue: index === 13 ? "Archive <Room> 13" : `Archive Room ${index}`,
        review: substantiveReview,
        overall: index === 13 ? 0 : 4,
        date: `2026-08-${String(index).padStart(2, "0")}`,
        createdAt: 10_000 + index,
      });
    }
    addPost(database, { id: "invalid-concert-date", venue: "Invalid Date Room", review: substantiveReview, date: "2026-02-30" });
    addPost(database, { id: "restricted-concert", userId: "banned", venue: "Hidden Archive", review: substantiveReview, date: "2026-08-18" });

    const concertPageOne = documents.directoryDocument({ kind: "concerts", page: 1, at: NOW, today: "2026-08-25" });
    const concertPageTwo = documents.directoryDocument({ kind: "concerts", page: 2, at: NOW, today: "2026-08-25" });
    assert.equal(concertPageOne.concerts.length, 12);
    assert.equal(concertPageTwo.concerts.length, 1);
    assert.equal(concertPageOne.concerts[0].date, "2026-08-13");
    assert.equal(concertPageTwo.concerts[0].date, "2026-08-01");
    assert.equal(concertPageOne.nextPath, "/concerts/page/2");
    assert.equal(concertPageTwo.previousPath, "/concerts");
    assert.equal(concertPageTwo.canonicalPath, "/concerts/page/2");
    assert.match(concertPageTwo.title, /Page 2/);
    assert.equal(documents.directoryDocument({ kind: "concerts", page: 3, at: NOW, today: "2026-08-25" }), null);
    assert.equal([...concertPageOne.concerts, ...concertPageTwo.concerts].some((concert) => concert.date === "2026-02-30"), false);
    assert.equal(concertPageOne.concerts[0].artistPath, "/artist/alpha");
    assert.match(concertPageOne.concerts[0].path, /^\/concert\//);
    const concertHtml = documents.render(concertPageOne);
    assert.match(concertHtml, /<h1>Concert nights fans remember<\/h1>/);
    assert.match(concertHtml, /Archive &lt;Room&gt; 13/);
    assert.doesNotMatch(concertHtml, /Archive <Room> 13/);
    assert.match(concertHtml, /No rating yet/);
    assert.doesNotMatch(concertHtml, /0\.0\/5/);
    assert.match(concertHtml, /href="\/artist\/alpha"/);
    assert.doesNotMatch(concertHtml, /href="\/venue\/archive-room-13"/,
      "name-only venues stay visible but do not manufacture links the resolver may reject");
    assert.match(concertHtml, /href="\/concert\//);
    assert.equal(concertPageOne.jsonLd[0].mainEntity.numberOfItems, 12);
  } finally {
    database.close();
  }
});

test("concert pages and collections fail closed when one show maps to conflicting structured locations", () => {
  const database = createDatabase();
  try {
    addUser(database, "active", { name: "Collision Fan", handle: "collisionfan" });
    addArtist(database);
    const date = "2026-08-20";
    const venue = "Collision Hall";
    addPost(database, {
      id: "location-collision-review",
      venue,
      date,
      review: "A detailed fan account that would otherwise qualify this concert for public indexing.",
    });
    const insertLocation = database.prepare(`INSERT INTO tour_dates
      (id,artist,artist_key,venue,date,source,updated_at,release_at,venue_city,venue_country_code,provider_active)
      VALUES (?,?,?,?,?,?,?,?,?,?,1)`);
    insertLocation.run("collision-toronto", "Alpha", "alpha", venue, date, "ticketmaster", NOW, 0, "Toronto", "CA");
    insertLocation.run("collision-ottawa", "Alpha", "alpha", venue, date, "ticketmaster", NOW, 0, "Ottawa", "CA");

    const documents = service(database);
    const showKey = archiveShowKey({ artistIdentity: "alpha", venueIdentity: venue.toLowerCase(), date });
    assert.equal(documents.concertDocument({ showKey, today: "2026-08-25", at: NOW }), null);
    assert.equal(documents.directoryDocument({ kind: "concerts", today: "2026-08-25", at: NOW }), null);
    assert.equal(documents.artistConcertsDocument({ publicSlug: "alpha", today: "2026-08-25", at: NOW }), null);
    const artist = documents.artistDocument({ artistKey: "alpha", today: "2026-08-25", at: NOW });
    assert.deepEqual(artist.concerts, []);
  } finally {
    database.close();
  }
});

test("legacy name-only reviews never bleed across duplicate artist identities", () => {
  const database = createDatabase();
  try {
    addUser(database, "active", { name: "Identity Fan", handle: "identityfan" });
    const bio = "A substantive biography with enough real live-performance context to keep both catalogue identities independently useful.";
    addArtist(database, { key: "shared-a", name: "Shared Artist", bio, mbid: ARTIST_MBID });
    addArtist(database, { key: "shared-b", name: "Shared Artist", bio, mbid: OTHER_MBID });
    addPost(database, {
      id: "legacy-shared-review", artist: "Shared Artist", artistKey: null, venue: "Identity Hall",
      review: "A detailed legacy review that cannot be assigned safely when two catalogue artists share the same display name.",
    });
    addPost(database, {
      id: "keyed-shared-review", artist: "Shared Artist", artistKey: "shared-a", venue: "Identity Hall",
      review: "A detailed identity-bound review that belongs only to the first canonical artist record.",
    });

    const documents = service(database);
    const first = documents.artistDocument({ artistKey: "shared-a", today: "2026-08-25", at: NOW });
    const second = documents.artistDocument({ artistKey: "shared-b", today: "2026-08-25", at: NOW });
    assert.deepEqual(first.reviews.map((review) => review.id), ["keyed-shared-review"]);
    assert.deepEqual(second.reviews, []);
    const home = documents.homeDocument();
    const counts = Object.fromEntries(home.artists.map((artist) => [artist.path, artist.reviewCount]));
    assert.equal(counts["/artist/shared-a"], 1);
    assert.equal(counts["/artist/shared-b"], 0);
    assert.equal(documents.postDocument({ id: "legacy-shared-review" }).post.artistPath, null);
  } finally {
    database.close();
  }
});


test("standalone posts safely expose attributed tour and setlist details and complete public navigation", () => {
  const database = createDatabase();
  try {
    addUser(database, "active", { name: "Cloe Fan", handle: "cloe" });
    addArtist(database);
    const submittedSetlist = [
      " <script>alert('x')</script> ",
      "A & B",
      "X".repeat(160),
      ...Array.from({ length: 45 }, (_, index) => "Song " + (index + 1)),
    ];
    addPost(database, {
      id: "setlist-review",
      review: "A detailed firsthand review of the musicianship, crowd, room, sound, and final encore.",
      setlist: submittedSetlist,
      tour: "<img src=x onerror=alert(1)>" + "T".repeat(220),
    });
    addPost(database, {
      id: "malformed-setlist",
      review: "A detailed firsthand review with a malformed legacy setlist payload that must fail closed.",
      setlist: "{not-json",
    });

    const documents = service(database);
    const document = documents.postDocument({ id: "setlist-review" });
    const html = documents.render(document);
    const malformed = documents.postDocument({ id: "malformed-setlist" });
    const malformedHtml = documents.render(malformed);

    assert.equal(document.post.setlist.length, 40);
    assert.equal(document.post.setlist.every((item) => item.length > 0 && item.length <= 120), true);
    assert.equal(document.post.tour.length, 180);
    assert.equal(html.includes("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;"), true);
    assert.equal(html.includes("<script>alert('x')</script>"), false);
    assert.equal(html.includes("&lt;img src=x onerror=alert(1)&gt;"), true);
    assert.equal(html.includes("Setlist shared by"), true);
    assert.equal(html.includes("@cloe"), true);
    assert.equal(JSON.stringify(document.jsonLd).includes("EventSeries"), false);
    for (const path of ["/artists", "/events", "/venues", "/concerts", "/discover"]) {
      assert.equal(html.includes('href="' + path + '"'), true);
    }
    assert.deepEqual(malformed.post.setlist, []);
    assert.equal(malformedHtml.includes("Setlist shared by"), false);
  } finally {
    database.close();
  }
});

test("venue schema never promotes a free-form post city into a postal address", () => {
  const database = createDatabase();
  try {
    addUser(database, "active", { name: "Active Fan", handle: "activefan" });
    addArtist(database);
    addPost(database, {
      id: "freeform-venue-review",
      venue: "Freeform Hall",
      city: "Freeform City",
      review: "A detailed firsthand account of the room, sound, crowd, performance, and encore.",
    });
    const documents = service(database);
    const request = { name: "Freeform Hall", venueKey: "freeform hall", today: "2026-08-25", at: NOW };
    const freeform = documents.venueDocument(request);
    const freeformHtml = documents.render(freeform);

    assert.equal(freeform.venue.place, "Freeform City");
    assert.equal(freeform.venue.address, null);
    assert.equal(JSON.stringify(freeform.jsonLd).includes("PostalAddress"), false);
    assert.equal(freeformHtml.includes('<address class="postal-address">'), false);
    assert.deepEqual(freeform.breadcrumbs.map((crumb) => crumb.name), ["Mshpit", "Venues", "Freeform Hall"]);
    assert.equal(freeformHtml.includes('href="/venues"'), true);

    database.prepare("INSERT INTO tour_dates (id,artist,venue,place,date,start_date_time,release_at,venue_address_line1,venue_address_line2,venue_city,venue_region,venue_postal_code,venue_country_code) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
      "structured-venue-event",
      "Alpha",
      "Freeform Hall",
      "Toronto, Canada",
      "2026-09-10",
      "2026-09-10T20:00:00-04:00",
      0,
      "10 Music Avenue",
      "Level 2",
      "Toronto",
      "Ontario",
      "M5V 1A1",
      "CA",
    );
    const structured = documents.venueDocument(request);
    const structuredHtml = documents.render(structured);
    assert.equal(structured.jsonLd[0].address["@type"], "PostalAddress");
    assert.equal(Object.hasOwn(structured.jsonLd[0], "event"), false,
      "venue schema must not create incomplete cross-page Event nodes");
    assert.equal(structured.jsonLd[1].hasPart[0]["@id"], "https://www.example.com/event/structured-venue-event#page");
    assert.equal(structuredHtml.includes("10 Music Avenue, Level 2"), true);
    assert.equal(structuredHtml.includes("Toronto, Ontario M5V 1A1"), true);
    assert.equal(structuredHtml.includes(">CA<"), true);
  } finally {
    database.close();
  }
});

test("venue pages expose only verified capacity and coordinates with practical visit links", () => {
  const database = createDatabase();
  try {
    const documents = service(database);
    const document = documents.venueDocument({
      name: "Scotiabank Arena",
      venueKey: "scotiabank arena",
      at: NOW,
    });
    const html = documents.render(document);
    const schema = document.jsonLd.find((node) => node["@type"] === "MusicVenue");

    assert.equal(document.venue.place, "Toronto, Ontario, Canada");
    assert.equal(document.venue.capacity, 19_800);
    assert.deepEqual(document.venue.coord, { lat: 43.6435, lng: -79.3791 });
    assert.equal(document.venue.guide.actions.length, 3);
    assert.equal(schema.maximumAttendeeCapacity, 19_800);
    assert.deepEqual(schema.geo, {
      "@type": "GeoCoordinates",
      latitude: 43.6435,
      longitude: -79.3791,
    });
    assert.match(schema.hasMap, /^https:\/\/www\.google\.com\/maps\/dir\//u);
    assert.equal(schema.mainEntityOfPage["@id"], "https://www.example.com/venue/scotiabank-arena#page");
    assert.match(document.title, /concert venue guide/u);
    assert.match(document.description, /listed capacity of 19,800/u);
    assert.match(html, /Seating, parking and transport/u);
    assert.match(html, /19,800 listed capacity/u);
    assert.match(html, />Parking nearby</u);
    assert.match(html, />Public transit</u);
    assert.doesNotMatch(html, /parking lot|parking price|open 24 hours/iu);

    const unverifiedProvider = documents.venueDocument({
      name: "Scotiabank Arena",
      venueKey: "provider:ticketmaster:unlocated-room",
      source: "ticketmaster",
      providerVenueId: "unlocated-room",
      at: NOW,
    });
    const unverifiedSchema = unverifiedProvider.jsonLd.find((node) => node["@type"] === "MusicVenue");
    assert.equal(unverifiedProvider.venue.capacity, null);
    assert.equal(unverifiedProvider.venue.coord, null);
    assert.deepEqual(unverifiedProvider.venue.guide.actions, []);
    assert.equal(Object.hasOwn(unverifiedSchema, "maximumAttendeeCapacity"), false);
    assert.equal(Object.hasOwn(unverifiedSchema, "geo"), false);
    assert.equal(Object.hasOwn(unverifiedSchema, "hasMap"), false);
  } finally {
    database.close();
  }
});

test("venue pages show real public ratings and safely render only eligible recent reviews", () => {
  const database = createDatabase();
  try {
    addUser(database, "active", { name: "Cloe <script>alert(1)</script>", handle: "cloe<script>" });
    addUser(database, "banned", { name: "Hidden Fan", handle: "hidden", banned: true });
    addUser(database, "removed-reviewer", { name: "Removed Fan", handle: "removed" });
    const verifiedUrl = "https://cdn.example/venue-room.jpg";
    addReadyImage(database, { assetId: "venue-room", ownerId: "active", url: verifiedUrl });
    addVenueReview(database, {
      id: "visible-venue-review",
      rating: 4.5,
      text: "<script>alert('review')</script> The sound, staff, sightlines, and atmosphere made this a memorable room.",
      photos: [verifiedUrl, "https://unverified.example/not-owned.jpg"],
      photosPublic: true,
      createdAt: 4_000,
    });
    addVenueReview(database, {
      id: "banned-venue-review",
      userId: "banned",
      rating: 1,
      text: "This banned account review is long enough but must never become public on the venue page.",
      createdAt: 5_000,
    });
    addVenueReview(database, {
      id: "removed-venue-review",
      userId: "removed-reviewer",
      rating: 2,
      text: "This removed review is long enough but must never become public on the venue page.",
      removed: true,
      createdAt: 6_000,
    });

    const documents = service(database);
    const document = documents.venueDocument({
      name: "Freeform Hall",
      venueKey: "freeform hall",
      today: "2026-08-25",
      at: NOW,
    });
    const html = documents.render(document);
    const venueSchema = document.jsonLd.find((node) => node["@type"] === "MusicVenue");

    assert.deepEqual(document.venueReviewStats, { reviewCount: 1, ratingCount: 1, averageRating: 4.5 });
    assert.equal(document.venueReviews.length, 1);
    assert.deepEqual(document.venueReviews[0].photos, [verifiedUrl]);
    assert.equal(venueSchema.review.length, 1);
    assert.equal(venueSchema.review[0].author.name, "Cloe <script>alert(1)</script>");
    assert.equal(venueSchema.review[0].reviewRating.ratingValue, 4.5);
    assert.equal(venueSchema.review[0].itemReviewed["@id"], venueSchema["@id"]);
    assert.equal(document.imageProvenance, null);
    assert.match(html, /4\.5<small>\/5<\/small><\/strong> from 1 rating/);
    assert.match(html, /1 public review/);
    assert.match(html, /Recent venue reviews/);
    assert.match(html, /&lt;script&gt;alert\(&#39;review&#39;\)&lt;\/script&gt;/);
    assert.match(html, /Cloe &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /src="https:\/\/cdn\.example\/venue-room\.jpg"/);
    assert.doesNotMatch(html, /<script>alert/);
    assert.doesNotMatch(html, /unverified\.example|Hidden Fan|Removed Fan|banned-venue-review|removed-venue-review/);
    assert.doesNotMatch(JSON.stringify(document.jsonLd), /AggregateRating/);
  } finally {
    database.close();
  }
});

test("venue pages never display a zero rating or emit venue AggregateRating markup", () => {
  const database = createDatabase();
  try {
    addUser(database, "active", { name: "No-score Fan", handle: "noscore" });
    addVenueReview(database, {
      id: "zero-score-venue-review",
      venueKey: "quiet room",
      rating: 0,
      text: "The room had clear sightlines and welcoming staff, but this legacy score is invalid.",
    });
    const documents = service(database);
    const document = documents.venueDocument({ name: "Quiet Room", venueKey: "quiet room", at: NOW });
    const html = documents.render(document);

    assert.deepEqual(document.venueReviewStats, { reviewCount: 1, ratingCount: 0, averageRating: null });
    assert.equal(document.venueReviews[0].rating, null);
    assert.match(html, /No community rating yet/);
    assert.match(html, /1 public review/);
    assert.doesNotMatch(html, /0(?:\.0)?\/5/);
    assert.doesNotMatch(JSON.stringify(document.jsonLd), /AggregateRating/);
  } finally {
    database.close();
  }
});

test("venue SEO pages lead with rights-verified structural photography and ImageObject attribution", () => {
  const database = createDatabase();
  try {
    const documents = createPublicDocumentService({ database, origin: "https://www.example.test" });
    const document = documents.venueDocument({
      venueKey: "rogers centre",
      name: "Rogers Centre",
    });
    const html = documents.render(document);
    const venueSchema = document.jsonLd.find((node) => node["@type"] === "MusicVenue");

    assert.equal(document.imageProvenance, "licensed-venue");
    assert.match(document.image, /^https:\/\/pub-[a-z0-9]+\.r2\.dev\/venues\/licensed\//u);
    assert.equal(document.venuePhotos.length >= 1, true);
    assert.equal(document.venue.heroPhoto.url, document.image);
    assert.equal(venueSchema.image["@type"], "ImageObject");
    assert.equal(venueSchema.image.contentUrl, document.image);
    assert.match(venueSchema.image.license, /^https:\/\/creativecommons\.org\//u);
    assert.match(venueSchema.image.acquireLicensePage, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/u);
    assert.match(html, /class="profile-hero venue-hero"/u);
    assert.match(html, /class="venue-hero-photo"/u);
    assert.match(html, /fetchpriority="high"/u);
    assert.match(html, />Source<\/a>/u);
    assert.match(html, />License<\/a>/u);
    assert.match(html, /Converted to WebP and resized/u);
    assert.match(html, /property="og:image" content="https:\/\/pub-/u);
    assert.match(html, /name="twitter:image" content="https:\/\/pub-/u);
    assert.doesNotMatch(html, /Verified venue photo coming soon/u);
  } finally {
    database.close();
  }
});

test("provider event artwork never becomes a venue hero or social preview", () => {
  const database = createDatabase();
  try {
    database.prepare(`INSERT INTO tour_dates
      (id,provider_event_id,artist,venue,place,date,start_date_time,ticket_url,source,venue_provider_id,
        venue_city,venue_country_code,event_name,music_evidence,event_image_url,event_image_attribution,
        event_image_width,event_image_height,updated_at,release_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      "provider-art-event",
      "provider-art-event",
      "Example Artist",
      "Uncovered Provider Hall",
      "Toronto, Ontario, Canada",
      "2026-09-20",
      "2026-09-20T19:30:00-04:00",
      "https://www.ticketmaster.ca/event/provider-art-event",
      "ticketmaster",
      "uncovered-provider-hall",
      "Toronto",
      "CA",
      "Example Artist Live",
      "segment:music",
      "https://s1.ticketm.net/dam/a/example-artist.jpg",
      "Ticketmaster",
      1600,
      900,
      NOW,
      0,
    );
    const documents = createPublicDocumentService({ database, origin: "https://www.example.test" });
    const document = documents.venueDocument({
      venueKey: "uncovered provider hall",
      name: "Uncovered Provider Hall",
      providerVenueId: "uncovered-provider-hall",
      source: "ticketmaster",
      at: NOW,
      today: "2026-08-25",
    });
    const html = documents.render(document);
    const venueSchema = document.jsonLd.find((node) => node["@type"] === "MusicVenue");

    assert.equal(document.image, null);
    assert.equal(document.imageProvenance, null);
    assert.equal(document.venue.heroPhoto, null);
    assert.equal(venueSchema.image, undefined);
    assert.doesNotMatch(JSON.stringify(venueSchema), /ticketm\.net/u);
    assert.doesNotMatch(html, /ticketm\.net|Ticketmaster/u);
    assert.match(html, /class="venue-hero-fallback"/u);
    assert.match(html, />Uncovered Provider Hall<\/strong>/u);
    assert.match(html, /property="og:image" content="https:\/\/www\.example\.test\/og\.png"/u);
  } finally {
    database.close();
  }
});

test("venues without verified photography render an honest venue-specific fallback", () => {
  const database = createDatabase();
  try {
    const documents = createPublicDocumentService({ database, origin: "https://www.example.test" });
    const document = documents.venueDocument({
      venueKey: "uncovered test room",
      name: "Uncovered Test Room",
    });
    const html = documents.render(document);

    assert.equal(document.image, null);
    assert.equal(document.imageProvenance, null);
    assert.match(html, /class="venue-hero-fallback"/u);
    assert.match(html, />Uncovered Test Room<\/strong>/u);
    assert.match(html, /Verified venue photo coming soon/u);
    assert.equal(
      document.jsonLd.find((node) => node["@type"] === "MusicVenue").image,
      undefined,
    );
  } finally {
    database.close();
  }
});

test("public document service delegates artist collections and shows load more only above three", () => {
  const database = createDatabase();
  try {
    addUser(database, "active", { name: "Archive Fan", handle: "archivefan" });
    addArtist(database);
    const review = "A detailed firsthand account of the sound, crowd, staging, musicianship, and encore.";
    for (let index = 1; index <= 4; index += 1) {
      addPost(database, {
        id: "artist-archive-" + index,
        venue: "Archive Hall " + index,
        date: "2026-08-0" + index,
        review,
        createdAt: 2_000 + index,
      });
    }
    addPost(database, {
      id: "artist-archive-invalid-date",
      venue: "Impossible Hall",
      date: "2026-02-30",
      review,
    });
    addPost(database, {
      id: "artist-archive-pending-media",
      venue: "Pending Hall",
      date: "2026-08-10",
      review: "",
      photosPublic: true,
    });
    database.prepare("INSERT INTO post_media (post_id,asset_id,position,created_at) VALUES (?,?,0,?)")
      .run("artist-archive-pending-media", "missing-pending-asset", 2_500);

    const documents = service(database);
    assert.equal(typeof documents.cityVenuesDocument, "function");
    assert.equal(typeof documents.cityConcertsDocument, "function");
    assert.equal(typeof documents.artistConcertsDocument, "function");

    const archive = documents.artistConcertsDocument({ publicSlug: "alpha", today: "2026-08-25" });
    const dispatched = documents.documentFor({ kind: "artist-concerts", publicSlug: "alpha", today: "2026-08-25" });
    assert.equal(archive.concerts.length, 4);
    assert.equal(dispatched.canonicalPath, "/artist/alpha/concerts");

    const artist = documents.artistDocument({ artistKey: "alpha", today: "2026-08-25" });
    const html = documents.render(artist);
    assert.equal(artist.concerts.length, 3);
    assert.equal(artist.archiveTotal, 4);
    assert.equal(artist.archivePath, "/artist/alpha/concerts");
    assert.equal(html.includes('href="/artist/alpha/concerts"'), true);
    assert.equal(html.includes("View full concert archive"), true);

    database.prepare("UPDATE posts SET removed=1 WHERE id=?").run("artist-archive-4");
    const threshold = documents.artistDocument({ artistKey: "alpha", today: "2026-08-25" });
    const thresholdHtml = documents.render(threshold);
    assert.equal(threshold.archiveTotal, 3);
    assert.equal(threshold.archivePath, null);
    assert.equal(thresholdHtml.includes("View full concert archive"), false);
  } finally {
    database.close();
  }
});
