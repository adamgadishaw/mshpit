import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { backupFileDigests, uploadPrivateBackup } from "./backupTransfer.js";

const ENV = {
  BACKUP_S3_ENDPOINT: "https://private.example.test/storage",
  BACKUP_S3_BUCKET: "pit-private-backups",
  BACKUP_S3_ACCESS_KEY_ID: "fixture-id",
  BACKUP_S3_SECRET_ACCESS_KEY: "fixture-secret",
  MEDIA_BUCKET: "pit-public-media",
};
const NAME = "pit-20260915-120000.db";
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "pit-backup-transfer-"));
  const path = join(directory, NAME);
  const data = Buffer.alloc(256 * 1024 + 37, 91);
  writeFileSync(path, data);
  return { path, data, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

function provider({ headStatus = 200, wrongSize = false, wrongHash = false, putStatus = 200, privacyAfter = false } = {}) {
  const calls = [];
  let headers;
  let uploaded = false;
  let uploadBytes = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, ...options });
    assert.equal(options.redirect, "manual");
    if (options.method === "PUT") {
      assert.equal(Buffer.isBuffer(options.body), false, "database is streamed, never retained as one buffer");
      assert.equal(options.duplex, "half");
      headers = options.headers;
      const digest = createHash("md5");
      for await (const chunk of options.body) {
        assert.ok(chunk.length <= 64 * 1024);
        uploadBytes += chunk.length;
        digest.update(chunk);
      }
      assert.equal(digest.digest("base64"), headers["Content-MD5"]);
      uploaded = putStatus === 200;
      return new Response(null, { status: putStatus });
    }
    if (options.method === "HEAD") return new Response(null, { status: headStatus, headers: {
      "content-length": String(wrongSize ? uploadBytes + 1 : uploadBytes),
      "x-amz-meta-sha256": wrongHash ? "0".repeat(64) : headers["x-amz-meta-sha256"],
    } });
    if (options.method === "DELETE") return new Response(null, { status: 204 });
    return new Response(null, { status: privacyAfter && uploaded ? 200 : 403 });
  };
  return { calls, fetchImpl };
}

test("backup hashes and upload are chunked; remote size and digest metadata must match", async () => {
  const f = fixture();
  try {
    const p = provider();
    const expected = createHash("sha256").update(f.data).digest("hex");
    const result = await uploadPrivateBackup(f.path, { env: ENV, fetchImpl: p.fetchImpl });
    assert.equal(result.sha256, expected);
    assert.equal(result.size, f.data.length);
    assert.deepEqual(p.calls.map((call) => call.method), ["GET", "GET", "PUT", "GET", "GET", "HEAD"]);
    const signedHeaders = new URL(p.calls.find((call) => call.method === "PUT").url).searchParams.get("X-Amz-SignedHeaders");
    assert.match(signedHeaders, /content-md5/);
    assert.match(signedHeaders, /x-amz-meta-sha256/);
  } finally { f.cleanup(); }
});

test("failed remote integrity or permission checks cannot produce upload success", async () => {
  const f = fixture();
  try {
    for (const options of [{ wrongSize: true }, { wrongHash: true }, { headStatus: 403 }]) {
      const p = provider(options);
      await assert.rejects(uploadPrivateBackup(f.path, { env: ENV, fetchImpl: p.fetchImpl }),
        (error) => /BACKUP_(REMOTE_MISMATCH|HEAD_HTTP_403)/.test(error.code));
    }
  } finally { f.cleanup(); }
});

test("upload redirects are rejected without forwarding database bytes", async () => {
  const f = fixture();
  try {
    const p = provider({ putStatus: 307 });
    await assert.rejects(uploadPrivateBackup(f.path, { env: ENV, fetchImpl: p.fetchImpl }), { code: "HTTP_307" });
    assert.equal(p.calls.some((call) => call.method === "HEAD"), false);
    assert.equal(p.calls.filter((call) => call.method === "PUT").length, 1);
  } finally { f.cleanup(); }
});

test("changed bucket privacy deletes only the exact newly uploaded object and refuses success", async () => {
  const f = fixture();
  try {
    const p = provider({ privacyAfter: true });
    await assert.rejects(uploadPrivateBackup(f.path, { env: ENV, fetchImpl: p.fetchImpl }), /privacy probe failed closed/);
    const removed = p.calls.find((call) => call.method === "DELETE");
    assert.equal(new URL(removed.url).pathname, `/storage/${ENV.BACKUP_S3_BUCKET}/db/${NAME}`);
    assert.equal(p.calls.some((call) => call.method === "HEAD"), false);
  } finally { f.cleanup(); }
});

test("public bucket preflight fails before reading a missing snapshot or sending account data", async () => {
  let calls = 0;
  await assert.rejects(uploadPrivateBackup("does-not-exist.db", {
    env: ENV, publishedName: NAME,
    fetchImpl: async (_url, options) => { calls++; assert.equal(options.method, "GET"); return new Response(null, { status: 200 }); },
  }), /privacy probe failed closed/);
  assert.equal(calls, 2);
});

test("backup file hash aborts and unsafe names/configuration fail without network", async () => {
  const f = fixture();
  try {
    await assert.rejects(backupFileDigests(f.path, { signal: AbortSignal.abort() }), { name: "AbortError" });
    for (const publishedName of ["../stolen.db", "pit.db", "https://other.test/backup"]) {
      await assert.rejects(uploadPrivateBackup(f.path, { env: ENV, publishedName }), { code: "BACKUP_CONFIG_INVALID" });
    }
  } finally { f.cleanup(); }
});

test("native fetch streams an actual local HTTP upload and verifies remote headers", async () => {
  const f = fixture();
  let storedSize = 0;
  let storedHash = "";
  let transportMd5 = "";
  const server = createServer(async (request, response) => {
    if (request.method === "PUT") {
      const md5 = createHash("md5");
      for await (const chunk of request) { storedSize += chunk.length; md5.update(chunk); }
      transportMd5 = md5.digest("base64");
      storedHash = String(request.headers["x-amz-meta-sha256"]);
      response.writeHead(transportMd5 === request.headers["content-md5"] ? 200 : 400);
    } else if (request.method === "HEAD") {
      response.writeHead(200, { "content-length": String(storedSize), "x-amz-meta-sha256": storedHash });
    } else response.writeHead(403);
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const local = `http://127.0.0.1:${server.address().port}`;
    const result = await uploadPrivateBackup(f.path, { env: ENV,
      fetchImpl: (url, options) => {
        const target = new URL(url);
        return fetch(`${local}${target.pathname}${target.search}`, options);
      },
    });
    assert.equal(result.size, f.data.length);
    assert.equal(transportMd5, createHash("md5").update(f.data).digest("base64"));
    assert.equal(result.sha256, createHash("sha256").update(f.data).digest("hex"));
  } finally {
    server.closeAllConnections();
    await new Promise((resolveClose) => server.close(resolveClose));
    f.cleanup();
  }
});
