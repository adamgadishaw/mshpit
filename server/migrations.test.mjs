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
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { trackOverrideIdentityKey } from "./trackIdentity.js";

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
