import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-legacy-video-migration-"));
process.env.PIT_DATA_DIR = dataDir;
Object.assign(process.env, {
  NODE_ENV: "test",
  PIT_ENV: "local",
  MEDIA_ENDPOINT: "https://objects.example.com/s3",
  MEDIA_BUCKET: "pit-public",
  MEDIA_SOURCE_BUCKET: "pit-private",
  MEDIA_REGION: "auto",
  MEDIA_ACCESS_KEY_ID: "legacy-video-migration-access",
  MEDIA_SECRET_ACCESS_KEY: "legacy-video-migration-secret",
  MEDIA_PUBLIC_BASE_URL: "https://media.example.com/cdn",
});

const { db, q } = await import("./db.js");
const { hashPassword } = await import("./auth.js");
const {
  legacyVideoMigrationIdentity,
  legacyVideoMigrationInternals,
  migrateLegacyVideoRelease,
} = await import("./legacyVideoMigration.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

let clock = 100_000;

function addUser(id) {
  q.insertUser.run(id, `${id}@example.com`, id, id, hashPassword("migration-password"),
    "fan", "Toronto", 43.65, -79.38, "MV", "#123456", clock++);
  return q.userById.get(id);
}

function releaseEntry({ ownerId, postId, position = 1, suffix = "reviewed-legacy" }) {
  const sourceKey = `users/${ownerId}/post/${suffix}.mov`;
  const posterDigest = suffix === "reviewed-legacy"
    ? "a".repeat(64)
    : createHash("sha256").update(`poster:${suffix}`).digest("hex");
  const posterKey = `users/${ownerId}/post/legacy-poster-${posterDigest.slice(0, 16)}.jpg`;
  return {
    postId,
    ownerId,
    position,
    sourceUrl: `https://media.example.com/cdn/${sourceKey}`,
    sourceByteSize: 4_096,
    sourceMimeType: "video/quicktime",
    sourceEtag: '"11111111111111111111111111111111"',
    localFileName: `${suffix}.jpg`,
    posterKey,
    posterUrl: `https://media.example.com/cdn/${posterKey}`,
    byteSize: 2_048,
    width: 720,
    height: 1280,
    timeMs: 2_000,
    contentSha256: posterDigest,
    contentMd5: suffix === "reviewed-legacy"
      ? "b".repeat(32)
      : createHash("md5").update(`poster:${suffix}`).digest("hex"),
  };
}

function attachStableImage({ ownerId, postId }) {
  const suffix = createHash("sha256").update(postId).digest("hex").slice(0, 16);
  const assetId = `ma_existing_${suffix}`;
  const variantId = `mv_existing_${suffix}`;
  const sourceKey = `users/${ownerId}/post/existing-image-source-${suffix}.jpg`;
  const renderKey = `users/${ownerId}/post/existing-image-render-${suffix}.webp`;
  const renderUrl = `https://media.example.com/cdn/${renderKey}`;
  for (const [key, scope, bytes] of [[sourceKey, "private", 2_048], [renderKey, "public", 1_024]]) {
    db.prepare(`INSERT INTO media_objects
      (object_key,owner_id,storage_scope,purpose,byte_size,status,associated_at,created_at,updated_at)
      VALUES (?,?,?,'post',?,'associated',?,?,?)`).run(key, ownerId, scope, bytes, clock, clock, clock++);
  }
  db.prepare(`INSERT INTO media_assets
    (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,
     original_name,mime_type,byte_size,width,height,metadata_status,codec_status,status,source_verified_at,
     render_state,render_variant_id,created_at,updated_at)
    VALUES (?,?,?,?, 'post','image',?,?,'private','existing.jpg','image/jpeg',2048,1200,900,
      'declared','not_applicable','ready',?,'ready',?,?,?)`).run(
    assetId, ownerId, "existing-migration-image", "c".repeat(64), sourceKey, `pit-private:${sourceKey}`,
    clock, variantId, clock, clock++,
  );
  db.prepare(`INSERT INTO media_variants
    (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,
     status,finalize_hash,verified_at,verification_origin,created_at,updated_at)
    VALUES (?,?,?,?,'render',?,?,'image/webp',1024,800,600,'verified',?,?,'private_derivative_v1',?,?)`)
    .run(variantId, assetId, "existing-migration-render", "d".repeat(64), renderKey, renderUrl,
      "e".repeat(64), clock, clock, clock++);
  db.prepare("INSERT INTO post_media (post_id,asset_id,position,created_at) VALUES (?,?,0,?)")
    .run(postId, assetId, clock++);
  return { assetId, renderUrl };
}

function addLegacyMapping(entry) {
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,associated_at,created_at,updated_at)
    VALUES (?,?,'public','post',?,'associated',?,?,?)`)
    .run(entry.posterKey, entry.ownerId, entry.byteSize, clock, clock, clock++);
  db.prepare(`INSERT INTO legacy_video_posters
    (post_id,media_url,position,owner_id,poster_key,poster_url,mime_type,byte_size,width,height,time_ms,
     content_sha256,content_md5,status,attempts,next_attempt_at,last_error_code,verified_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'image/jpeg',?,?,?,?,?,?,'verified',0,0,NULL,?,?,?)`)
    .run(entry.postId, entry.sourceUrl, entry.position, entry.ownerId, entry.posterKey, entry.posterUrl,
      entry.byteSize, entry.width, entry.height, entry.timeMs, entry.contentSha256, entry.contentMd5,
      clock, clock, clock++);
  db.prepare("INSERT INTO media_reactions (media_url,user_id,post_id,created_at) VALUES (?,?,?,?)")
    .run(entry.sourceUrl, entry.ownerId, entry.postId, clock++);
}

function addLegacyPostGroup(entries) {
  const [first] = entries;
  assert.ok(first && entries.every((entry) => entry.postId === first.postId && entry.ownerId === first.ownerId));
  db.prepare(`INSERT INTO posts
    (id,user_id,artist,venue,overall,review,photos,photos_public,kind,created_at)
    VALUES (?,?, 'Migration Artist','Migration Room',5,'Historical clips','[]',1,'review',?)`)
    .run(first.postId, first.ownerId, clock++);
  const image = attachStableImage({ ownerId: first.ownerId, postId: first.postId });
  const photos = [image.renderUrl];
  for (const entry of entries) photos[entry.position] = entry.sourceUrl;
  assert.equal(photos.every((url) => typeof url === "string" && url), true);
  db.prepare("UPDATE posts SET photos=? WHERE id=?")
    .run(JSON.stringify(photos), first.postId);
  for (const entry of entries) addLegacyMapping(entry);
  return image;
}

function addLegacyPost(entry) {
  return addLegacyPostGroup([entry]);
}

function sourceHeadFetch(entry) {
  return async (_url, options = {}) => {
    if (String(options.method || "GET").toUpperCase() !== "HEAD") {
      throw new Error("dry-run must not read or write complete source bytes");
    }
    return {
      status: 200,
      headers: new Headers({
        "content-length": String(entry.sourceByteSize),
        "content-type": entry.sourceMimeType,
        etag: entry.sourceEtag,
      }),
    };
  };
}

const healthyPrivacy = async () => ({ ready: true });
const healthyVerifier = async () => ({
  ready: true,
  sourceTypes: ["video/mp4", "video/quicktime"],
  sourceCodecs: {
    "video/mp4": ["h264", "hevc"],
    "video/quicktime": ["h264", "hevc"],
  },
});
const structural = Object.freeze({
  width: 1920,
  height: 1080,
  codedWidth: 1920,
  codedHeight: 1088,
  durationMs: 10_000,
  sampleCount: 300,
  sourceContainer: "quicktime",
  sourceCodec: "hevc",
});
const structuralProbe = async () => structural;

test("the source copier generation-binds, hashes, and create-only streams the exact reviewed bytes", async () => {
  const bytes = Buffer.from("reviewed historical QuickTime bytes");
  const ownerId = "u_migration_copy_owner";
  const sourceKey = `users/${ownerId}/post/reviewed-copy.mov`;
  const entry = {
    sourceKey,
    sourceByteSize: bytes.length,
    sourceMimeType: "video/quicktime",
    sourceEtag: `"${createHash("md5").update(bytes).digest("hex")}"`,
  };
  let privateBytes = null;
  const upload = {
    uploadUrl: "https://uploads.example.com/private-copy",
    requiredHeaders: { "Content-Type": entry.sourceMimeType, "If-None-Match": "*" },
    key: `users/${ownerId}/post/deterministic-private-copy.mov`,
  };
  const requests = [];
  let capabilityClock = 150_000;
  const fetchImpl = async (url, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    requests.push({ method, url: String(url), headers: new Headers(options.headers || {}) });
    if (method === "GET") {
      capabilityClock += 70_000;
      return new Response(bytes, {
        status: 200,
        headers: {
          "content-length": String(bytes.length),
          "content-type": entry.sourceMimeType,
          etag: entry.sourceEtag,
        },
      });
    }
    if (method === "PUT") {
      const chunks = [];
      for await (const chunk of options.body) chunks.push(Buffer.from(chunk));
      privateBytes = Buffer.concat(chunks);
      capabilityClock += 70_000;
      return { status: 200, headers: new Headers() };
    }
    if (method === "HEAD") {
      return {
        status: 200,
        headers: new Headers({
          "content-length": String(privateBytes?.length || 0),
          "content-type": entry.sourceMimeType,
          etag: entry.sourceEtag,
        }),
      };
    }
    throw new Error(`unexpected method ${method}`);
  };
  const copied = await legacyVideoMigrationInternals.copyExactSourceToPrivate(entry, upload, {
    env: process.env,
    fetchImpl,
    at: 150_000,
    clock: () => capabilityClock,
  });
  assert.deepEqual(copied, {
    byteSize: bytes.length,
    mimeType: entry.sourceMimeType,
    etag: entry.sourceEtag,
  });
  assert.deepEqual(privateBytes, bytes);
  assert.deepEqual(requests.map((request) => request.method), ["GET", "PUT", "HEAD"]);
  assert.equal(requests[0].headers.get("if-match"), entry.sourceEtag);
  assert.equal(requests[1].headers.get("if-none-match"), "*");
  assert.equal(requests[1].headers.get("content-length"), String(bytes.length));
  assert.equal(new URL(requests[2].url).searchParams.get("X-Amz-Date"), "19700101T000450Z",
    "the confirmation HEAD is signed from a fresh post-copy clock, not the expired item start");
});

function fakeDelivery(ownerId, assetId) {
  const renderId = `mv_render_${createHash("sha256").update(assetId).digest("hex").slice(0, 20)}`;
  const renderKey = `users/${ownerId}/post/${assetId}_delivery_${renderId}.mp4`;
  return { renderId, renderKey, renderUrl: `https://media.example.com/cdn/${renderKey}` };
}

function fakeFinalize(entry) {
  return async (database, { ownerId, assetId, at }) => {
    const { renderId, renderKey, renderUrl } = fakeDelivery(ownerId, assetId);
    const posterId = `mv_poster_${createHash("sha256").update(assetId).digest("hex").slice(0, 20)}`;
    const posterKey = `users/${ownerId}/post/${assetId}_poster_${posterId}.jpg`;
    const posterUrl = `https://media.example.com/cdn/${posterKey}`;
    for (const [key, type, bytes] of [[renderKey, "video/mp4", 3_000], [posterKey, "image/jpeg", 1_000]]) {
      void type;
      database.prepare(`INSERT INTO media_objects
        (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at)
        VALUES (?,?,'public','post',?,'issued',?,?)`).run(key, ownerId, bytes, at, at);
    }
    database.prepare(`INSERT INTO media_variants
      (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,
       time_ms,status,finalize_hash,verified_at,verification_origin,created_at,updated_at)
      VALUES (?,?,?,?,'render',?,?,'video/mp4',3000,720,1280,NULL,'verified',?,?,'private_derivative_v1',?,?)`)
      .run(renderId, assetId, `render-${assetId}`, "f".repeat(64), renderKey, renderUrl,
        "1".repeat(64), at, at, at);
    database.prepare(`INSERT INTO media_variants
      (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,
       time_ms,status,finalize_hash,verified_at,verification_origin,created_at,updated_at)
      VALUES (?,?,?,?,'poster',?,?,'image/jpeg',1000,720,1280,?,'verified',?,?,'private_derivative_v1',?,?)`)
      .run(posterId, assetId, `poster-${assetId}`, "2".repeat(64), posterKey, posterUrl, entry.timeMs,
        "3".repeat(64), at, at, at);
    database.prepare(`UPDATE media_assets SET width=1920,height=1080,duration_ms=10000,orientation=0,
      metadata_status='declared',codec_status='verified',codec_verified_at=?,status='ready',
      edit_recipe=?,finalize_hash=?,source_verified_at=?,source_etag=?,render_state='ready',
      render_variant_id=?,poster_variant_id=?,poster_key=?,poster_url=?,poster_time_ms=?,updated_at=?
      WHERE id=? AND owner_id=?`).run(
      at,
      JSON.stringify({ version: 1, kind: "video", durationMs: 10_000, trimStartMs: 0, trimEndMs: 10_000,
        coverMode: "manual", coverMs: entry.timeMs }),
      "4".repeat(64),
      at,
      entry.sourceEtag,
      renderId,
      posterId,
      posterKey,
      posterUrl,
      entry.timeMs,
      at,
      assetId,
      ownerId,
    );
    return { asset: { id: assetId, status: "ready", url: renderUrl } };
  };
}

function fakeFinalizeForEntries(entries, { failAt = 0, onFinalized = null } = {}) {
  const byAssetId = new Map(entries.map((entry) => [
    legacyVideoMigrationIdentity(entry).assetId,
    entry,
  ]));
  let calls = 0;
  return async (...args) => {
    calls += 1;
    const assetId = args[1]?.assetId;
    const entry = byAssetId.get(assetId);
    assert.ok(entry, `unexpected grouped migration asset ${assetId}`);
    if (calls === failAt) throw new Error(`simulated finalizer failure ${calls}`);
    const result = await fakeFinalize(entry)(...args);
    onFinalized?.({ calls, entry });
    return result;
  };
}

test("dry-run validates the exact reviewed tuple without mutating posts or media ledgers", async () => {
  const owner = addUser("u_migration_dry_owner");
  const entry = releaseEntry({ ownerId: owner.id, postId: "p_migration_dry_post" });
  addLegacyPost(entry);
  const before = {
    photos: db.prepare("SELECT photos FROM posts WHERE id=?").get(entry.postId).photos,
    assets: db.prepare("SELECT COUNT(*) count FROM media_assets").get().count,
    queue: db.prepare("SELECT COUNT(*) count FROM media_deletion_queue").get().count,
  };
  const result = await migrateLegacyVideoRelease(db, {
    entries: [entry],
    allowNonProduction: true,
    fetchImpl: sourceHeadFetch(entry),
    structuralProbe,
    privacyProbe: healthyPrivacy,
    verifierHealthCheck: healthyVerifier,
    at: 200_000,
  });
  assert.deepEqual(result, {
    releaseId: "2026-08-22-v1",
    mode: "dry-run",
    checked: 1,
    ready: 1,
    alreadyMigrated: 0,
    items: [{
      postId: entry.postId,
      position: entry.position,
      status: "ready",
      assetId: legacyVideoMigrationIdentity(entry).assetId,
    }],
  });
  assert.deepEqual({
    photos: db.prepare("SELECT photos FROM posts WHERE id=?").get(entry.postId).photos,
    assets: db.prepare("SELECT COUNT(*) count FROM media_assets").get().count,
    queue: db.prepare("SELECT COUNT(*) count FROM media_deletion_queue").get().count,
  }, before);
});

test("migration refuses a rolling worker that has not proven every manifest source type", async () => {
  const owner = addUser("u_migration_worker_owner");
  const entry = releaseEntry({ ownerId: owner.id, postId: "p_migration_worker_post" });
  addLegacyPost(entry);
  const before = db.prepare("SELECT photos FROM posts WHERE id=?").get(entry.postId).photos;
  await assert.rejects(() => migrateLegacyVideoRelease(db, {
    entries: [entry],
    allowNonProduction: true,
    fetchImpl: async () => { throw new Error("incompatible health must stop before storage preflight"); },
    structuralProbe: async () => { throw new Error("incompatible health must stop before structural preflight"); },
    privacyProbe: healthyPrivacy,
    verifierHealthCheck: async () => ({
      ready: true,
      sourceTypes: ["video/mp4"],
      sourceCodecs: { "video/mp4": ["h264", "hevc"] },
    }),
    at: 250_000,
  }), (error) => error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE");
  assert.equal(db.prepare("SELECT photos FROM posts WHERE id=?").get(entry.postId).photos, before);
  assert.equal(db.prepare("SELECT 1 FROM media_assets WHERE id=?")
    .get(legacyVideoMigrationIdentity(entry).assetId), undefined);
});

test("migration refuses a worker that has not proven both accepted source codecs", async () => {
  const owner = addUser("u_migration_codec_owner");
  const entry = releaseEntry({ ownerId: owner.id, postId: "p_migration_codec_post" });
  addLegacyPost(entry);
  await assert.rejects(() => migrateLegacyVideoRelease(db, {
    entries: [entry],
    allowNonProduction: true,
    fetchImpl: async () => { throw new Error("incompatible health must stop before storage preflight"); },
    structuralProbe: async () => { throw new Error("incompatible health must stop before structural preflight"); },
    privacyProbe: healthyPrivacy,
    verifierHealthCheck: async () => ({
      ready: true,
      sourceTypes: ["video/mp4", "video/quicktime"],
      sourceCodecs: {
        "video/mp4": ["h264", "hevc"],
        "video/quicktime": ["h264"],
      },
    }),
    at: 255_000,
  }), (error) => error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE");
  assert.equal(db.prepare("SELECT 1 FROM media_assets WHERE id=?")
    .get(legacyVideoMigrationIdentity(entry).assetId), undefined);
});

test("apply swaps one exact URL atomically, preserves stable order, migrates reactions, and is restart-safe", async () => {
  const owner = addUser("u_migration_apply_owner");
  const entry = releaseEntry({ ownerId: owner.id, postId: "p_migration_apply_post" });
  const existing = addLegacyPost(entry);
  let copies = 0;
  let finalizations = 0;
  const result = await migrateLegacyVideoRelease(db, {
    apply: true,
    entries: [entry],
    allowNonProduction: true,
    fetchImpl: sourceHeadFetch(entry),
    structuralProbe,
    privacyProbe: healthyPrivacy,
    verifierHealthCheck: healthyVerifier,
    sourceCopier: async () => { copies += 1; },
    assetFinalizer: async (...args) => {
      finalizations += 1;
      return fakeFinalize(entry)(...args);
    },
    at: 300_000,
  });
  assert.equal(result.migrated, 1);
  assert.equal(copies, 1);
  assert.equal(finalizations, 1);
  const identity = legacyVideoMigrationIdentity(entry);
  const asset = db.prepare("SELECT * FROM media_assets WHERE id=?").get(identity.assetId);
  const render = db.prepare("SELECT * FROM media_variants WHERE id=?").get(asset.render_variant_id);
  assert.deepEqual(JSON.parse(db.prepare("SELECT photos FROM posts WHERE id=?").get(entry.postId).photos),
    [existing.renderUrl, render.public_url]);
  assert.deepEqual(db.prepare("SELECT asset_id,position FROM post_media WHERE post_id=? ORDER BY position")
    .all(entry.postId).map((row) => ({ ...row })), [
    { asset_id: existing.assetId, position: 0 },
    { asset_id: identity.assetId, position: 1 },
  ]);
  assert.equal(db.prepare("SELECT 1 FROM legacy_video_posters WHERE post_id=?").get(entry.postId), undefined);
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?")
    .get(new URL(entry.sourceUrl).pathname.replace(/^\/cdn\//u, "")).status, "delete_queued");
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(entry.posterKey).status,
    "delete_queued");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_deletion_queue WHERE object_key IN (?,?)")
    .get(new URL(entry.sourceUrl).pathname.replace(/^\/cdn\//u, ""), entry.posterKey).count, 2);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_reactions WHERE media_url=? AND post_id=?")
    .get(entry.sourceUrl, entry.postId).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_reactions WHERE media_url=? AND post_id=?")
    .get(render.public_url, entry.postId).count, 1);
  assert.match(asset.source_url, /^pit-private:/u);
  assert.notEqual(render.public_url, entry.sourceUrl);

  const rerun = await migrateLegacyVideoRelease(db, {
    apply: true,
    entries: [entry],
    allowNonProduction: true,
    fetchImpl: async () => { throw new Error("a committed retry must not touch the deleted raw source"); },
    structuralProbe: async () => { throw new Error("a committed retry must not probe the raw source"); },
    privacyProbe: healthyPrivacy,
    verifierHealthCheck: healthyVerifier,
    sourceCopier: async () => { copies += 1; },
    assetFinalizer: async () => { finalizations += 1; },
    at: 400_000,
  });
  assert.equal(rerun.migrated, 0);
  assert.equal(rerun.alreadyMigrated, 1);
  assert.equal(copies, 1);
  assert.equal(finalizations, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_deletion_queue WHERE object_key IN (?,?)")
    .get(new URL(entry.sourceUrl).pathname.replace(/^\/cdn\//u, ""), entry.posterKey).count, 2,
  "idempotent reruns cannot duplicate deletion work");
});

test("same-post clips prepare completely, publish in one stable swap, and rerun after cleanup", async () => {
  const owner = addUser("u_migration_group_owner");
  const postId = "p_migration_group_post";
  const entries = [
    releaseEntry({ ownerId: owner.id, postId, position: 1, suffix: "grouped-one" }),
    releaseEntry({ ownerId: owner.id, postId, position: 2, suffix: "grouped-two" }),
  ];
  const existing = addLegacyPostGroup(entries);
  const originalPhotos = [existing.renderUrl, ...entries.map((entry) => entry.sourceUrl)];
  let copies = 0;
  let finalizations = 0;
  const result = await migrateLegacyVideoRelease(db, {
    apply: true,
    entries,
    allowNonProduction: true,
    fetchImpl: sourceHeadFetch(entries[0]),
    structuralProbe,
    privacyProbe: healthyPrivacy,
    verifierHealthCheck: healthyVerifier,
    sourceCopier: async () => { copies += 1; },
    assetFinalizer: fakeFinalizeForEntries(entries, {
      onFinalized: ({ calls }) => {
        finalizations = calls;
        assert.deepEqual(JSON.parse(db.prepare("SELECT photos FROM posts WHERE id=?").get(postId).photos),
          originalPhotos, "preparing either clip must not publish a mixed post");
        assert.deepEqual(db.prepare(`SELECT asset_id,position FROM post_media
          WHERE post_id=? ORDER BY position`).all(postId).map((row) => ({ ...row })), [
          { asset_id: existing.assetId, position: 0 },
        ]);
        assert.equal(db.prepare("SELECT COUNT(*) count FROM legacy_video_posters WHERE post_id=?")
          .get(postId).count, 2);
      },
    }),
    at: 425_000,
  });

  assert.equal(result.migrated, 2);
  assert.equal(result.alreadyMigrated, 0);
  assert.equal(copies, 2);
  assert.equal(finalizations, 2);
  const identities = entries.map(legacyVideoMigrationIdentity);
  const renders = identities.map(({ assetId }) => {
    const asset = db.prepare("SELECT render_variant_id FROM media_assets WHERE id=?").get(assetId);
    return db.prepare("SELECT public_url FROM media_variants WHERE id=?").get(asset.render_variant_id).public_url;
  });
  assert.deepEqual(JSON.parse(db.prepare("SELECT photos FROM posts WHERE id=?").get(postId).photos),
    [existing.renderUrl, ...renders]);
  assert.deepEqual(db.prepare(`SELECT asset_id,position FROM post_media
    WHERE post_id=? ORDER BY position`).all(postId).map((row) => ({ ...row })), [
    { asset_id: existing.assetId, position: 0 },
    { asset_id: identities[0].assetId, position: 1 },
    { asset_id: identities[1].assetId, position: 2 },
  ]);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM legacy_video_posters WHERE post_id=?")
    .get(postId).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_reactions WHERE media_url IN (?,?)")
    .get(entries[0].sourceUrl, entries[1].sourceUrl).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_reactions WHERE media_url IN (?,?)")
    .get(renders[0], renders[1]).count, 2);
  const retiredKeys = entries.flatMap((entry) => [
    new URL(entry.sourceUrl).pathname.replace(/^\/cdn\//u, ""),
    entry.posterKey,
  ]);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM media_deletion_queue
    WHERE object_key IN (${retiredKeys.map(() => "?").join(",")})`).get(...retiredKeys).count, 4);

  db.prepare(`DELETE FROM media_deletion_queue
    WHERE object_key IN (${retiredKeys.map(() => "?").join(",")})`).run(...retiredKeys);
  db.prepare(`DELETE FROM media_objects
    WHERE object_key IN (${retiredKeys.map(() => "?").join(",")})`).run(...retiredKeys);
  const rerun = await migrateLegacyVideoRelease(db, {
    apply: true,
    entries,
    allowNonProduction: true,
    fetchImpl: async () => { throw new Error("a committed group cannot read retired source bytes"); },
    structuralProbe: async () => { throw new Error("a committed group cannot probe retired source bytes"); },
    privacyProbe: healthyPrivacy,
    verifierHealthCheck: healthyVerifier,
    sourceCopier: async () => { throw new Error("a committed group cannot copy retired source bytes"); },
    assetFinalizer: async () => { throw new Error("a committed group cannot finalize again"); },
    at: 426_000,
  });
  assert.equal(rerun.migrated, 0);
  assert.equal(rerun.alreadyMigrated, 2);
  assert.equal(db.prepare(`SELECT COUNT(*) count FROM media_deletion_queue
    WHERE object_key IN (${retiredKeys.map(() => "?").join(",")})`).get(...retiredKeys).count, 0,
  "a lost response after drained cleanup must not recreate deletion work");
});

test("an unmanifested companion rejects before creating assets or mutating the post", async () => {
  const owner = addUser("u_migration_companion_owner");
  const entry = releaseEntry({ ownerId: owner.id, postId: "p_migration_companion_post" });
  addLegacyPost(entry);
  const unmanifested = "https://media.example.com/cdn/users/u_migration_companion_owner/post/unknown.mov";
  const photos = JSON.parse(db.prepare("SELECT photos FROM posts WHERE id=?").get(entry.postId).photos);
  photos.push(unmanifested);
  db.prepare("UPDATE posts SET photos=? WHERE id=?").run(JSON.stringify(photos), entry.postId);
  const before = {
    photos: db.prepare("SELECT photos FROM posts WHERE id=?").get(entry.postId).photos,
    assets: db.prepare("SELECT COUNT(*) count FROM media_assets").get().count,
    queue: db.prepare("SELECT COUNT(*) count FROM media_deletion_queue").get().count,
    mappings: db.prepare("SELECT COUNT(*) count FROM legacy_video_posters WHERE post_id=?")
      .get(entry.postId).count,
  };

  await assert.rejects(() => migrateLegacyVideoRelease(db, {
    apply: true,
    entries: [entry],
    allowNonProduction: true,
    fetchImpl: sourceHeadFetch(entry),
    structuralProbe,
    privacyProbe: healthyPrivacy,
    verifierHealthCheck: healthyVerifier,
    sourceCopier: async () => { throw new Error("coverage must reject before copying"); },
    assetFinalizer: async () => { throw new Error("coverage must reject before finalizing"); },
    at: 427_000,
  }), /companion media.*positions 3/u);
  assert.deepEqual({
    photos: db.prepare("SELECT photos FROM posts WHERE id=?").get(entry.postId).photos,
    assets: db.prepare("SELECT COUNT(*) count FROM media_assets").get().count,
    queue: db.prepare("SELECT COUNT(*) count FROM media_deletion_queue").get().count,
    mappings: db.prepare("SELECT COUNT(*) count FROM legacy_video_posters WHERE post_id=?")
      .get(entry.postId).count,
  }, before);
});

test("a mispositioned stable companion fails closed before migration preparation", async () => {
  const owner = addUser("u_migration_position_owner");
  const entry = releaseEntry({ ownerId: owner.id, postId: "p_migration_position_post" });
  addLegacyPost(entry);
  db.prepare("UPDATE post_media SET position=1 WHERE post_id=? AND position=0").run(entry.postId);
  const before = {
    photos: db.prepare("SELECT photos FROM posts WHERE id=?").get(entry.postId).photos,
    links: db.prepare("SELECT asset_id,position FROM post_media WHERE post_id=?")
      .all(entry.postId).map((row) => ({ ...row })),
    assets: db.prepare("SELECT COUNT(*) count FROM media_assets").get().count,
    queue: db.prepare("SELECT COUNT(*) count FROM media_deletion_queue").get().count,
  };

  await assert.rejects(() => migrateLegacyVideoRelease(db, {
    apply: true,
    entries: [entry],
    allowNonProduction: true,
    fetchImpl: sourceHeadFetch(entry),
    structuralProbe,
    privacyProbe: healthyPrivacy,
    verifierHealthCheck: healthyVerifier,
    sourceCopier: async () => { throw new Error("position validation must reject before copying"); },
    assetFinalizer: async () => { throw new Error("position validation must reject before finalizing"); },
    at: 427_100,
  }), /stable media link that cannot be preserved safely/u);
  assert.deepEqual({
    photos: db.prepare("SELECT photos FROM posts WHERE id=?").get(entry.postId).photos,
    links: db.prepare("SELECT asset_id,position FROM post_media WHERE post_id=?")
      .all(entry.postId).map((row) => ({ ...row })),
    assets: db.prepare("SELECT COUNT(*) count FROM media_assets").get().count,
    queue: db.prepare("SELECT COUNT(*) count FROM media_deletion_queue").get().count,
  }, before);
});

test("an extra legacy cover mapping cannot be retired by an out-of-release swap", async () => {
  const owner = addUser("u_migration_mapping_owner");
  const postId = "p_migration_mapping_post";
  const entry = releaseEntry({ ownerId: owner.id, postId });
  addLegacyPost(entry);
  const unreviewed = releaseEntry({
    ownerId: owner.id,
    postId,
    position: 0,
    suffix: "unreviewed-mapping",
  });
  addLegacyMapping(unreviewed);
  const before = {
    photos: db.prepare("SELECT photos FROM posts WHERE id=?").get(postId).photos,
    mappings: db.prepare("SELECT media_url FROM legacy_video_posters WHERE post_id=? ORDER BY media_url")
      .all(postId).map((row) => row.media_url),
    assets: db.prepare("SELECT COUNT(*) count FROM media_assets").get().count,
    queue: db.prepare("SELECT COUNT(*) count FROM media_deletion_queue").get().count,
  };

  await assert.rejects(() => migrateLegacyVideoRelease(db, {
    apply: true,
    entries: [entry],
    allowNonProduction: true,
    fetchImpl: sourceHeadFetch(entry),
    structuralProbe,
    privacyProbe: healthyPrivacy,
    verifierHealthCheck: healthyVerifier,
    sourceCopier: async () => { throw new Error("mapping validation must reject before copying"); },
    assetFinalizer: async () => { throw new Error("mapping validation must reject before finalizing"); },
    at: 427_200,
  }), /unreviewed historical clip cover mapping/u);
  assert.deepEqual({
    photos: db.prepare("SELECT photos FROM posts WHERE id=?").get(postId).photos,
    mappings: db.prepare("SELECT media_url FROM legacy_video_posters WHERE post_id=? ORDER BY media_url")
      .all(postId).map((row) => row.media_url),
    assets: db.prepare("SELECT COUNT(*) count FROM media_assets").get().count,
    queue: db.prepare("SELECT COUNT(*) count FROM media_deletion_queue").get().count,
  }, before);
});

test("a second grouped finalizer failure leaves every legacy attachment and deletion ledger untouched", async () => {
  const owner = addUser("u_migration_group_failure_owner");
  const postId = "p_migration_group_failure";
  const entries = [
    releaseEntry({ ownerId: owner.id, postId, position: 1, suffix: "failure-one" }),
    releaseEntry({ ownerId: owner.id, postId, position: 2, suffix: "failure-two" }),
  ];
  const existing = addLegacyPostGroup(entries);
  const before = {
    photos: db.prepare("SELECT photos FROM posts WHERE id=?").get(postId).photos,
    links: db.prepare("SELECT asset_id,position FROM post_media WHERE post_id=? ORDER BY position")
      .all(postId).map((row) => ({ ...row })),
    mappings: db.prepare("SELECT media_url FROM legacy_video_posters WHERE post_id=? ORDER BY media_url")
      .all(postId).map((row) => row.media_url),
    queue: db.prepare("SELECT COUNT(*) count FROM media_deletion_queue").get().count,
  };

  await assert.rejects(() => migrateLegacyVideoRelease(db, {
    apply: true,
    entries,
    allowNonProduction: true,
    fetchImpl: sourceHeadFetch(entries[0]),
    structuralProbe,
    privacyProbe: healthyPrivacy,
    verifierHealthCheck: healthyVerifier,
    sourceCopier: async () => {},
    assetFinalizer: fakeFinalizeForEntries(entries, { failAt: 2 }),
    at: 428_000,
  }), /simulated finalizer failure 2/u);
  assert.deepEqual({
    photos: db.prepare("SELECT photos FROM posts WHERE id=?").get(postId).photos,
    links: db.prepare("SELECT asset_id,position FROM post_media WHERE post_id=? ORDER BY position")
      .all(postId).map((row) => ({ ...row })),
    mappings: db.prepare("SELECT media_url FROM legacy_video_posters WHERE post_id=? ORDER BY media_url")
      .all(postId).map((row) => row.media_url),
    queue: db.prepare("SELECT COUNT(*) count FROM media_deletion_queue").get().count,
  }, before);
  assert.deepEqual(before.links, [{ asset_id: existing.assetId, position: 0 }]);
  assert.equal(db.prepare("SELECT status FROM media_assets WHERE id=?")
    .get(legacyVideoMigrationIdentity(entries[0]).assetId).status, "ready",
  "a prepared deterministic asset may remain private and unattached for the retry");
  assert.equal(db.prepare("SELECT 1 FROM post_media WHERE asset_id=?")
    .get(legacyVideoMigrationIdentity(entries[0]).assetId), undefined);
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?")
    .get(entries[0].posterKey).status, "associated");
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?")
    .get(entries[1].posterKey).status, "associated");
});

test("apply moves every exact-source reaction and merges destination conflicts without losing engagement", async () => {
  const owner = addUser("u_migration_reaction_owner");
  const nullableContextUser = addUser("u_migration_reaction_null");
  const staleContextUser = addUser("u_migration_reaction_stale");
  const entry = releaseEntry({ ownerId: owner.id, postId: "p_migration_reaction_post" });
  addLegacyPost(entry);
  const stalePostId = "p_migration_reaction_context";
  db.prepare(`INSERT INTO posts
    (id,user_id,artist,venue,overall,review,photos,photos_public,kind,created_at)
    VALUES (?,?,'Reaction Artist','Reaction Room',5,'Context','[]',1,'review',?)`)
    .run(stalePostId, owner.id, clock++);

  const identity = legacyVideoMigrationIdentity(entry);
  const destination = fakeDelivery(owner.id, identity.assetId).renderUrl;
  db.prepare("UPDATE media_reactions SET post_id=NULL,created_at=? WHERE media_url=? AND user_id=?")
    .run(700_001, entry.sourceUrl, owner.id);
  db.prepare("INSERT INTO media_reactions (media_url,user_id,post_id,created_at) VALUES (?,?,NULL,?)")
    .run(entry.sourceUrl, nullableContextUser.id, 700_002);
  db.prepare("INSERT INTO media_reactions (media_url,user_id,post_id,created_at) VALUES (?,?,?,?)")
    .run(entry.sourceUrl, staleContextUser.id, stalePostId, 700_003);
  db.prepare("INSERT INTO media_reactions (media_url,user_id,post_id,created_at) VALUES (?,?,?,?)")
    .run(destination, owner.id, entry.postId, 700_004);

  await migrateLegacyVideoRelease(db, {
    apply: true,
    entries: [entry],
    allowNonProduction: true,
    fetchImpl: sourceHeadFetch(entry),
    structuralProbe,
    privacyProbe: healthyPrivacy,
    verifierHealthCheck: healthyVerifier,
    sourceCopier: async () => {},
    assetFinalizer: fakeFinalize(entry),
    at: 450_000,
  });

  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_reactions WHERE media_url=?")
    .get(entry.sourceUrl).count, 0);
  assert.deepEqual(db.prepare(`SELECT user_id,post_id,created_at FROM media_reactions
    WHERE media_url=? ORDER BY user_id`).all(destination).map((row) => ({ ...row })), [
    { user_id: nullableContextUser.id, post_id: null, created_at: 700_002 },
    { user_id: owner.id, post_id: entry.postId, created_at: 700_001 },
    { user_id: staleContextUser.id, post_id: stalePostId, created_at: 700_003 },
  ].sort((a, b) => a.user_id.localeCompare(b.user_id)));
});

test("a source HEAD mismatch aborts before a deterministic asset or deletion job is created", async () => {
  const owner = addUser("u_migration_mismatch_owner");
  const entry = releaseEntry({ ownerId: owner.id, postId: "p_migration_mismatch_post" });
  addLegacyPost(entry);
  await assert.rejects(() => migrateLegacyVideoRelease(db, {
    apply: true,
    entries: [entry],
    allowNonProduction: true,
    fetchImpl: async () => ({
      status: 200,
      headers: new Headers({
        "content-length": String(entry.sourceByteSize + 1),
        "content-type": entry.sourceMimeType,
        etag: entry.sourceEtag,
      }),
    }),
    structuralProbe,
    privacyProbe: healthyPrivacy,
    verifierHealthCheck: healthyVerifier,
    at: 500_000,
  }), /no longer matches the reviewed manifest/u);
  assert.equal(db.prepare("SELECT 1 FROM media_assets WHERE id=?")
    .get(legacyVideoMigrationIdentity(entry).assetId), undefined);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_deletion_queue WHERE object_key=?")
    .get(new URL(entry.sourceUrl).pathname.replace(/^\/cdn\//u, "")).count, 0);
  assert.deepEqual(JSON.parse(db.prepare("SELECT photos FROM posts WHERE id=?").get(entry.postId).photos).at(1),
    entry.sourceUrl);
});

test("a reused temporary poster rolls the post swap and poster deletion back", async () => {
  const owner = addUser("u_migration_reused_poster_owner");
  const entry = releaseEntry({ ownerId: owner.id, postId: "p_migration_reused_poster" });
  addLegacyPost(entry);
  const referencingPostId = "p_migration_reused_poster_ref";
  db.prepare(`INSERT INTO posts
    (id,user_id,artist,venue,overall,review,photos,photos_public,kind,created_at)
    VALUES (?,?,'Reference Artist','Reference Room',5,'Reference',?,1,'review',?)`)
    .run(referencingPostId, owner.id, JSON.stringify([entry.posterUrl]), clock++);
  const before = db.prepare("SELECT photos FROM posts WHERE id=?").get(entry.postId).photos;

  await assert.rejects(() => migrateLegacyVideoRelease(db, {
    apply: true,
    entries: [entry],
    allowNonProduction: true,
    fetchImpl: sourceHeadFetch(entry),
    structuralProbe,
    privacyProbe: healthyPrivacy,
    verifierHealthCheck: healthyVerifier,
    sourceCopier: async () => {},
    assetFinalizer: fakeFinalize(entry),
    at: 600_000,
  }), /cover is still referenced/u);

  assert.equal(db.prepare("SELECT photos FROM posts WHERE id=?").get(entry.postId).photos, before);
  assert.ok(db.prepare("SELECT 1 FROM legacy_video_posters WHERE post_id=? AND media_url=?")
    .get(entry.postId, entry.sourceUrl));
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(entry.posterKey).status,
    "associated");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_deletion_queue WHERE object_key=?")
    .get(entry.posterKey).count, 0);
});
