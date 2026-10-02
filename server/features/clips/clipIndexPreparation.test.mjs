import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureClipIndexSchema, clipIndexState, assertClipIndexReady, CLIP_PHOTOS_MAX_BYTES } from "./clipIndex.js";
import { prepareClipIndex, prepareClipIndexBatch, clipPreparationBatchSql } from "./clipIndexPreparation.js";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "pit-clip-preparation-"));
  const path = join(dir, "index.db");
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE posts(id TEXT PRIMARY KEY,photos TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE post_media(post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      asset_id TEXT UNIQUE,position INTEGER,PRIMARY KEY(post_id,position));`);
  const other = new DatabaseSync(path); // deliberately no application JS functions
  t.after(() => { other.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { db, other, path };
}
const insert = (db, id, photos = '["https://example.com/a.mp4"]') =>
  db.prepare("INSERT INTO posts VALUES(?,?,?)").run(id, photos, 10);

test("preparation resumes through a fixed horizon while native old-writer triggers cover both sides", async (t) => {
  const { db, other, path } = fixture(t);
  for (let i = 0; i < 7; i++) insert(db, `p${i}`);
  ensureClipIndexSchema(db);
  assert.throws(() => assertClipIndexReady(db), /preparation is incomplete/);
  assert.deepEqual(prepareClipIndexBatch(db, { batchSize: 2 }), { ready: false, processed: 2 });
  assert.equal(clipIndexState(db).last_post_id, "p1");
  other.exec("BEGIN");
  insert(other, "p00", '["behind"]');
  insert(other, "z_new", '["ahead"]');
  other.prepare("UPDATE posts SET photos=?,created_at=99 WHERE id='p0'").run('["changed",3,null,{"x":1},"changed"]');
  other.exec("COMMIT");
  const reopened = new DatabaseSync(path);
  try {
    ensureClipIndexSchema(reopened);
    assert.equal(clipIndexState(reopened).upper_post_id, "p6");
    let yielded = false;
    setImmediate(() => { yielded = true; });
    const result = await prepareClipIndex(reopened, { batchSize: 2 });
    assert.equal(yielded, true);
    assert.equal(result.processed, 5);
    assertClipIndexReady(reopened);
    assert.equal(reopened.prepare("SELECT COUNT(*) n FROM clip_post_candidates").get().n, 9);
    assert.deepEqual(reopened.prepare("SELECT raw_url FROM clip_photo_refs WHERE post_id='p0' ORDER BY position").all().map(r => r.raw_url), ["changed", "changed"]);
    assert.equal(reopened.prepare("SELECT created_at FROM clip_post_candidates WHERE post_id='p0'").get().created_at, 99);
  } finally { reopened.close(); }
});

test("oversized historical JSON aborts its entire batch and does not claim completion", (t) => {
  const { db } = fixture(t);
  insert(db, "a");
  insert(db, "b", JSON.stringify(["x".repeat(CLIP_PHOTOS_MAX_BYTES)]));
  ensureClipIndexSchema(db);
  assert.throws(() => prepareClipIndexBatch(db), { code: "CLIP_INDEX_PHOTOS_OVERSIZED" });
  assert.equal(clipIndexState(db).last_post_id, null);
  assert.equal(clipIndexState(db).ready, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM clip_photo_refs").get().n, 0);
  assert.throws(() => assertClipIndexReady(db), /incomplete/);
});

test("native trigger maintenance rolls back and handles malformed JSON, attachments, timestamps and deletion", (t) => {
  const { db, other } = fixture(t);
  ensureClipIndexSchema(db);
  assertClipIndexReady(db);
  insert(other, "a", "[]");
  insert(other, "b", "{broken");
  other.exec("INSERT INTO post_media VALUES('a','asset',0)");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM clip_post_candidates").get().n, 1);
  other.exec("BEGIN; UPDATE post_media SET post_id='b'; UPDATE posts SET created_at=123 WHERE id='b'; ROLLBACK");
  assert.equal(db.prepare("SELECT post_id FROM clip_post_candidates").get().post_id, "a");
  other.exec("UPDATE post_media SET post_id='b'; UPDATE posts SET created_at=123 WHERE id='b'");
  assert.deepEqual({ ...db.prepare("SELECT * FROM clip_post_candidates").get() }, { post_id: "b", created_at: 123, legacy_hint: 0 });
  other.exec("DELETE FROM post_media");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM clip_post_candidates").get().n, 0);
  other.prepare("UPDATE posts SET photos=? WHERE id='a'").run('[null,{},4,false,"yes"]');
  assert.equal(db.prepare("SELECT raw_url FROM clip_photo_refs").get().raw_url, "yes");
  other.exec("DELETE FROM posts WHERE id='a'");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM clip_photo_refs").get().n, 0);
  assertClipIndexReady(db);
});

test("resumed preparation seeks the primary-key lower and upper bounds", (t) => {
  const { db } = fixture(t);
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${clipPreparationBatchSql(true)}`).all("p9990", "p9999", 2);
  const detail = plan.map(row => row.detail).join("\n");
  assert.match(detail, /id>\? AND id<\?/);
  assert.doesNotMatch(detail, /SCAN posts|TEMP B-TREE/);
});

test("preparation yields at aggregate bytes and rejects oversized arrays without truncation", async (t) => {
  const { db } = fixture(t);
  for (let i = 0; i < 4; i++) insert(db, `p${i}`, JSON.stringify(["x".repeat(300_000)]));
  ensureClipIndexSchema(db);
  assert.deepEqual(prepareClipIndexBatch(db), { ready: false, processed: 3 });
  assert.equal(clipIndexState(db).last_post_id, "p2");
  assert.deepEqual(await prepareClipIndex(db), { ready: true, processed: 1 });
  const { db: oversized } = fixture(t);
  insert(oversized, "a", JSON.stringify(Array(4097).fill("")));
  ensureClipIndexSchema(oversized);
  assert.throws(() => prepareClipIndexBatch(oversized), { code: "CLIP_INDEX_PHOTOS_OVERSIZED" });
  assert.equal(clipIndexState(oversized).ready, 0);
  assert.equal(clipIndexState(oversized).last_post_id, null);
  assert.equal(oversized.prepare("SELECT COUNT(*) n FROM clip_photo_refs").get().n, 0);
});

test("valid JS arrays beyond native JSON depth block preparation instead of disappearing", (t) => {
  const { db } = fixture(t);
  const raw = '["https://example.com/clip.mp4",' + "[".repeat(1001) + "0" + "]".repeat(1001) + "]";
  assert.equal(JSON.parse(raw)[0], "https://example.com/clip.mp4");
  insert(db, "a", raw);
  ensureClipIndexSchema(db);
  assert.throws(() => prepareClipIndexBatch(db), /native JSON parser support/);
  assert.equal(clipIndexState(db).ready, 0);
  assert.equal(clipIndexState(db).last_post_id, null);
});

test("preparation also yields before exceeding4096 aggregate array elements", async (t) => {
  const { db } = fixture(t);
  for (let i = 0; i < 3; i++) insert(db, `p${i}`, JSON.stringify(Array(2000).fill("")));
  ensureClipIndexSchema(db);
  assert.deepEqual(prepareClipIndexBatch(db), { ready: false, processed: 2 });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM clip_photo_refs").get().n, 4000);
  assert.deepEqual(await prepareClipIndex(db), { ready: true, processed: 1 });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM clip_photo_refs").get().n, 6000);
});
