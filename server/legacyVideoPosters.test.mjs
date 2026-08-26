import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath } from "node:process";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-legacy-video-posters-"));
process.env.PIT_DATA_DIR = dataDir;
Object.assign(process.env, {
  MEDIA_ENDPOINT: "https://objects.example.com/s3",
  MEDIA_BUCKET: "pit-media",
  MEDIA_REGION: "auto",
  MEDIA_ACCESS_KEY_ID: "legacy-poster-access",
  MEDIA_SECRET_ACCESS_KEY: "legacy-poster-secret",
  MEDIA_PUBLIC_BASE_URL: "https://media.example.com/cdn",
});

const { db, q } = await import("./db.js");
const { hashPassword } = await import("./auth.js");
const { routes } = await import("./api.js");
const {
  legacyVideoPosterDescriptors,
  legacyVideoPosterDescriptorsByPost,
  reconcileLegacyVideoPosters,
  registerLegacyVideoPosterRelease,
  startLegacyVideoPosterVerificationScheduler,
  verifyLegacyVideoPosterBatch,
} = await import("./legacyVideoPosters.js");
const {
  LEGACY_VIDEO_POSTER_PUBLIC_BASE,
  LEGACY_VIDEO_POSTER_RELEASE,
  LEGACY_VIDEO_POSTER_RELEASE_ID,
} = await import("./legacyVideoPosterRelease.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id, role = "fan") {
  q.insertUser.run(id, `${id}@example.com`, id, id, hashPassword("legacy-poster-password"),
    role, "Toronto", 43.65, -79.38, "LP", "#123456", Date.now());
  return q.userById.get(id);
}

function addPost({ id, ownerId, photos, artist = "Archive Artist", createdAt = Date.now() }) {
  db.prepare(`INSERT INTO posts (id,user_id,artist,venue,overall,review,photos,photos_public,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(id, ownerId, artist, "Archive Room", 4, "Historical clip",
    JSON.stringify(photos), 1, createdAt);
}

function releaseEntry({
  postId = "p_legacy_video",
  ownerId = "u_legacy_owner",
  position = 0,
  suffix = "source",
} = {}) {
  const contentSha256 = `${suffix === "source" ? "a" : "b"}`.repeat(64);
  const sourceUrl = `https://media.example.com/cdn/users/${ownerId}/post/${suffix}.mp4`;
  const posterKey = `users/${ownerId}/post/legacy-${suffix}-${contentSha256.slice(0, 16)}.jpg`;
  return {
    postId,
    ownerId,
    position,
    sourceUrl,
    sourceByteSize: 2_000_000,
    sourceMimeType: "video/mp4",
    sourceEtag: '"11111111111111111111111111111111"',
    localFileName: `${suffix}.jpg`,
    posterKey,
    posterUrl: `https://media.example.com/cdn/${posterKey}`,
    byteSize: 40_000,
    width: 720,
    height: 1280,
    timeMs: 2_000,
    contentSha256,
    contentMd5: suffix === "source" ? "2".repeat(32) : "3".repeat(32),
  };
}

function posterHead(entry, overrides = {}) {
  return async () => ({
    status: overrides.status ?? 200,
    headers: new Headers({
      "content-length": String(overrides.byteSize ?? entry.byteSize),
      "content-type": overrides.contentType ?? "image/jpeg",
      etag: overrides.etag ?? `"${entry.contentMd5}"`,
    }),
  });
}

test("the default release requires the one-time production identity before any database or storage work", async () => {
  const before = {
    mappings: db.prepare("SELECT COUNT(*) count FROM legacy_video_posters").get().count,
    objects: db.prepare("SELECT COUNT(*) count FROM media_objects").get().count,
    queue: db.prepare("SELECT COUNT(*) count FROM media_deletion_queue").get().count,
  };
  const base = { ...process.env, MEDIA_PUBLIC_BASE_URL: LEGACY_VIDEO_POSTER_PUBLIC_BASE };
  delete base.PIT_LEGACY_VIDEO_POSTER_RELEASE;
  const staging = registerLegacyVideoPosterRelease(db, {
    env: {
      ...base,
      NODE_ENV: "production",
      PIT_ENV: "staging",
      PIT_LEGACY_VIDEO_POSTER_RELEASE: LEGACY_VIDEO_POSTER_RELEASE_ID,
    },
  });
  const local = registerLegacyVideoPosterRelease(db, {
    env: {
      ...base,
      NODE_ENV: "development",
      PIT_ENV: "production",
      PIT_LEGACY_VIDEO_POSTER_RELEASE: LEGACY_VIDEO_POSTER_RELEASE_ID,
    },
  });
  const foreign = registerLegacyVideoPosterRelease(db, {
    env: {
      ...base,
      NODE_ENV: "production",
      PIT_ENV: "foreign",
      PIT_LEGACY_VIDEO_POSTER_RELEASE: LEGACY_VIDEO_POSTER_RELEASE_ID,
    },
  });
  const missingRelease = registerLegacyVideoPosterRelease(db, {
    env: { ...base, NODE_ENV: "production", PIT_ENV: "production" },
  });
  const wrongRelease = registerLegacyVideoPosterRelease(db, {
    env: {
      ...base,
      NODE_ENV: "production",
      PIT_ENV: "production",
      PIT_LEGACY_VIDEO_POSTER_RELEASE: "wrong-release",
    },
  });
  assert.deepEqual(staging, { active: false, registered: 0, retained: 0, retired: 0 });
  assert.deepEqual(local, { active: false, registered: 0, retained: 0, retired: 0 });
  assert.deepEqual(foreign, { active: false, registered: 0, retained: 0, retired: 0 });
  assert.deepEqual(missingRelease, { active: false, registered: 0, retained: 0, retired: 0 });
  assert.deepEqual(wrongRelease, { active: false, registered: 0, retained: 0, retired: 0 });
  assert.deepEqual({
    mappings: db.prepare("SELECT COUNT(*) count FROM legacy_video_posters").get().count,
    objects: db.prepare("SELECT COUNT(*) count FROM media_objects").get().count,
    queue: db.prepare("SELECT COUNT(*) count FROM media_deletion_queue").get().count,
  }, before, "a foreign database cannot create a production ledger row or deletion job");

  let fetched = false;
  const verification = await verifyLegacyVideoPosterBatch(db, {
    env: { ...base, NODE_ENV: "production", PIT_ENV: "production" },
    fetchImpl: async () => { fetched = true; throw new Error("must not fetch"); },
  });
  assert.deepEqual(verification, { processed: 0, verified: 0, failed: 0, retrying: 0 });
  assert.equal(fetched, false);
  startLegacyVideoPosterVerificationScheduler({
    database: { prepare: () => { throw new Error("disabled scheduler touched the database"); } },
    env: { ...base, NODE_ENV: "production", PIT_ENV: "production" },
  }).stop();
});

test("the explicitly activated default release retires pre-published posters whose posts disappeared", () => {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    PIT_ENV: "production",
    MEDIA_PUBLIC_BASE_URL: LEGACY_VIDEO_POSTER_PUBLIC_BASE,
    PIT_LEGACY_VIDEO_POSTER_RELEASE: LEGACY_VIDEO_POSTER_RELEASE_ID,
  };
  const released = registerLegacyVideoPosterRelease(db, { env, at: 500 });
  assert.deepEqual(released, {
    active: true,
    registered: 0,
    retained: 0,
    retired: LEGACY_VIDEO_POSTER_RELEASE.length,
  });
  for (const entry of LEGACY_VIDEO_POSTER_RELEASE) {
    assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(entry.posterKey).status,
      "delete_queued");
    assert.ok(db.prepare("SELECT 1 FROM media_deletion_queue WHERE object_key=?").get(entry.posterKey));
  }
  assert.deepEqual(registerLegacyVideoPosterRelease(db, { env, at: 600 }), {
    active: true,
    registered: 0,
    retained: 0,
    retired: 0,
  }, "a second boot must not create duplicate deletion jobs");

  // Keep the remaining fixture counts independent. These rows represent only
  // the production objects simulated by this one test, not shared test media.
  for (const entry of LEGACY_VIDEO_POSTER_RELEASE) {
    db.prepare("DELETE FROM media_deletion_queue WHERE object_key=?").run(entry.posterKey);
    db.prepare("DELETE FROM media_objects WHERE object_key=?").run(entry.posterKey);
  }
});

test("an existing database from before the cleanup triggers gains them idempotently on boot", () => {
  const migrationDir = mkdtempSync(join(tmpdir(), "pit-legacy-poster-migration-"));
  const dbModule = new URL("./db.js", import.meta.url).href;
  const childEnv = {
    ...process.env,
    PIT_DATA_DIR: migrationDir,
    NODE_ENV: "test",
    PIT_ENV: "local",
  };
  const run = (source) => spawnSync(execPath, ["--input-type=module", "--eval", source], {
    cwd: process.cwd(),
    env: childEnv,
    encoding: "utf8",
  });
  try {
    const legacy = run(`
      const { db } = await import(${JSON.stringify(dbModule)});
      db.exec("DROP TRIGGER IF EXISTS trg_legacy_video_posters_post_update_cleanup");
      db.exec("DROP TRIGGER IF EXISTS trg_legacy_video_posters_post_delete_cleanup");
      db.exec("ALTER TABLE media_objects DROP COLUMN upload_expires_at");
      db.close();
    `);
    assert.equal(legacy.status, 0, legacy.stderr || legacy.stdout);

    const migrated = run(`
      const { db } = await import(${JSON.stringify(dbModule)});
      const names = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_legacy_video_posters_%' ORDER BY name").all().map((row) => row.name);
      const hasUploadExpiry = db.prepare("PRAGMA table_info(media_objects)").all().some((row) => row.name === "upload_expires_at");
      console.log(JSON.stringify({ names, hasUploadExpiry }));
      db.close();
    `);
    assert.equal(migrated.status, 0, migrated.stderr || migrated.stdout);
    const result = JSON.parse(migrated.stdout.trim().split(/\r?\n/u).at(-1));
    assert.deepEqual(result.names, [
      "trg_legacy_video_posters_post_delete_cleanup",
      "trg_legacy_video_posters_post_update_cleanup",
    ]);
    assert.equal(result.hasUploadExpiry, true, "later additive columns still migrate after trigger creation");
  } finally {
    rmSync(migrationDir, { recursive: true, force: true });
  }
});

test("unrelated posts and non-manifest sources return before preparing SQL", () => {
  const noSql = { prepare: () => { throw new Error("unrelated projection prepared SQL"); } };
  assert.deepEqual(legacyVideoPosterDescriptors(noSql, {
    postId: "p_not_in_the_release",
    photos: ["https://media.example.com/unrelated.jpg"],
  }), []);
  assert.equal(legacyVideoPosterDescriptorsByPost(noSql, ["p_not_in_the_release"]).size, 0);
  assert.deepEqual(legacyVideoPosterDescriptors(noSql, {
    postId: "p_e975198f-4de",
    photos: ["https://media.example.com/not-the-reviewed-source.mov"],
  }), [], "both the immutable post id and exact source URL are required");
});

test("an exact trusted release restores its verified owned clip without minting a stable asset id", async () => {
  const user = addUser("u_legacy_owner");
  const entry = releaseEntry();
  addPost({ id: entry.postId, ownerId: user.id, photos: [entry.sourceUrl] });

  const first = registerLegacyVideoPosterRelease(db, {
    entries: [entry], env: process.env, at: 1_000, allowNonProduction: true,
  });
  assert.deepEqual(first, { active: true, registered: 1, retained: 0, retired: 0 });
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(entry.posterKey).status, "associated");
  assert.deepEqual(legacyVideoPosterDescriptors(db, { postId: entry.postId, photos: [entry.sourceUrl] }), [],
    "a manifest claim alone never makes bytes public");

  const verified = await verifyLegacyVideoPosterBatch(db, {
    env: process.env,
    fetchImpl: posterHead(entry),
    at: 2_000,
    allowNonProduction: true,
  });
  assert.deepEqual(verified, { processed: 1, verified: 1, failed: 0, retrying: 0 });
  const [descriptor] = legacyVideoPosterDescriptors(db, { postId: entry.postId, photos: [entry.sourceUrl] });
  assert.deepEqual({
    kind: descriptor.kind,
    url: descriptor.url,
    sourceUrl: descriptor.sourceUrl,
    posterUrl: descriptor.posterUrl,
    posterTimeMs: descriptor.posterTimeMs,
  }, {
    kind: "video",
    url: entry.sourceUrl,
    sourceUrl: entry.sourceUrl,
    posterUrl: entry.posterUrl,
    posterTimeMs: 2_000,
  });

  const second = registerLegacyVideoPosterRelease(db, {
    entries: [entry], env: process.env, at: 3_000, allowNonProduction: true,
  });
  assert.deepEqual(second, { active: true, registered: 0, retained: 1, retired: 0 });
  assert.equal(db.prepare("SELECT status FROM legacy_video_posters WHERE post_id=?").get(entry.postId).status, "verified",
    "an idempotent release boot cannot demote a verified cover");

  const feed = routes["GET /api/feed"]({ query: {}, ip: "legacy-poster-feed" });
  const projected = feed.posts.find((post) => post.id === entry.postId);
  assert.deepEqual(projected.photos, [entry.sourceUrl],
    "the immutable release restores only its exact owned source slot");
  assert.deepEqual(projected.media, [descriptor]);
  assert.deepEqual(projected.mediaAssetIds, [], "a release-only cover cannot masquerade as a stable composer asset");
  const gallery = routes["GET /api/artists/photos"]({
    user,
    query: { name: "Archive Artist" },
    ip: "legacy-poster-gallery",
  });
  const galleryItem = gallery.photos.find((item) => item.postId === entry.postId);
  assert.deepEqual({
    uri: galleryItem?.uri,
    kind: galleryItem?.kind,
    posterUrl: galleryItem?.posterUrl,
    posterTimeMs: galleryItem?.posterTimeMs,
  }, {
    uri: entry.sourceUrl,
    kind: "video",
    posterUrl: entry.posterUrl,
    posterTimeMs: entry.timeMs,
  }, "artist galleries project the same exact verified release descriptor");
});

test("wrong poster bytes fail closed and enter the owned deletion queue", async () => {
  const user = addUser("u_legacy_bad");
  const entry = releaseEntry({ postId: "p_legacy_bad", ownerId: user.id, suffix: "bad" });
  addPost({ id: entry.postId, ownerId: user.id, photos: [entry.sourceUrl] });
  registerLegacyVideoPosterRelease(db, {
    entries: [entry], env: process.env, at: 10_000, allowNonProduction: true,
  });

  const failed = await verifyLegacyVideoPosterBatch(db, {
    env: process.env,
    fetchImpl: posterHead(entry, { etag: '"ffffffffffffffffffffffffffffffff"' }),
    at: 11_000,
    allowNonProduction: true,
  });
  assert.deepEqual(failed, { processed: 1, verified: 0, failed: 1, retrying: 0 });
  assert.equal(db.prepare("SELECT status,last_error_code FROM legacy_video_posters WHERE post_id=?")
    .get(entry.postId).status, "failed");
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(entry.posterKey).status, "delete_queued");
  assert.ok(db.prepare("SELECT 1 FROM media_deletion_queue WHERE object_key=?").get(entry.posterKey));
  assert.deepEqual(legacyVideoPosterDescriptors(db, { postId: entry.postId, photos: [entry.sourceUrl] }), []);
});

test("concurrent verifiers consume one retry for one transient storage failure", async () => {
  const user = addUser("u_legacy_race");
  const entry = releaseEntry({ postId: "p_legacy_race", ownerId: user.id, suffix: "race" });
  addPost({ id: entry.postId, ownerId: user.id, photos: [entry.sourceUrl] });
  registerLegacyVideoPosterRelease(db, {
    entries: [entry], env: process.env, at: 15_000, allowNonProduction: true,
  });
  let fetches = 0;
  const outcomes = await Promise.all(Array.from({ length: 5 }, () => verifyLegacyVideoPosterBatch(db, {
    env: process.env,
    at: 16_000,
    allowNonProduction: true,
    fetchImpl: async () => {
      fetches += 1;
      await Promise.resolve();
      throw new Error("transient object-store outage");
    },
  })));
  assert.equal(fetches, 1, "only the worker holding the compare-and-swap lease may issue HEAD");
  assert.equal(outcomes.reduce((sum, value) => sum + value.processed, 0), 1);
  assert.equal(outcomes.reduce((sum, value) => sum + value.retrying, 0), 1);
  const row = db.prepare(`SELECT status,attempts,next_attempt_at
    FROM legacy_video_posters WHERE post_id=? AND media_url=?`).get(entry.postId, entry.sourceUrl);
  assert.deepEqual({ ...row }, { status: "retry", attempts: 1, next_attempt_at: 76_000 });
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(entry.posterKey).status, "associated");
  assert.equal(db.prepare("SELECT 1 FROM media_deletion_queue WHERE object_key=?").get(entry.posterKey), undefined);
});

test("author removal retires the derivative while leaving unrelated covers alone", async () => {
  const user = addUser("u_legacy_delete");
  const first = releaseEntry({ postId: "p_legacy_delete", ownerId: user.id, suffix: "one", position: 0 });
  const second = releaseEntry({ postId: "p_legacy_delete", ownerId: user.id, suffix: "two", position: 1 });
  const imageOne = "https://images.example.com/legacy-one.jpg";
  const imageTwo = "https://images.example.com/legacy-two.jpg";
  const canonicalPhotos = [imageOne, second.sourceUrl, imageTwo, first.sourceUrl];
  addPost({ id: first.postId, ownerId: user.id, photos: canonicalPhotos });
  registerLegacyVideoPosterRelease(db, {
    entries: [first, second], env: process.env, at: 20_000, allowNonProduction: true,
  });
  await verifyLegacyVideoPosterBatch(db, {
    env: process.env,
    fetchImpl: async (url) => posterHead(String(url).includes(first.posterKey) ? first : second)(),
    at: 21_000,
    allowNonProduction: true,
  });

  const verifiedDescriptors = legacyVideoPosterDescriptors(db, {
    postId: first.postId,
    photos: canonicalPhotos,
  });
  assert.deepEqual(
    verifiedDescriptors.map((item) => item.url),
    [second.sourceUrl, first.sourceUrl],
    "partial video enrichment follows canonical photo order without inventing image descriptors",
  );
  const projected = routes["GET /api/feed"]({ query: {}, ip: "legacy-multi-photo-feed" }).posts
    .find((post) => post.id === first.postId);
  assert.deepEqual(projected.photos, [second.sourceUrl, first.sourceUrl]);
  assert.deepEqual(projected.media, verifiedDescriptors);
  assert.deepEqual(projected.mediaAssetIds, [], "release-only descriptors never become composer asset ids");

  const retainedPhotos = canonicalPhotos.filter((url) => url !== first.sourceUrl);
  const edited = routes["PATCH /api/posts/:id"]({
    user,
    params: { id: first.postId },
    body: { photos: retainedPhotos },
    ip: "legacy-poster-author-edit",
    requestId: "legacy-poster-author-edit",
  });
  assert.deepEqual(edited.post.photos, [second.sourceUrl],
    "the exact retained release clip stays visible while unrelated unverified URLs remain hidden");
  assert.deepEqual(edited.post.media.map((item) => ({
    kind: item.kind,
    url: item.url,
    posterUrl: item.posterUrl,
  })), [{
    kind: "video",
    url: second.sourceUrl,
    posterUrl: second.posterUrl,
  }]);
  assert.deepEqual(edited.post.mediaAssetIds, []);
  assert.equal(db.prepare("SELECT 1 FROM legacy_video_posters WHERE media_url=?").get(first.sourceUrl), undefined);
  assert.ok(db.prepare("SELECT 1 FROM legacy_video_posters WHERE media_url=?").get(second.sourceUrl));
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(first.posterKey).status, "delete_queued");
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(second.posterKey).status, "associated");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_deletion_queue WHERE object_key=?")
    .get(first.posterKey).count, 1, "the trigger and current edit route share one idempotent deletion job");

  routes["DELETE /api/posts/:id"]({
    user,
    params: { id: first.postId },
    ip: "legacy-poster-author-delete",
    requestId: "legacy-poster-author-delete",
  });
  assert.equal(db.prepare("SELECT COUNT(*) count FROM legacy_video_posters WHERE post_id=?").get(first.postId).count, 0);
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(second.posterKey).status, "delete_queued");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_deletion_queue WHERE object_key=?")
    .get(second.posterKey).count, 1, "soft deletion cannot double-enqueue a poster");
});

test("an absent exact attachment cannot authorize a ledger or storage deletion", () => {
  const user = addUser("u_legacy_orphan");
  const entry = releaseEntry({ postId: "p_legacy_orphan", ownerId: user.id, suffix: "orphan" });
  const result = registerLegacyVideoPosterRelease(db, {
    entries: [entry], env: process.env, at: 30_000, allowNonProduction: true,
  });
  assert.deepEqual(result, { active: true, registered: 0, retained: 0, retired: 0 });
  assert.equal(db.prepare("SELECT 1 FROM legacy_video_posters WHERE post_id=?").get(entry.postId), undefined);
  assert.equal(db.prepare("SELECT 1 FROM media_objects WHERE object_key=?").get(entry.posterKey), undefined);
  assert.equal(db.prepare("SELECT 1 FROM media_deletion_queue WHERE object_key=?").get(entry.posterKey), undefined);
});

test("moderation removes the legacy cover in the same transaction as its post media", async () => {
  const owner = addUser("u_legacy_moderated");
  const moderator = addUser("u_legacy_moderator", "moderator");
  const entry = releaseEntry({ postId: "p_legacy_moderated", ownerId: owner.id, suffix: "moderated" });
  addPost({ id: entry.postId, ownerId: owner.id, photos: [entry.sourceUrl] });
  registerLegacyVideoPosterRelease(db, {
    entries: [entry], env: process.env, at: 40_000, allowNonProduction: true,
  });
  await verifyLegacyVideoPosterBatch(db, {
    env: process.env,
    fetchImpl: posterHead(entry),
    at: 41_000,
    allowNonProduction: true,
  });

  const result = routes["POST /api/admin/moderation/actions"]({
    user: moderator,
    ip: "legacy-poster-moderation",
    requestId: "legacy-poster-moderation",
    body: {
      action: "remove",
      targetType: "post",
      targetId: entry.postId,
      reason: "unsafe clip",
    },
  });
  assert.equal(result.removed, true);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM legacy_video_posters WHERE post_id=?").get(entry.postId).count, 0);
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(entry.posterKey).status, "delete_queued");
  assert.ok(db.prepare("SELECT 1 FROM media_deletion_queue WHERE object_key=?").get(entry.posterKey));
});

test("the database trigger protects edits made by an older rolling worker", async () => {
  const owner = addUser("u_legacy_old_worker");
  const entry = releaseEntry({ postId: "p_legacy_old_worker", ownerId: owner.id, suffix: "old-worker" });
  const image = "https://images.example.com/old-worker.jpg";
  addPost({ id: entry.postId, ownerId: owner.id, photos: [image, entry.sourceUrl] });
  registerLegacyVideoPosterRelease(db, {
    entries: [entry], env: process.env, at: 50_000, allowNonProduction: true,
  });
  await verifyLegacyVideoPosterBatch(db, {
    env: process.env,
    fetchImpl: posterHead(entry),
    at: 51_000,
    allowNonProduction: true,
  });

  db.prepare("UPDATE posts SET photos=? WHERE id=?").run(JSON.stringify([entry.sourceUrl, image]), entry.postId);
  assert.equal(db.prepare("SELECT position FROM legacy_video_posters WHERE post_id=?").get(entry.postId).position, 0,
    "a URL retained by an old edit gets its canonical position refreshed");

  db.prepare("UPDATE posts SET photos=? WHERE id=?").run(JSON.stringify([image]), entry.postId);
  assert.equal(db.prepare("SELECT 1 FROM legacy_video_posters WHERE post_id=?").get(entry.postId), undefined);
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(entry.posterKey).status, "delete_queued");
  assert.ok(db.prepare("SELECT 1 FROM media_deletion_queue WHERE object_key=?").get(entry.posterKey));
});

test("periodic reconciliation retires a stale verified mapping even without the update trigger", async () => {
  const owner = addUser("u_legacy_reconcile");
  const entry = releaseEntry({ postId: "p_legacy_reconcile", ownerId: owner.id, suffix: "reconcile" });
  addPost({ id: entry.postId, ownerId: owner.id, photos: [entry.sourceUrl] });
  registerLegacyVideoPosterRelease(db, {
    entries: [entry], env: process.env, at: 60_000, allowNonProduction: true,
  });
  await verifyLegacyVideoPosterBatch(db, {
    env: process.env,
    fetchImpl: posterHead(entry),
    at: 61_000,
    allowNonProduction: true,
  });

  // Simulate a process/database predating this release's durable trigger. The
  // scheduler's bounded sweep is an independent rolling-deploy backstop.
  db.exec("DROP TRIGGER trg_legacy_video_posters_post_update_cleanup");
  db.prepare("UPDATE posts SET photos='[]' WHERE id=?").run(entry.postId);
  assert.ok(db.prepare("SELECT 1 FROM legacy_video_posters WHERE post_id=?").get(entry.postId));
  const reconciled = reconcileLegacyVideoPosters(db, { at: 62_000 });
  assert.ok(reconciled.checked >= 1);
  assert.equal(reconciled.retired, 1);
  assert.equal(reconciled.repositioned, 0);
  assert.equal(db.prepare("SELECT 1 FROM legacy_video_posters WHERE post_id=?").get(entry.postId), undefined);
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(entry.posterKey).status, "delete_queued");
  assert.ok(db.prepare("SELECT 1 FROM media_deletion_queue WHERE object_key=?").get(entry.posterKey));
});
