// Local synthetic HTTP fixture only. Not imported by application runtime.
import assert from "node:assert/strict";
import { basename, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";

const directory = resolve(process.env.PIT_DATA_DIR || ".");
assert.equal(process.env.PIT_NEWS_CATEGORY_FIXTURE, "1");
assert.equal(dirname(directory), resolve(tmpdir()));
assert.ok(basename(directory).startsWith("pit-news-category-http-"));
assert.equal(process.env.NODE_ENV, "test");
assert.equal(typeof process.send, "function");
const denied = () => { process.send({ kind: "outbound-blocked" }); throw new Error("Fixture outbound network disabled"); };
globalThis.fetch = async () => denied();
http.request = denied; http.get = denied; https.request = denied; https.get = denied;
net.connect = denied; net.createConnection = denied; tls.connect = denied; net.Socket.prototype.connect = denied;
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function fixtureListen(port) {
  assert.equal(arguments.length, 1);
  assert.equal(port, Number(process.env.PORT));
  this.once("listening", () => process.send({ kind: "listener-bound", address: this.address().address, port: this.address().port }));
  return listen.call(this, { port, host: "127.0.0.1" });
};
syncBuiltinESMExports();

const { db, q } = await import("../../server/db.js");
const { createSession, destroySession, COOKIE } = await import("../../server/auth.js");
const { ensureNewsDeskSchema, createNewsDeskReader } = await import("../../server/features/newsDesk/newsDeskService.js");
const { createPublicDocumentService, renderPublicDocumentMain } = await import("../../server/features/seo/publicDocuments.js");
const at = Date.now();
ensureNewsDeskSchema(db);
const users = {};
for (const [name, role] of [["editor", "editor"], ["admin", "admin"], ["fan", "fan"], ["unverified", "editor"], ["revoked", "editor"], ["publisher", "moderator"]]) {
  const id = `category_${name}`;
  q.insertUser.run(id, `${id}@example.test`, id, id, "synthetic-unused-hash", role, "Toronto", null, null, "NC", "#123456", at);
  db.prepare("UPDATE users SET email_verified_at=?,age_band='18_plus',onboarding_version=1 WHERE id=?").run(name === "unverified" ? 0 : at, id);
  const session = createSession(id);
  users[name] = { id, cookie: `${COOKIE}=${session.token}` };
  if (name === "revoked") destroySession(session.token);
}
const sourceKey = "users/category_editor/post/category-source.jpg";
const renderKey = "users/category_editor/post/category-safe.jpg";
const photoUrl = `https://media.example.test/${renderKey}`;
for (const [key, scope] of [[sourceKey, "private"], [renderKey, "public"]]) {
  db.prepare(`INSERT INTO media_objects(object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at)
    VALUES (?,'category_editor',?,'post',4096,'issued',?,?)`).run(key, scope, at, at);
}
db.prepare(`INSERT INTO media_assets
  (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,
    original_name,mime_type,byte_size,width,height,orientation,metadata_status,codec_status,status,
    edit_recipe,recipe_version,finalize_hash,source_verified_at,render_state,render_variant_id,created_at,updated_at)
  VALUES ('ma_category_photo','category_editor','category-photo',?,'post','image',?,?,'private',
    'category.jpg','image/jpeg',4096,1200,1500,0,'declared','not_applicable','ready','{}',1,?,?,'ready','mv_category_photo',?,?)`)
  .run("a".repeat(64), sourceKey, `pit-private:${sourceKey}`, "b".repeat(64), at, at, at);
db.prepare(`INSERT INTO media_variants
  (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,
    status,finalize_hash,verified_at,verification_origin,created_at,updated_at)
  VALUES ('mv_category_photo','ma_category_photo','category-render',?,'render',?,?,'image/jpeg',2048,1200,1500,
    'verified',?,?,'private_derivative_v1',?,?)`).run("c".repeat(64), renderKey, photoUrl, "d".repeat(64), at, at, at);

// IPC belongs solely to the fixture parent; no testing controls enter HTTP.
process.on("message", ({ id, operation, postId, value } = {}) => {
  try {
    let result = null;
    if (operation === "snapshot") {
      const story = db.prepare("SELECT * FROM news_stories WHERE post_id=?").get(postId);
      const reader = createNewsDeskReader(db);
      const publicStory = reader.forLivePost(postId);
      const pages = createPublicDocumentService({ database: db, origin: "https://example.test" });
      const document = pages.postDocument({ id: postId, canonicalPath: `/post/${postId}` });
      result = { story, post: db.prepare("SELECT * FROM posts WHERE id=?").get(postId), publicStory,
        media: db.prepare("SELECT * FROM post_media WHERE post_id=?").all(postId),
        comments: db.prepare("SELECT * FROM comments WHERE post_id=?").all(postId),
        likes: db.prepare("SELECT * FROM likes WHERE post_id=?").all(postId),
        audit: db.prepare("SELECT * FROM moderation_actions WHERE action='news_story_category_corrected' AND target_id=? ORDER BY created_at").all(postId),
        html: document ? renderPublicDocumentMain(document) : null, article: document?.jsonLd.find(node => node["@type"] === "NewsArticle"),
        paidReceipts: db.prepare("SELECT COUNT(*) n FROM news_desk_receipts").get().n };
    } else if (operation === "seed-legacy-category") {
      db.prepare("UPDATE news_stories SET category='charts' WHERE post_id=?").run(postId);
      db.prepare("INSERT INTO likes(user_id,post_id) VALUES ('category_fan',?)").run(postId);
      db.prepare("INSERT INTO comments(id,post_id,user_id,text,created_at) VALUES ('category-comment',?,'category_fan','Synthetic comment',?)").run(postId, at);
    } else if (operation === "refuse-audit") {
      db.exec("CREATE TEMP TRIGGER reject_category_audit BEFORE INSERT ON moderation_actions WHEN NEW.action='news_story_category_corrected' BEGIN SELECT RAISE(ABORT,'synthetic category audit failure'); END");
    } else if (operation === "clear-audit-trigger") {
      db.exec("DROP TRIGGER IF EXISTS reject_category_audit; DROP TRIGGER IF EXISTS revoke_category_session");
    } else if (operation === "revoke-during-audit") {
      db.exec("CREATE TEMP TRIGGER revoke_category_session AFTER INSERT ON moderation_actions WHEN NEW.action='news_story_category_corrected' BEGIN DELETE FROM sessions WHERE user_id='category_editor'; END");
    } else if (operation === "restrict-editor") {
      assert.ok(["fan", "editor"].includes(value));
      db.prepare("UPDATE users SET role=? WHERE id='category_editor'").run(value);
    } else if (operation === "set-origin") {
      assert.ok(["generated", "self_written"].includes(value));
      const stored = JSON.parse(db.prepare("SELECT signals FROM news_stories WHERE post_id=?").get(postId).signals);
      db.prepare("UPDATE news_stories SET signals=? WHERE post_id=?").run(JSON.stringify({ ...stored, origin: value }), postId);
    } else if (operation === "remove-post") {
      db.prepare("UPDATE posts SET removed=? WHERE id=?").run(value ? 1 : 0, postId);
    } else if (operation === "set-post-kind") {
      assert.ok(["review", "status"].includes(value));
      db.prepare("UPDATE posts SET kind=? WHERE id=?").run(value, postId);
    } else if (operation === "restrict-publisher") {
      db.prepare("UPDATE users SET is_banned=? WHERE id='category_publisher'").run(value ? 1 : 0);
    } else throw new Error("Unknown fixture operation");
    process.send({ kind: "reply", id, result });
  } catch (error) { process.send({ kind: "reply", id, error: error.message }); }
});
process.send({ kind: "fixture", users });
