import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-media-reactions-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id, role = "fan") {
  q.insertUser.run(id, `${id}@example.com`, id, id.replace(/[^a-z0-9_]/g, "").slice(0, 20), "test-hash", role, "Toronto", 43.65, -79.38, id.slice(0, 2).toUpperCase(), "#123456", Date.now());
  return q.userById.get(id);
}

const PHOTO = "https://pub-example.r2.dev/users/u_1/post/abc.jpg";

let mediaSequence = 0;
function attachReadyImage(owner, postId) {
  const token = `reaction${++mediaSequence}`.padEnd(12, "x");
  const assetId = `ma_${token}`;
  const variantId = `mv_${token}`;
  const sourceKey = `users/${owner.id}/post/${token}.jpg`;
  const renderKey = `users/${owner.id}/post/${token}.webp`;
  const sourceUrl = `pit-private:${sourceKey}`;
  const url = `https://pit-media.example/${renderKey}`;
  const at = Date.now();
  db.prepare("INSERT INTO media_objects (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at) VALUES (?,?,'private','post',2048,'associated',?,?)")
    .run(sourceKey, owner.id, at, at);
  db.prepare("INSERT INTO media_objects (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at) VALUES (?,?,'public','post',1024,'associated',?,?)")
    .run(renderKey, owner.id, at, at);
  db.prepare(`INSERT INTO media_assets
    (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,original_name,mime_type,
      byte_size,width,height,metadata_status,codec_status,status,source_verified_at,render_state,render_variant_id,created_at,updated_at)
    VALUES (?,?,?,?, 'post','image',?,?,'private','photo.jpg','image/jpeg',2048,100,100,'declared','not_applicable','ready',?,'ready',?,?,?)`)
    .run(assetId, owner.id, `client-${token}`, "a".repeat(64), sourceKey, sourceUrl, at, variantId, at, at);
  db.prepare(`INSERT INTO media_variants
    (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,status,
      finalize_hash,verified_at,verification_origin,created_at,updated_at)
    VALUES (?,?,?,?,'render',?,?,'image/webp',1024,100,100,'verified',?,?,'private_derivative_v1',?,?)`)
    .run(variantId, assetId, `variant-${token}`, "b".repeat(64), renderKey, url, "c".repeat(64), at, at, at);
  db.prepare("UPDATE posts SET photos=? WHERE id=?").run(JSON.stringify([url]), postId);
  db.prepare("INSERT INTO post_media (post_id,asset_id,position,created_at) VALUES (?,?,0,?)").run(postId, assetId, at);
  return url;
}

test("photo likes toggle per URL, count per photo, and read back in batch", () => {
  const alice = addUser("mediaalice");
  const bob = addUser("mediabob");
  const react = routes["POST /api/media/react"];
  const read = routes["POST /api/media/reactions"];
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,photos,photos_public,created_at) VALUES (?,?,?,?,?,?,1,?)")
    .run("p_media_reaction", alice.id, "Artist", "Venue", 4, "[]", Date.now());
  const photo = attachReadyImage(alice, "p_media_reaction");

  // Two people like the same photo; a hash fragment normalizes away so it
  // cannot split one photo's likes across two keys.
  assert.deepEqual(react({ user: alice, ip: "mr1", body: { url: photo, postId: "p_media_reaction" } }), { liked: true, count: 1 });
  assert.deepEqual(react({ user: bob, ip: "mr2", body: { url: photo + "#frag", postId: "p_media_reaction" } }), { liked: true, count: 2 });

  // Toggling off removes only the caller's like.
  assert.deepEqual(react({ user: alice, ip: "mr1", body: { url: photo, postId: "p_media_reaction" } }), { liked: false, count: 1 });

  // Batch read: counts are public, `mine` reflects the signed-in viewer.
  const asBob = read({ user: bob, ip: "mr2", body: { items: [
    { url: photo, postId: "p_media_reaction" },
    { url: "https://other.example/x.jpg", postId: "p_media_reaction" },
  ] } });
  assert.deepEqual(asBob.reactions[photo], { count: 1, mine: true });
  assert.equal(asBob.reactions["https://other.example/x.jpg"], undefined);
  const anon = read({ user: null, ip: "anon", body: { items: [{ url: photo, postId: "p_media_reaction" }] } });
  assert.deepEqual(anon.reactions[photo], { count: 1, mine: false });
  assert.deepEqual(read({ user: null, ip: "legacy-anon", body: { urls: [photo] } }).reactions, {});
});

test("photo likes require a visible, live attachment and honor blocks", () => {
  const owner = addUser("mediaowner");
  const viewer = addUser("mediaviewer");
  const react = routes["POST /api/media/react"];
  const read = routes["POST /api/media/reactions"];
  const postId = "p_media_visible";
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,photos,photos_public,created_at) VALUES (?,?,?,?,?,?,1,?)")
    .run(postId, owner.id, "Artist", "Venue", 4, "[]", Date.now());
  const photo = attachReadyImage(owner, postId);
  assert.deepEqual(react({ user: owner, ip: "mr-owner", body: { url: photo, postId } }), { liked: true, count: 1 });

  for (const body of [
    { url: photo },
    { url: "https://attacker.example/not-attached.jpg", postId },
    { url: PHOTO, postId: "missing-post" },
  ]) {
    assert.throws(
      () => react({ user: viewer, ip: `mr-context-${body.postId || "none"}`, body }),
      (error) => error instanceof ApiError && [400, 404].includes(error.status),
    );
  }

  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)")
    .run(owner.id, viewer.id, Date.now());
  assert.deepEqual(
    read({ user: viewer, ip: "mr-blocked-read", body: { items: [{ url: photo, postId }] } }).reactions,
    {},
  );
  assert.throws(
    () => react({ user: viewer, ip: "mr-blocked", body: { url: photo, postId } }),
    (error) => error instanceof ApiError && error.status === 404,
  );
  db.prepare("DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?").run(owner.id, viewer.id);
  db.prepare("UPDATE posts SET photos_public=0 WHERE id=?").run(postId);
  assert.deepEqual(
    read({ user: null, ip: "mr-private-read", body: { items: [{ url: photo, postId }] } }).reactions,
    {},
  );
  assert.throws(
    () => react({ user: viewer, ip: "mr-private", body: { url: photo, postId } }),
    (error) => error instanceof ApiError && error.status === 404,
  );
  db.prepare("UPDATE posts SET photos_public=1 WHERE id=?").run(postId);
  db.prepare("UPDATE posts SET removed=1 WHERE id=?").run(postId);
  assert.deepEqual(
    read({ user: null, ip: "mr-removed-read", body: { items: [{ url: photo, postId }] } }).reactions,
    {},
  );
  assert.throws(
    () => react({ user: viewer, ip: "mr-removed", body: { url: photo, postId } }),
    (error) => error instanceof ApiError && error.status === 404,
  );
  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_reactions WHERE user_id=?").get(viewer.id).count, 0);
});

test("only real https URLs can carry a like", () => {
  const user = addUser("mediastrict");
  const react = routes["POST /api/media/react"];
  for (const bad of ["http://insecure.example/a.jpg", "javascript:alert(1)", "not a url", "https://user:pw@host/x.jpg", ""]) {
    assert.throws(
      () => react({ user, ip: "mr-bad", body: { url: bad } }),
      (error) => error instanceof ApiError && error.status === 400,
      `should reject: ${bad}`
    );
  }
});
