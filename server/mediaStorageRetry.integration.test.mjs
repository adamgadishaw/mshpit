import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import sharp from "sharp";

import { ApiError } from "./errors.js";

const dataDir = mkdtempSync(join(tmpdir(), "pit-storage-retry-"));
process.env.PIT_DATA_DIR = dataDir;
Object.assign(process.env, {
  NODE_ENV: "test",
  MEDIA_ENDPOINT: "https://objects.example.com/s3",
  MEDIA_BUCKET: "pit-public",
  MEDIA_SOURCE_BUCKET: "pit-private",
  MEDIA_REGION: "auto",
  MEDIA_ACCESS_KEY_ID: "retry-test-access",
  MEDIA_SECRET_ACCESS_KEY: "retry-test-secret",
  MEDIA_PUBLIC_BASE_URL: "https://media.example.com/cdn",
});
const { db, q } = await import("./db.js");
const { hashPassword } = await import("./auth.js");
const { createMediaAsset, finalizeMediaAsset } = await import("./mediaAssets.js");
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

const etagFor = (bytes) => `"${createHash("sha256").update(bytes).digest("hex")}"`;
const lostConnection = () => new TypeError("fetch failed at private signed storage URL", {
  cause: Object.assign(new Error("private provider detail"), { code: "ECONNRESET" }),
});

function storageFixture() {
  const objects = new Map();
  const calls = [];
  let publicCreations = 0;
  const fetchImpl = async (url, options = {}) => {
    const parts = new URL(url).pathname.slice("/s3/".length).split("/").map(decodeURIComponent);
    const bucket = parts.shift();
    const key = `${bucket}/${parts.join("/")}`;
    const method = options.method;
    calls.push({ url, options, bucket, key });
    if (method === "PUT") {
      assert.equal(new Headers(options.headers).get("if-none-match"), "*");
      if (objects.has(key)) return { status: 412 };
      const bytes = Buffer.from(options.body);
      objects.set(key, { bytes, type: new Headers(options.headers).get("content-type"), etag: etagFor(bytes) });
      if (bucket === "pit-public") publicCreations += 1;
      return { status: 200 };
    }
    const object = objects.get(key);
    if (!object) return { status: 404 };
    const headers = new Headers({ "content-length": String(object.bytes.length), "content-type": object.type, etag: object.etag });
    if (method === "HEAD") return { status: 200, headers };
    assert.equal(method, "GET");
    if (new Headers(options.headers).get("if-match") !== object.etag) return { status: 412 };
    return new Response(object.bytes, { status: 200, headers });
  };
  return { objects, calls, fetchImpl, get publicCreations() { return publicCreations; } };
}

async function pendingPhoto(suffix) {
  const ownerId = `storage_retry_${suffix}`;
  q.insertUser.run(ownerId, `${ownerId}@example.com`, ownerId, ownerId, hashPassword("test-password"),
    "fan", "Toronto", 43.65, -79.38, "SR", "#123456", Date.now());
  const source = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#308020" } }).jpeg().toBuffer();
  const created = createMediaAsset(db, {
    ownerId, assetId: `ma_storage_retry_${suffix}`,
    body: { clientAssetId: `storage-retry-${suffix}`, purpose: "post", contentType: "image/jpeg", fileSize: source.length, name: "photo.jpg" },
  });
  const storage = storageFixture();
  storage.objects.set(`pit-private/${created.upload.key}`, { bytes: source, type: "image/jpeg", etag: etagFor(source) });
  return { ownerId, created, source, storage,
    options: { ownerId, assetId: created.asset.id, body: { deliveryMode: "server", editRecipe: {} } } };
}

function isPublic(url) { return new URL(url).pathname.includes("/pit-public/"); }

function interruptedResponse(response, bytes) {
  let reads = 0;
  return { status: response.status, headers: response.headers, body: {
    getReader: () => ({
      read: async () => ++reads === 1 ? { done: false, value: bytes.subarray(0, 10) } : Promise.reject(lostConnection()),
      releaseLock() {},
    }),
    cancel: async () => {},
  } };
}

test("real photo finalization survives transient HEAD and partial source/digest reads without a duplicate public write", async () => {
  const { storage, options, source } = await pendingPhoto("recovered");
  const failures = new Set();
  const retries = new Map();
  const fetchImpl = async (url, request) => {
    const stage = request.method === "HEAD" && !isPublic(url) ? "head"
      : request.method === "GET" ? isPublic(url) ? "digest" : "source" : null;
    if (stage) {
      const previous = retries.get(stage);
      if (previous) {
        assert.equal(url, previous.url);
        assert.equal(request.signal, previous.signal);
        assert.deepEqual(request.headers, previous.headers);
      } else retries.set(stage, { url, signal: request.signal, headers: request.headers });
    }
    const response = await storage.fetchImpl(url, request);
    if (stage && !failures.has(stage)) {
      failures.add(stage);
      if (stage === "head") return { status: 503 };
      // Release the ordinary fixture response; the injected read fails after
      // delivering a partial chunk, just as a dropped storage socket can.
      await response.body.cancel();
      return interruptedResponse(response, source);
    }
    return response;
  };
  const finalized = await finalizeMediaAsset(db, { ...options, fetchImpl });
  assert.equal(finalized.asset.status, "ready");
  assert.deepEqual([...failures].sort(), ["digest", "head", "source"]);
  assert.equal(storage.publicCreations, 1);
  assert.equal(storage.calls.filter((call) => call.options.method === "PUT").length, 1);
});

test("a storage generation changing between read attempts stays a conflict and never publishes", async () => {
  const { storage, options, source } = await pendingPhoto("changed");
  let reads = 0;
  const fetchImpl = async (url, request) => {
    const response = await storage.fetchImpl(url, request);
    if (request.method === "GET" && !isPublic(url)) {
      reads += 1;
      if (reads === 1) {
        await response.body.cancel();
        const object = [...storage.objects.values()][0];
        object.etag = '"replacement-generation"';
        return interruptedResponse(response, source);
      }
    }
    return response;
  };
  await assert.rejects(finalizeMediaAsset(db, { ...options, fetchImpl }), { status: 409, code: "CONFLICT" });
  assert.equal(reads, 2);
  assert.equal(storage.publicCreations, 0);
});

test("exhausted source reads produce finite diagnostics and keep the draft unpublished", async () => {
  const { storage, options } = await pendingPhoto("unavailable");
  let reads = 0;
  await assert.rejects(finalizeMediaAsset(db, { ...options, fetchImpl: async (url, request) => {
    if (request.method === "GET") { reads += 1; return { status: 503 }; }
    return storage.fetchImpl(url, request);
  } }), (error) => error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE"
    && error.cause?.code === "source_get_http_503");
  assert.equal(reads, 3);
  assert.equal(storage.publicCreations, 0);
  assert.equal(db.prepare("SELECT status FROM media_assets WHERE id=?").get(options.assetId).status, "upload_pending");
});

test("authority lost while a private read retries is rechecked before public publication", async () => {
  const { storage, options } = await pendingPhoto("authority");
  let authorized = true;
  let reads = 0;
  await assert.rejects(finalizeMediaAsset(db, {
    ...options,
    assertAuthorized: () => { if (!authorized) throw new ApiError(401, "Log in first.", "AUTH_REQUIRED"); },
    fetchImpl: async (url, request) => {
      if (request.method === "GET" && !isPublic(url) && ++reads === 1) {
        authorized = false;
        throw lostConnection();
      }
      return storage.fetchImpl(url, request);
    },
  }), { status: 401, code: "AUTH_REQUIRED" });
  assert.equal(reads, 2);
  assert.equal(storage.publicCreations, 0);
});

for (const corrupt of [false, true]) {
  test(`uncertain conditional PUT is never blindly retried; a later 412 ${corrupt ? "rejects mismatched bytes" : "reconciles only identical bytes"}`, async () => {
    const { storage, options } = await pendingPhoto(corrupt ? "corrupt" : "lost");
    let lost = false;
    const fetchImpl = async (url, request) => {
      const response = await storage.fetchImpl(url, request);
      if (request.method === "PUT" && !lost) { lost = true; throw lostConnection(); }
      return response;
    };
    await assert.rejects(finalizeMediaAsset(db, { ...options, fetchImpl }), (error) => error.status === 503
      && error.cause?.code === "photo_put_connection");
    assert.equal(storage.calls.filter((call) => call.options.method === "PUT").length, 1);
    assert.equal(storage.publicCreations, 1);
    const publicKey = [...storage.objects.keys()].find((key) => key.startsWith("pit-public/"));
    if (corrupt) {
      const object = storage.objects.get(publicKey);
      object.bytes[20] ^= 1;
      object.etag = etagFor(object.bytes);
      await assert.rejects(finalizeMediaAsset(db, { ...options, fetchImpl }), { status: 409, code: "CONFLICT" });
    } else {
      assert.equal((await finalizeMediaAsset(db, { ...options, fetchImpl })).asset.status, "ready");
    }
    assert.equal(storage.publicCreations, 1, "412 never overwrites the existing generation");
    const puts = storage.calls.filter((call) => call.options.method === "PUT");
    assert.equal(puts.length, 2, "only the explicit caller retry issues another conditional PUT");
    assert.equal(puts[0].key, puts[1].key);
  });
}
