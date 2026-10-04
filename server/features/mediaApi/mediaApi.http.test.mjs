import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DATA_DIR = mkdtempSync(join(tmpdir(), "pit-media-api-real-"));
const NOW = Date.parse("2026-10-01T12:00:00Z");
const ENV = {
  ...process.env,
  NODE_ENV: "test",
  PIT_ENV: "production",
  PIT_DATA_DIR: DATA_DIR,
  PIT_ALLOW_EMPTY_DB_BOOTSTRAP: "false",
  PIT_MEDIA_API_ENABLED: "true",
  MEDIA_ENDPOINT: "https://objects.example.com/s3",
  MEDIA_BUCKET: "pit-media",
  MEDIA_SOURCE_BUCKET: "pit-media-private",
  MEDIA_REGION: "auto",
  MEDIA_ACCESS_KEY_ID: "synthetic-test-access",
  MEDIA_SECRET_ACCESS_KEY: "synthetic-test-secret",
  MEDIA_PUBLIC_BASE_URL: "https://media.example.com/cdn",
  NEWS_DESK_ACCOUNT_ID: "media_http_publisher",
};
for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "RESEND_API_KEY"]) delete ENV[key];
Object.assign(process.env, ENV);

const { db, q } = await import("../../db.js");
const { createMediaApiService } = await import("./mediaApiService.js");
const { createNewsDeskEditor } = await import("../newsDesk/newsDeskEditor.js");
const { finalizeMediaAsset } = await import("../../mediaAssets.js");
const { inspectImageBytes } = await import("../../imageInspection.js");
const { ApiError } = await import("../../errors.js");

after(() => {
  db.close();
  rmSync(DATA_DIR, { recursive: true, force: true });
});

let clock = NOW;
let ownerCounter = 0;
function user(id, role) {
  q.insertUser.run(id, `${id}@example.test`, id, id, "synthetic-unused-hash", role, "Toronto", 43.65, -79.38, "X", "#000000", clock);
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(clock, id);
  return q.userById.get(id);
}
const owner = user("media_http_owner", "admin");
user("media_http_publisher", "moderator");

const editor = createNewsDeskEditor({
  database: db,
  env: ENV,
  now: () => clock,
  summarize: null,
  fetchArticle: async () => { throw new Error("article network disabled in test"); },
});

function jpeg(bytes = 4096, width = 640, height = 480) {
  const segment = (marker, payload) => {
    const out = Buffer.alloc(payload.length + 4);
    out[0] = 255; out[1] = marker; out.writeUInt16BE(payload.length + 2, 2); payload.copy(out, 4); return out;
  };
  const sof = Buffer.alloc(15);
  sof[0] = 8; sof.writeUInt16BE(height, 1); sof.writeUInt16BE(width, 3); sof[5] = 3;
  sof.set([1, 17, 0, 2, 17, 0, 3, 17, 0], 6);
  const prefix = Buffer.concat([
    Buffer.from([255, 216]),
    segment(224, Buffer.from([74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])),
    segment(192, sof),
    segment(218, Buffer.from([3, 1, 0, 2, 0, 3, 0, 0, 63, 0])),
  ]);
  return Buffer.concat([prefix, Buffer.alloc(bytes - prefix.length - 2), Buffer.from([255, 217])]);
}

function storage({ onPut } = {}) {
  const original = jpeg();
  let delivery = null;
  return async (url, request = {}) => {
    const publicObject = new URL(url).pathname.includes("/pit-media/users/");
    const method = request.method || "GET";
    if (method === "PUT") {
      assert.ok(publicObject);
      onPut?.();
      delivery = Buffer.from(request.body);
      return { status: 200, headers: new Headers({ etag: '"synthetic-delivery"' }) };
    }
    const bytes = publicObject ? delivery : original;
    if (!bytes) return { status: 404, headers: new Headers() };
    const etag = publicObject ? '"synthetic-delivery"' : '"synthetic-source"';
    const headers = new Headers({ "content-length": String(bytes.length), "content-type": "image/jpeg", etag });
    if (method === "HEAD") return { status: 200, headers };
    assert.equal(new Headers(request.headers).get("if-match"), etag);
    return new Response(bytes, { status: 200, headers });
  };
}

const imageProcessor = {
  async sanitize(bytes, { expectedType }) {
    const info = inspectImageBytes(bytes, { expectedType, sanitized: false });
    return { ...info, bytes: Buffer.from(bytes), byteSize: bytes.length, mimeType: expectedType };
  },
};

function photoBody(clientAssetId) {
  return { clientAssetId, purpose: "post", contentType: "image/jpeg", fileSize: 4096, name: "synthetic.jpg" };
}

function service({ onStoragePut, fetchImpl: suppliedFetchImpl } = {}) {
  return createMediaApiService({
    database: db,
    env: ENV,
    now: () => clock,
    editor,
    media: {
      finalize: (database, options) => finalizeMediaAsset(database, {
        ...options,
        fetchImpl: suppliedFetchImpl || storage({ onPut: onStoragePut }),
        imageProcessor,
      }),
    },
  });
}

function grant(api, scopes = ["news:write", "media:write"]) {
  const pairing = api.issuePairing({ ownerId: owner.id, actorType: "assistant", actorLabel: "SyntheticHTTP", scopes });
  return api.exchangePairing({ pairingCode: pairing.pairingCode });
}

test("API body keys stay grant-scoped across revocation and separate from human receipts; previews verify ownership", async () => {
  const api = service();
  const firstGrant = grant(api);
  const authorization = `Bearer ${firstGrant.accessToken}`;
  const { asset } = api.createMedia({ authorization, body: photoBody("receipt-scope-photo"), idempotencyKey: "receipt-photo-create" });
  const finalized = await api.finalizeMedia({ authorization, assetId: asset.id, body: { deliveryMode: "server", editRecipe: {} }, idempotencyKey: "receipt-photo-finalize" });
  const body = { headline: "Radiohead announce a world tour for next year", summary: "Three independent music publishers confirm the announced world tour and its dates.",
    body: "The band has announced new world tour dates for its fans. ".repeat(110), category: "tour", idempotencyKey: "shared-human-and-api-save",
    sources: [{ kind: "article", name: "NME", url: "https://www.nme.com/news/tour-scope" },
      { kind: "article", name: "Stereogum", url: "https://www.stereogum.com/tour-scope" },
      { kind: "article", name: "Pitchfork", url: "https://pitchfork.com/news/tour-scope" }],
    photo: { assetId: asset.id, name: "Synthetic photographer", url: "https://example.com/photo-rights" } };
  const first = api.createNewsDraft({ authorization, body, idempotencyKey: body.idempotencyKey });
  assert.equal(first.draft.photo.url, finalized.asset.url);
  assert.equal(first.draft.photo.status, "ready");
  assert.equal(Object.hasOwn(first.draft.photo, "sourceUrl"), false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM news_editor_save_receipts WHERE actor_id=? AND idempotency_key=?").get(owner.id, body.idempotencyKey).n, 0);
  api.revokeGrant({ ownerId: owner.id, grantId: firstGrant.grantId });
  const secondGrant = grant(api);
  const secondAuth = `Bearer ${secondGrant.accessToken}`;
  const second = api.createNewsDraft({ authorization: secondAuth, body, idempotencyKey: body.idempotencyKey });
  assert.notEqual(first.draft.id, second.draft.id);
  assert.equal(second.draft.writer.grantId, secondGrant.grantId);
  assert.equal(api.createNewsDraft({ authorization: secondAuth, body, idempotencyKey: body.idempotencyKey }).draft.id, second.draft.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media_api_audit WHERE action='news_draft_created' AND target_id IN (?,?)").get(first.draft.id, second.draft.id).n, 2);
  const human = editor.writeSelfWritten({ ...body, actorId: owner.id });
  assert.notEqual(human.id, second.draft.id);
  const foreign = user("receipt_preview_foreign", "editor");
  const foreignDraft = editor.writeSelfWritten({ ...body, idempotencyKey: null, actorId: foreign.id });
  assert.equal(foreignDraft.photo.url, null);
  assert.equal(foreignDraft.photo.status, "unavailable");
  db.prepare("UPDATE media_objects SET status='delete_queued' WHERE owner_id=? AND storage_scope='public'").run(owner.id);
  assert.equal(editor.writeSelfWritten({ ...body, actorId: owner.id }).photo.url, null, "human receipt replay rechecks media readiness");
});

test("real media adapter keeps photo-only admission and rolls back ready state with audit failure", async () => {
  const api = service();
  const issued = grant(api, ["media:write"]);
  const authorization = `Bearer ${issued.accessToken}`;
  assert.throws(() => api.createMedia({ authorization, body: { ...photoBody("real-video-rejected"), contentType: "video/mp4" }, idempotencyKey: "real-video-0001" }),
    (error) => error instanceof ApiError && error.code === "MEDIA_TYPE_UNSUPPORTED");
  const { asset } = api.createMedia({ authorization, body: photoBody("real-audit-photo"), idempotencyKey: "real-create-0001" });
  db.exec("CREATE TEMP TRIGGER reject_media_api_audit BEFORE INSERT ON media_api_audit WHEN NEW.action='media_finalized' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
  await assert.rejects(api.finalizeMedia({ authorization, assetId: asset.id, body: { deliveryMode: "server", editRecipe: {} }, idempotencyKey: "real-finalize-0001" }), /synthetic audit failure/);
  db.exec("DROP TRIGGER reject_media_api_audit");
  assert.equal(db.prepare("SELECT status FROM media_assets WHERE id=?").get(asset.id).status, "upload_pending");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media_api_audit WHERE action='media_finalized' AND target_id=?").get(asset.id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media_api_idempotency WHERE idempotency_key='real-finalize-0001'").get().n, 0);
});

test("an already-ready Media API retry rolls back its ledger renewal and reservation on audit failure, then retries", async () => {
  const api = service();
  const issued = grant(api, ["media:write"]);
  const authorization = `Bearer ${issued.accessToken}`;
  const { asset } = api.createMedia({ authorization, body: photoBody("real-ready-audit-photo"), idempotencyKey: "real-ready-create-0001" });
  await api.finalizeMedia({ authorization, assetId: asset.id, body: { deliveryMode: "server", editRecipe: {} }, idempotencyKey: "real-ready-initial-finalize-0001" });
  const sourceKey = db.prepare("SELECT source_key FROM media_assets WHERE id=?").get(asset.id).source_key;
  const before = db.prepare("SELECT updated_at FROM media_objects WHERE owner_id=? AND object_key=?").get(owner.id, sourceKey);
  const auditCountBefore = db.prepare("SELECT COUNT(*) AS n FROM media_api_audit WHERE action='media_finalized' AND target_id=?").get(asset.id).n;
  clock += 1_000;
  const body = { deliveryMode: "server", editRecipe: {} };
  db.exec("CREATE TEMP TRIGGER reject_ready_media_api_audit BEFORE INSERT ON media_api_audit WHEN NEW.action='media_finalized' BEGIN SELECT RAISE(ABORT,'synthetic ready audit failure'); END");
  await assert.rejects(
    api.finalizeMedia({ authorization, assetId: asset.id, body, idempotencyKey: "real-ready-retry-0001" }),
    /synthetic ready audit failure/,
  );
  db.exec("DROP TRIGGER reject_ready_media_api_audit");
  const afterFailure = db.prepare("SELECT updated_at FROM media_objects WHERE owner_id=? AND object_key=?").get(owner.id, sourceKey);
  assert.equal(afterFailure.updated_at, before.updated_at);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media_api_idempotency WHERE operation='media.finalize' AND idempotency_key='real-ready-retry-0001'").get().n, 0);
  const retried = await api.finalizeMedia({ authorization, assetId: asset.id, body, idempotencyKey: "real-ready-retry-0001" });
  assert.equal(retried.finalize.state, "completed");
  assert.equal(db.prepare("SELECT status FROM media_api_idempotency WHERE operation='media.finalize' AND idempotency_key='real-ready-retry-0001'").get().status, "completed");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media_api_audit WHERE action='media_finalized' AND target_id=?").get(asset.id).n, auditCountBefore + 1);
});

test("an ordinary finalization racing a deferred already-ready retry preserves both completion contracts", async () => {
  const api = service();
  const issued = grant(api, ["media:write"]);
  const authorization = `Bearer ${issued.accessToken}`;
  const { asset } = api.createMedia({ authorization, body: photoBody("real-ready-race-photo"), idempotencyKey: "real-ready-race-create-0001" });
  await api.finalizeMedia({ authorization, assetId: asset.id, body: { deliveryMode: "server", editRecipe: {} }, idempotencyKey: "real-ready-race-initial-0001" });
  clock += 1_000;
  const body = { deliveryMode: "server", editRecipe: {} };
  const deferredApiRetry = api.finalizeMedia({ authorization, assetId: asset.id, body, idempotencyKey: "real-ready-race-api-0001" });
  const ordinaryRetry = finalizeMediaAsset(db, {
    ownerId: owner.id,
    assetId: asset.id,
    body,
    at: clock,
    env: ENV,
    fetchImpl: storage(),
    imageProcessor,
  });
  const [apiResult, ordinaryResult] = await Promise.all([deferredApiRetry, ordinaryRetry]);
  assert.equal(apiResult.finalize.state, "completed");
  assert.equal(ordinaryResult.duplicate, true);
  assert.equal(Object.hasOwn(ordinaryResult, "deferredCommit"), false);
  assert.equal(db.prepare("SELECT status FROM media_api_idempotency WHERE operation='media.finalize' AND idempotency_key='real-ready-race-api-0001'").get().status, "completed");
});

test("a transient storage HEAD failure releases the Media API reservation", async () => {
  const api = service({
    fetchImpl: async () => { throw new Error("synthetic HEAD failure"); },
  });
  const issued = grant(api, ["media:write"]);
  const authorization = `Bearer ${issued.accessToken}`;
  const { asset } = api.createMedia({ authorization, body: photoBody("real-head-failure"), idempotencyKey: "real-head-create-0001" });
  await assert.rejects(
    api.finalizeMedia({ authorization, assetId: asset.id, body: { deliveryMode: "server", editRecipe: {} }, idempotencyKey: "real-head-finalize-0001" }),
    (error) => error instanceof ApiError && error.code === "MEDIA_STORAGE_UNAVAILABLE",
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media_api_idempotency WHERE operation='media.finalize' AND idempotency_key='real-head-finalize-0001'").get().n, 0);
});

test("ordinary and deferred image finalization modes never coalesce into the wrong result contract", async () => {
  const api = service();
  const issued = grant(api, ["media:write"]);
  const authorization = `Bearer ${issued.accessToken}`;
  const { asset } = api.createMedia({ authorization, body: photoBody("real-finalization-mode-separation"), idempotencyKey: "real-mode-create-0001" });
  const original = jpeg();
  let delivery = null;
  let reads = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let firstRead;
  const firstReadStarted = new Promise((resolve) => { firstRead = resolve; });
  const fetchImpl = async (url, request = {}) => {
    const publicObject = new URL(url).pathname.includes("/pit-media/users/");
    const method = request.method || "GET";
    if (method === "PUT") {
      delivery = Buffer.from(request.body);
      return { status: 200, headers: new Headers({ etag: '"synthetic-mode-delivery"' }) };
    }
    const bytes = publicObject ? delivery : original;
    if (!bytes) return { status: 404, headers: new Headers() };
    const etag = publicObject ? '"synthetic-mode-delivery"' : '"synthetic-mode-source"';
    const headers = new Headers({ "content-length": String(bytes.length), "content-type": "image/jpeg", etag });
    if (method === "HEAD") {
      reads += 1;
      if (reads === 1) { firstRead(); await gate; }
      return { status: 200, headers };
    }
    assert.equal(new Headers(request.headers).get("if-match"), etag);
    return new Response(bytes, { status: 200, headers });
  };
  const deferred = finalizeMediaAsset(db, {
    ownerId: owner.id, assetId: asset.id, body: { deliveryMode: "server", editRecipe: {} },
    env: ENV, fetchImpl, imageProcessor, photosOnly: true, deferCommit: true,
  });
  await Promise.race([
    firstReadStarted,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`synthetic finalization did not reach storage (reads=${reads})`)), 2_000)),
  ]);
  const ordinary = finalizeMediaAsset(db, {
    ownerId: owner.id, assetId: asset.id, body: { deliveryMode: "server", editRecipe: {} },
    env: ENV, fetchImpl, imageProcessor,
  });
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const [deferredResult, ordinaryResult] = await Promise.all([deferred, ordinary]);
  assert.equal(deferredResult.deferredCommit, true);
  assert.equal(typeof deferredResult.commit, "function");
  assert.equal(Object.hasOwn(ordinaryResult, "deferredCommit"), false);
  assert.equal(ordinaryResult.asset.status, "ready");
  assert.ok(reads > 1);
});

test("real media adapter rejects a grant revoked during storage work before durable commit", async () => {
  let api;
  let revoked = false;
  const issued = { value: null };
  api = service({
    onStoragePut: () => {
      if (!issued.value || revoked) return;
      revoked = true;
      api.revokeGrant({ ownerId: owner.id, grantId: issued.value.grantId, requestId: "real-revoke-inflight" });
    },
  });
  issued.value = grant(api, ["media:write"]);
  const authorization = `Bearer ${issued.value.accessToken}`;
  const { asset } = api.createMedia({ authorization, body: photoBody("real-revoked-photo"), idempotencyKey: "real-revoke-create-0001" });
  await assert.rejects(
    api.finalizeMedia({ authorization, assetId: asset.id, body: { deliveryMode: "server", editRecipe: {} }, idempotencyKey: "real-revoke-finalize-0001" }),
    (error) => error instanceof ApiError && error.code === "AUTH_INVALID",
  );
  assert.equal(db.prepare("SELECT status FROM media_assets WHERE id=?").get(asset.id).status, "upload_pending");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media_api_idempotency WHERE idempotency_key='real-revoke-finalize-0001'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media_api_audit WHERE action='media_finalized' AND target_id=?").get(asset.id).n, 0);
  assert.equal(db.prepare("SELECT result FROM media_api_audit WHERE action='grant_revoked' AND grant_id=?").get(issued.value.grantId).result, "revoked");
});

test("real assistant editor publishes a concise officially sourced article with provenance and revision guards", async () => {
  const api = service();
  const issued = grant(api);
  const authorization = `Bearer ${issued.accessToken}`;
  const { asset } = api.createMedia({ authorization, body: photoBody("real-editor-photo"), idempotencyKey: "editor-create-0001" });
  await api.finalizeMedia({ authorization, assetId: asset.id, body: { deliveryMode: "server", editRecipe: {} }, idempotencyKey: "editor-finalize-0001" });
  assert.deepEqual({
    ...db.prepare("SELECT owner_id,kind,status FROM media_assets WHERE id=?").get(asset.id),
  }, { owner_id: owner.id, kind: "image", status: "ready" });
  const body = "The fictional band announced new tour dates on its website. Tickets go on sale Friday, according to the announcement.";
  const created = api.createNewsDraft({ authorization, body: {
    headline: "Synthetic band announce 2027 world tour dates",
    summary: "The synthetic band has announced a new world tour with dates that will bring the group back to major venues.",
    body,
    sources: [
      { kind: "article", name: "Fixture Artist", url: "https://artist.example.com/tour" },
    ],
    photo: { assetId: asset.id, source: { name: "Synthetic photographer", url: "https://example.com/synthetic-photo" } },
  }, idempotencyKey: "editor-draft-0001" });
  assert.equal(created.draft.revision, 0);
  assert.deepEqual({ ...db.prepare("SELECT created_by,created_actor_type,created_actor_label,created_grant_id,revision FROM news_drafts WHERE id=?").get(created.draft.id) }, {
    created_by: owner.id, created_actor_type: "assistant", created_actor_label: "SyntheticHTTP", created_grant_id: issued.grantId, revision: 0,
  });
  const secondGrant = grant(api);
  assert.throws(
    () => api.publishNewsDraft({ authorization: `Bearer ${secondGrant.accessToken}`, draftId: created.draft.id, expectedRevision: 0, idempotencyKey: "editor-publish-spoof" }),
    (error) => error instanceof ApiError && error.code === "NOT_FOUND",
  );
  assert.throws(
    () => api.createNewsDraft({ authorization: "Bearer invalid-editor-token", body: {}, idempotencyKey: "editor-unauthorized" }),
    (error) => error instanceof ApiError && error.code === "AUTH_INVALID",
  );
  assert.throws(() => api.publishNewsDraft({ authorization, draftId: created.draft.id, expectedRevision: 999999, idempotencyKey: "editor-publish-stale" }),
    (error) => error instanceof ApiError && error.code === "CONFLICT");
  const published = api.publishNewsDraft({ authorization, draftId: created.draft.id, expectedRevision: 0, idempotencyKey: "editor-publish-0001" });
  assert.equal(published.draft.revision, 1);
  assert.equal(published.draft.body, body);
  assert.deepEqual(published.draft.sources.filter(source => source.kind === "article"), [
    { kind: "article", name: "Fixture Artist", url: "https://artist.example.com/tour" },
  ]);
  assert.equal(db.prepare("SELECT user_id FROM posts WHERE id=?").get(published.postId).user_id, "media_http_publisher");
  assert.equal(db.prepare("SELECT asset_id FROM post_media WHERE post_id=?").get(published.postId).asset_id, asset.id);
  assert.deepEqual({
    ...db.prepare("SELECT actor_type,actor_label,grant_id,target_type,target_id,result FROM media_api_audit WHERE action='news_published' AND target_id=?").get(published.postId),
  }, {
    actor_type: "assistant", actor_label: "SyntheticHTTP", grant_id: issued.grantId,
    target_type: "news_post", target_id: published.postId, result: "completed",
  });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM news_desk_receipts").get().n, 0);
});

test("real self-written publication rolls back story, media association, draft state, receipt, and audit together", async () => {
  const api = service();
  const issued = grant(api);
  const authorization = `Bearer ${issued.accessToken}`;
  const { asset } = api.createMedia({ authorization, body: photoBody("real-publish-audit-photo"), idempotencyKey: "audit-publish-create-0001" });
  await api.finalizeMedia({ authorization, assetId: asset.id, body: { deliveryMode: "server", editRecipe: {} }, idempotencyKey: "audit-publish-finalize-0001" });
  const body = Array.from({ length: 180 }, (_, index) => `Synthetic audit rollback paragraph ${index + 1} confirms the announced dates and music release plans.`).join(" ");
  const created = api.createNewsDraft({ authorization, body: {
    headline: "Synthetic band announce 2027 festival dates",
    summary: "The synthetic band has announced a new festival run with dates that will bring the group back to major venues.",
    body,
    sources: [
      { kind: "article", name: "NME", url: "https://www.nme.com/news/festival-1" },
      { kind: "article", name: "Stereogum", url: "https://www.stereogum.com/festival-2" },
      { kind: "article", name: "Pitchfork", url: "https://pitchfork.com/news/festival-3" },
    ],
    photo: { assetId: asset.id, source: { name: "Synthetic photographer", url: "https://example.com/synthetic-audit-photo" } },
  }, idempotencyKey: "audit-publish-draft-0001" });
  const publishedAuditCount = db.prepare("SELECT COUNT(*) AS n FROM media_api_audit WHERE action='news_published'").get().n;
  db.exec("CREATE TEMP TRIGGER reject_media_api_news_audit BEFORE INSERT ON media_api_audit WHEN NEW.action='news_published' BEGIN SELECT RAISE(ABORT,'synthetic news audit failure'); END");
  assert.throws(
    () => api.publishNewsDraft({ authorization, draftId: created.draft.id, expectedRevision: 0, idempotencyKey: "audit-publish-news-0001" }),
    /synthetic news audit failure/,
  );
  db.exec("DROP TRIGGER reject_media_api_news_audit");
  assert.deepEqual({
    ...db.prepare("SELECT status,story_post_id,revision FROM news_drafts WHERE id=?").get(created.draft.id),
  }, { status: "draft", story_post_id: null, revision: 0 });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM news_stories WHERE post_id IS NOT NULL AND headline LIKE 'Synthetic band announce 2027 festival dates'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM post_media WHERE asset_id=?").get(asset.id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media_api_idempotency WHERE operation='news.publish' AND idempotency_key='audit-publish-news-0001'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM media_api_audit WHERE action='news_published'").get().n, publishedAuditCount);
});

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

test("real HTTP namespace is disabled before session auth and never echoes bearer input", async () => {
  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), "pit-media-api-http-disabled-"));
  const childEnv = {
    ...process.env,
    NODE_ENV: "development",
    PIT_DATA_DIR: dataDir,
    PIT_MEDIA_API_ENABLED: "",
    PORT: String(port),
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    RESEND_API_KEY: "",
    TICKETMASTER_API_KEY: "",
  };
  const child = spawn(process.execPath, [join(ROOT, "server", "index.js")], { cwd: ROOT, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`HTTP test server did not start: ${output.slice(-2_000)}`)), 20_000);
    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes(`up on http://localhost:${port}`)) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
  try {
    await ready;
    const bearer = `Bearer ${"S".repeat(40)}`;
    const response = await fetch(`http://127.0.0.1:${port}/api/media/v1/grants/pairing`, {
      method: "POST",
      headers: { authorization: bearer, "content-type": "application/json" },
      body: "{}",
    });
    const text = await response.text();
    assert.equal(response.status, 404);
    assert.equal(text.includes(bearer), false);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    rmSync(dataDir, { recursive: true, force: true });
  }
});
