import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-media-legacy-quarantine-"));
process.env.PIT_DATA_DIR = dataDir;
process.env.NODE_ENV = "test";

const { db, q } = await import("./db.js");
const { hashPassword } = await import("./auth.js");
const { mediaSelection } = await import("./mediaAssets.js");
const { quarantineUnsafeLegacyImages, safeOwnedReadyMediaUrl } = await import("./publicMedia.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id) {
  q.insertUser.run(id, `${id}@example.com`, id, id, hashPassword("quarantine-password"),
    "fan", "Toronto", 43.65, -79.38, "IP", "#123456", Date.now());
  return q.userById.get(id);
}

function addLegacyRawImage(owner, id) {
  const at = Date.now();
  const key = `users/${owner.id}/post/${id}.jpg`;
  const url = `https://media.example/${owner.id}/${id}.jpg`;
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at)
    VALUES (?,?,'public','post',4096,'issued',?,?)`).run(key, owner.id, at, at);
  db.prepare(`INSERT INTO media_assets
    (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,
      original_name,mime_type,byte_size,width,height,metadata_status,codec_status,status,edit_recipe,
      finalize_hash,source_verified_at,render_state,created_at,updated_at)
    VALUES (?,?,?,?, 'post','image',?,?,'public','camera.jpg','image/jpeg',4096,1200,900,
      'declared','not_applicable','ready','{}',?,?,'not_required',?,?)`)
    .run(id, owner.id, `client-${id}`, "a".repeat(64), key, url, "b".repeat(64), at, at, at);
  return { id, url };
}

function addSanitizedImage(owner, id) {
  const at = Date.now();
  const sourceKey = `users/${owner.id}/post/${id}-source.jpg`;
  const renderKey = `users/${owner.id}/post/${id}-safe.webp`;
  const variantId = `mv_${id.slice(3)}_safe`;
  const url = `https://media.example/${owner.id}/${id}-safe.webp`;
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at)
    VALUES (?,?,'private','post',4096,'issued',?,?)`).run(sourceKey, owner.id, at, at);
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at)
    VALUES (?,?,'public','post',2048,'issued',?,?)`).run(renderKey, owner.id, at, at);
  db.prepare(`INSERT INTO media_assets
    (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,
      original_name,mime_type,byte_size,width,height,metadata_status,codec_status,status,edit_recipe,
      finalize_hash,source_verified_at,render_state,render_variant_id,created_at,updated_at)
    VALUES (?,?,?,?, 'post','image',?,?,'private','camera.jpg','image/jpeg',4096,1200,900,
      'declared','not_applicable','ready','{}',?,?,'ready',?,?,?)`)
    .run(id, owner.id, `client-${id}`, "c".repeat(64), sourceKey, `pit-private:${sourceKey}`,
      "d".repeat(64), at, variantId, at, at);
  db.prepare(`INSERT INTO media_variants
    (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,
      status,finalize_hash,verified_at,verification_origin,created_at,updated_at)
    VALUES (?,?,?,?,'render',?,?,'image/webp',2048,1200,900,'verified',?,?,'private_derivative_v1',?,?)`)
    .run(variantId, id, `client-${variantId}`, "e".repeat(64), renderKey, url, "f".repeat(64), at, at, at);
  return { id, url, variantId };
}

test("legacy raw image rows fail closed while server-authored derivatives remain publishable", () => {
  const owner = addUser("legacy_quarantine_owner");
  const legacy = addLegacyRawImage(owner, "ma_legacyrawquarantine01");
  const sanitized = addSanitizedImage(owner, "ma_sanitizedquarantine01");
  const clientOrigin = addSanitizedImage(owner, "ma_clientoriginquarantine1");
  db.prepare("UPDATE media_variants SET verification_origin='client' WHERE id=?").run(clientOrigin.variantId);

  assert.equal(safeOwnedReadyMediaUrl(db, { ownerId: owner.id, url: legacy.url, kind: "image" }), null);
  assert.throws(
    () => mediaSelection(db, { ownerId: owner.id, assetIds: [legacy.id] }),
    (error) => error.status === 409 && error.code === "CONFLICT",
  );
  assert.equal(safeOwnedReadyMediaUrl(db, { ownerId: owner.id, url: sanitized.url, kind: "image" }), sanitized.url);
  assert.deepEqual(mediaSelection(db, { ownerId: owner.id, assetIds: [sanitized.id] }).photos, [sanitized.url]);
  assert.equal(safeOwnedReadyMediaUrl(db, { ownerId: owner.id, url: clientOrigin.url, kind: "image" }), null,
    "a verified client-origin row is not proof of server-authored pixels");
  assert.throws(
    () => mediaSelection(db, { ownerId: owner.id, assetIds: [clientOrigin.id] }),
    (error) => error.status === 409 && error.code === "CONFLICT",
  );

  assert.equal(quarantineUnsafeLegacyImages(db), 2);
  const legacyState = db.prepare("SELECT status,render_state FROM media_assets WHERE id=?").get(legacy.id);
  assert.equal(legacyState.status, "render_unavailable");
  assert.equal(legacyState.render_state, "unavailable");
  const sanitizedState = db.prepare("SELECT status,render_state FROM media_assets WHERE id=?").get(sanitized.id);
  assert.equal(sanitizedState.status, "ready");
  assert.equal(sanitizedState.render_state, "ready");
  const clientOriginState = db.prepare("SELECT status,render_state FROM media_assets WHERE id=?").get(clientOrigin.id);
  assert.equal(clientOriginState.status, "render_unavailable");
  assert.equal(clientOriginState.render_state, "unavailable");
});
