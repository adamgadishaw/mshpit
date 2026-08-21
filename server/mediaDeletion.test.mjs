import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-media-deletion-"));
process.env.PIT_DATA_DIR = dataDir;
Object.assign(process.env, {
  MEDIA_ENDPOINT: "https://objects.example.com/s3",
  MEDIA_BUCKET: "pit-active-media",
  MEDIA_REGION: "auto",
  MEDIA_ACCESS_KEY_ID: "test-access",
  MEDIA_SECRET_ACCESS_KEY: "test-secret",
  MEDIA_PUBLIC_BASE_URL: "https://media.example.com/cdn",
});

const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const { hashPassword } = await import("./auth.js");
const {
  enqueueAllOwnedMedia,
  enqueueOwnedMediaUrls,
  enqueueOwnerMediaSweep,
  mediaDeletionHealth,
  mediaOrphanTtlMs,
  MEDIA_OWNER_SWEEP_QUIET_WINDOW_MS,
  MEDIA_OWNER_SWEEP_RECHECK_MS,
  MEDIA_UPLOAD_SETTLE_BUFFER_MS,
  recordMediaObjectTicket,
  reserveMediaUploadTicket,
  runMediaDeletionBatch,
  runMediaOwnerSweepOnce,
  trustedOwnedMediaKey,
} = await import("./mediaDeletion.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const mediaUrl = (owner, purpose, name, extension = "jpg") =>
  `https://media.example.com/cdn/users/${owner}/${purpose}/${name}.${extension}`;

function addUser(id, password = "delete-password") {
  q.insertUser.run(id, `${id}@example.com`, id, id, hashPassword(password), "fan", "Toronto", 43.65, -79.38, "MD", "#123456", Date.now());
  return q.userById.get(id);
}

function clearMediaTables() {
  db.prepare("DELETE FROM post_media").run();
  db.prepare("DELETE FROM media_variants").run();
  db.prepare("DELETE FROM media_assets").run();
  db.prepare("DELETE FROM media_deletion_queue").run();
  db.prepare("DELETE FROM media_objects").run();
  db.prepare("DELETE FROM media_upload_issuances").run();
  db.prepare("DELETE FROM media_owner_sweeps").run();
}

function enqueueTicket(owner, key, at = Date.now()) {
  assert.equal(recordMediaObjectTicket(db, { ownerId: owner, objectKey: key, at, expiresAt: null }), true);
  return enqueueAllOwnedMedia(db, { ownerId: owner, at });
}

test("only exact, credential-free owner-prefixed public URLs become deletion keys", () => {
  const env = { ...process.env };
  const good = mediaUrl("u_owner", "post", "concert-1");
  assert.equal(trustedOwnedMediaKey(good, { ownerId: "u_owner", env }), "users/u_owner/post/concert-1.jpg");
  for (const bad of [
    mediaUrl("u_foreign", "post", "concert-1"),
    "https://media.example.com.evil.test/cdn/users/u_owner/post/concert-1.jpg",
    "https://user:pass@media.example.com/cdn/users/u_owner/post/concert-1.jpg",
    `${good}?download=1`,
    `${good}#fragment`,
    "http://media.example.com/cdn/users/u_owner/post/concert-1.jpg",
    "https://media.example.com/cdn/users/u_owner/post/%2e%2e.jpg",
    "https://media.example.com/cdn/users/u_owner/post/x%2f..%2fconcert.jpg",
    "https://media.example.com/cdn/users/u_owner/unknown/concert-1.jpg",
    "https://media.example.com/cdn/users/u_owner/post/concert-1.svg",
  ]) {
    assert.equal(trustedOwnedMediaKey(bad, { ownerId: "u_owner", env }), null, bad);
  }
});

test("presign records a durable owner ledger before returning an upload ticket", () => {
  clearMediaTables();
  const user = addUser("media_ticket_owner");
  const ticket = routes["POST /api/media/presign"]({
    user,
    ip: "ticket-owner",
    body: { purpose: "avatar", contentType: "image/jpeg", fileSize: 1234, name: "show.jpg" },
  });
  const ledger = db.prepare("SELECT owner_id,purpose,status FROM media_objects WHERE object_key=?").get(ticket.key);
  assert.deepEqual({ ...ledger }, { owner_id: user.id, purpose: "avatar", status: "issued" });
  assert.equal(ticket.publicUrl, `https://media.example.com/cdn/${ticket.key}`);
});

test("upload reservations enforce atomic outstanding and rolling owner budgets", () => {
  clearMediaTables();
  const owner = addUser("media_quota_owner");
  const other = addUser("media_quota_other");
  const halfMiB = 512 * 1024;
  const env = {
    ...process.env,
    MEDIA_UPLOAD_OUTSTANDING_OBJECTS: "2",
    MEDIA_UPLOAD_OUTSTANDING_BYTES: String(1024 * 1024),
    MEDIA_UPLOAD_24H_TICKETS: "4",
    MEDIA_UPLOAD_24H_BYTES: String(2 * 1024 * 1024),
  };
  const reserve = (ownerId, name, at, byteSize = halfMiB) => reserveMediaUploadTicket(db, {
    ownerId,
    objectKey: `users/${ownerId}/post/${name}.jpg`,
    byteSize,
    at,
    env,
  });

  assert.equal(reserve(owner.id, "first", 1_000).duplicate, false);
  assert.equal(reserve(owner.id, "second", 2_000).duplicate, false,
    "the exact outstanding object/byte boundary is accepted");
  assert.throws(
    () => reserve(owner.id, "over-outstanding", 3_000, 1),
    (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.code, "MEDIA_UPLOAD_QUOTA_EXCEEDED");
      assert.equal(error.message.includes(owner.id), false);
      assert.equal(error.message.includes("over-outstanding"), false);
      return true;
    },
  );

  db.prepare("UPDATE media_objects SET status='associated' WHERE owner_id=? AND object_key=?")
    .run(owner.id, `users/${owner.id}/post/first.jpg`);
  assert.equal(reserve(owner.id, "third", 4_000).duplicate, false,
    "association releases one unattached-object reservation");
  assert.equal(reserve(owner.id, "second", 5_000).duplicate, true,
    "a retry does not add an outstanding object but is charged to the rolling budget");
  assert.throws(
    () => reserve(owner.id, "second", 6_000),
    (error) => error.status === 429 && error.code === "MEDIA_UPLOAD_QUOTA_EXCEEDED",
    "the fifth ticket is rejected at the four-ticket rolling boundary",
  );

  db.prepare("DELETE FROM media_objects WHERE owner_id=?").run(owner.id);
  assert.throws(
    () => reserve(owner.id, "after-delete", 7_000),
    (error) => error.status === 429 && error.code === "MEDIA_UPLOAD_QUOTA_EXCEEDED",
    "deleting object ledgers cannot erase durable 24-hour issuance usage",
  );
  assert.equal(reserve(other.id, "isolated", 7_000).duplicate, false,
    "one owner's budget never consumes another owner's allowance");

  const migrated = addUser("media_quota_migrated_zero");
  const migratedKey = `users/${migrated.id}/post/legacy-zero.jpg`;
  assert.equal(recordMediaObjectTicket(db, {
    ownerId: migrated.id,
    objectKey: migratedKey,
    byteSize: 0,
    at: 1_000,
    expiresAt: null,
  }), true);
  const migrationEnv = {
    ...process.env,
    MEDIA_UPLOAD_OUTSTANDING_OBJECTS: "4",
    MEDIA_UPLOAD_OUTSTANDING_BYTES: String(1024 * 1024),
    MEDIA_UPLOAD_24H_TICKETS: "10",
    MEDIA_UPLOAD_24H_BYTES: String(10 * 1024 * 1024),
  };
  reserveMediaUploadTicket(db, {
    ownerId: migrated.id,
    objectKey: `users/${migrated.id}/post/filler.jpg`,
    byteSize: 900 * 1024,
    at: 2_000,
    env: migrationEnv,
  });
  assert.throws(
    () => reserveMediaUploadTicket(db, {
      ownerId: migrated.id,
      objectKey: migratedKey,
      byteSize: 200 * 1024,
      at: 3_000,
      env: migrationEnv,
    }),
    (error) => error.status === 429 && error.code === "MEDIA_UPLOAD_QUOTA_EXCEEDED",
    "migrated zero-byte rows charge their positive byte delta before retry",
  );
});

test("legacy presign cannot bypass the shared owner byte quota", () => {
  clearMediaTables();
  const user = addUser("legacy_presign_quota_owner");
  const previous = {
    objects: process.env.MEDIA_UPLOAD_OUTSTANDING_OBJECTS,
    bytes: process.env.MEDIA_UPLOAD_OUTSTANDING_BYTES,
    tickets: process.env.MEDIA_UPLOAD_24H_TICKETS,
    rollingBytes: process.env.MEDIA_UPLOAD_24H_BYTES,
  };
  Object.assign(process.env, {
    MEDIA_UPLOAD_OUTSTANDING_OBJECTS: "2",
    MEDIA_UPLOAD_OUTSTANDING_BYTES: String(1024 * 1024),
    MEDIA_UPLOAD_24H_TICKETS: "10",
    MEDIA_UPLOAD_24H_BYTES: String(10 * 1024 * 1024),
  });
  try {
    routes["POST /api/media/presign"]({
      user,
      ip: "legacy-quota-first",
      body: { purpose: "avatar", contentType: "image/jpeg", fileSize: 700 * 1024, name: "one.jpg" },
    });
    assert.throws(
      () => routes["POST /api/media/presign"]({
        user,
        ip: "legacy-quota-second",
        body: { purpose: "avatar", contentType: "image/jpeg", fileSize: 700 * 1024, name: "two.jpg" },
      }),
      (error) => error.status === 429 && error.code === "MEDIA_UPLOAD_QUOTA_EXCEEDED",
    );
    assert.equal(db.prepare("SELECT COUNT(*) count FROM media_upload_issuances WHERE owner_id=?").get(user.id).count, 1);
  } finally {
    const restore = (key, value) => value === undefined ? delete process.env[key] : (process.env[key] = value);
    restore("MEDIA_UPLOAD_OUTSTANDING_OBJECTS", previous.objects);
    restore("MEDIA_UPLOAD_OUTSTANDING_BYTES", previous.bytes);
    restore("MEDIA_UPLOAD_24H_TICKETS", previous.tickets);
    restore("MEDIA_UPLOAD_24H_BYTES", previous.rollingBytes);
  }
});

test("legacy presign never mints a raw video ticket", () => {
  clearMediaTables();
  const user = addUser("legacy_video_presign_owner");
  assert.throws(
    () => routes["POST /api/media/presign"]({
      user,
      ip: "legacy-video-presign",
      body: { purpose: "venue", contentType: "video/mp4", fileSize: 2 * 1024 * 1024, name: "walkthrough.mp4" },
    }),
    (error) => error.status === 415 && error.code === "MEDIA_TYPE_UNSUPPORTED",
  );
  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_upload_issuances WHERE owner_id=?").get(user.id).count, 0);
});

test("mixed association input queues only a ledger-backed owned key, never a foreign URL", () => {
  clearMediaTables();
  const owner = "queue_owner";
  const owned = mediaUrl(owner, "post", "owned");
  const foreign = mediaUrl("queue_foreign", "post", "foreign");
  const result = enqueueOwnedMediaUrls(db, {
    ownerId: owner,
    urls: [owned, owned, foreign, "https://outside.example/photo.jpg"],
    at: 1_000,
  });
  assert.deepEqual(result.keys, ["users/queue_owner/post/owned.jpg"]);
  assert.equal(result.enqueued, 1);
  assert.deepEqual(db.prepare("SELECT owner_id,object_key,status FROM media_deletion_queue").all().map((row) => ({ ...row })), [{
    owner_id: owner,
    object_key: "users/queue_owner/post/owned.jpg",
    status: "pending",
  }]);
});

test("stable deletion resolves its stored authoritative key after a public-base migration", () => {
  clearMediaTables();
  const user = addUser("stable_key_migration_owner");
  const created = routes["POST /api/media/assets"]({
    user,
    ip: "stable-key-migration",
    body: {
      clientAssetId: "stable-key-migration-asset",
      purpose: "post",
      contentType: "image/jpeg",
      fileSize: 2_048,
      name: "old-origin.jpg",
    },
  });
  const result = enqueueOwnedMediaUrls(db, {
    ownerId: user.id,
    urls: [created.asset.sourceUrl],
    env: { ...process.env, MEDIA_PUBLIC_BASE_URL: "https://new-media.example.com/next" },
    at: 2_000,
  });
  assert.deepEqual(result.keys, [created.upload.key]);
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(created.upload.key).status, "delete_queued");
});

test("worker signs DELETE, treats 204 and 404 as success, and never exposes credentials", async () => {
  clearMediaTables();
  const owner = "worker_owner";
  const first = `users/${owner}/post/first.jpg`;
  const second = `users/${owner}/venue/second.mp4`;
  recordMediaObjectTicket(db, { ownerId: owner, objectKey: first, at: 1_000, expiresAt: null });
  recordMediaObjectTicket(db, { ownerId: owner, objectKey: second, at: 1_000, expiresAt: null });
  enqueueAllOwnedMedia(db, { ownerId: owner, at: 2_000 });
  const requests = [];
  const statuses = [204, 404];
  const result = await runMediaDeletionBatch({
    database: db,
    env: process.env,
    clock: () => 3_000,
    batchSize: 2,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { status: statuses.shift() };
    },
  });
  assert.equal(result.deleted, 2);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_deletion_queue").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_objects").get().count, 0);
  assert.equal(requests.every((request) => request.options.method === "DELETE"), true);
  assert.match(requests[0].url, /^https:\/\/objects\.example\.com\/s3\/pit-active-media\/users\/worker_owner\/post\/first\.jpg\?/);
  assert.equal(requests.some((request) => request.url.includes("test-secret")), false);
});

test("bounded failures retry, dead-letter, and corrupted keys never reach fetch", async () => {
  clearMediaTables();
  const owner = "retry_owner";
  const key = `users/${owner}/post/retry.jpg`;
  let at = 10_000;
  enqueueTicket(owner, key, at);
  let calls = 0;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const result = await runMediaDeletionBatch({
      database: db,
      env: process.env,
      clock: () => at,
      batchSize: 1,
      fetchImpl: async () => { calls += 1; return { status: 503 }; },
    });
    const row = db.prepare("SELECT status,attempts,next_attempt_at,last_error_code FROM media_deletion_queue WHERE object_key=?").get(key);
    assert.equal(row.attempts, attempt);
    assert.equal(row.last_error_code, "http_503");
    if (attempt < 5) {
      assert.equal(row.status, "retry");
      assert.ok(row.next_attempt_at > at);
      at = row.next_attempt_at;
      assert.equal(result.retried, 1);
    } else {
      assert.equal(row.status, "dead");
      assert.equal(result.deadLettered, 1);
    }
  }
  assert.equal(calls, 5);

  clearMediaTables();
  db.prepare(`INSERT INTO media_objects (object_key,owner_id,purpose,status,created_at,updated_at)
    VALUES (?,?,?,'delete_queued',?,?)`).run("users/retry_owner/post/%2f.jpg", owner, "post", at, at);
  db.prepare(`INSERT INTO media_deletion_queue
    (owner_id,object_key,status,attempts,next_attempt_at,created_at,updated_at)
    VALUES (?,?,'pending',0,?,?,?)`).run(owner, "users/retry_owner/post/%2f.jpg", at, at, at);
  const corrupt = await runMediaDeletionBatch({
    database: db,
    env: process.env,
    clock: () => at,
    batchSize: 1,
    fetchImpl: async () => { calls += 100; return { status: 204 }; },
  });
  assert.equal(corrupt.deadLettered, 1);
  assert.equal(calls, 5, "an invalid persisted key must never be sent to object storage");
  assert.equal(db.prepare("SELECT last_error_code FROM media_deletion_queue").get().last_error_code, "invalid_key");
});

test("stale never-associated tickets are queued after a bounded TTL", async () => {
  clearMediaTables();
  const at = 100 * 24 * 60 * 60_000;
  const ttl = mediaOrphanTtlMs({ MEDIA_ORPHAN_TTL_MS: "1" });
  assert.equal(ttl, 24 * 60 * 60_000, "operator TTL is bounded to at least one day");
  const owner = "orphan_owner";
  const key = `users/${owner}/post/abandoned.jpg`;
  recordMediaObjectTicket(db, { ownerId: owner, objectKey: key, at: at - ttl - 1 });
  const result = await runMediaDeletionBatch({
    database: db,
    env: { ...process.env, MEDIA_ORPHAN_TTL_MS: String(ttl) },
    clock: () => at,
    batchSize: 1,
    fetchImpl: async () => ({ status: 404 }),
  });
  assert.equal(result.orphanTicketsQueued, 1);
  assert.equal(result.deleted, 1);
  assert.equal(db.prepare("SELECT 1 FROM media_objects WHERE object_key=?").get(key), undefined);
});

test("legacy owner-prefix sweep paginates safely and ignores every foreign or malformed returned key", async () => {
  clearMediaTables();
  const owner = "sweep_owner";
  assert.equal(enqueueOwnerMediaSweep(db, { ownerId: owner, at: 5_000 }), true);
  const firstPage = `<?xml version="1.0"?><ListBucketResult>
    <IsTruncated>true</IsTruncated>
    <Contents><Key>users%2Fsweep_owner%2Fpost%2Fold.jpg</Key></Contents>
    <Contents><Key>users%2Fsomebody_else%2Fpost%2Fforeign.jpg</Key></Contents>
    <Contents><Key>users%2Fsweep_owner%2Fpost%2Fbad%252fkey.jpg</Key></Contents>
    <NextContinuationToken>page&amp;2</NextContinuationToken>
  </ListBucketResult>`;
  const secondPage = `<?xml version="1.0"?><ListBucketResult>
    <IsTruncated>false</IsTruncated>
    <Contents><Key>users%2Fsweep_owner%2Fbanner%2Fhero.jpg</Key></Contents>
  </ListBucketResult>`;
  const requested = [];
  const pages = [firstPage, secondPage];
  const fetchImpl = async (url, options) => {
    requested.push({ url, options });
    return { status: 200, text: async () => pages.shift() };
  };

  const first = await runMediaOwnerSweepOnce({ database: db, env: process.env, fetchImpl, clock: () => 5_000 });
  assert.deepEqual(first, { processed: 1, discovered: 1, hasMore: true, verificationPending: false, errorCode: null });
  assert.equal(requested[0].options.method, "GET");
  assert.match(requested[0].url, /prefix=users%2Fsweep_owner%2F/);
  assert.equal(requested[0].url.includes("test-secret"), false);
  const cursor = db.prepare("SELECT status,attempts,continuation_token FROM media_owner_sweeps WHERE owner_id=?").get(owner);
  assert.deepEqual({ ...cursor }, { status: "pending", attempts: 0, continuation_token: "page&2" });

  const second = await runMediaOwnerSweepOnce({ database: db, env: process.env, fetchImpl, clock: () => 5_001 });
  assert.deepEqual(second, { processed: 1, discovered: 1, hasMore: false, verificationPending: true, errorCode: null });
  assert.match(requested[1].url, /continuation-token=page%262/);
  const retained = db.prepare(`SELECT status,attempts,continuation_token,verification_passes,next_attempt_at,finalize_after_at
    FROM media_owner_sweeps WHERE owner_id=?`).get(owner);
  assert.deepEqual({ ...retained }, {
    status: "pending",
    attempts: 0,
    continuation_token: null,
    verification_passes: 1,
    next_attempt_at: 5_001 + MEDIA_OWNER_SWEEP_RECHECK_MS,
    finalize_after_at: 5_000 + MEDIA_OWNER_SWEEP_QUIET_WINDOW_MS,
  });
  assert.deepEqual(db.prepare("SELECT object_key FROM media_deletion_queue ORDER BY object_key").all().map((row) => row.object_key), [
    "users/sweep_owner/banner/hero.jpg",
    "users/sweep_owner/post/old.jpg",
  ]);

  pages.push("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>");
  const final = await runMediaOwnerSweepOnce({
    database: db,
    env: process.env,
    fetchImpl,
    clock: () => 5_000 + MEDIA_OWNER_SWEEP_QUIET_WINDOW_MS,
  });
  assert.deepEqual(final, { processed: 1, discovered: 0, hasMore: false, verificationPending: false, errorCode: null });
  assert.equal(requested[2].url.includes("continuation-token="), false);
  assert.equal(db.prepare("SELECT 1 FROM media_owner_sweeps WHERE owner_id=?").get(owner), undefined);
});

test("account cleanup waits out a live PUT ticket and catches an object created after an early 404", async () => {
  clearMediaTables();
  const owner = "late_put_owner";
  const key = `users/${owner}/post/late-upload.mp4`;
  const issuedAt = 10_000;
  const expiresAt = issuedAt + 10 * 60_000;
  recordMediaObjectTicket(db, { ownerId: owner, objectKey: key, at: issuedAt, expiresAt });
  enqueueAllOwnedMedia(db, { ownerId: owner, at: issuedAt + 1_000 });
  enqueueOwnerMediaSweep(db, { ownerId: owner, at: issuedAt + 1_000 });
  const barrier = expiresAt + MEDIA_UPLOAD_SETTLE_BUFFER_MS;
  const sweep = db.prepare("SELECT not_before_at,finalize_after_at,next_attempt_at FROM media_owner_sweeps WHERE owner_id=?").get(owner);
  assert.deepEqual({ ...sweep }, {
    not_before_at: barrier,
    finalize_after_at: barrier + MEDIA_OWNER_SWEEP_QUIET_WINDOW_MS,
    next_attempt_at: barrier,
  });

  // A returned PUT remains usable through its expiry. Neither the object worker
  // nor the independent prefix sweep may race it with an optimistic early 404.
  const early = await runMediaDeletionBatch({
    database: db,
    env: process.env,
    clock: () => issuedAt + 2_000,
    batchSize: 1,
    fetchImpl: async () => { throw new Error("must not delete before the ticket barrier"); },
  });
  assert.equal(early.deleted, 0);
  assert.ok(db.prepare("SELECT 1 FROM media_objects WHERE object_key=?").get(key));
  assert.ok(db.prepare("SELECT 1 FROM media_owner_sweeps WHERE owner_id=?").get(owner));

  let listCalls = 0;
  const beforeBarrier = await runMediaOwnerSweepOnce({
    database: db,
    env: process.env,
    clock: () => barrier - 1,
    fetchImpl: async () => { listCalls += 1; throw new Error("must not list early"); },
  });
  assert.deepEqual(beforeBarrier, { processed: 0, errorCode: null });
  assert.equal(listCalls, 0);

  const barrierDelete = await runMediaDeletionBatch({
    database: db,
    env: process.env,
    clock: () => barrier,
    batchSize: 1,
    fetchImpl: async (_url, options) => {
      if (options.method === "GET") {
        listCalls += 1;
        return {
          status: 200,
          text: async () => "<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>",
        };
      }
      assert.equal(options.method, "DELETE");
      return { status: 404 };
    },
  });
  assert.equal(barrierDelete.deleted, 1);
  assert.equal(barrierDelete.sweepPages, 1);
  assert.equal(db.prepare("SELECT 1 FROM media_objects WHERE object_key=?").get(key), undefined);
  // The same worker pass performs the first mandatory empty prefix check after
  // the signing + normal-client settle barrier. It must retain the sweep: an
  // S3-style provider can authorize a PUT before expiration while its body is
  // still arriving.
  assert.equal(db.prepare("SELECT verification_passes FROM media_owner_sweeps WHERE owner_id=?").get(owner).verification_passes, 1);

  // Model that deliberately slow PUT completing after the first empty pass.
  // The retained exact-prefix sweep discovers and queues it on the next pass.
  const encoded = encodeURIComponent(key);
  const late = await runMediaOwnerSweepOnce({
    database: db,
    env: process.env,
    clock: () => barrier + MEDIA_OWNER_SWEEP_RECHECK_MS,
    fetchImpl: async (_url, options) => {
      listCalls += 1;
      assert.equal(options.method, "GET");
      return {
        status: 200,
        text: async () => `<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>${encoded}</Key></Contents></ListBucketResult>`,
      };
    },
  });
  assert.deepEqual(late, { processed: 1, discovered: 1, hasMore: false, verificationPending: true, errorCode: null });
  assert.equal(listCalls, 2);
  assert.equal(db.prepare("SELECT object_key FROM media_deletion_queue").get().object_key, key);

  const finalDelete = await runMediaDeletionBatch({
    database: db,
    env: process.env,
    clock: () => barrier + MEDIA_OWNER_SWEEP_RECHECK_MS + 1,
    batchSize: 1,
    fetchImpl: async (_url, options) => ({ status: options.method === "DELETE" ? 204 : 500 }),
  });
  assert.equal(finalDelete.deleted, 1);
  assert.equal(db.prepare("SELECT 1 FROM media_objects WHERE object_key=?").get(key), undefined);
  assert.ok(db.prepare("SELECT 1 FROM media_owner_sweeps WHERE owner_id=?").get(owner),
    "a successful object DELETE must not retire the independent verification sweep");

  const finalBarrier = barrier + MEDIA_OWNER_SWEEP_QUIET_WINDOW_MS;
  const finalVerification = await runMediaOwnerSweepOnce({
    database: db,
    env: process.env,
    clock: () => finalBarrier,
    fetchImpl: async () => ({
      status: 200,
      text: async () => "<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>",
    }),
  });
  assert.deepEqual(finalVerification, {
    processed: 1,
    discovered: 0,
    hasMore: false,
    verificationPending: false,
    errorCode: null,
  });
  assert.equal(db.prepare("SELECT 1 FROM media_owner_sweeps WHERE owner_id=?").get(owner), undefined);
});

test("post photo edits and author deletion queue only attachments that became unreferenced", () => {
  clearMediaTables();
  const user = addUser("content_cleanup_owner");
  const oldUrl = mediaUrl(user.id, "post", "old-photo");
  const keptUrl = mediaUrl(user.id, "post", "kept-photo");
  const newUrl = mediaUrl(user.id, "post", "new-photo");
  for (const url of [oldUrl, keptUrl, newUrl]) {
    const key = trustedOwnedMediaKey(url, { ownerId: user.id, env: process.env });
    recordMediaObjectTicket(db, { ownerId: user.id, objectKey: key, at: 1_000 });
  }
  const created = 20_000;
  db.prepare(`INSERT INTO posts (id,user_id,artist,venue,overall,review,photos,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run("p_cleanup_edit", user.id, "Artist", "Venue", 4, "Review", JSON.stringify([oldUrl, keptUrl, newUrl]), created);
  routes["PATCH /api/posts/:id"]({
    user,
    ip: "content-edit",
    params: { id: "p_cleanup_edit" },
    body: { photos: [keptUrl, newUrl], version: created },
  });
  assert.deepEqual(db.prepare("SELECT object_key FROM media_deletion_queue ORDER BY object_key").all().map((row) => ({ ...row })), [{
    object_key: "users/content_cleanup_owner/post/old-photo.jpg",
  }]);
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get("users/content_cleanup_owner/post/new-photo.jpg").status, "associated");

  routes["DELETE /api/posts/:id"]({ user, ip: "content-delete", params: { id: "p_cleanup_edit" }, body: {} });
  const post = db.prepare("SELECT removed,photos,photos_public,landing_showcase FROM posts WHERE id=?").get("p_cleanup_edit");
  assert.deepEqual({ ...post }, { removed: 1, photos: "[]", photos_public: 0, landing_showcase: 0 });
  assert.deepEqual(db.prepare("SELECT object_key FROM media_deletion_queue ORDER BY object_key").all().map((row) => row.object_key), [
    "users/content_cleanup_owner/post/kept-photo.jpg",
    "users/content_cleanup_owner/post/new-photo.jpg",
    "users/content_cleanup_owner/post/old-photo.jpg",
  ]);
});

test("account erasure queues historical associations and minted-but-unattached objects before cascades", () => {
  clearMediaTables();
  const user = addUser("account_cleanup_owner", "erase-me-now");
  const admin = addUser("account_cleanup_admin");
  const avatar = mediaUrl(user.id, "avatar", "legacy-avatar");
  const banner = mediaUrl(user.id, "banner", "legacy-banner");
  const postPhoto = mediaUrl(user.id, "post", "legacy-post");
  const venuePhoto = mediaUrl(user.id, "venue", "legacy-venue");
  const artistPhoto = mediaUrl(user.id, "banner", "legacy-artist");
  const foreign = mediaUrl("somebody_else", "post", "foreign");
  db.prepare("UPDATE users SET avatar_uri=?,banner=? WHERE id=?").run(avatar, banner, user.id);
  db.prepare(`INSERT INTO posts (id,user_id,artist,venue,overall,review,photos,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run("p_account_cleanup", user.id, "Artist", "Venue", 4, "Review", JSON.stringify([postPhoto, foreign]), 1_000);
  db.prepare(`INSERT INTO venue_reviews (id,venue_key,user_id,rating,text,photos,created_at)
    VALUES (?,?,?,?,?,?,?)`).run("vr_account_cleanup", "venue", user.id, 4, "Review", JSON.stringify([venuePhoto]), 1_000);
  db.prepare(`INSERT INTO artist_profiles (artist_key,owner_id,banner,updated_at)
    VALUES (?,?,?,?)`).run("account artist", user.id, artistPhoto, 1_000);

  const orphanKey = `users/${user.id}/post/minted-never-associated.jpg`;
  recordMediaObjectTicket(db, { ownerId: user.id, objectKey: orphanKey, at: 1_000 });
  const foreignKey = "users/somebody_else/post/foreign.jpg";
  recordMediaObjectTicket(db, { ownerId: "somebody_else", objectKey: foreignKey, at: 1_000 });

  db.prepare(`INSERT INTO reports (id,target_type,target_id,reason,reporter_id,status,created_at)
    VALUES ('r_artist_profile_cleanup','artist_profile','account artist','test',?,'open',?)`).run(admin.id, 1_000);
  db.prepare(`INSERT INTO moderation_actions
    (id,actor_id,action,target_type,target_id,reason,prior_state,next_state,created_at)
    VALUES ('ma_artist_profile_cleanup',?,'remove','artist_profile','account artist','test','{}','{}',?)`).run(admin.id, 1_000);

  let cleared = false;
  const result = routes["DELETE /api/me"]({
    user: q.userById.get(user.id),
    ip: "account-cleanup",
    body: { password: "erase-me-now" },
    clearSession: () => { cleared = true; },
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(cleared, true);
  assert.equal(q.userById.get(user.id), undefined);
  assert.equal(db.prepare("SELECT 1 FROM reports WHERE id='r_artist_profile_cleanup'").get(), undefined);
  assert.equal(db.prepare("SELECT 1 FROM moderation_actions WHERE id='ma_artist_profile_cleanup'").get(), undefined);

  const queued = db.prepare("SELECT owner_id,object_key FROM media_deletion_queue ORDER BY object_key").all();
  assert.deepEqual(queued.map((row) => row.object_key), [
    `users/${user.id}/avatar/legacy-avatar.jpg`,
    `users/${user.id}/banner/legacy-artist.jpg`,
    `users/${user.id}/banner/legacy-banner.jpg`,
    `users/${user.id}/post/legacy-post.jpg`,
    orphanKey,
    `users/${user.id}/venue/legacy-venue.jpg`,
  ].sort());
  assert.equal(queued.every((row) => row.owner_id === user.id), true);
  assert.equal(queued.some((row) => row.object_key === foreignKey), false);
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(foreignKey).status, "issued");

  const health = mediaDeletionHealth(db, { env: process.env, at: Date.now() });
  assert.equal(health.pending, queued.length);
  assert.equal(health.deadLetter, 0);
  assert.equal(JSON.stringify(health).includes(user.id), false, "health exposes counts/status only, never owner keys");
});
