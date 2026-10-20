// Test-only transport/seed fixture for the real server/index.js listener.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";
import sharp from "sharp";

const directory = resolve(process.env.PIT_DATA_DIR || ".");
assert.equal(process.env.PIT_RECOVERY_HTTP_FIXTURE, "1");
assert.equal(dirname(directory), resolve(tmpdir()));
assert.ok(basename(directory).startsWith("pit-durability-http-"));
assert.equal(process.env.NODE_ENV, "test");
assert.equal(typeof process.send, "function");
const counts = { blocked: 0, sourceHeads: 0, verifications: 0, posterPuts: 0 };
const denied = () => { counts.blocked++; throw new Error("Recovery fixture forbids outbound network"); };
http.request = denied; http.get = denied; https.request = denied; https.get = denied;
net.connect = denied; net.createConnection = denied; tls.connect = denied;
net.Socket.prototype.connect = denied;
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function fixtureListen(port) {
  assert.equal(arguments.length, 1);
  assert.equal(port, Number(process.env.PORT));
  this.once("listening", () => process.send({ kind: "listener", address: this.address().address }));
  return listen.call(this, { port, host: "127.0.0.1" });
};
syncBuiltinESMExports();

const {
  signVideoVerifierResponse, verifyVideoVerifierRequest, VIDEO_VERIFIER_PROTOCOL_VERSION,
  VIDEO_VERIFIER_PIPELINE_VERSION, VIDEO_VERIFIER_SOURCE_ADMISSION_REVISION,
  VIDEO_VERIFIER_UNIVERSAL_ADMISSION, VIDEO_VERIFIER_UNIVERSAL_SOURCE_TYPES,
} = await import("../../server/videoVerifierProtocol.js");
const secret = process.env.PIT_VIDEO_VERIFIER_SECRET;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const poster = await sharp({ create: { width: 32, height: 18, channels: 3, background: "#345678" } }).jpeg().toBuffer();
// Deliberately synthetic decoder output: this proves transport/persistence
// handling, not that ffmpeg can decode or transcode these bytes.
const delivery = Buffer.alloc(1024, 7);
const objects = new Map();
let releaseStorage;
const storageGate = new Promise(done => { releaseStorage = done; });
if (process.env.PIT_RECOVERY_HTTP_PHASE === "finished") releaseStorage();

globalThis.fetch = async (input, request = {}) => {
  const url = new URL(input);
  if (url.hostname === "pit-video-verifier" && ["/v2/health", "/v2/verify"].includes(url.pathname)) {
    const authenticated = verifyVideoVerifierRequest({ secret, path: url.pathname, body: request.body, headers: request.headers });
    let payload = {
      ok: true, protocol: VIDEO_VERIFIER_PROTOCOL_VERSION, pipeline: VIDEO_VERIFIER_PIPELINE_VERSION,
      sourceAdmissionRevision: VIDEO_VERIFIER_SOURCE_ADMISSION_REVISION,
      decoder: { ffmpeg: true, ffprobe: true, version: "synthetic recovery fixture" },
      poster: { generated: true, decoded: true }, storage: { privateInput: true, sanitizedOutput: true },
      sourceTypes: ["video/mp4", "video/quicktime"],
      sourceCodecs: { "video/mp4": ["h264", "hevc"], "video/quicktime": ["h264", "hevc"] },
      universalAdmission: VIDEO_VERIFIER_UNIVERSAL_ADMISSION,
      universalSourceTypes: [...VIDEO_VERIFIER_UNIVERSAL_SOURCE_TYPES], concurrency: 1,
    };
    if (url.pathname === "/v2/verify") {
      counts.verifications++;
      const job = authenticated.payload;
      assert.equal(job.admission, VIDEO_VERIFIER_UNIVERSAL_ADMISSION);
      objects.set(`/s3/pit-media/${job.output.key}`, { bytes: delivery, type: "video/mp4" });
      payload = {
        ok: true, protocol: VIDEO_VERIFIER_PROTOCOL_VERSION, pipeline: VIDEO_VERIFIER_PIPELINE_VERSION,
        object: { key: job.object.key, byteSize: job.object.byteSize, contentType: job.object.contentType, etag: job.object.etag },
        video: { codec: "vp9", audioCodec: "opus", rotation: 0, width: 1280, height: 720,
          codedWidth: 1280, codedHeight: 720, durationMs: 1000 },
        delivery: { key: job.output.key, contentType: "video/mp4", byteSize: delivery.length, sha256: digest(delivery),
          width: 1280, height: 720, durationMs: 1000, rotation: 0, codec: "h264", audioCodec: "aac", uploadStatus: "created" },
        poster: { contentType: "image/jpeg", byteSize: poster.length, width: 32, height: 18,
          timeMs: job.poster.timeMs, sha256: digest(poster), dataBase64: poster.toString("base64") },
      };
    }
    const signed = signVideoVerifierResponse({ secret, path: url.pathname, requestNonce: authenticated.nonce, payload });
    return new Response(signed.body, { status: 200, headers: signed.headers });
  }
  if (url.hostname === "objects.example.test") {
    const path = decodeURIComponent(url.pathname);
    if (path.startsWith("/s3/pit-media-private/users/") && request.method === "HEAD") {
      counts.sourceHeads++;
      await storageGate;
      request.signal?.throwIfAborted();
      return new Response(null, { status: 200, headers: {
        "content-type": "video/webm", "content-length": "2048", etag: '"synthetic-source-generation"',
      } });
    }
    if (path.startsWith("/s3/pit-media/users/")) {
      if (request.method === "PUT") {
        counts.posterPuts++;
        objects.set(path, { bytes: Buffer.from(request.body), type: "image/jpeg" });
        return new Response(null, { status: 200 });
      }
      const object = objects.get(path);
      if (!object) return new Response(null, { status: 404 });
      const etag = `"${digest(object.bytes)}"`;
      const headers = { "content-type": object.type, "content-length": String(object.bytes.length), etag };
      if (request.method === "HEAD") return new Response(null, { status: 200, headers });
      assert.equal(request.method || "GET", "GET");
      assert.equal(new Headers(request.headers).get("if-match"), etag);
      return new Response(object.bytes, { status: 200, headers });
    }
    return new Response(null, { status: 403 }); // Anonymous bucket isolation probes.
  }
  return denied();
};

const { db, q } = await import("../../server/db.js");
const { createSession, COOKIE } = await import("../../server/auth.js");
const { LEGAL_ACCEPTANCE_VERSION } = await import("../../src/domain/privacyDisclosures.mjs");
const owner = "http_recovery_owner";
let cookie = null;
if (!q.userById.get(owner)) {
  q.insertUser.run(owner, "recovery@example.test", "HTTP Recovery", owner, "unused-fixture-hash",
    "fan", "Toronto", 43.65, -79.38, "HR", "#345678", Date.now());
  db.prepare("UPDATE users SET email_verified_at=?,onboarding_version=1,age_band='18_plus',extras=? WHERE id=?")
    .run(Date.now(), JSON.stringify({ termsAcceptedAt: Date.now(), termsVersion: LEGAL_ACCEPTANCE_VERSION }), owner);
  cookie = `${COOKIE}=${createSession(owner).token}`;
}
const { refreshVideoVerifierHealth } = await import("../../server/videoVerifier.js");
await refreshVideoVerifierHealth({ env: process.env });
process.on("message", message => {
  if (message.kind === "release-storage") releaseStorage();
  if (message.kind === "snapshot") process.send({
    kind: "snapshot", requestId: message.requestId, counts,
    jobs: db.prepare("SELECT asset_id,state,attempts FROM media_processing_jobs WHERE owner_id=?").all(owner),
    assets: db.prepare("SELECT id,status,render_variant_id,poster_variant_id FROM media_assets WHERE owner_id=?").all(owner),
    variants: db.prepare("SELECT id,role,status FROM media_variants WHERE asset_id IN (SELECT id FROM media_assets WHERE owner_id=?) ORDER BY role").all(owner),
    posts: db.prepare("SELECT id,client_mutation_id FROM posts WHERE user_id=?").all(owner),
    receipts: db.prepare("SELECT post_id,state FROM post_create_receipts WHERE user_id=?").all(owner),
    links: db.prepare("SELECT post_id,asset_id FROM post_media WHERE post_id IN (SELECT id FROM posts WHERE user_id=?)").all(owner),
    foreignKeys: db.prepare("PRAGMA foreign_key_check").all(),
  });
});
process.send({ kind: "fixture", owner, cookie });
