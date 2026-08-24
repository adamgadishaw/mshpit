import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-artist-campaign-posts-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id, role = "fan", artistName = null) {
  q.insertUser.run(
    id,
    `${id}@example.com`,
    id,
    id.replace(/[^a-z0-9_]/g, "").slice(0, 20),
    "test-hash",
    role,
    "Toronto",
    43.65,
    -79.38,
    id.slice(0, 2).toUpperCase(),
    "#123456",
    Date.now(),
  );
  if (artistName) db.prepare("UPDATE users SET artist_name=? WHERE id=?").run(artistName, id);
  return q.userById.get(id);
}

function addReadyImage(ownerId, id = "ma_campaignasset123456") {
  const at = Date.now();
  const sourceKey = `users/${ownerId}/post/${id}-source.jpg`;
  const renderKey = `users/${ownerId}/post/${id}-safe.jpg`;
  const variantId = `mv_${id.slice(3)}_render`;
  const url = `https://media.example/${ownerId}/${id}-safe.jpg`;
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'issued',?,?)`).run(sourceKey, ownerId, "private", "post", 4096, at, at);
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'issued',?,?)`).run(renderKey, ownerId, "public", "post", 2048, at, at);
  db.prepare(`INSERT INTO media_assets
    (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,
      original_name,mime_type,byte_size,width,height,orientation,metadata_status,codec_status,status,
      edit_recipe,recipe_version,finalize_hash,source_verified_at,render_state,render_variant_id,created_at,updated_at)
    VALUES (?,?,?,?,?,'image',?,?,?,'campaign.jpg','image/jpeg',4096,1200,1500,0,'declared','not_applicable','ready','{}',1,?,?,'ready',?,?,?)`)
    .run(id, ownerId, `client_${id}`, "a".repeat(64), "post", sourceKey, `pit-private:${sourceKey}`, "private",
      "b".repeat(64), at, variantId, at, at);
  db.prepare(`INSERT INTO media_variants
    (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,
      status,finalize_hash,verified_at,verification_origin,created_at,updated_at)
    VALUES (?,?,?,?,'render',?,?,'image/jpeg',2048,1200,1500,'verified',?,?,'private_derivative_v1',?,?)`)
    .run(variantId, id, `client_${variantId}`, "c".repeat(64), renderKey, url, "d".repeat(64), at, at, at);
  return { id, url, renderKey };
}

const campaign = (treatment = "spotlight", backgroundAssetId = null) => ({
  version: 1,
  treatment,
  ...(backgroundAssetId ? { backgroundAssetId } : {}),
});

test("only a named approved artist can publish campaign styling", () => {
  const create = routes["POST /api/posts"];
  const fan = addUser("campaignfan");
  const unnamedArtist = addUser("campaignunnamed", "artist");
  const admin = addUser("campaignadmin", "admin", "Admin Act");

  for (const [user, ip] of [[fan, "campaign-fan"], [unnamedArtist, "campaign-unnamed"], [admin, "campaign-admin"]]) {
    assert.throws(
      () => create({ user, ip, body: { kind: "status", review: "New music", campaign: campaign() } }),
      (error) => error instanceof ApiError && error.status === 403 && error.code === "FORBIDDEN",
    );
  }
});

test("artist campaign posts share the ordinary post substrate and server-owned identity", () => {
  const artist = addUser("campaignartist", "artist", "Turnstile");
  const result = routes["POST /api/posts"]({
    user: artist,
    ip: "campaign-create",
    body: {
      clientMutationId: "campaign_create_retry_001",
      kind: "status",
      review: "Toronto. Midnight. Be there.",
      campaign: campaign("after-dark"),
    },
  });

  assert.equal(result.post.kind, "status");
  assert.deepEqual(result.post.campaign, { version: 1, treatment: "after-dark", artistKey: "turnstile" });
  assert.equal(db.prepare("SELECT campaign FROM posts WHERE id=?").get(result.id).campaign.includes("turnstile"), true);
  assert.ok(db.prepare("SELECT id FROM posts WHERE id=?").get(result.id));
  assert.equal(db.prepare("SELECT id FROM artist_posts WHERE id=?").get(result.id), undefined, "campaign engagement never forks into artist_posts");

  const retry = routes["POST /api/posts"]({
    user: artist,
    ip: "campaign-create-retry",
    body: {
      clientMutationId: "campaign_create_retry_001",
      kind: "status",
      review: "Toronto. Midnight. Be there.",
      campaign: campaign("after-dark"),
    },
  });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.id, result.id);
});

test("a committed campaign create remains idempotent after approved identity changes", () => {
  const artist = addUser("campaignretryidentity", "artist", "Original Act");
  const body = {
    clientMutationId: "campaign_identity_retry_001",
    kind: "status",
    review: "One committed transmission",
    campaign: campaign("after-dark"),
  };
  const create = routes["POST /api/posts"];
  const created = create({ user: artist, ip: "campaign-identity-create", body });

  db.prepare("UPDATE users SET artist_name=? WHERE id=?").run("Renamed Act", artist.id);
  const renamedRetry = create({ user: q.userById.get(artist.id), ip: "campaign-identity-renamed", body });
  assert.equal(renamedRetry.duplicate, true);
  assert.equal(renamedRetry.id, created.id);
  assert.equal(renamedRetry.post.campaign, null, "an old identity no longer projects an official treatment");

  db.prepare("UPDATE users SET role='fan',artist_name=NULL WHERE id=?").run(artist.id);
  const demotedRetry = create({ user: q.userById.get(artist.id), ip: "campaign-identity-demoted", body });
  assert.equal(demotedRetry.duplicate, true);
  assert.equal(demotedRetry.id, created.id);
  assert.equal(demotedRetry.post.campaign, null, "revoking the artist role immediately revokes official presentation");
});

test("campaign treatments and background references fail closed", () => {
  const artist = addUser("campaigninvalid", "artist", "Slowdive");
  const create = routes["POST /api/posts"];
  for (const value of [
    { version: 2, treatment: "spotlight" },
    { version: 1, treatment: "custom-css" },
    { version: 1, treatment: "spotlight", backgroundAssetId: "https://evil.example/art.gif" },
    campaign("spotlight", "ma_missingasset123456"),
  ]) {
    assert.throws(
      () => create({ user: artist, ip: `campaign-invalid-${Math.random()}`, body: { kind: "status", review: "Still here", campaign: value } }),
      (error) => error instanceof ApiError && error.status === 400,
    );
  }
});

test("an attached ready image can become the background and stays normal moderated post media", () => {
  const artist = addUser("campaignmedia", "artist", "Model Actriz");
  const image = addReadyImage(artist.id);
  const created = routes["POST /api/posts"]({
    user: artist,
    ip: "campaign-media-create",
    body: {
      kind: "status",
      review: "The new visual is live.",
      mediaAssetIds: [image.id],
      campaign: campaign("tour-poster", image.id),
    },
  });

  assert.equal(created.post.campaign.backgroundAssetId, image.id);
  assert.equal(created.post.media[0].id, image.id);
  assert.equal(created.post.media[0].kind, "image");
  assert.deepEqual(created.post.photos, [image.url]);
  assert.equal(db.prepare("SELECT asset_id FROM post_media WHERE post_id=?").get(created.id).asset_id, image.id);
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(image.renderKey).status, "associated");
});

test("campaign edits preserve concurrency and revoked styling fails closed", () => {
  const artist = addUser("campaignedit", "artist", "Japanese Breakfast");
  const created = routes["POST /api/posts"]({
    user: artist,
    ip: "campaign-edit-create",
    body: { kind: "status", review: "First transmission", campaign: campaign() },
  });
  const edit = routes["PATCH /api/posts/:id"];
  const updated = edit({
    user: artist,
    ip: "campaign-edit-style",
    params: { id: created.id },
    body: { campaign: campaign("tour-poster"), version: created.post.version },
  });
  assert.equal(updated.post.campaign.treatment, "tour-poster");

  db.prepare("UPDATE users SET role='fan',artist_name=NULL WHERE id=?").run(artist.id);
  const demoted = q.userById.get(artist.id);
  assert.throws(
    () => edit({ user: demoted, ip: "campaign-edit-demoted-retain", params: { id: created.id }, body: { review: "Copy edit after role change", campaign: updated.post.campaign, version: updated.post.version } }),
    (error) => error instanceof ApiError && error.status === 403,
  );
  const ordinaryEdit = edit({
    user: demoted,
    ip: "campaign-edit-demoted-copy",
    params: { id: created.id },
    body: { review: "Copy edit after role change", version: updated.post.version },
  });
  assert.equal(ordinaryEdit.post.review, "Copy edit after role change");
  assert.equal(ordinaryEdit.post.campaign, null);
  assert.equal(db.prepare("SELECT campaign FROM posts WHERE id=?").get(created.id).campaign, null);
});

test("artist drops have a smaller daily allowance than ordinary posts", () => {
  const artist = addUser("campaignratelimit", "artist", "PUP");
  const create = routes["POST /api/posts"];
  for (let index = 0; index < 2; index += 1) {
    create({ user: artist, ip: `campaign-rate-${index}`, body: { kind: "status", review: `Drop ${index}`, campaign: campaign() } });
  }
  assert.throws(
    () => create({ user: artist, ip: "campaign-rate-third", body: { kind: "status", review: "Drop 3", campaign: campaign() } }),
    (error) => error instanceof ApiError && error.status === 429 && error.code === "RATE_LIMITED",
  );
});

test("converting ordinary statuses cannot bypass the artist drop allowance", () => {
  const artist = addUser("campaignpatchlimit", "artist", "Alvvays");
  const create = routes["POST /api/posts"];
  const edit = routes["PATCH /api/posts/:id"];
  const ordinary = Array.from({ length: 3 }, (_, index) => create({
    user: artist,
    ip: `campaign-patch-create-${index}`,
    body: { kind: "status", review: `Ordinary ${index}` },
  }));

  for (const post of ordinary.slice(0, 2)) {
    const styled = edit({
      user: artist,
      ip: `campaign-patch-style-${post.id}`,
      params: { id: post.id },
      body: { campaign: campaign(), version: post.post.version },
    });
    assert.equal(styled.post.campaign.treatment, "spotlight");
  }
  assert.throws(
    () => edit({
      user: artist,
      ip: "campaign-patch-style-third",
      params: { id: ordinary[2].id },
      body: { campaign: campaign(), version: ordinary[2].post.version },
    }),
    (error) => error instanceof ApiError && error.status === 429 && error.code === "RATE_LIMITED",
  );
  assert.equal(db.prepare("SELECT campaign FROM posts WHERE id=?").get(ordinary[2].id).campaign, null);
});

test("author deletion scrubs artist campaign identity and background metadata", () => {
  const artist = addUser("campaigndelete", "artist", "Wednesday");
  const created = routes["POST /api/posts"]({
    user: artist,
    ip: "campaign-delete-create",
    body: { kind: "status", review: "Delete this transmission", campaign: campaign("tour-poster") },
  });
  routes["DELETE /api/posts/:id"]({ user: artist, ip: "campaign-delete", params: { id: created.id } });
  const tombstone = db.prepare("SELECT removed,campaign FROM posts WHERE id=?").get(created.id);
  assert.deepEqual({ ...tombstone }, { removed: 1, campaign: null });
});
