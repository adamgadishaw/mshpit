// Rollback safety.
//
// A deploy rolls back; the schema it migrated does not. Old code can therefore
// only survive a rollback while every migration is additive: it ignores columns
// it does not know about, but it cannot cope with one that was dropped, renamed
// or retyped underneath it. That property was rehearsed on 2026-08-05 (see
// LAUNCH.md section 5b) and this keeps it true.
//
// The migration loop in db.js already refuses anything but ADD COLUMN. What it
// cannot see is a destructive statement written outside the loop, which is what
// this test covers.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { trackOverrideIdentityKey } from "./trackIdentity.js";
import { createArtistMemorialRepository } from "./features/artistMemorials/artistMemorialRepository.js";
import { createArtistMemorialService } from "./features/artistMemorials/artistMemorialService.js";

const source = readFileSync(new URL("./db.js", import.meta.url), "utf8");

test("no destructive DDL anywhere in the database layer", () => {
  // Dropping or renaming makes a code rollback insufficient on its own: the
  // database has to be restored from a snapshot first, which is slower and
  // loses everything written since. Adding one of these is a deliberate
  // decision that should also update LAUNCH.md section 5b.
  const banned = /\b(DROP\s+COLUMN|DROP\s+TABLE|RENAME\s+COLUMN|RENAME\s+TO|ALTER\s+COLUMN)\b/gi;
  const offenders = source.split("\n")
    .map((line, index) => ({ line: line.trim(), n: index + 1 }))
    .filter(({ line }) => banned.test(line));
  assert.deepEqual(offenders.map((o) => `db.js:${o.n}  ${o.line.slice(0, 70)}`), []);
});

test("the additive-migration guard is still enforced at runtime", () => {
  // The loop parses each statement and throws on anything that is not an
  // ADD COLUMN, so a destructive entry fails at boot rather than on first use.
  assert.match(source, /ALTER TABLE \(\[a-z_\]\+\) ADD COLUMN/,
    "the migration parser changed; re-check that non-additive statements still cannot run");
  assert.match(source, /Unsupported additive migration/,
    "the guard that rejects non-additive migrations is gone");
});

test("every additive migration carries a default or is nullable", () => {
  // NOT NULL without a default fails on a table that already has rows, which
  // turns a routine deploy into an outage on the first boot after it.
  const block = /const additiveMigrations = \[([\s\S]*?)\n\];/.exec(source);
  assert.ok(block, "could not find the migration list; update this test");
  const statements = block[1].split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith('"ALTER TABLE'));
  assert.ok(statements.length > 10, `expected the real migration list, found ${statements.length}`);
  const unsafe = statements.filter((s) => /NOT NULL/i.test(s) && !/DEFAULT/i.test(s));
  assert.deepEqual(unsafe, [], "NOT NULL without DEFAULT fails on a table with existing rows");
});

test("landing showcase consent migrates historical posts as opted out", () => {
  assert.match(
    source,
    /ALTER TABLE posts ADD COLUMN landing_showcase INTEGER NOT NULL DEFAULT 0/,
    "historical artist-page consent must not become homepage consent during migration",
  );
});

test("verification retry receipts are additive, bounded, and avoid raw email", () => {
  assert.match(source, /CREATE TABLE IF NOT EXISTS email_verification_receipts/);
  assert.match(source, /email_hash\s+TEXT NOT NULL/);
  assert.doesNotMatch(source, /email_verification_receipts[\s\S]{0,300}\n\s*email\s+TEXT/i);
  assert.match(source, /idx_email_verification_receipts_expiry/);

  const emailColumnMigration = source.indexOf("ALTER TABLE users ADD COLUMN email_verify_hash");
  const lookupIndex = source.indexOf("idx_users_email_verify_hash");
  assert.ok(emailColumnMigration >= 0 && lookupIndex > emailColumnMigration,
    "the lookup index must be created only after legacy databases gain the column");
});

test("legacy artists receive unique immutable public slugs deterministically", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "pit-artist-public-slug-migration-"));
  process.env.PIT_DATA_DIR = dataDir;
  let legacy;
  let upgraded;
  let rebooted;
  try {
    legacy = await import(`./db.js?artist-public-slug-legacy=${encodeURIComponent(dataDir)}`);
    legacy.db.exec(`
      DELETE FROM artists;
      DROP TRIGGER trg_artists_public_slug_immutable;
      DROP INDEX idx_artists_public_slug;
      ALTER TABLE artists DROP COLUMN public_slug;
    `);
    const insertLegacy = legacy.db.prepare(`INSERT INTO artists
      (norm,name,rank_score,created_at,updated_at) VALUES (?,?,0,1,1)`);
    insertLegacy.run("seo slug collision a", "SEO Slug Collision");
    insertLegacy.run("seo slug collision b", "SEO-Slug Collision");
    insertLegacy.run("seo slug symbols", "!!!");
    legacy.db.close();
    legacy = null;

    upgraded = await import(`./db.js?artist-public-slug-upgrade=${encodeURIComponent(dataDir)}`);
    const migrated = upgraded.db.prepare(`SELECT norm,public_slug FROM artists
      WHERE norm LIKE 'seo slug %' ORDER BY norm`).all().map((row) => ({ ...row }));
    assert.equal(migrated.length, 3);
    assert.equal(migrated[0].public_slug, "seo-slug-collision");
    assert.match(migrated[1].public_slug, /^seo-slug-collision-[a-f0-9]{10}$/);
    assert.match(migrated[2].public_slug, /^artist-[a-f0-9]{12}$/);
    assert.equal(new Set(migrated.map((row) => row.public_slug.toLowerCase())).size, migrated.length);

    const indexes = upgraded.db.prepare("PRAGMA index_list(artists)").all();
    assert.ok(indexes.some((row) => row.name === "idx_artists_public_slug" && row.unique === 1));
    assert.equal(
      upgraded.artistStmts.byPublicSlug.get(migrated[0].public_slug)?.norm,
      "seo slug collision a",
    );
    assert.equal(
      upgraded.publicArtist(upgraded.artistStmts.byNorm.get("seo slug collision a"))?.publicSlug,
      migrated[0].public_slug,
    );
    assert.throws(
      () => upgraded.db.prepare("UPDATE artists SET public_slug=? WHERE norm=?")
        .run("moved-without-an-audited-migration", "seo slug collision a"),
      /artist public slug is immutable/i,
      "an arbitrary update cannot break an indexed artist URL",
    );
    upgraded.db.prepare(`INSERT INTO artists
      (norm,name,rank_score,created_at,updated_at) VALUES (?,?,0,1,1)`)
      .run("seo slug uniqueness probe", "SEO Slug Uniqueness Probe");
    assert.throws(
      () => upgraded.db.prepare("UPDATE artists SET public_slug=? WHERE norm=?")
        .run(migrated[0].public_slug.toUpperCase(), "seo slug uniqueness probe"),
      /UNIQUE constraint failed/i,
      "public slug uniqueness is case-insensitive for a newly assigned slug",
    );
    upgraded.db.prepare("DELETE FROM artists WHERE norm=?").run("seo slug uniqueness probe");

    upgraded.artistStmts.upsert.run(upgraded.artistRow(
      "seo slug collision a",
      { name: "A Completely New Display Name" },
      "test",
    ));
    assert.equal(
      upgraded.artistStmts.byNorm.get("seo slug collision a").public_slug,
      migrated[0].public_slug,
      "catalog enrichment and display-name changes cannot move an established URL",
    );

    upgraded.artistStmts.upsert.run(upgraded.artistRow(
      "seo slug collision c",
      { name: "SEO Slug Collision" },
      "test",
    ));
    assert.match(
      upgraded.artistStmts.byNorm.get("seo slug collision c").public_slug,
      /^seo-slug-collision-[a-f0-9]{10}$/,
      "new colliding catalog identities receive deterministic suffixes",
    );

    // A previous binary in a rolling deploy does not know the new column and
    // can still insert NULL. The first current enrichment fills that blank but
    // never rewrites an established slug.
    upgraded.db.prepare(`INSERT INTO artists
      (norm,name,rank_score,created_at,updated_at) VALUES (?,?,0,2,2)`)
      .run("seo slug rolling", "SEO Slug Rolling");
    assert.equal(upgraded.artistStmts.byNorm.get("seo slug rolling").public_slug, null);
    upgraded.artistStmts.upsert.run(upgraded.artistRow(
      "seo slug rolling",
      { name: "SEO Slug Rolling" },
      "test",
    ));
    assert.equal(upgraded.artistStmts.byNorm.get("seo slug rolling").public_slug, "seo-slug-rolling");

    const beforeReboot = upgraded.db.prepare(`SELECT norm,public_slug FROM artists
      WHERE norm LIKE 'seo slug %' ORDER BY norm`).all().map((row) => ({ ...row }));
    upgraded.db.close();
    upgraded = null;
    rebooted = await import(`./db.js?artist-public-slug-reboot=${encodeURIComponent(dataDir)}`);
    assert.deepEqual(
      rebooted.db.prepare(`SELECT norm,public_slug FROM artists
        WHERE norm LIKE 'seo slug %' ORDER BY norm`).all().map((row) => ({ ...row })),
      beforeReboot,
      "re-running the migration is idempotent",
    );
  } finally {
    try { legacy?.db.close(); } catch {}
    try { upgraded?.db.close(); } catch {}
    try { rebooted?.db.close(); } catch {}
    delete process.env.PIT_DATA_DIR;
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("legacy attendance, tour-date, and campaign tables gain safe additive columns", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "pit-index-migration-order-"));
  process.env.PIT_DATA_DIR = dataDir;

  // Build the complete pre-existing application schema, then remove only the
  // columns and indexes absent from the previous release. This keeps the fixture
  // HEAD-shaped without duplicating hundreds of unrelated CREATE statements.
  const previous = await import(`./db.js?index-migration-fixture=${encodeURIComponent(dataDir)}`);
  previous.db.prepare(`INSERT INTO email_campaigns
    (id,name,subject,body,audience,status,created_at,updated_at,test_sent_at)
    VALUES ('legacy_tested_campaign','Legacy','Old approved copy','Body','staff','draft',1,1,1)`).run();
  previous.db.prepare(`INSERT INTO track_overrides
    (key,title,artist,video_id,set_by,updated_at)
    VALUES ('|','初恋','宇多田ヒカル','legacyjp001',NULL,7)`).run();
  previous.db.prepare(`INSERT INTO track_source_overrides
    (provider,source_id,title,artist,video_id,set_by,updated_at)
    VALUES ('deezer','1234638792','Shared Recording','Proofed Artist','sourcepin01',NULL,8)`).run();
  previous.db.exec(`
    DROP INDEX idx_going_cursor;
    DROP INDEX idx_tourdates_owner_show;
    DROP INDEX idx_tourdates_visibility;
    DROP INDEX idx_tourdates_owner;
    ALTER TABLE going DROP COLUMN created_at;
    ALTER TABLE tour_dates DROP COLUMN release_at;
    ALTER TABLE tour_dates DROP COLUMN owner_id;
    ALTER TABLE email_queue DROP COLUMN claim_token;
    ALTER TABLE email_queue DROP COLUMN claimed_at;
    ALTER TABLE email_campaigns DROP COLUMN tested_revision;
    ALTER TABLE email_campaigns DROP COLUMN content_revision;
    ALTER TABLE plays DROP COLUMN source_id;
    ALTER TABLE plays DROP COLUMN provider;
  `);

  const upgraded = await import(`./db.js?index-migration-upgrade=${encodeURIComponent(dataDir)}`);
  const goingColumns = new Set(upgraded.db.prepare("PRAGMA table_info(going)").all().map((row) => row.name));
  const tourColumns = new Set(upgraded.db.prepare("PRAGMA table_info(tour_dates)").all().map((row) => row.name));
  const emailQueueColumns = new Set(upgraded.db.prepare("PRAGMA table_info(email_queue)").all().map((row) => row.name));
  const campaignColumns = new Set(upgraded.db.prepare("PRAGMA table_info(email_campaigns)").all().map((row) => row.name));
  const playColumns = new Set(upgraded.db.prepare("PRAGMA table_info(plays)").all().map((row) => row.name));
  const goingIndexes = new Set(upgraded.db.prepare("PRAGMA index_list(going)").all().map((row) => row.name));
  const tourIndexes = new Set(upgraded.db.prepare("PRAGMA index_list(tour_dates)").all().map((row) => row.name));

  assert.ok(goingColumns.has("created_at"));
  assert.ok(tourColumns.has("owner_id"));
  assert.ok(tourColumns.has("release_at"));
  assert.ok(emailQueueColumns.has("claimed_at"));
  assert.ok(emailQueueColumns.has("claim_token"));
  assert.ok(campaignColumns.has("content_revision"));
  assert.ok(campaignColumns.has("tested_revision"));
  assert.ok(playColumns.has("provider"));
  assert.ok(playColumns.has("source_id"));
  const legacyCampaign = upgraded.emailStmts.campaignById.get("legacy_tested_campaign");
  assert.equal(legacyCampaign.content_revision, 1);
  assert.equal(legacyCampaign.tested_revision, null,
    "a legacy test timestamp is not silently bound to unknown historical copy");
  assert.equal(legacyCampaign.test_sent_at, 1);
  assert.equal(upgraded.emailStmts.startCampaign.run({
    id: legacyCampaign.id,
    started_at: 2,
    total: 0,
    revision: legacyCampaign.content_revision,
    require_current_test: 1,
  }).changes, 0, "a migrated legacy approval cannot start a broadcast without a fresh revision-bound test");
  assert.ok(goingIndexes.has("idx_going_cursor"));
  assert.ok(tourIndexes.has("idx_tourdates_visibility"));
  assert.ok(tourIndexes.has("idx_tourdates_owner"));
  assert.ok(tourIndexes.has("idx_tourdates_owner_show"));
  const migratedOverride = upgraded.db.prepare("SELECT * FROM track_overrides WHERE key=?")
    .get(trackOverrideIdentityKey("初恋", "宇多田ヒカル"));
  assert.equal(migratedOverride.video_id, "legacyjp001");
  assert.equal(migratedOverride.updated_at, 7, "identity migration must not refresh authoritative pin age");
  assert.ok(upgraded.db.prepare("SELECT 1 FROM track_overrides WHERE key='|'").get(),
    "legacy key stays available for a code rollback");
  assert.equal(upgraded.db.prepare("SELECT video_id FROM track_source_overrides WHERE provider='deezer' AND source_id='1234638792'").get().video_id, "sourcepin01");
  assert.equal(upgraded.db.prepare("SELECT 1 FROM track_overrides WHERE key=?")
    .get(trackOverrideIdentityKey("Shared Recording", "Proofed Artist")), undefined,
  "source overrides live outside legacy reconciliation and cannot corrupt a tuple pin during a rolling deploy");
});

test("legacy post friend-tag JSON backfills an indexed rolling-deploy relation", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "pit-post-user-tag-migration-"));
  process.env.PIT_DATA_DIR = dataDir;
  const legacy = await import(`./db.js?post-user-tags-legacy=${encodeURIComponent(dataDir)}`);
  const addUser = (id) => legacy.q.insertUser.run(
    id,
    `${id}@example.com`,
    id,
    id,
    "test-hash",
    "fan",
    "Toronto",
    43.65,
    -79.38,
    id.slice(0, 2).toUpperCase(),
    "#123456",
    Date.now(),
  );
  addUser("migration-tag-author");
  addUser("migration-tag-left");
  addUser("migration-tag-right");
  legacy.db.exec(`
    DROP TRIGGER trg_posts_user_tags_insert;
    DROP TRIGGER trg_posts_user_tags_update;
    DROP TABLE post_user_tags;
    DELETE FROM app_meta WHERE key='schema:post-user-tags:v1';
  `);
  legacy.db.prepare(`INSERT INTO posts
    (id,user_id,artist,venue,overall,tagged_user_ids,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(
    "migration-tag-post",
    "migration-tag-author",
    "Migration Act",
    "Migration Hall",
    4,
    JSON.stringify(["migration-tag-right", "migration-tag-left"]),
    123,
  );
  legacy.db.close();

  const upgraded = await import(`./db.js?post-user-tags-upgrade=${encodeURIComponent(dataDir)}`);
  try {
    assert.deepEqual(
      upgraded.db.prepare(`SELECT post_id,user_id,author_id,position FROM post_user_tags
        WHERE post_id='migration-tag-post' ORDER BY position`).all().map((row) => ({ ...row })),
      [
        { post_id: "migration-tag-post", user_id: "migration-tag-right", author_id: "migration-tag-author", position: 0 },
        { post_id: "migration-tag-post", user_id: "migration-tag-left", author_id: "migration-tag-author", position: 1 },
      ],
    );
    assert.ok(upgraded.db.prepare("SELECT 1 FROM app_meta WHERE key='schema:post-user-tags:v1'").get());
    const indexes = new Set(upgraded.db.prepare("PRAGMA index_list(post_user_tags)").all().map((row) => row.name));
    assert.ok(indexes.has("idx_post_user_tags_user_post"));
    assert.ok(indexes.has("idx_post_user_tags_author_user_post"));

    // Simulate an older process that still writes only tagged_user_ids after the
    // migration. The database trigger keeps the new relation authoritative.
    upgraded.db.prepare(`INSERT INTO posts
      (id,user_id,artist,venue,overall,tagged_user_ids,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      "migration-tag-rolling-post",
      "migration-tag-author",
      "Migration Act",
      "Migration Hall",
      4,
      JSON.stringify(["migration-tag-left"]),
      124,
    );
    assert.equal(
      upgraded.db.prepare("SELECT user_id FROM post_user_tags WHERE post_id='migration-tag-rolling-post'").get()?.user_id,
      "migration-tag-left",
    );

    // The previous release's author-delete statement cannot name campaign or
    // tagged_user_ids. The database recognizes its complete irreversible scrub
    // signature and clears this release's fields plus normalized relation.
    upgraded.db.prepare(`INSERT INTO posts
      (id,user_id,kind,artist,venue,overall,review,campaign,tagged_user_ids,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      "migration-tag-old-author-delete",
      "migration-tag-author",
      "status",
      "",
      "",
      0,
      "Legacy process will scrub this copy",
      JSON.stringify({ version: 1, treatment: "spotlight", artistKey: "migration act" }),
      JSON.stringify(["migration-tag-left"]),
      125,
    );
    upgraded.db.prepare(`UPDATE posts SET removed=1,artist='',venue='',city='',date='',overall=0,
      band=NULL,room=NULL,dims='{}',review='',photos='[]',photos_public=0,landing_showcase=0,
      setlist='[]',tour=NULL,tags='[]',song=NULL,playlist=NULL,artist_key=NULL,artist_mbid=NULL,
      venue_key=NULL,client_mutation_id=NULL,client_mutation_hash=NULL,updated_at=?
      WHERE id=? AND user_id=?`).run(126, "migration-tag-old-author-delete", "migration-tag-author");
    assert.deepEqual(
      { ...upgraded.db.prepare(`SELECT campaign,tagged_user_ids,
        (SELECT COUNT(*) FROM post_user_tags WHERE post_id=posts.id) AS relation_count
        FROM posts WHERE id=?`).get("migration-tag-old-author-delete") },
      { campaign: null, tagged_user_ids: "[]", relation_count: 0 },
    );

    // Moderator hides remain reversible and therefore must not be mistaken for
    // the legacy author's destructive tombstone.
    upgraded.db.prepare(`INSERT INTO posts
      (id,user_id,kind,artist,venue,overall,review,campaign,tagged_user_ids,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      "migration-tag-moderator-hide",
      "migration-tag-author",
      "status",
      "",
      "",
      0,
      "Keep this for a reversible moderation restore",
      JSON.stringify({ version: 1, treatment: "spotlight", artistKey: "migration act" }),
      JSON.stringify(["migration-tag-left"]),
      127,
    );
    upgraded.db.prepare("UPDATE posts SET removed=1 WHERE id=?").run("migration-tag-moderator-hide");
    const hidden = upgraded.db.prepare(`SELECT campaign,tagged_user_ids,
      (SELECT COUNT(*) FROM post_user_tags WHERE post_id=posts.id) AS relation_count
      FROM posts WHERE id=?`).get("migration-tag-moderator-hide");
    assert.ok(hidden.campaign);
    assert.equal(hidden.tagged_user_ids, JSON.stringify(["migration-tag-left"]));
    assert.equal(hidden.relation_count, 1);

    // Simulate the previous release's account erasure: it deletes the user
    // directly, without the current API's explicit JSON scrub. The BEFORE DELETE
    // compatibility trigger removes only that recipient and reindexes survivors.
    upgraded.db.prepare(`INSERT INTO posts
      (id,user_id,artist,venue,overall,tagged_user_ids,created_at)
      VALUES (?,?,?,?,?,?,?)`).run(
      "migration-tag-old-account-delete",
      "migration-tag-author",
      "Migration Act",
      "Migration Hall",
      4,
      JSON.stringify(["migration-tag-left", "migration-tag-right"]),
      128,
    );
    upgraded.db.prepare("DELETE FROM users WHERE id=?").run("migration-tag-left");
    assert.deepEqual(
      JSON.parse(upgraded.db.prepare("SELECT tagged_user_ids FROM posts WHERE id=?")
        .get("migration-tag-old-account-delete").tagged_user_ids),
      ["migration-tag-right"],
    );
    assert.deepEqual(
      upgraded.db.prepare(`SELECT user_id,position FROM post_user_tags
        WHERE post_id=? ORDER BY position`).all("migration-tag-old-account-delete").map((row) => ({ ...row })),
      [{ user_id: "migration-tag-right", position: 0 }],
    );
  } finally {
    upgraded.db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("legacy artist memorials gain exact identity bindings without exposing ambiguous rows", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "pit-artist-memorial-migration-"));
  const migrationAt = Date.parse("2026-08-25T12:00:00.000Z");
  process.env.PIT_DATA_DIR = dataDir;
  let legacy;
  let upgraded;
  try {
    legacy = await import(`./db.js?artist-memorial-legacy=${encodeURIComponent(dataDir)}`);
    const validArtist = legacy.db.prepare(`SELECT norm,name,lower(mbid) mbid FROM artists
      WHERE mbid IS NOT NULL AND length(mbid)=36
        AND lower(mbid) GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[1-5][0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
      ORDER BY norm LIMIT 1`).get();
    assert.ok(validArtist?.mbid, "the bundled catalog must provide a valid migration fixture MBID");
    const secondValidArtist = legacy.db.prepare(`SELECT norm,name,lower(mbid) mbid FROM artists
      WHERE norm<>? AND mbid IS NOT NULL AND length(mbid)=36
        AND lower(mbid) GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[1-5][0-9a-f][0-9a-f][0-9a-f]-[89ab][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
      ORDER BY norm LIMIT 1`).get(validArtist.norm);
    assert.ok(secondValidArtist?.mbid, "the migration fixture needs a second valid artist for a new write");
    legacy.db.prepare(`INSERT INTO artists
      (norm,name,mbid,rank_score,created_at,updated_at)
      VALUES ('malformed memorial artist','Malformed Memorial Artist',?,0,1,1)
      ON CONFLICT(norm) DO UPDATE SET mbid=excluded.mbid`).run("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx");
    legacy.db.exec(`
      DROP TRIGGER IF EXISTS trg_artist_memorials_require_mbid_insert;
      DROP TRIGGER IF EXISTS trg_artist_memorials_require_mbid_update;
      DROP INDEX IF EXISTS idx_artist_memorials_status_updated;
      DROP TABLE artist_memorials;
      CREATE TABLE artist_memorials (
        artist_key           TEXT PRIMARY KEY,
        artist_name          TEXT NOT NULL,
        status               TEXT NOT NULL CHECK (status IN ('draft','published')),
        death_date           TEXT NOT NULL,
        summary              TEXT NOT NULL,
        thank_you            TEXT NOT NULL,
        accomplishments      TEXT NOT NULL,
        source_url           TEXT NOT NULL,
        source_title         TEXT,
        source_hostname      TEXT NOT NULL,
        source_verified_at   INTEGER NOT NULL,
        first_published_at   INTEGER,
        published_at         INTEGER,
        spotlight_started_at INTEGER,
        spotlight_ends_at    INTEGER,
        created_at           INTEGER NOT NULL,
        updated_at           INTEGER NOT NULL,
        CHECK (
          (status='draft' AND published_at IS NULL AND spotlight_started_at IS NULL AND spotlight_ends_at IS NULL)
          OR
          (status='published' AND published_at IS NOT NULL AND first_published_at IS NOT NULL
            AND spotlight_started_at IS NOT NULL AND spotlight_ends_at > spotlight_started_at)
        )
      );
    `);
    const insertLegacy = legacy.db.prepare(`INSERT INTO artist_memorials
      (artist_key,artist_name,status,death_date,summary,thank_you,accomplishments,
       source_url,source_title,source_hostname,source_verified_at,first_published_at,
       published_at,spotlight_started_at,spotlight_ends_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const legacyValues = (key, name) => [
      key,
      name,
      "published",
      "2024-05-17",
      "A singular performer whose songs and live shows changed generations.",
      "Thank you for leaving the music with us.",
      JSON.stringify(["Three landmark albums"]),
      "https://news.example.org/artist/confirmed",
      "Official announcement",
      "news.example.org",
      migrationAt,
      migrationAt,
      migrationAt,
      migrationAt,
      migrationAt + 30 * 24 * 60 * 60 * 1000,
      migrationAt,
      migrationAt,
    ];
    insertLegacy.run(...legacyValues(validArtist.norm, validArtist.name));
    insertLegacy.run(...legacyValues("unmatched memorial artist", "Unmatched Memorial Artist"));
    insertLegacy.run(...legacyValues("malformed memorial artist", "Malformed Memorial Artist"));
    legacy.db.close();
    legacy = null;

    upgraded = await import(`./db.js?artist-memorial-upgrade=${encodeURIComponent(dataDir)}`);
    const rows = upgraded.db.prepare(`SELECT artist_key,artist_mbid FROM artist_memorials
      ORDER BY artist_key`).all().map((row) => ({ ...row }));
    assert.equal(rows.find((row) => row.artist_key === validArtist.norm)?.artist_mbid, validArtist.mbid);
    assert.equal(rows.find((row) => row.artist_key === "unmatched memorial artist")?.artist_mbid, null);
    assert.equal(rows.find((row) => row.artist_key === "malformed memorial artist")?.artist_mbid, null);

    const repository = createArtistMemorialRepository(upgraded.db);
    const service = createArtistMemorialService({ repository });
    assert.equal(service.readPublic({
      artistKey: "unmatched memorial artist",
      artistMbid: "12345678-1234-4234-8234-123456789abc",
      at: migrationAt,
    }), null);
    assert.equal(service.readPublic({
      artistKey: "malformed memorial artist",
      artistMbid: "12345678-1234-4234-8234-123456789abc",
      at: migrationAt,
    }), null);
    const saved = service.upsert({
      status: "published",
      deathDate: "2024-05-17",
      summary: "A revised memorial summary that keeps the verified artist identity intact.",
      thankYou: "Thank you for leaving the music with us.",
      accomplishments: ["Three landmark albums"],
      sourceUrl: "https://news.example.org/artist/confirmed",
      sourceTitle: "Official announcement",
      confirmedIndividual: true,
      restartSpotlight: false,
    }, {
      artistKey: validArtist.norm,
      artistName: validArtist.name,
      artistMbid: validArtist.mbid,
      at: migrationAt + 1,
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.changed, true);
    assert.equal(repository.findByArtistKey(validArtist.norm).artist_mbid, validArtist.mbid);
    const created = service.upsert({
      status: "draft",
      deathDate: "2024-05-17",
      summary: "A newly created memorial proves legacy extra columns do not block current writes.",
      thankYou: "Thank you for leaving the music with us.",
      accomplishments: ["Three landmark albums"],
      sourceUrl: "https://news.example.org/artist/confirmed",
      sourceTitle: "Official announcement",
      confirmedIndividual: true,
      restartSpotlight: false,
    }, {
      artistKey: secondValidArtist.norm,
      artistName: secondValidArtist.name,
      artistMbid: secondValidArtist.mbid,
      at: migrationAt + 2,
    });
    assert.equal(created.ok, true);
    assert.equal(repository.findByArtistKey(secondValidArtist.norm).artist_mbid, secondValidArtist.mbid);
  } finally {
    try { upgraded?.db.close(); } catch { /* architecture: allow-empty-catch -- test cleanup preserves the migration assertion */ }
    try { legacy?.db.close(); } catch { /* architecture: allow-empty-catch -- test cleanup preserves the migration assertion */ }
    rmSync(dataDir, { recursive: true, force: true });
  }
});
