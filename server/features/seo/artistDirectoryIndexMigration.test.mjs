import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("directory evidence indexes upgrade existing rows and survive a second startup", () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-directory-index-upgrade-"));
  const databaseUrl = new URL("../../db.js", import.meta.url).href;
  const repositoryUrl = new URL("./publicDocumentRepository.js", import.meta.url).href;
  const env = Object.fromEntries(["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA"]
    .filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, { NODE_ENV: "test", PIT_DATA_DIR: directory, PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "false" });
  const script = `
    globalThis.fetch = async () => { throw new Error('No network in migration fixture'); };
    const { db } = await import(${JSON.stringify(databaseUrl)});
    const { createPublicDocumentRepository } = await import(${JSON.stringify(repositoryUrl)});
    if (process.argv[1] === 'prepare-old') {
      db.exec("DROP INDEX idx_posts_public_artist_evidence; DROP INDEX idx_posts_public_artist_name_evidence");
      db.prepare('INSERT INTO users(id,email,name,handle,pass_hash,created_at) VALUES(?,?,?,?,?,?)')
        .run('directory-user','directory@example.invalid','Directory','directory','synthetic-unusable',1);
      db.prepare('INSERT INTO artists(norm,name,public_slug,rank_score,created_at,updated_at) VALUES(?,?,?,?,?,?)')
        .run('directory-artist','Directory Artist','directory-artist',999999,1,1);
      const post = db.prepare('INSERT INTO posts(id,user_id,artist,artist_key,venue,overall,review,created_at) VALUES(?,?,?,?,?,?,?,?)');
      post.run('canonical','directory-user','Directory Artist','directory-artist','Room',4,'A substantive review of the music, performance and sound in the room.',1);
      post.run('legacy','directory-user','DIRECTORY ARTIST',null,'Room',4,'Another substantive review whose original calendar date was never stored.',2);
    }
    const page = createPublicDocumentRepository(db).readDirectory({kind:'artists',at:1794484800000,today:'2026-11-12'});
    const data = {
      posts: db.prepare("SELECT * FROM posts WHERE user_id='directory-user' ORDER BY id").all(),
      // Ordinary startup also normalizes bundled catalog metadata. Compare its
      // membership/order, and the complete response row owned by this fixture.
      directory: { total: page.total, hasNext: page.hasNext, keys: page.artists.map(a=>a.norm),
        fixtureArtist: page.artists.find(a=>a.norm==='directory-artist') },
      indexes: db.prepare("SELECT name,sql FROM sqlite_schema WHERE name IN ('idx_posts_public_artist_evidence','idx_posts_public_artist_name_evidence') ORDER BY name").all(),
      integrity: db.prepare('PRAGMA quick_check').get().quick_check,
      foreignKeyViolations: db.prepare('PRAGMA foreign_key_check').all().length
    };
    db.close(); console.log('DIRECTORY_MIGRATION_RESULT ' + JSON.stringify(data));
  `;
  const run = phase => {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script, phase], {
      env, encoding: "utf8", timeout: 30_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(child.status, 0, `${child.error || ""}\n${child.stderr}\n${child.stdout}`);
    const result = child.stdout.split(/\r?\n/).find(line => line.startsWith("DIRECTORY_MIGRATION_RESULT "));
    assert.ok(result, child.stdout);
    return JSON.parse(result.slice("DIRECTORY_MIGRATION_RESULT ".length));
  };
  try {
    const before = run("prepare-old"), upgraded = run("upgrade"), restarted = run("restart");
    assert.equal(before.indexes.length, 0);
    assert.equal(upgraded.indexes.length, 2);
    assert.deepEqual(upgraded.posts, before.posts);
    assert.deepEqual(upgraded.directory, before.directory);
    assert.deepEqual(restarted, upgraded);
    assert.equal(upgraded.integrity, "ok");
    assert.equal(upgraded.foreignKeyViolations, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
