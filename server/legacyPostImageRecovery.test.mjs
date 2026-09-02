import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-legacy-post-image-recovery-"));
process.env.PIT_DATA_DIR = dataDir;
Object.assign(process.env, {
  NODE_ENV: "test",
  MEDIA_ENDPOINT: "https://objects.example.com/s3",
  MEDIA_BUCKET: "pit-public",
  MEDIA_SOURCE_BUCKET: "pit-private",
  MEDIA_REGION: "auto",
  MEDIA_ACCESS_KEY_ID: "legacy-recovery-access",
  MEDIA_SECRET_ACCESS_KEY: "legacy-recovery-secret",
  MEDIA_PUBLIC_BASE_URL: "https://media.example.com/cdn",
});

const { db, q } = await import("./db.js");
const { hashPassword } = await import("./auth.js");
const {
  drainLegacyImageRecovery,
  legacyPostImageRecoveryCandidates,
  legacyProfileImageRecoveryCandidates,
  recoverLegacyPostImage,
  legacyImageRecoveryEnabled,
  legacyImageRecoveryHealth,
  recoverLegacyProfileImage,
  startLegacyImageRecoveryScheduler,
} = await import("./legacyPostImageRecovery.js");

test("legacy recovery defaults on and only explicit false values pause it", () => {
  assert.equal(legacyImageRecoveryEnabled({}), true);
  assert.equal(legacyImageRecoveryEnabled({ RENDER: "true" }), true);
  for (const value of ["0", "false", "no", "off", "disabled"]) {
    assert.equal(legacyImageRecoveryEnabled({ MEDIA_LEGACY_RECOVERY_ENABLED: value }), false);
  }
  assert.equal(legacyImageRecoveryEnabled({ MEDIA_LEGACY_RECOVERY_ENABLED: "true" }), true);
});
test("automatic legacy recovery is serial, bounded, observable, and stoppable", async () => {
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let calls = 0;
  const scheduler = startLegacyImageRecoveryScheduler({
    database: db,
    initialDelayMs: 60_000,
    intervalMs: 60_000,
    maxItems: 2,
    drain: async (_database, options) => {
      calls += 1;
      assert.equal(options.maxItems, 2);
      assert.ok(options.signal instanceof AbortSignal);
      if (calls === 1) await firstGate;
      return {
        scanned: 1,
        recovered: [{ kind: "post" }],
        failed: [],
        exhausted: true,
        limitReached: false,
      };
    },
  });
  const first = scheduler.runOnce();
  const coalesced = scheduler.runOnce();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1, "overlapping ticks share one serial drain");
  releaseFirst();
  const [firstResult, coalescedResult] = await Promise.all([first, coalesced]);
  assert.deepEqual(firstResult, {
    status: "completed",
    value: {
      scanned: 1,
      recovered: [{ kind: "post" }],
      failed: [],
      exhausted: true,
      limitReached: false,
    },
    errorCode: null,
  });
  assert.equal(coalescedResult, firstResult, "overlapping ticks share one typed result");
  assert.deepEqual(legacyImageRecoveryHealth(db), {
    enabled: true,
    running: false,
    lastStartedAt: legacyImageRecoveryHealth(db).lastStartedAt,
    lastFinishedAt: legacyImageRecoveryHealth(db).lastFinishedAt,
    lastSuccessAt: legacyImageRecoveryHealth(db).lastSuccessAt,
    lastErrorCode: null,
    scanned: 1,
    recovered: 1,
    failed: 0,
    backlog: false,
    exhausted: true,
    limitReached: false,
  });
  const healthy = legacyImageRecoveryHealth(db);
  assert.ok(healthy.lastStartedAt > 0 && healthy.lastFinishedAt >= healthy.lastStartedAt);
  assert.ok(healthy.lastSuccessAt >= healthy.lastStartedAt);
  await scheduler.stop();
  assert.equal(legacyImageRecoveryHealth(db).enabled, false);
  assert.deepEqual(await scheduler.runOnce(), {
    status: "stopped",
    value: null,
    errorCode: null,
  });

  const failingScheduler = startLegacyImageRecoveryScheduler({
    database: db,
    initialDelayMs: 60_000,
    intervalMs: 60_000,
    drain: async () => {
      const failure = new Error("Synthetic recovery failure");
      failure.code = "TEST_RECOVERY_FAILED";
      throw failure;
    },
  });
  assert.deepEqual(await failingScheduler.runOnce(), {
    status: "failed",
    value: null,
    errorCode: "TEST_RECOVERY_FAILED",
  });
  assert.equal(legacyImageRecoveryHealth(db).lastErrorCode, "TEST_RECOVERY_FAILED");
  await failingScheduler.stop();
});
after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

let clock = 10_000;

function addUser(id) {
  q.insertUser.run(id, `${id}@example.com`, id, id, hashPassword("legacy-recovery-password"),
    "fan", "Toronto", 43.65, -79.38, "LR", "#123456", clock++);
  return q.userById.get(id);
}

function addPost({ id, ownerId, photos, photosPublic = 1 }) {
  db.prepare(`INSERT INTO posts
    (id,user_id,artist,venue,overall,review,photos,photos_public,kind,created_at)
    VALUES (?,?, 'Recovery Artist','Recovery Room',5,'Historical photo',?,?,'review',?)`)
    .run(id, ownerId, JSON.stringify(photos), photosPublic, clock++);
}

function memoryStorage() {
  const objects = new Map();
  const requests = [];
  let failPublicRenderOnce = false;
  const location = (url) => {
    const parts = new URL(url).pathname.slice("/s3/".length).split("/").map(decodeURIComponent);
    return { bucket: parts.shift(), key: parts.join("/") };
  };
  const put = (bucket, key, bytes, type = "image/jpeg") => {
    const body = Buffer.from(bytes);
    objects.set(`${bucket}/${key}`, {
      bytes: body,
      type,
      etag: `"${createHash("sha256").update(body).digest("hex")}"`,
    });
  };
  const fetchImpl = async (url, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    const target = location(url);
    const identity = `${target.bucket}/${target.key}`;
    requests.push({ method, identity, headers: new Headers(options.headers || {}) });
    if (method === "PUT") {
      if (failPublicRenderOnce && target.bucket === "pit-public" && target.key.includes("_recovered_render_")) {
        failPublicRenderOnce = false;
        return { status: 503, headers: new Headers() };
      }
      if (objects.has(identity)) return { status: 412, headers: new Headers() };
      const bytes = Buffer.from(options.body || []);
      const type = new Headers(options.headers || {}).get("content-type") || "application/octet-stream";
      put(target.bucket, target.key, bytes, type);
      return { status: 200, headers: new Headers({ etag: objects.get(identity).etag }) };
    }
    const object = objects.get(identity);
    if (!object) return { status: 404, headers: new Headers() };
    const headers = new Headers({
      "content-length": String(object.bytes.length),
      "content-type": object.type,
      etag: object.etag,
    });
    if (method === "HEAD") return { status: 200, headers };
    if (method !== "GET") return { status: 405, headers: new Headers() };
    if (new Headers(options.headers || {}).get("if-match") !== object.etag) {
      return { status: 412, headers: new Headers() };
    }
    return new Response(object.bytes, { status: 200, headers });
  };
  return {
    objects,
    requests,
    put,
    fetchImpl,
    failNextPublicRender() { failPublicRenderOnce = true; },
  };
}

function legacyUrl(ownerId, token, extension = "jpg") {
  return `https://media.example.com/cdn/users/${ownerId}/post/${token}.${extension}`;
}

function legacyProfileUrl(ownerId, purpose, token, extension = "jpg") {
  return `https://media.example.com/cdn/users/${ownerId}/${purpose}/${token}.${extension}`;
}

function keyFor(url) {
  return new URL(url).pathname.replace(/^\/cdn\//, "");
}

const sanitizedBytes = Buffer.from("sanitized-historical-photo-pixels");
async function fakeSanitizer(_bytes, { outputType }) {
  return {
    bytes: sanitizedBytes,
    byteSize: sanitizedBytes.length,
    mimeType: outputType,
    width: 40,
    height: 30,
  };
}

function candidateFor(postId) {
  return legacyPostImageRecoveryCandidates(db, { limit: 2 })
    .find((candidate) => candidate.postId === postId);
}

test("URL-only post photos become stable private-source assets with a sanitized public rendition", async () => {
  const owner = addUser("legacy_recovery_url_owner");
  const postId = "p_legacy_recovery_url";
  const sourceUrl = legacyUrl(owner.id, "legacy-url-photo");
  const trailingPhotos = Array.from({ length: 9 }, (_, index) => `https://external.example/trailing-${index}.jpg`);
  const storage = memoryStorage();
  const sourceBytes = Buffer.from("raw-camera-image-with-private-metadata");
  storage.put("pit-public", keyFor(sourceUrl), sourceBytes);
  addPost({ id: postId, ownerId: owner.id, photos: [sourceUrl, ...trailingPhotos] });
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,associated_at,created_at,updated_at)
    VALUES (?,?,'public','post',0,'associated',?,?,?)`)
    .run(keyFor(sourceUrl), owner.id, clock, clock, clock++);

  const candidate = candidateFor(postId);
  assert.ok(candidate);
  let processorOptions;
  const recovered = await recoverLegacyPostImage(db, candidate, {
    fetchImpl: storage.fetchImpl,
    imageProcessor: async (bytes, options) => {
      processorOptions = options;
      return fakeSanitizer(bytes, options);
    },
    at: 20_000,
  });
  assert.equal(processorOptions.allowHeicFallback, true,
    "only the bounded historical recovery explicitly enables the HEIC fallback");
  assert.equal(processorOptions.allowLegacyJpegTrailer, true,
    "only the bounded historical recovery may canonicalize a valid legacy JPEG prefix");
  assert.equal(processorOptions.timeoutMs, 60_000,
    "the bounded recovery gets enough isolated-worker time for large production phone photos");

  const link = db.prepare("SELECT asset_id,position FROM post_media WHERE post_id=?").get(postId);
  assert.deepEqual({ ...link }, { asset_id: recovered.assetId, position: 0 });
  const asset = db.prepare("SELECT * FROM media_assets WHERE id=?").get(recovered.assetId);
  const variant = db.prepare("SELECT * FROM media_variants WHERE asset_id=? AND role='render'").get(recovered.assetId);
  assert.equal(asset.source_storage_scope, "private");
  assert.match(asset.source_etag, /^"[a-f0-9]{64}"$/u);
  assert.equal(asset.status, "ready");
  assert.equal(asset.render_state, "ready");
  assert.equal(variant.verification_origin, "private_derivative_v1");
  assert.equal(parsePhotos(postId)[0], recovered.url);
  assert.deepEqual(parsePhotos(postId).slice(1), trailingPhotos,
    "replacing one supported slot never truncates untouched legacy history");
  assert.notEqual(recovered.url, sourceUrl);
  assert.deepEqual(storage.objects.get(`pit-private/${asset.source_key}`).bytes, sanitizedBytes);
  assert.deepEqual(storage.objects.get(`pit-public/${variant.object_key}`).bytes, sanitizedBytes);
  assert.ok(storage.requests.filter((request) => request.method === "GET")
    .every((request) => /^"[a-f0-9]{64}"$/u.test(request.headers.get("if-match") || "")));
  assert.ok(storage.requests.filter((request) => request.method === "PUT")
    .every((request) => request.headers.get("if-none-match") === "*"));
  assert.ok(storage.requests.filter((request) => request.method === "PUT" && request.identity.startsWith("pit-public/"))
    .every((request) => request.headers.get("cache-control") === "public, max-age=300, must-revalidate"));
  assert.ok(storage.requests.filter((request) => request.method === "PUT" && request.identity.startsWith("pit-private/"))
    .every((request) => request.headers.get("cache-control") === null),
  "private recovery copies never receive public cache metadata");
  const retiredSource = db.prepare("SELECT status,byte_size FROM media_objects WHERE object_key=?").get(keyFor(sourceUrl));
  assert.deepEqual({ ...retiredSource }, { status: "delete_queued", byte_size: sourceBytes.length },
    "a live zero-byte legacy ledger is upgraded only to its HEAD-verified size");
  db.prepare("UPDATE media_objects SET status='delete_queued' WHERE object_key=?").run(variant.object_key);
  assert.ok(candidateFor(postId), "a dead render ledger keeps an otherwise ready image recoverable");
  db.prepare("UPDATE media_objects SET status='associated' WHERE object_key=?").run(variant.object_key);
  assert.equal(candidateFor(postId), undefined, "a committed recovery is not selected twice");
});

function parsePhotos(postId) {
  return JSON.parse(db.prepare("SELECT photos FROM posts WHERE id=?").get(postId).photos);
}

test("a linked quarantined client rendition keeps its asset identity and resets stale edit state", async () => {
  const owner = addUser("legacy_recovery_linked_owner");
  const postId = "p_legacy_recovery_linked";
  const sharedPostId = "p_legacy_recovery_linked_shared_url";
  const assetId = "ma_legacy_recovery_linked";
  const variantId = "mv_legacy_recovery_linked";
  const sourceUrl = legacyUrl(owner.id, "legacy-linked-source");
  const renderUrl = legacyUrl(owner.id, "legacy-linked-render");
  const sourceKey = keyFor(sourceUrl);
  const renderKey = keyFor(renderUrl);
  const privateSourceLocator = `pit-private:${sourceKey}`;
  const storage = memoryStorage();
  storage.put("pit-public", sourceKey, Buffer.from("old-public-source-pixels"));
  storage.put("pit-public", renderKey, Buffer.from("old-client-render-pixels"));
  addPost({ id: postId, ownerId: owner.id, photos: [renderUrl] });
  addPost({ id: sharedPostId, ownerId: owner.id, photos: [renderUrl] });
  for (const [key, storageScope, bytes] of [[sourceKey, "private", 24], [renderKey, "public", 24]]) {
    db.prepare(`INSERT INTO media_objects
      (object_key,owner_id,storage_scope,purpose,byte_size,status,associated_at,created_at,updated_at)
      VALUES (?,?,?,'post',?,'associated',?,?,?)`).run(key, owner.id, storageScope, bytes, clock, clock, clock++);
  }
  db.prepare(`INSERT INTO media_assets
    (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,
     original_name,mime_type,byte_size,width,height,metadata_status,codec_status,status,edit_recipe,
     recipe_version,finalize_hash,source_verified_at,render_state,render_variant_id,created_at,updated_at)
    VALUES (?,?,?,?, 'post','image',?,?,'private','camera.jpg','image/jpeg',24,1200,900,'declared',
      'not_applicable','render_unavailable',?,4,?,?, 'unavailable',?,?,?)`)
    .run(assetId, owner.id, "legacy-recovery-linked-client", "a".repeat(64), sourceKey, privateSourceLocator,
      JSON.stringify({ kind: "image", crop: { x: 0.2 } }), "b".repeat(64), clock, variantId, clock, clock++);
  db.prepare(`INSERT INTO media_variants
    (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,
     status,finalize_hash,verified_at,verification_origin,created_at,updated_at)
    VALUES (?,?,?,?,'render',?,?,'image/jpeg',23,800,600,'verified',?,?, 'client',?,?)`)
    .run(variantId, assetId, "legacy-linked-client-render", "c".repeat(64), renderKey, renderUrl,
      "d".repeat(64), clock, clock, clock++);
  db.prepare("INSERT INTO post_media (post_id,asset_id,position,created_at) VALUES (?,?,0,?)")
    .run(postId, assetId, clock++);

  const recovered = await recoverLegacyPostImage(db, candidateFor(postId), {
    fetchImpl: storage.fetchImpl,
    imageProcessor: fakeSanitizer,
    at: 30_000,
  });
  assert.equal(recovered.assetId, assetId);
  const asset = db.prepare("SELECT * FROM media_assets WHERE id=?").get(assetId);
  const variant = db.prepare("SELECT * FROM media_variants WHERE id=?").get(variantId);
  assert.equal(asset.edit_recipe, "{}");
  assert.equal(asset.recipe_version, 1);
  assert.equal(asset.source_storage_scope, "private");
  assert.equal(asset.render_variant_id, variantId);
  assert.equal(variant.verification_origin, "private_derivative_v1");
  assert.equal(parsePhotos(postId)[0], recovered.url);
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(renderKey).status,
    "associated", "a captured actual variant URL remains live while another post still stores it");
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(sourceKey).status,
    "delete_queued", "the captured private source key retires even though its URL is a private locator");

  await recoverLegacyPostImage(db, candidateFor(sharedPostId), {
    fetchImpl: storage.fetchImpl,
    imageProcessor: fakeSanitizer,
    at: 31_000,
  });
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(renderKey).status,
    "delete_queued", "the shared variant object retires only after its last actual URL reference moves");
});

test("owner/path mismatches and video extensions never become recovery candidates", () => {
  const owner = addUser("legacy_recovery_wrong_owner");
  const other = addUser("legacy_recovery_path_owner");
  addPost({
    id: "p_legacy_recovery_wrong_owner",
    ownerId: owner.id,
    photos: [legacyUrl(other.id, "not-owned"), legacyUrl(owner.id, "not-an-image", "mp4")],
  });
  const candidates = legacyPostImageRecoveryCandidates(db, { limit: 2 });
  assert.equal(candidates.some((candidate) => candidate.postId === "p_legacy_recovery_wrong_owner"), false);
});

test("a failed create-only delivery leaves the post untouched and retries the same generation idempotently", async () => {
  const owner = addUser("legacy_recovery_retry_owner");
  const postId = "p_legacy_recovery_retry";
  const sourceUrl = legacyUrl(owner.id, "legacy-retry-photo");
  const storage = memoryStorage();
  storage.put("pit-public", keyFor(sourceUrl), Buffer.from("raw-retry-camera-image"));
  storage.failNextPublicRender();
  addPost({ id: postId, ownerId: owner.id, photos: [sourceUrl] });
  const candidate = candidateFor(postId);

  await assert.rejects(
    recoverLegacyPostImage(db, candidate, {
      fetchImpl: storage.fetchImpl,
      imageProcessor: fakeSanitizer,
      at: 40_000,
    }),
    (error) => error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE",
  );
  assert.equal(db.prepare("SELECT 1 FROM post_media WHERE post_id=?").get(postId), undefined);
  assert.equal(parsePhotos(postId)[0], sourceUrl);
  const issuanceCount = (accountingClass) => Number(db.prepare(`SELECT COUNT(*) count
    FROM media_upload_issuances WHERE owner_id=? AND accounting_class=?`)
    .get(owner.id, accountingClass).count);
  assert.equal(issuanceCount("member_source"), 0,
    "server recovery never consumes the member-visible original-upload allowance");
  assert.equal(issuanceCount("service_generated"), 2,
    "the private recovery copy and sanitized public copy both remain globally accounted");

  const recovered = await recoverLegacyPostImage(db, candidate, {
    fetchImpl: storage.fetchImpl,
    imageProcessor: fakeSanitizer,
    at: 41_000,
  });
  assert.equal(parsePhotos(postId)[0], recovered.url);
  const privatePuts = storage.requests.filter((request) => request.method === "PUT"
    && request.identity.includes("_recovered_source_"));
  assert.equal(privatePuts.length, 2, "retry reuses the same create-only private generation");
  assert.equal(new Set(privatePuts.map((request) => request.identity)).size, 1);
  assert.equal(issuanceCount("member_source"), 0,
    "server-only immutable recovery never consumes the member-visible original-upload allowance");
  assert.equal(issuanceCount("service_generated"), 2,
    "a deterministic retry does not mint duplicate generated-object issuances");
});

test("candidate scanning cannot be starved by more than 96 earlier non-candidates", () => {
  const owner = addUser("legacy_recovery_long_scan_owner");
  for (let index = 0; index < 100; index += 1) {
    addPost({
      id: `p_legacy_recovery_safe_${String(index).padStart(3, "0")}`,
      ownerId: owner.id,
      photos: [`https://external.example/safe-${index}.jpg`],
    });
  }
  const postId = "p_legacy_recovery_after_100";
  addPost({
    id: postId,
    ownerId: owner.id,
    photos: [legacyUrl(owner.id, "after-one-hundred")],
  });
  assert.ok(legacyPostImageRecoveryCandidates(db, { limit: 2 })
    .some((candidate) => candidate.postId === postId));
  db.prepare("UPDATE posts SET removed=1 WHERE id=?").run(postId);
});

test("profile candidates dedupe shared exact owner references, skip external URLs, and recover safely", async () => {
  const owner = addUser("legacy_profile_worker_owner");
  const sourceUrl = legacyProfileUrl(owner.id, "avatar", "shared-legacy-avatar");
  const external = "https://external.example/profile-banner.jpg";
  db.prepare("UPDATE users SET avatar_uri=?,banner=? WHERE id=?").run(sourceUrl, external, owner.id);
  db.prepare(`INSERT INTO artist_profiles (artist_key,owner_id,avatar_uri,banner,feed_enabled,updated_at)
    VALUES (?,?,?,?,1,?)`).run("legacy profile worker artist", owner.id, sourceUrl, external, clock++);
  const storage = memoryStorage();
  const profileSourceBytes = Buffer.from("raw-shared-profile-camera-image");
  storage.put("pit-public", keyFor(sourceUrl), profileSourceBytes);
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,associated_at,created_at,updated_at)
    VALUES (?,?,'public','avatar',0,'associated',?,?,?)`)
    .run(keyFor(sourceUrl), owner.id, clock, clock, clock++);
  db.prepare(`INSERT INTO media_upload_issuances (owner_id,object_key,byte_size,issued_at)
    VALUES (?,?,?,?)`).run(owner.id, `users/${owner.id}/avatar/quota-full.jpg`, 1, 49_999);
  const quotaEnv = {
    ...process.env,
    MEDIA_UPLOAD_24H_TICKETS: "1",
    MEDIA_UPLOAD_24H_BYTES: "1",
  };

  const candidates = legacyProfileImageRecoveryCandidates(db, { limit: 2 });
  const candidate = candidates.find((item) => item.sourceUrl === sourceUrl);
  assert.ok(candidate);
  assert.equal(candidate.references.length, 2);
  assert.deepEqual(new Set(candidate.references.map((item) => item.reference)),
    new Set(["user.avatar", "artist_profile.avatar"]));
  assert.equal(candidates.some((item) => item.sourceUrl === external), false);

  let processorOptions;
  const recovered = await recoverLegacyProfileImage(db, candidate, {
    fetchImpl: storage.fetchImpl,
    imageProcessor: async (bytes, options) => {
      processorOptions = options;
      return fakeSanitizer(bytes, options);
    },
    env: quotaEnv,
    at: 50_000,
  });
  assert.equal(processorOptions.allowHeicFallback, true,
    "profile recovery passes the explicit HEIC capability through private staging");
  assert.equal(processorOptions.allowLegacyJpegTrailer, true,
    "profile recovery passes the explicit legacy JPEG capability through private staging");
  assert.equal(processorOptions.timeoutMs, 60_000,
    "profile HEIC recovery gets the same bounded production timeout");
  assert.equal(recovered.references, 2);
  const user = db.prepare("SELECT avatar_uri,banner FROM users WHERE id=?").get(owner.id);
  const artist = db.prepare("SELECT avatar_uri,banner FROM artist_profiles WHERE artist_key=?")
    .get("legacy profile worker artist");
  assert.equal(user.avatar_uri, recovered.publicUrl);
  assert.equal(artist.avatar_uri, recovered.publicUrl);
  assert.equal(user.banner, external);
  assert.equal(artist.banner, external);
  assert.deepEqual({ ...db.prepare("SELECT status,byte_size FROM media_objects WHERE object_key=?")
    .get(keyFor(sourceUrl)) }, { status: "delete_queued", byte_size: profileSourceBytes.length });
  assert.deepEqual(db.prepare(`SELECT accounting_class,COUNT(*) count
    FROM media_upload_issuances WHERE owner_id=? GROUP BY accounting_class ORDER BY accounting_class`)
    .all(owner.id).map((row) => ({ ...row })), [
    { accounting_class: "member_source", count: 1 },
    { accounting_class: "service_generated", count: 2 },
  ], "quota-exhausted recovery bypasses member limits while both generated objects stay globally accounted");
  assert.deepEqual(new Set(db.prepare(`SELECT storage_scope FROM media_objects
    WHERE owner_id=? AND object_key<>?`).all(owner.id, keyFor(sourceUrl)).map((row) => row.storage_scope)),
  new Set(["private", "public"]));
  assert.ok(storage.requests.filter((request) => request.method === "GET")
    .every((request) => /^"[a-f0-9]{64}"$/u.test(request.headers.get("if-match") || "")));
  assert.equal(legacyProfileImageRecoveryCandidates(db, { limit: 2 })
    .some((item) => item.sourceUrl === recovered.publicUrl), false,
  "a finalized profile derivative is not selected again");
});

test("aggregate drain alternates post and profile work and proves exhaustion", async () => {
  const owner = addUser("legacy_aggregate_worker_owner");
  const postUrl = legacyUrl(owner.id, "aggregate-post");
  const avatarUrl = legacyProfileUrl(owner.id, "avatar", "aggregate-avatar");
  addPost({ id: "p_legacy_aggregate_post", ownerId: owner.id, photos: [postUrl] });
  db.prepare("UPDATE users SET avatar_uri=? WHERE id=?").run(avatarUrl, owner.id);
  const storage = memoryStorage();
  storage.put("pit-public", keyFor(postUrl), Buffer.from("raw-aggregate-post-camera-image"));
  storage.put("pit-public", keyFor(avatarUrl), Buffer.from("raw-aggregate-profile-camera-image"));

  const capped = await drainLegacyImageRecovery(db, {
    maxItems: 1,
    fetchImpl: storage.fetchImpl,
    imageProcessor: fakeSanitizer,
  });
  assert.equal(capped.scanned, 1);
  assert.equal(capped.exhausted, false);
  assert.equal(capped.limitReached, true);

  const finished = await drainLegacyImageRecovery(db, {
    maxItems: 2,
    fetchImpl: storage.fetchImpl,
    imageProcessor: fakeSanitizer,
  });
  assert.equal(finished.failed.length, 0);
  assert.equal(finished.exhausted, true);
  assert.equal(finished.limitReached, false);
  assert.equal(finished.posts.recovered + capped.posts.recovered, 1);
  assert.equal(finished.profiles.recovered + capped.profiles.recovered, 1);
});
