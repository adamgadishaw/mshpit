import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "pit-newsroom-video-"));
process.env.PIT_DATA_DIR = directory;
const { db, q } = await import("../../db.js");
const { createNewsDeskEditor } = await import("./newsDeskEditor.js");
const { createNewsDeskReader, normalizeSelfWrittenStory } = await import("./newsDeskService.js");
const { newsSourceLine, newsStorySources, newsStoryVideo, newsStoryPhoto } = await import("../../../src/domain/newsDesk.mjs");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
const at = Date.now();
for (const id of ["fixture_editor", "fixture_publisher", "fixture_other"]) {
  q.insertUser.run(id, `${id}@example.test`, id, id, "unused", "editor", "Toronto", null, null, "FX", "#123456", at);
}
const editor = createNewsDeskEditor({ database: db, env: { NEWS_DESK_ACCOUNT_ID: "fixture_publisher" },
  summarize: () => assert.fail("Import must not generate reporting"), fetchArticle: () => assert.fail("No remote document reads") });
let sequence = 0;
function readyMedia(kind, owner = "fixture_editor") {
  const suffix = ++sequence, id = `ma_newsroom_fixture_${suffix}`;
  const source = `users/${owner}/post/${suffix}-source`, render = `users/${owner}/post/${suffix}-render`, poster = `users/${owner}/post/${suffix}-poster`;
  const mime = kind === "video" ? "video/mp4" : "image/jpeg";
  for (const [key, scope] of [[source, "private"], [render, "public"], ...(kind === "video" ? [[poster, "public"]] : [])]) {
    db.prepare("INSERT INTO media_objects(object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at) VALUES (?,?,?,'post',4096,'issued',?,?)").run(key, owner, scope, at, at);
  }
  db.prepare(`INSERT INTO media_assets(id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,
    original_name,mime_type,byte_size,width,height,orientation,metadata_status,codec_status,status,edit_recipe,recipe_version,
    finalize_hash,source_verified_at,render_state,render_variant_id,poster_variant_id,created_at,updated_at)
    VALUES (?,?,?,?,'post',?,?,?,'private','fixture',?,4096,640,360,0,'declared',?,'ready','{"coverMs":0}',1,?,?,'ready',?,?,?,?)`)
    .run(id, owner, `client-${suffix}`, "a".repeat(64), kind, source, `pit-private:${source}`, mime, kind === "video" ? "verified" : "not_applicable",
      "b".repeat(64), at, `mv_render_${suffix}`, kind === "video" ? `mv_poster_${suffix}` : null, at, at);
  for (const [role, key, type] of [["render", render, mime], ...(kind === "video" ? [["poster", poster, "image/jpeg"]] : [])]) {
    db.prepare(`INSERT INTO media_variants(id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,
      time_ms,status,finalize_hash,verified_at,verification_origin,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,2048,640,360,0,'verified',?,?,'private_derivative_v1',?,?)`)
      .run(`mv_${role}_${suffix}`, id, `client-${role}-${suffix}`, "c".repeat(64), role, key, `https://media.example.test/${key}`, type, "d".repeat(64), at, at, at);
  }
  return { assetId: id, name: `${kind} creator`, url: `https://example.test/${kind}-rights`, credit: "Synthetic attribution" };
}
const input = () => ({ actorId: "fixture_editor", headline: "Fixture band announces a new tour",
  summary: "The band's official announcement sets out the new tour dates.", body: "Synthetic fixture reporting that stays off production.", category: "tour",
  sources: [{ kind: "article", name: "Fixture Band", url: "https://artist.example.com/tour" }], photo: readyMedia("image"), video: readyMedia("video") });
test("draft, reopen and manual publication retain one cover, one verified video and separate credits", async () => {
  const value = input(), saved = editor.writeSelfWritten(value);
  assert.equal(saved.status, "draft"); assert.equal(saved.video.status, "ready");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM news_stories").get().n, 0, "saving never publishes");
  assert.equal((await editor.overview()).drafts.recent.find((draft) => draft.id === saved.id).video.assetId, value.video.assetId);
  const published = editor.publish(saved.id);
  const story = createNewsDeskReader(db).forPost(published.postId);
  assert.deepEqual(story.media.map((media) => media.kind), ["image", "video"]);
  assert.equal(story.sources.find((source) => source.kind === "video").credit, value.video.credit);
  assert.equal(story.confirmedBy, 1); assert.equal(newsStorySources(story).length, 1);
  assert.equal(newsSourceLine(story), "Sources: Fixture Band");
  assert.ok(newsStoryVideo(story)?.posterUrl); assert.equal(newsStoryPhoto(story), story.media[0].url);
  assert.equal(db.prepare("SELECT user_id FROM posts WHERE id=?").get(published.postId).user_id, "fixture_publisher");
  assert.equal(db.prepare("SELECT owner_id FROM media_assets WHERE id=?").get(value.video.assetId).owner_id, "fixture_editor");
  assert.throws(() => editor.publish(saved.id), /already published/u);
});
test("foreign, unfinished, missing-poster and wrong-kind video roll back the entire publication", () => {
  for (const variant of ["foreign", "pending", "poster", "kind"]) {
    const value = input();
    if (variant === "foreign") value.video = readyMedia("video", "fixture_other");
    if (variant === "pending") db.prepare("UPDATE media_assets SET status='upload_pending' WHERE id=?").run(value.video.assetId);
    if (variant === "poster") db.prepare("UPDATE media_assets SET poster_variant_id=NULL WHERE id=?").run(value.video.assetId);
    if (variant === "kind") value.video = readyMedia("image");
    const saved = editor.writeSelfWritten(value);
    const count = db.prepare("SELECT COUNT(*) n FROM news_stories").get().n;
    assert.throws(() => editor.publish(saved.id));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM news_stories").get().n, count);
    assert.equal(db.prepare("SELECT status FROM news_drafts WHERE id=?").get(saved.id).status, "draft");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM post_media WHERE asset_id=?").get(value.photo.assetId).n, 0);
  }
});
test("video credit cannot substitute for article evidence or impersonate asset ownership", () => {
  const value = input();
  assert.throws(() => normalizeSelfWrittenStory({ ...value, sources: [{ ...value.sources[0], kind: "video" }] }), /article sources/u);
  assert.throws(() => normalizeSelfWrittenStory({ ...value, video: { assetId: value.video.assetId } }), /video source/u);
  const normalized = normalizeSelfWrittenStory({ ...value, video: { ...value.video, assetOwnerId: "fixture_other" } }, { assetOwnerId: "fixture_editor" });
  assert.equal(normalized.video.assetOwnerId, "fixture_editor");
  assert.throws(() => editor.writeSelfWritten({ ...value, video: [value.video] }), /verified video/u);
});
