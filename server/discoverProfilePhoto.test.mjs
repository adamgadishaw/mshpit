import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
const dataDir = mkdtempSync(join(tmpdir(), "pit-discover-profile-avatar-"));
process.env.PIT_DATA_DIR = dataDir;
// Optional source root proves the old projection fails without touching it.
const sourceRoot = process.env.PIT_DISCOVER_SOURCE_ROOT
  ? pathToFileURL(resolve(process.env.PIT_DISCOVER_SOURCE_ROOT) + sep) : new URL("../", import.meta.url);
const { db, q, artistStmts, artistRow } = await import(new URL("server/db.js", sourceRoot));
const { routes } = await import(new URL("server/api.js", sourceRoot));
const { createDiscoverService, discoverArtistPhotoFields } = await import(new URL("server/discoverService.js", sourceRoot));
const { createArtistRecommendationService } = await import(new URL("server/features/artistRecommendations/artistRecommendationService.js", sourceRoot));
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });
let sequence = 0;
function addUser(prefix, { role = "fan", artistName = null, name = null, createdAt = Date.now() } = {}) {
  sequence += 1;
  const id = `${prefix}_${sequence}`;
  const handle = `${prefix}${sequence}`.replace(/[^a-z0-9_]/gi, "").toLowerCase().slice(0, 24);
  q.insertUser.run(id, `${id}@example.com`, name || id, handle, "test-hash", role, "Toronto", 43.65, -79.38, id.slice(0, 2).toUpperCase(), "#123456", createdAt);
  if (artistName) db.prepare("UPDATE users SET artist_name=? WHERE id=?").run(artistName, id);
  return q.userById.get(id);
}

function readyImage(owner, suffix) {
  const token = `${suffix}${++sequence}`.replace(/[^A-Za-z0-9_-]/g, "").padEnd(12, "x");
  const id = `ma_${token}`;
  const sourceKey = `users/${owner.id}/post/${token}.jpg`;
  const sourceUrl = `pit-private:${sourceKey}`;
  const variantId = `mv_${token}`;
  const renderKey = `users/${owner.id}/post/${token}-render.webp`;
  const url = `https://pit-media.example/${renderKey}`;
  const at = Date.now();
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at)
    VALUES (?,?, 'private','post',2048,'issued',?,?)`).run(sourceKey, owner.id, at, at);
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at)
    VALUES (?,?, 'public','post',1024,'issued',?,?)`).run(renderKey, owner.id, at, at);
  db.prepare(`INSERT INTO media_assets
    (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,
      original_name,mime_type,byte_size,width,height,metadata_status,codec_status,status,source_verified_at,
      render_state,render_variant_id,created_at,updated_at)
    VALUES (?,?,?,?, 'post','image',?,?, 'private', 'photo.jpg','image/jpeg',2048,100,100,
      'declared','not_applicable','ready',?,'ready',?,?,?)`)
    .run(id, owner.id, `client-${token}`, "a".repeat(64), sourceKey, sourceUrl, at, variantId, at, at);
  db.prepare(`INSERT INTO media_variants
    (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,
      status,finalize_hash,verified_at,verification_origin,created_at,updated_at)
    VALUES (?,?,?,?,'render',?,?,'image/webp',1024,100,100,'verified',?,?, 'client',?,?)`)
    .run(variantId, id, `variant-${token}`, "b".repeat(64), renderKey, url, "c".repeat(64), at, at, at);
  return { id, url, key: renderKey };
}

function finalizedLegacyImage(owner, suffix, purpose) {
  const image = readyImage(owner, suffix);
  const token = `${suffix}legacy${++sequence}`.replace(/[^A-Za-z0-9_-]/g, "").padEnd(12, "x");
  const at = Date.now();
  db.prepare(`INSERT INTO legacy_media_finalize_descriptors
    (id,owner_id,token_hash,purpose,staging_object_key,staging_mime_type,staging_byte_size,
      output_mime_type,output_object_key,output_url,output_byte_size,width,height,status,expires_at,
      consumed_at,finalized_at,created_at,updated_at)
    VALUES (?,?,?,?,?,'image/jpeg',2048,'image/webp',?,?,1024,100,100,'finalized',?,?,?,?,?)`)
    .run(`lm_${token}`, owner.id, "d".repeat(64), purpose,
      `users/${owner.id}/${purpose}/${token}-staging.jpg`, image.key, image.url,
      at + 60_000, null, at, at, at);
  return image;
}


function fixture() {
  const admin = addUser("curator", { role: "admin" }), viewer = addUser("reader"), owner = addUser("artist", { role: "artist" });
  const key = `curated fixture ${++sequence}`, name = key;
  artistStmts.upsert.run(artistRow(key, { name, popularity: 99, spotifyId: "1234567890ABCDEFGHIJKL",
    genreClaims: [{ value: "Indie", source: "staff", at: 1 }] }, "test"));
  const image = finalizedLegacyImage(admin, "curated", "avatar");
  db.prepare("INSERT INTO artist_profiles(artist_key,avatar_uri,avatar_owner_id,updated_at) VALUES(?,?,?,?)").run(key,image.url,admin.id,Date.now());
  const service = createDiscoverService({ database: db, reviewedArtistNorms: new Set([key]) });
  const artist = () => artistStmts.byNorm.get(key);
  const projected = who => discoverArtistPhotoFields(artist(), { database: db, viewer: who }).photo;
  const chart = who => service.chart({ viewer: who }).rows.find(row => row.key === key);
  const profile = who => routes["GET /api/artists/:key/profile"]({ user: who, params: { key }, ip: "fixture", setHeader() {} }).profile;
  return { key, admin, viewer, owner, image, service, projected, chart, profile };
}

test("Discover and recommendations use the same finalized staff avatar visible on a catalog-only artist profile", () => {
  const f = fixture();
  assert.equal(f.profile(null).avatarUri, f.image.url);
  assert.equal(f.chart(null).photo, f.image.url, "Drake shape: catalog photo and Spotify photo absent, public profile avatar present");
  const response = routes["GET /api/discover/chart"]({ user: null, query: { limit: 60 }, setHeader() {} });
  assert.equal(response.rows.find(row => row.key === f.key).photo, f.image.url, "the actual API projects the same verified profile image");
  db.prepare("UPDATE users SET genres='[\"Indie\"]' WHERE id=?").run(f.viewer.id);
  const recommendations = createArtistRecommendationService(db).list(q.userById.get(f.viewer.id));
  assert.equal(recommendations.recommendations.find(row => row.artist.key === f.key)?.artist.photo, f.image.url);
  // A staff uploader's personal audience/block is not the public catalog audience.
  db.prepare("UPDATE users SET profile_audience='only_me' WHERE id=?").run(f.admin.id);
  db.prepare("INSERT INTO blocks VALUES(?,?,?)").run(f.viewer.id,f.admin.id,Date.now());
  assert.equal(f.chart(f.viewer).photo,f.image.url);
  assert.equal(f.profile(f.viewer).avatarUri,f.image.url);
});

test("Discover rejects raw/wrong-slot/removed assets and never promotes banner or gallery media", () => {
  const f=fixture();
  for (const value of ["https://unverified.example/raw.jpg", finalizedLegacyImage(f.admin,"banner","banner").url, null]) {
    db.prepare("UPDATE artist_profiles SET avatar_uri=?,banner=? WHERE artist_key=?").run(value,f.image.url,f.key);
    assert.equal(f.projected(null),null);
  }
  db.prepare("UPDATE artist_profiles SET avatar_uri=? WHERE artist_key=?").run(f.image.url,f.key);
  db.prepare("UPDATE media_objects SET status='delete_queued' WHERE object_key=?").run(f.image.key);
  assert.equal(f.projected(null),null);
});

test("current claim privacy, reciprocal blocks and identity moderation are applied on every read", () => {
  const f=fixture();
  db.prepare("UPDATE artist_profiles SET owner_id=? WHERE artist_key=?").run(f.owner.id,f.key);
  assert.equal(f.chart(f.viewer).photo,f.image.url);
  for (const audience of ["only_me","members"]) {
    db.prepare("UPDATE users SET profile_audience=? WHERE id=?").run(audience,f.owner.id);
    assert.equal(f.chart(null).photo,null);
    assert.equal(f.projected(f.viewer),audience==='members'?f.image.url:null);
  }
  db.prepare("UPDATE users SET profile_audience='everyone' WHERE id=?").run(f.owner.id);
  for (const [a,b] of [[f.owner.id,f.viewer.id],[f.viewer.id,f.owner.id]]) {
    db.prepare("INSERT INTO blocks VALUES(?,?,?)").run(a,b,Date.now());
    assert.equal(f.chart(f.viewer).photo,null);
    db.prepare("DELETE FROM blocks WHERE blocker_id=? AND blocked_id=?").run(a,b);
  }
  db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(f.owner.id);
  assert.equal(f.projected(f.viewer),null);
  db.prepare("UPDATE users SET is_banned=0 WHERE id=?").run(f.owner.id);
  db.prepare("UPDATE artist_profiles SET removed=1 WHERE artist_key=?").run(f.key);
  assert.equal(f.projected(f.viewer),null);
  db.prepare("UPDATE artist_profiles SET removed=0,identity_review_status='pending' WHERE artist_key=?").run(f.key);
  assert.equal(f.projected(f.viewer),null);
});

test("retained avatars recheck publication, author privacy and blocks without a stale Discover cache", () => {
  const f=fixture(), retention=`retained-${f.key}`;
  db.prepare(`INSERT INTO artist_access_revocations(id,artist_key,owner_id,reviewer_id,reason,created_at,profile_json)
    VALUES(?,?,?,?,?,?,?)`).run(retention,f.key,f.admin.id,f.admin.id,"Fixture retained publication",Date.now(),"{}");
  db.prepare(`INSERT INTO artist_access_profile_items(revocation_id,slot,value,author_id,publication,original_public)
    VALUES(?,'avatar',?,?,'public',1)`).run(retention,f.image.url,f.admin.id);
  db.prepare("UPDATE artist_profiles SET avatar_retention_id=? WHERE artist_key=?").run(retention,f.key);
  assert.equal(f.chart(f.viewer).photo,f.image.url);
  db.prepare("UPDATE artist_access_profile_items SET publication='hidden' WHERE revocation_id=?").run(retention);
  assert.equal(f.chart(f.viewer).photo,null);
  db.prepare("UPDATE artist_access_profile_items SET publication='public' WHERE revocation_id=?").run(retention);
  db.prepare("UPDATE users SET profile_audience='only_me' WHERE id=?").run(f.admin.id);
  assert.equal(f.chart(f.viewer).photo,null);
  db.prepare("UPDATE users SET profile_audience='everyone' WHERE id=?").run(f.admin.id);
  db.prepare("INSERT INTO blocks VALUES(?,?,?)").run(f.admin.id,f.viewer.id,Date.now());
  assert.equal(f.chart(f.viewer).photo,null);
  assert.equal(f.chart(null).photo,f.image.url);
});

test("legacy memorial artwork retains the active staff-curator boundary", () => {
  const f=fixture(), mbid="00000000-0000-4000-8000-000000000085", at=Date.now();
  db.prepare("UPDATE artists SET mbid=? WHERE norm=?").run(mbid,f.key);
  db.prepare(`INSERT INTO artist_memorials(artist_key,artist_name,artist_mbid,status,death_date,summary,thank_you,
    accomplishments,source_url,published_at,spotlight_started_at,created_at,updated_at)
    VALUES(?,?,?,'published','1960-01-01',?,?,?, ?,?,?,?,?)`).run(f.key,f.key,mbid,
      "A documented fixture legacy memorial.","Thank you.",'["Fixture accomplishment"]',"https://example.org/source",at,at,at,at);
  assert.equal(f.projected(null),f.image.url);
  db.prepare("UPDATE users SET role='fan' WHERE id=?").run(f.admin.id);
  assert.equal(f.projected(null),null);
  db.prepare("UPDATE users SET role='admin',is_banned=1 WHERE id=?").run(f.admin.id);
  assert.equal(f.projected(null),null);
});
