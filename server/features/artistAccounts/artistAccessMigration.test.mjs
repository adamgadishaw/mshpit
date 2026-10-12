import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ensureArtistAccessRetentionSchema } from "./artistAccessRetention.js";

test("local v1 retention upgrade preserves private snapshots and installs publication guards idempotently", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY);INSERT INTO users VALUES('old-author');
      CREATE TABLE artist_profiles(artist_key TEXT PRIMARY KEY,owner_id TEXT,bio TEXT,avatar_uri TEXT,banner TEXT);
      CREATE TABLE posts(id TEXT PRIMARY KEY,removed INTEGER);INSERT INTO posts VALUES('old-post',1);
      CREATE TABLE artist_posts(id TEXT PRIMARY KEY,removed INTEGER);
      CREATE TABLE artist_access_revocations(id TEXT PRIMARY KEY,artist_key TEXT,owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,reviewer_id TEXT,reason TEXT,created_at INTEGER,profile_json TEXT,review_status TEXT DEFAULT 'pending');
      CREATE TABLE artist_access_retained_content(revocation_id TEXT REFERENCES artist_access_revocations(id) ON DELETE CASCADE,target_type TEXT,target_id TEXT,record_json TEXT,PRIMARY KEY(revocation_id,target_type,target_id));
      CREATE TABLE artist_access_retained_media(revocation_id TEXT,owner_id TEXT,url TEXT,object_key TEXT,PRIMARY KEY(revocation_id,url,object_key));
      INSERT INTO artist_access_revocations VALUES('old-review','old-key','old-author',NULL,'Old review',1,'{"bio":"Retained old biography"}','pending');
      INSERT INTO artist_access_retained_content VALUES('old-review','post','old-post','{"id":"old-post","removed":0,"review":"Preserved old body"}');`);
    ensureArtistAccessRetentionSchema(db);ensureArtistAccessRetentionSchema(db);
    const row = db.prepare("SELECT * FROM artist_access_retained_content").get();
    assert.equal(JSON.parse(row.record_json).review, "Preserved old body");
    assert.equal(row.publication, "hidden");assert.equal(row.original_public, 0, "unknown historic visibility is not guessed public");
    assert.equal(row.revision, 1);
    assert.throws(() => db.prepare("UPDATE posts SET removed=0 WHERE id='old-post'").run(), /requires retained-content review/);
    assert.ok(db.prepare("PRAGMA table_info(artist_profiles)").all().some(column => column.name === "bio_author_id"));
  } finally { db.close(); }
});

test("new and existing local application databases migrate before new public SQL is prepared", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-access-upgrade-")), existing = join(directory, "existing"), fresh = join(directory, "fresh");
  const currentDb = new URL("../../db.js", import.meta.url).href;
  const publicRepo = new URL("../seo/publicDocumentRepository.js", import.meta.url).href;
  const env = { ...process.env, NODE_ENV: "test", PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "false" };delete env.RENDER;delete env.RESEND_API_KEY;delete env.MAIL_FROM;
  const run = (dataDir, code) => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { env: { ...env, PIT_DATA_DIR: dataDir }, encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout;
  };
  try {
    mkdirSync(existing);
    const old = new DatabaseSync(join(existing, "pit.db"));
    try {
      old.exec(readFileSync(new URL("./fixtures/preArtistAccessSchema.sql", import.meta.url), "utf8"));
      assert.equal(old.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'artist_access_%'").get().n, 0);
      assert.ok(!old.prepare("PRAGMA table_info(artist_profiles)").all().some(column => column.name === "bio_author_id"));
      old.exec(`INSERT INTO users(id,email,name,handle,pass_hash,role,artist_name,created_at)
        VALUES('upgrade-fixture','upgrade@example.test','Upgrade','upgrade','fixture','artist','Upgrade Fixture',1);
        INSERT INTO artist_profiles(artist_key,owner_id,bio,avatar_uri,avatar_owner_id,banner,banner_owner_id,feed_enabled,updated_at)
        VALUES('upgrade fixture','upgrade-fixture','Existing biography','https://fixture.example/avatar.webp','upgrade-fixture','https://fixture.example/banner.webp','upgrade-fixture',1,1);
        INSERT INTO artist_posts(id,artist_key,user_id,text,removed,created_at)
        VALUES('upgrade-post','upgrade fixture','upgrade-fixture','Existing artist update',0,1);
        INSERT INTO posts(id,user_id,artist,venue,overall,review,created_at)
        VALUES('upgrade-review','upgrade-fixture','Upgrade Fixture','Fixture Room',4,'Existing personal review',1);`);
    } finally { old.close(); }
    for (const dataDir of [existing, fresh]) {
      const inspect = `globalThis.fetch=()=>{throw Error('No provider calls in migration fixture')};const {db}=await import(${JSON.stringify(currentDb)});const {createPublicDocumentRepository}=await import(${JSON.stringify(publicRepo)});createPublicDocumentRepository(db);console.log(JSON.stringify({tables:db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'artist_access_%' AND type='table'").all().length,foreignKeys:db.prepare('PRAGMA foreign_key_check').all().length,preserved:!!db.prepare("SELECT 1 FROM users WHERE id='upgrade-fixture'").get(),profile:db.prepare("SELECT owner_id,bio,avatar_uri,banner,feed_enabled FROM artist_profiles WHERE artist_key='upgrade fixture'").get(),update:db.prepare("SELECT user_id,text,removed FROM artist_posts WHERE id='upgrade-post'").get(),review:db.prepare("SELECT user_id,review FROM posts WHERE id='upgrade-review'").get(),role:db.prepare("SELECT role FROM users WHERE id='upgrade-fixture'").get()?.role}));db.close();`;
      run(dataDir, inspect); // Reboot also exercises idempotent full application initialization.
      const output = run(dataDir, inspect);
      const state = JSON.parse(output.trim().split(/\r?\n/).at(-1));assert.equal(state.tables, 4);assert.equal(state.foreignKeys, 0);
      assert.equal(state.preserved, dataDir === existing);
      if (dataDir === existing) {
        assert.deepEqual(state.profile, { owner_id: "upgrade-fixture", bio: "Existing biography", avatar_uri: "https://fixture.example/avatar.webp", banner: "https://fixture.example/banner.webp", feed_enabled: 1 });
        assert.deepEqual(state.update, { user_id: "upgrade-fixture", text: "Existing artist update", removed: 0 });
        assert.deepEqual(state.review, { user_id: "upgrade-fixture", review: "Existing personal review" });
        assert.equal(state.role, "artist");
      }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
