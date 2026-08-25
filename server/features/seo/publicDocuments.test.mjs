import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createArtistMemorialRepository } from "../artistMemorials/artistMemorialRepository.js";
import { createArtistMemorialService } from "../artistMemorials/artistMemorialService.js";
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
      suspended_until INTEGER
    );
    CREATE TABLE artists (
      norm TEXT PRIMARY KEY,name TEXT NOT NULL,public_slug TEXT,genre TEXT,bio TEXT,mbid TEXT,country TEXT,formed TEXT,
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
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,artist TEXT NOT NULL,artist_key TEXT,venue TEXT NOT NULL,
      city TEXT,date TEXT,overall REAL,review TEXT,photos TEXT NOT NULL DEFAULT '[]',
      photos_public INTEGER NOT NULL DEFAULT 0,kind TEXT DEFAULT 'review',removed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,updated_at INTEGER
    );
    CREATE TABLE likes (post_id TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(post_id,user_id));
    CREATE TABLE comments (
      id TEXT PRIMARY KEY,post_id TEXT NOT NULL,user_id TEXT NOT NULL,text TEXT NOT NULL,
      removed INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL
    );
    CREATE TABLE follows (follower_id TEXT NOT NULL,followee_id TEXT NOT NULL,PRIMARY KEY(follower_id,followee_id));
    CREATE TABLE artist_profiles (
      artist_key TEXT PRIMARY KEY,bio TEXT,banner TEXT,avatar_uri TEXT,feed_enabled INTEGER NOT NULL DEFAULT 0,
      owner_id TEXT,removed INTEGER NOT NULL DEFAULT 0,updated_at INTEGER
    );
    CREATE TABLE artist_posts (
      id TEXT PRIMARY KEY,artist_key TEXT NOT NULL,user_id TEXT,text TEXT NOT NULL,
      removed INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL
    );
    CREATE TABLE tour_dates (
      id TEXT PRIMARY KEY,artist TEXT NOT NULL,venue TEXT,place TEXT,date TEXT,sold_out INTEGER NOT NULL DEFAULT 0,
      owner_id TEXT,release_at INTEGER NOT NULL DEFAULT 0
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
  `);
  return database;
}

function addUser(database, id, { name = id, handle = id, banned = false, suspended = false, bio = "" } = {}) {
  database.prepare(`INSERT INTO users
    (id,name,handle,artist_name,bio,avatar_uri,banner,created_at,is_banned,suspended_until)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    id, name, handle, null, bio, null, null, 100, banned ? 1 : 0,
    suspended ? Date.now() + 86_400_000 : null,
  );
}

function addArtist(database, {
  key = "alpha", name = "Alpha", bio = "A real artist biography.", genre = "Rock", mbid = ARTIST_MBID,
} = {}) {
  database.prepare(`INSERT INTO artists
    (norm,name,public_slug,genre,bio,mbid,country,formed,popularity,rank_score,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(key, name, key, genre, bio, mbid, "Canada", "2012", 90, 100, 200);
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
  photos = [],
  photosPublic = true,
  kind = "review",
  removed = false,
  createdAt = 1_000,
} = {}) {
  database.prepare(`INSERT INTO posts
    (id,user_id,artist,artist_key,venue,city,date,overall,review,photos,photos_public,kind,removed,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, userId, artist, artistKey, venue, "Toronto", "2026-08-20", 4.5, review,
    JSON.stringify(photos), photosPublic ? 1 : 0, kind, removed ? 1 : 0, createdAt, createdAt + 1,
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
    assert.equal(document.posts.length, 1);
    assert.deepEqual(document.posts[0].media, [], "ordinary post media is not republished by the marketing homepage");
    assert.match(html, /Crowd energy &amp; joy &lt;b&gt;all night&lt;\/b&gt;/);
    assert.doesNotMatch(html, /BANNED PRIVATE COPY/);
    assert.doesNotMatch(html, /\b\d[\d,]* members\b/i);
    assert.match(html, /<h1>Remember every show/);
  } finally {
    database.close();
  }
});

test("artist document uses only active UGC and verified ready media, and never claims a fan post is a MusicEvent", () => {
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
    database.prepare("INSERT INTO tour_dates (id,artist,venue,place,date,sold_out,owner_id,release_at) VALUES (?,?,?,?,?,?,?,?)")
      .run("event-public", "Alpha", "Global Hall", "London, UK", "2026-09-01", 0, null, 0);
    database.prepare("INSERT INTO tour_dates (id,artist,venue,place,date,sold_out,owner_id,release_at) VALUES (?,?,?,?,?,?,?,?)")
      .run("event-hidden", "Alpha", "Secret Hall", "Nowhere", "2026-09-02", 0, "banned", 0);

    const documents = service(database);
    const document = documents.artistDocument({ artistKey: "alpha", today: "2026-08-25", at: Date.now() });
    const html = documents.render(document);

    assert.equal(document.jsonLd[0]["@type"], "CollectionPage");
    assert.equal(document.jsonLd[0].about["@type"], "Thing");
    assert.deepEqual(document.reviews.map((review) => review.id), ["visible", "private-gallery"]);
    assert.deepEqual(document.events.map((event) => event.id), ["event-public"]);
    assert.deepEqual(document.updates.map((update) => update.id), ["update-visible"]);
    assert.equal(document.reviews[0].media[0].url, safeUrl);
    assert.deepEqual(document.reviews[1].media, [], "artist aggregation honors the author's public-photo consent");
    assert.equal(document.image, avatarUrl);
    assert.match(html, /media\.example\/public\/visible\.jpg/);
    assert.doesNotMatch(html, /attacker\.example|HIDDEN REVIEW|HIDDEN UPDATE|Secret Hall/);
    assert.doesNotMatch(html, /MusicEvent/);
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

test("canonical artist documents expose only an identity-bound published memorial", () => {
  const database = createDatabase();
  try {
    addArtist(database, { bio: "" });
    assert.equal(saveMemorial(database, {
      summary: "A generous <script>songwriter</script> whose work gave generations a place to gather and remember.",
      thankYou: "Thank you for the <strong>songs</strong> and the rooms they filled.",
      accomplishments: ["A <b>lasting</b> songbook", "Decades of memorable performances"],
      sourceTitle: "Verified <public> & announcement",
    }).ok, true);
    database.prepare("UPDATE artist_memorials SET reviewer_secret=? WHERE artist_key=?")
      .run("PRIVATE REVIEWER AND AUDIT MATERIAL", "alpha");

    const documents = service(database);
    const canonical = documents.artistDocument({ artistKey: "alpha", at: NOW });
    const html = documents.render(canonical);
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
    addArtist(database);
    addPost(database, {
      id: "visible",
      review: "The encore was perfect.",
      photos: ["https://attacker.example/legacy.jpg"],
    });
    addPost(database, { id: "restricted-post", userId: "suspended", review: "PRIVATE SUSPENDED POST" });
    database.prepare("INSERT INTO comments (id,post_id,user_id,text,removed,created_at) VALUES (?,?,?,?,0,?)")
      .run("comment-visible", "visible", "commenter", "Same — that finale!", 2_000);
    database.prepare("INSERT INTO comments (id,post_id,user_id,text,removed,created_at) VALUES (?,?,?,?,0,?)")
      .run("comment-hidden", "visible", "banned", "HIDDEN COMMENT", 2_001);
    database.prepare("INSERT INTO likes (post_id,user_id) VALUES (?,?)").run("visible", "commenter");
    database.prepare("INSERT INTO likes (post_id,user_id) VALUES (?,?)").run("visible", "banned");

    const documents = service(database);
    const member = documents.memberDocument({ handle: "musicfan" });
    const post = documents.postDocument({ id: "visible" });
    const html = documents.render(post);

    assert.equal(member.member.name, "A & B");
    assert.equal(documents.memberDocument({ handle: "suspended" }), null);
    assert.equal(documents.postDocument({ id: "restricted-post" }), null);
    assert.equal(post.jsonLd[0]["@type"], "SocialMediaPosting");
    assert.equal(post.post.likes, 1, "restricted likes never enter public interaction totals");
    assert.equal(post.post.comments, 1, "restricted comments never enter public interaction totals");
    assert.deepEqual(post.comments.map((comment) => comment.id), ["comment-visible"]);
    assert.equal(post.post.media.length, 0, "unverified legacy URLs fail closed");
    assert.match(html, /Same — that finale!/);
    assert.doesNotMatch(html, /HIDDEN COMMENT|attacker\.example|PRIVATE SUSPENDED POST|MusicEvent/);
  } finally {
    database.close();
  }
});
