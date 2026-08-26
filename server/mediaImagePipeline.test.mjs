import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import sharp from "sharp";

const dataDir = mkdtempSync(join(tmpdir(), "pit-image-pipeline-"));
process.env.PIT_DATA_DIR = dataDir;
Object.assign(process.env, {
  NODE_ENV: "test",
  MEDIA_ENDPOINT: "https://objects.example.com/s3",
  MEDIA_BUCKET: "pit-public",
  MEDIA_SOURCE_BUCKET: "pit-private",
  MEDIA_REGION: "auto",
  MEDIA_ACCESS_KEY_ID: "pipeline-access",
  MEDIA_SECRET_ACCESS_KEY: "pipeline-secret",
  MEDIA_PUBLIC_BASE_URL: "https://media.example.com/cdn",
});

const { db, q } = await import("./db.js");
const { hashPassword } = await import("./auth.js");
const {
  createMediaAsset,
  createMediaVariant,
  finalizeMediaAsset,
  finalizeMediaVariant,
} = await import("./mediaAssets.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id) {
  q.insertUser.run(id, `${id}@example.com`, id, id, hashPassword("pipeline-password"),
    "fan", "Toronto", 43.65, -79.38, "IP", "#123456", Date.now());
  return q.userById.get(id);
}

function memoryStorage() {
  const objects = new Map();
  const publicPuts = [];
  const location = (url) => {
    const parts = new URL(url).pathname.slice("/s3/".length).split("/").map(decodeURIComponent);
    return { bucket: parts.shift(), key: parts.join("/") };
  };
  const fetchImpl = async (url, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    const target = location(url);
    const identity = `${target.bucket}/${target.key}`;
    if (method === "PUT") {
      if (objects.has(identity)) return { status: 412, headers: new Headers() };
      const bytes = Buffer.from(options.body || []);
      const type = new Headers(options.headers || {}).get("content-type") || "application/octet-stream";
      const etag = `"${createHash("sha256").update(bytes).digest("hex")}"`;
      objects.set(identity, { bytes, type, etag });
      if (target.bucket === "pit-public") publicPuts.push(identity);
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
  return { objects, publicPuts, fetchImpl };
}

async function upload(ticket, bytes, fetchImpl) {
  const response = await fetchImpl(ticket.uploadUrl, {
    method: "PUT",
    headers: ticket.requiredHeaders,
    body: bytes,
  });
  assert.equal(response.status, 200);
}

async function draftPhoto({ owner, storage, token, assetId, source }) {
  const created = createMediaAsset(db, {
    ownerId: owner.id,
    body: {
      clientAssetId: `${token}-source`,
      purpose: "post",
      contentType: "image/jpeg",
      fileSize: source.length,
      name: "source.jpg",
    },
    assetId,
  });
  await upload(created.upload, source, storage.fetchImpl);
  await finalizeMediaAsset(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    body: { width: 40, height: 30, editRecipe: { kind: "image", filter: "pit" } },
    fetchImpl: storage.fetchImpl,
  });
  return created;
}

test("client-authored stable variants stay private and only a decoded metadata-free derivative can become ready", async () => {
  const owner = addUser("stable_image_trust_owner");
  const storage = memoryStorage();
  const source = await sharp({
    create: { width: 40, height: 30, channels: 3, background: "#901050" },
  }).jpeg().toBuffer();
  const created = await draftPhoto({
    owner,
    storage,
    token: "stable-image-trust",
    assetId: "ma_stableimagetrustboundary",
    source,
  });

  const authored = await sharp({
    create: { width: 30, height: 20, channels: 3, background: "#20a0d0" },
  }).jpeg().withExif({ IFD0: { Artist: "client-private-editor" } }).toBuffer();
  const variant = createMediaVariant(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    variantId: "mv_stableimagetrustboundary",
    body: {
      clientVariantId: "stable-image-trust-render",
      role: "render",
      contentType: "image/jpeg",
      fileSize: authored.length,
      name: "client-edit.jpg",
    },
  });
  assert.equal(variant.upload.storageScope, "private");
  assert.equal(variant.upload.publicUrl, null);
  assert.match(variant.upload.storageLocator, /^pit-private:/);
  await upload(variant.upload, authored, storage.fetchImpl);
  const finalized = await finalizeMediaVariant(db, {
    ownerId: owner.id,
    assetId: created.asset.id,
    variantId: variant.variant.id,
    body: { width: 30, height: 20 },
    fetchImpl: storage.fetchImpl,
  });
  assert.equal(finalized.asset.status, "ready");
  assert.equal(finalized.asset.url, finalized.variant.url);
  const publicRow = db.prepare("SELECT object_key,verification_origin FROM media_variants WHERE id=?").get(variant.variant.id);
  assert.notEqual(publicRow.object_key, variant.upload.key);
  assert.match(publicRow.object_key, /_safe_/);
  assert.equal(publicRow.verification_origin, "private_derivative_v1");
  const publicBytes = storage.objects.get(`pit-public/${publicRow.object_key}`).bytes;
  assert.notDeepEqual(publicBytes, authored);
  assert.equal(publicBytes.includes(Buffer.from("client-private-editor")), false);
  assert.equal((await sharp(publicBytes).metadata()).exif, undefined);
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(variant.upload.key).status,
    "delete_queued");

  const rejectedSource = await draftPhoto({
    owner,
    storage,
    token: "stable-image-reject",
    assetId: "ma_stableimagerejectpayload",
    source,
  });
  const trailingPayload = Buffer.concat([authored, Buffer.from("#!/bin/sh\ncalc.exe\n")]);
  const rejected = createMediaVariant(db, {
    ownerId: owner.id,
    assetId: rejectedSource.asset.id,
    variantId: "mv_stableimagerejectpayload",
    body: {
      clientVariantId: "stable-image-reject-render",
      role: "render",
      contentType: "image/jpeg",
      fileSize: trailingPayload.length,
      name: "polyglot.jpg",
    },
  });
  await upload(rejected.upload, trailingPayload, storage.fetchImpl);
  const publicCount = storage.publicPuts.length;
  await assert.rejects(
    finalizeMediaVariant(db, {
      ownerId: owner.id,
      assetId: rejectedSource.asset.id,
      variantId: rejected.variant.id,
      body: { width: 30, height: 20 },
      fetchImpl: storage.fetchImpl,
    }),
    (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
  );
  assert.equal(storage.publicPuts.length, publicCount,
    "invalid client bytes never receive a public object capability");
  assert.equal(db.prepare("SELECT status FROM media_assets WHERE id=?").get(rejectedSource.asset.id).status,
    "render_pending");
});
