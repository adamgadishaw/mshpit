import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import sharp from "sharp";

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
  LEGACY_MEDIA_FINALIZE_TTL_MS,
} = await import("./mediaLegacyFinalize.js");

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
    (error) => error.status === 415 && error.code === "MEDIA_TYPE_UNSUPPORTED",
  );
  assert.equal(db.prepare("SELECT status FROM legacy_media_finalize_descriptors WHERE id=?")
    .get(malformed.descriptorId).status, "failed");
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(malformed.upload.key).status,
    "delete_queued");
});

test("legacy API route stages privately, finalizes, and gates profile association on the sanitized result", async () => {
  const owner = addUser("legacy_finalize_route_owner");
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
