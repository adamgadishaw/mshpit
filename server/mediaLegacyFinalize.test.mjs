import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";

import sharp from "sharp";

import { ApiError } from "./errors.js";

const dataDir = mkdtempSync(join(tmpdir(), "pit-legacy-media-finalize-"));
process.env.PIT_DATA_DIR = dataDir;
Object.assign(process.env, {
  NODE_ENV: "test",
  MEDIA_ENDPOINT: "https://objects.example.com/s3",
  MEDIA_BUCKET: "pit-public",
  MEDIA_SOURCE_BUCKET: "pit-private",
  MEDIA_REGION: "auto",
  MEDIA_ACCESS_KEY_ID: "legacy-access",
  MEDIA_SECRET_ACCESS_KEY: "legacy-secret",
  MEDIA_PUBLIC_BASE_URL: "https://media.example.com/cdn",
});

const { db, q } = await import("./db.js");
const { hashPassword } = await import("./auth.js");
const { routes } = await import("./api.js");
const {
  associateFinalizedLegacyMedia,
  createLegacyMediaUpload,
  finalizeLegacyMediaUpload,
  ensureLegacyMediaFinalizeSchema,
  isTerminalLegacyImageError,
  LEGACY_MEDIA_FINALIZE_TTL_MS,
  recoverProfileImageReference,
  verifiedFinalizedLegacyMedia,
} = await import("./mediaLegacyFinalize.js");
const { createMediaPresign } = await import("./media.js");
const {
  MEDIA_UPLOAD_TICKET_MS,
  reserveMediaUploadTicket,
  trustedOwnedMediaKey,
} = await import("./mediaDeletion.js");
const {
  sanitizePrivateImageStaging,
  stageSanitizedPublicImage,
} = await import("./mediaAssets.js");

test("artist slot provenance migration prefers one exact finalized uploader and never reruns", () => {
  const file = join(dataDir, "artist-slot-owner-migration.db");
  let database = new DatabaseSync(file);
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE artist_profiles (
      artist_key TEXT PRIMARY KEY,owner_id TEXT,avatar_uri TEXT,avatar_owner_id TEXT,
      banner TEXT,banner_owner_id TEXT,updated_at INTEGER
    );
    CREATE TABLE media_objects (
      object_key TEXT PRIMARY KEY,owner_id TEXT,storage_scope TEXT,purpose TEXT,status TEXT
    );
    CREATE TABLE legacy_media_finalize_descriptors (
      id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,status TEXT NOT NULL,expires_at INTEGER NOT NULL,
      output_url TEXT,output_object_key TEXT,purpose TEXT NOT NULL
    );
    INSERT INTO users VALUES ('claimant'),('staff-uploader');
    INSERT INTO artist_profiles
      (artist_key,owner_id,avatar_uri,avatar_owner_id,updated_at)
      VALUES ('seeded artist','claimant','https://media.example.com/seeded.webp','claimant',1);
    INSERT INTO media_objects VALUES
      ('users/staff-uploader/avatar/seeded.webp','staff-uploader','public','avatar','associated');
    INSERT INTO legacy_media_finalize_descriptors
      (id,owner_id,status,expires_at,output_url,output_object_key,purpose)
      VALUES ('lm_seededartistmigration0001','staff-uploader','finalized',9999999999999,
        'https://media.example.com/seeded.webp','users/staff-uploader/avatar/seeded.webp','avatar');
  `);
  ensureLegacyMediaFinalizeSchema(database);
  assert.deepEqual(
    database.prepare("PRAGMA index_info('idx_legacy_media_finalize_reconciliation')").all()
      .map((column) => column.name),
    ["output_url", "purpose", "status", "owner_id"],
  );
  assert.equal(database.prepare("SELECT avatar_owner_id FROM artist_profiles").get().avatar_owner_id,
    "staff-uploader", "the exact descriptor corrects the legacy claimant fallback");
  assert.equal(database.prepare("SELECT COUNT(*) count FROM legacy_media_finalize_migrations").get().count, 1);
  database.close();

  database = new DatabaseSync(file);
  database.prepare("UPDATE artist_profiles SET avatar_owner_id='claimant'").run();
  ensureLegacyMediaFinalizeSchema(database);
  assert.equal(database.prepare("SELECT avatar_owner_id FROM artist_profiles").get().avatar_owner_id,
    "claimant", "the durable marker prevents a later boot from rewriting explicit provenance");
  database.close();
});

test("finalized media purpose is selected in SQL when one URL has multiple descriptors", () => {
  const owner = addUser("legacy_finalize_duplicate_purpose");
  const objectKey = `users/${owner.id}/avatar/shared-output.webp`;
  const publicUrl = `https://media.example.com/cdn/${objectKey}`;
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at)
    VALUES (?,?,'public','avatar',1024,'issued',1,1)`).run(objectKey, owner.id);
  const insertDescriptor = db.prepare(`INSERT INTO legacy_media_finalize_descriptors
    (id,owner_id,token_hash,purpose,staging_object_key,staging_mime_type,staging_byte_size,
      output_mime_type,output_object_key,output_url,output_byte_size,width,height,status,expires_at,
      finalized_at,created_at,updated_at)
    VALUES (?,?,?,?,?,'image/jpeg',2048,'image/webp',?,?,1024,100,100,'finalized',9999999999999,?,?,?)`);
  insertDescriptor.run("lm_duplicatepurposebanner0001", owner.id, "a".repeat(64), "banner",
    `users/${owner.id}/banner/shared-staging.jpg`, objectKey, publicUrl, 1, 1, 1);
  insertDescriptor.run("lm_duplicatepurposeavatar0001", owner.id, "b".repeat(64), "avatar",
    `users/${owner.id}/avatar/shared-staging.jpg`, objectKey, publicUrl, 2, 2, 2);

  assert.equal(verifiedFinalizedLegacyMedia(db, {
    ownerId: owner.id,
    publicUrl,
    purpose: "banner",
  })?.descriptorId, "lm_duplicatepurposebanner0001");
  assert.equal(verifiedFinalizedLegacyMedia(db, {
    ownerId: owner.id,
    publicUrl,
    purpose: "avatar",
  })?.descriptorId, "lm_duplicatepurposeavatar0001");
  assert.equal(verifiedFinalizedLegacyMedia(db, {
    ownerId: owner.id,
    publicUrl,
    purpose: "review",
  }), null);
});

test("legacy finalize retires immutable image failures while keeping transient work resumable", () => {
  for (const [status, code] of [
    [400, "VALIDATION_FAILED"],
    [413, "MEDIA_TOO_LARGE"],
    [415, "MEDIA_TYPE_UNSUPPORTED"],
  ]) {
    assert.equal(isTerminalLegacyImageError(new ApiError(status, "terminal", code)), true);
  }
  assert.equal(isTerminalLegacyImageError(new ApiError(409, "changed", "CONFLICT")), false);
  assert.equal(isTerminalLegacyImageError(new ApiError(503, "retry", "MEDIA_STORAGE_UNAVAILABLE")), false);
  assert.equal(isTerminalLegacyImageError(new Error("unknown")), false);
});
after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id) {
  q.insertUser.run(id, `${id}@example.com`, id, id, hashPassword("legacy-media-password"),
    "fan", "Toronto", 43.65, -79.38, "LM", "#123456", Date.now());
  return q.userById.get(id);
}

function memoryObjectStorage() {
  const objects = new Map();
  const requests = [];
  const parsed = (url) => {
    const pathname = new URL(url).pathname;
    const prefix = "/s3/";
    const index = pathname.indexOf(prefix);
    const parts = pathname.slice(index + prefix.length).split("/").map(decodeURIComponent);
    return { bucket: parts.shift(), key: parts.join("/") };
  };
  const fetchImpl = async (url, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    const location = parsed(url);
    const identity = `${location.bucket}/${location.key}`;
    requests.push({ method, identity, options });
    if (method === "PUT") {
      if (objects.has(identity)) return { status: 412, headers: new Headers() };
      const bytes = Buffer.from(options.body || []);
      const type = new Headers(options.headers || {}).get("content-type") || "application/octet-stream";
      const etag = `"${createHash("sha256").update(bytes).digest("hex")}"`;
      objects.set(identity, { bytes, type, etag });
      return { status: 200, headers: new Headers({ etag }) };
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
  return { objects, requests, fetchImpl };
}

async function clientPut(ticket, bytes, fetchImpl) {
  const response = await fetchImpl(ticket.uploadUrl, {
    method: "PUT",
    headers: ticket.requiredHeaders,
    body: bytes,
  });
  assert.equal(response.status, 200);
}

async function stagedProfileDelivery({
  ownerId,
  purpose,
  identity,
  objectId,
  at,
  storage,
  legacySourceUrl,
  color = "#5b2c83",
}) {
  const source = await sharp({
    create: { width: 24, height: 18, channels: 3, background: color },
  }).jpeg().withExif({ IFD0: { Artist: `private-${identity}` } }).toBuffer();
  const upload = createMediaPresign({
    userId: ownerId,
    body: {
      purpose,
      contentType: "image/jpeg",
      fileSize: source.length,
      name: `${identity}.jpg`,
    },
    now: new Date(at),
    objectId,
    storageScope: "private",
  });
  reserveMediaUploadTicket(db, {
    ownerId,
    objectKey: upload.key,
    storageScope: "private",
    byteSize: source.length,
    at,
    expiresAt: at + MEDIA_UPLOAD_TICKET_MS,
  });
  await clientPut(upload, source, storage.fetchImpl);
  const { sanitized } = await sanitizePrivateImageStaging(db, {
    ownerId,
    objectKey: upload.key,
    expectedBytes: source.length,
    expectedType: "image/jpeg",
    outputType: "image/jpeg",
    fetchImpl: storage.fetchImpl,
  });
  const sourceEtag = `"legacy-${identity}-generation"`;
  const delivery = await stageSanitizedPublicImage(db, {
    ownerId,
    purpose,
    publicIdentity: identity,
    stagingKey: upload.key,
    sourceBinding: {
      objectKey: trustedOwnedMediaKey(legacySourceUrl, { ownerId }),
      etag: sourceEtag,
    },
    output: sanitized,
    at: at + 1,
    fetchImpl: storage.fetchImpl,
    serverRecovery: true,
  });
  return { delivery, source, sourceEtag, stagingKey: upload.key };
}

test("legacy photos use a one-time owner-bound private descriptor and publish only sanitized pixels", async () => {
  const owner = addUser("legacy_finalize_owner");
  const stranger = addUser("legacy_finalize_stranger");
  const storage = memoryObjectStorage();
  const source = await sharp({
    create: { width: 12, height: 9, channels: 3, background: "#d02070" },
  }).jpeg().withExif({
    IFD0: { Artist: "private-legacy-owner" },
    IFD3: { GPSLatitudeRef: "N", GPSLatitude: "43/1 39/1 0/1" },
  }).toBuffer();
  const created = createLegacyMediaUpload(db, {
    ownerId: owner.id,
    body: {
      purpose: "avatar",
      contentType: "image/jpeg",
      fileSize: source.length,
      name: "camera.jpg",
    },
    at: 1_000,
    descriptorId: "lm_aaaaaaaaaaaaaaaaaaaaaaaa",
    stagingObjectId: "ls_aaaaaaaaaaaaaaaaaaaaaaaa",
  });
  assert.equal(created.upload.storageScope, "private");
  assert.equal(created.upload.publicUrl, null);
  assert.equal(created.upload.storageLocator,
    `pit-private:${created.upload.key}`);
  const storedDescriptor = db.prepare("SELECT * FROM legacy_media_finalize_descriptors WHERE id=?")
    .get(created.descriptorId);
  assert.match(storedDescriptor.token_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(storedDescriptor.token_hash, created.finalizeToken);
  assert.equal(JSON.stringify(storedDescriptor).includes(created.finalizeToken.split(".")[1]), false,
    "only the token hash is persisted");

  await clientPut(created.upload, source, storage.fetchImpl);
  await assert.rejects(
    finalizeLegacyMediaUpload(db, {
      ownerId: stranger.id,
      finalizeToken: created.finalizeToken,
      at: 2_000,
      fetchImpl: storage.fetchImpl,
    }),
    (error) => error.status === 404 && error.code === "NOT_FOUND",
  );

  const finalized = await finalizeLegacyMediaUpload(db, {
    ownerId: owner.id,
    finalizeToken: created.finalizeToken,
    at: 2_000,
    fetchImpl: storage.fetchImpl,
  });
  assert.equal(finalized.status, "finalized");
  assert.equal(finalized.duplicate, false);
  assert.match(finalized.publicUrl, /^https:\/\/media\.example\.com\/cdn\//);
  assert.deepEqual([finalized.width, finalized.height], [1024, 1024]);
  assert.notEqual(finalized.key, created.upload.key);
  assert.match(finalized.key, /_safe_/);
  const publicObject = storage.objects.get(`pit-public/${finalized.key}`);
  assert.ok(publicObject);
  assert.equal(publicObject.bytes.includes(Buffer.from("private-legacy-owner")), false);
  const publicMetadata = await sharp(publicObject.bytes).metadata();
  assert.equal(publicMetadata.exif, undefined);
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(created.upload.key).status,
    "delete_queued");
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(finalized.key).status,
    "issued");

  const requestCount = storage.requests.length;
  const replay = await finalizeLegacyMediaUpload(db, {
    ownerId: owner.id,
    finalizeToken: created.finalizeToken,
    at: 3_000,
    fetchImpl: async () => { throw new Error("a consumed token must not touch storage again"); },
  });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.publicUrl, finalized.publicUrl);
  assert.equal(storage.requests.length, requestCount);

  assert.throws(
    () => associateFinalizedLegacyMedia(db, {
      ownerId: owner.id,
      publicUrl: finalized.publicUrl,
      purpose: "banner",
      at: 4_000,
    }),
    (error) => error.status === 400,
  );
  const associated = associateFinalizedLegacyMedia(db, {
    ownerId: owner.id,
    publicUrl: finalized.publicUrl,
    purpose: "avatar",
    at: 4_000,
  });
  assert.equal(associated.publicUrl, finalized.publicUrl);
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(finalized.key).status,
    "associated");
});

test("expired and malformed legacy descriptors fail closed and retire private staging", async () => {
  const owner = addUser("legacy_finalize_failures");
  const storage = memoryObjectStorage();
  const valid = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#101010" },
  }).jpeg().toBuffer();

  const expired = createLegacyMediaUpload(db, {
    ownerId: owner.id,
    body: { purpose: "banner", contentType: "image/jpeg", fileSize: valid.length, name: "expired.jpg" },
    at: 10_000,
    descriptorId: "lm_bbbbbbbbbbbbbbbbbbbbbbbb",
    stagingObjectId: "ls_bbbbbbbbbbbbbbbbbbbbbbbb",
  });
  await assert.rejects(
    finalizeLegacyMediaUpload(db, {
      ownerId: owner.id,
      finalizeToken: expired.finalizeToken,
      at: 10_000 + LEGACY_MEDIA_FINALIZE_TTL_MS,
      fetchImpl: storage.fetchImpl,
    }),
    (error) => error.status === 409 && error.code === "CONFLICT",
  );
  assert.equal(db.prepare("SELECT status FROM legacy_media_finalize_descriptors WHERE id=?")
    .get(expired.descriptorId).status, "expired");
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(expired.upload.key).status,
    "delete_queued");

  const scan = valid.indexOf(Buffer.from([0xff, 0xda]));
  const malformedBytes = Buffer.concat([valid.subarray(0, scan + 20), Buffer.from([0xff, 0xd9])]);
  const malformed = createLegacyMediaUpload(db, {
    ownerId: owner.id,
    body: {
      purpose: "review",
      contentType: "image/jpeg",
      fileSize: malformedBytes.length,
      name: "malformed.jpg",
    },
    at: 20_000,
    descriptorId: "lm_cccccccccccccccccccccccc",
    stagingObjectId: "ls_cccccccccccccccccccccccc",
  });
  await clientPut(malformed.upload, malformedBytes, storage.fetchImpl);
  await assert.rejects(
    finalizeLegacyMediaUpload(db, {
      ownerId: owner.id,
      finalizeToken: malformed.finalizeToken,
      at: 21_000,
      fetchImpl: storage.fetchImpl,
    }),
    (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
  );
  assert.equal(db.prepare("SELECT status FROM legacy_media_finalize_descriptors WHERE id=?")
    .get(malformed.descriptorId).status, "failed");
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(malformed.upload.key).status,
    "delete_queued");
});

test("legacy API route stages privately, finalizes, and gates profile association on the sanitized result", async () => {
  const unverifiedOwner = addUser("legacy_finalize_route_owner");
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), unverifiedOwner.id);
  const owner = q.userById.get(unverifiedOwner.id);
  const storage = memoryObjectStorage();
  const source = await sharp({
    create: { width: 18, height: 14, channels: 3, background: "#552299" },
  }).jpeg().withExif({ IFD0: { Artist: "route-private-metadata" } }).toBuffer();
  const ticket = routes["POST /api/media/presign"]({
    user: owner,
    ip: "legacy-finalize-route-presign",
    body: {
      purpose: "avatar",
      contentType: "image/jpeg",
      fileSize: source.length,
      name: "avatar-camera.jpg",
    },
  });
  assert.equal(ticket.storageScope, "private");
  assert.equal(ticket.publicUrl, null);
  await clientPut(ticket, source, storage.fetchImpl);

  const previousFetch = globalThis.fetch;
  globalThis.fetch = storage.fetchImpl;
  try {
    const finalized = await routes["POST /api/media/finalize"]({
      user: owner,
      ip: "legacy-finalize-route-finalize",
      body: { finalizeToken: ticket.finalizeToken },
      signal: new AbortController().signal,
    });
    assert.equal(finalized.descriptorId, ticket.descriptorId);
    assert.match(finalized.publicUrl, /^https:\/\/media\.example\.com\/cdn\//);
    assert.equal(storage.objects.get(`pit-public/${finalized.key}`).bytes
      .includes(Buffer.from("route-private-metadata")), false);

    const patched = routes["PATCH /api/me"]({
      user: owner,
      ip: "legacy-finalize-route-profile",
      body: { avatarUri: finalized.publicUrl },
    });
    assert.equal(patched.user.avatarUri, finalized.publicUrl);
    assert.equal(db.prepare("SELECT consumed_at FROM legacy_media_finalize_descriptors WHERE id=?")
      .get(ticket.descriptorId).consumed_at > 0, true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("profile recovery registers only attested sanitized derivatives and CAS-replaces exact owner references", async () => {
  const owner = addUser("legacy_profile_recovery_owner");
  const storage = memoryObjectStorage();
  const base = process.env.MEDIA_PUBLIC_BASE_URL;
  const oldAvatar = `${base}/users/${owner.id}/avatar/legacy-avatar.jpg`;
  const oldBanner = `${base}/users/${owner.id}/banner/legacy-banner.jpg`;
  db.prepare("UPDATE users SET avatar_uri=?,banner=? WHERE id=?")
    .run(oldAvatar, oldBanner, owner.id);
  db.prepare(`INSERT INTO artist_profiles (artist_key,owner_id,banner,feed_enabled,updated_at)
    VALUES (?,?,?,?,?)`).run("legacy recovery artist", owner.id, oldBanner, 1, 50_000);

  const avatar = await stagedProfileDelivery({
    ownerId: owner.id,
    purpose: "avatar",
    identity: "recoveryavatar01",
    objectId: "recovery_avatar_private",
    at: 51_000,
    storage,
    legacySourceUrl: oldAvatar,
  });
  assert.throws(
    () => recoverProfileImageReference(db, {
      ownerId: owner.id,
      reference: "user.avatar",
      expectedCurrentUrl: oldAvatar,
      sourceByteSize: avatar.source.length,
      sourceEtag: avatar.sourceEtag,
      delivery: { ...avatar.delivery },
      at: 52_000,
    }),
    (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
    "copying the public fields must not recreate the in-process sanitizer attestation",
  );
  assert.throws(
    () => recoverProfileImageReference(db, {
      ownerId: owner.id,
      reference: "user.avatar",
      expectedCurrentUrl: oldAvatar,
      sourceByteSize: avatar.source.length,
      sourceEtag: '"different-generation"',
      delivery: avatar.delivery,
      at: 52_000,
    }),
    (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
    "a sanitized delivery cannot be reused for a different source generation",
  );
  assert.throws(
    () => recoverProfileImageReference(db, {
      ownerId: owner.id,
      reference: "user.avatar",
      expectedCurrentUrl: "https://attacker.example/avatar.jpg",
      sourceByteSize: avatar.source.length,
      sourceEtag: avatar.sourceEtag,
      delivery: avatar.delivery,
      at: 52_000,
    }),
    (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
    "an arbitrary source URL cannot become recovery authority",
  );

  const recoveredAvatar = recoverProfileImageReference(db, {
    ownerId: owner.id,
    reference: "user.avatar",
    expectedCurrentUrl: oldAvatar,
    sourceByteSize: avatar.source.length,
    sourceEtag: avatar.sourceEtag,
    delivery: avatar.delivery,
    at: 52_000,
  });
  assert.equal(recoveredAvatar.publicUrl, avatar.delivery.publicUrl);
  assert.equal(recoveredAvatar.duplicate, false);
  assert.equal(db.prepare("SELECT avatar_uri FROM users WHERE id=?").get(owner.id).avatar_uri,
    avatar.delivery.publicUrl);
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(avatar.stagingKey).status,
    "delete_queued", "private recovery staging is retired in the same commit");
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(avatar.delivery.objectKey).status,
    "associated");
  const oldAvatarKey = trustedOwnedMediaKey(oldAvatar, { ownerId: owner.id });
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(oldAvatarKey).status,
    "delete_queued", "the now-unreferenced raw public profile photo is retired atomically");
  assert.equal(recoveredAvatar.sourceRetired, true);
  const avatarDescriptor = db.prepare("SELECT * FROM legacy_media_finalize_descriptors WHERE id=?")
    .get(recoveredAvatar.descriptorId);
  assert.equal(avatarDescriptor.status, "finalized");
  assert.equal(avatarDescriptor.purpose, "avatar");
  assert.equal(avatarDescriptor.output_object_key, avatar.delivery.objectKey);
  assert.equal(avatarDescriptor.consumed_at, 52_000);

  const avatarReplay = recoverProfileImageReference(db, {
    ownerId: owner.id,
    reference: "user.avatar",
    expectedCurrentUrl: oldAvatar,
    sourceByteSize: avatar.source.length,
    sourceEtag: avatar.sourceEtag,
    delivery: avatar.delivery,
    at: 53_000,
  });
  assert.equal(avatarReplay.duplicate, true);
  assert.equal(avatarReplay.descriptorId, recoveredAvatar.descriptorId);

  const banner = await stagedProfileDelivery({
    ownerId: owner.id,
    purpose: "banner",
    identity: "recoverybanner01",
    objectId: "recovery_banner_private",
    at: 54_000,
    storage,
    legacySourceUrl: oldBanner,
    color: "#aa4400",
  });
  const recoveredUserBanner = recoverProfileImageReference(db, {
    ownerId: owner.id,
    reference: "user.banner",
    expectedCurrentUrl: oldBanner,
    sourceByteSize: banner.source.length,
    sourceEtag: banner.sourceEtag,
    delivery: banner.delivery,
    at: 55_000,
  });
  const oldBannerKey = trustedOwnedMediaKey(oldBanner, { ownerId: owner.id });
  assert.equal(recoveredUserBanner.sourceRetired, false,
    "a raw object shared by another exact profile reference must stay live");
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(oldBannerKey).status,
    "associated");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_deletion_queue WHERE owner_id=? AND object_key=?")
    .get(owner.id, oldBannerKey).count, 0);
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(banner.stagingKey).status,
    "issued", "shared-source staging remains retryable until the last exact reference moves");
  const recoveredArtistBanner = recoverProfileImageReference(db, {
    ownerId: owner.id,
    reference: "artist_profile.banner",
    artistKey: "legacy recovery artist",
    expectedCurrentUrl: oldBanner,
    sourceByteSize: banner.source.length,
    sourceEtag: banner.sourceEtag,
    delivery: banner.delivery,
    at: 56_000,
  });
  assert.equal(recoveredArtistBanner.descriptorId, recoveredUserBanner.descriptorId,
    "one sanitized owner/purpose derivative can safely repair multiple exact references");
  assert.equal(db.prepare("SELECT banner FROM users WHERE id=?").get(owner.id).banner,
    banner.delivery.publicUrl);
  const artistProfile = db.prepare("SELECT banner,updated_at FROM artist_profiles WHERE artist_key=?")
    .get("legacy recovery artist");
  assert.equal(artistProfile.banner, banner.delivery.publicUrl);
  assert.equal(artistProfile.updated_at, 56_000);
  assert.equal(recoveredArtistBanner.sourceRetired, true);
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(oldBannerKey).status,
    "delete_queued", "the shared raw object is queued only after its last reference is swapped");
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(banner.stagingKey).status,
    "delete_queued");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM legacy_media_finalize_descriptors WHERE owner_id=? AND status='finalized'")
    .get(owner.id).count, 2);
});

test("profile recovery rolls back descriptor registration when the exact reference changed", async () => {
  const owner = addUser("legacy_profile_recovery_cas");
  const storage = memoryObjectStorage();
  const base = process.env.MEDIA_PUBLIC_BASE_URL;
  const expected = `${base}/users/${owner.id}/banner/original-banner.jpg`;
  const changed = `${base}/users/${owner.id}/banner/newer-banner.jpg`;
  db.prepare("UPDATE users SET banner=? WHERE id=?").run(expected, owner.id);
  const staged = await stagedProfileDelivery({
    ownerId: owner.id,
    purpose: "banner",
    identity: "recoverycasbanner",
    objectId: "recovery_cas_private",
    at: 61_000,
    storage,
    legacySourceUrl: expected,
  });
  db.prepare("UPDATE users SET banner=? WHERE id=?").run(changed, owner.id);

  assert.throws(
    () => recoverProfileImageReference(db, {
      ownerId: owner.id,
      reference: "user.banner",
      expectedCurrentUrl: expected,
      sourceByteSize: staged.source.length,
      sourceEtag: staged.sourceEtag,
      delivery: staged.delivery,
      at: 62_000,
    }),
    (error) => error.status === 409 && error.code === "CONFLICT",
  );
  assert.equal(db.prepare("SELECT banner FROM users WHERE id=?").get(owner.id).banner, changed);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM legacy_media_finalize_descriptors WHERE owner_id=? AND output_url=?")
    .get(owner.id, staged.delivery.publicUrl).count, 0,
  "the descriptor insert and reference swap share one transaction");
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(staged.delivery.objectKey).status,
    "issued");
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(staged.stagingKey).status,
    "issued");
});
