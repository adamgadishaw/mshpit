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
  MEDIA_SOURCE_BUCKET: "pit-private-media",
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
  enqueueOwnedMediaKeys,
  enqueueOwnedMediaUrls,
  enqueueOwnerMediaSweep,
  mediaDeletionHealth,
  mediaOrphanTtlMs,
  mediaUploadGlobalCircuitBreakerLimits,
  mediaUploadQuotaLimits,
  MEDIA_OWNER_SWEEP_QUIET_WINDOW_MS,
  MEDIA_OWNER_SWEEP_RECHECK_MS,
  MEDIA_DELETION_DEAD_REDRIVE_MS,
  MEDIA_UPLOAD_ACCOUNTING_CLASS,
  MEDIA_UPLOAD_SETTLE_BUFFER_MS,
  recordMediaObjectTicket,
  reserveMediaUploadTicket,
  redriveMediaDeletionDeadLetters,
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
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}

function addUnverifiedUser(id, role = "fan") {
  q.insertUser.run(id, `${id}@example.com`, id, id, hashPassword("delete-password"), role, "Toronto", 43.65, -79.38, "MD", "#123456", Date.now());
  return q.userById.get(id);
}

function clearMediaTables() {
  db.prepare("DELETE FROM legacy_media_finalize_descriptors").run();
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

test("default media allowances fit ordinary social posting and bound abandoned work", () => {
  const limits = mediaUploadQuotaLimits({});
  assert.deepEqual(limits, {
    outstandingObjects: 40,
    outstandingBytes: 6 * 1024 * 1024 * 1024,
    rollingBytes: 6 * 1024 * 1024 * 1024,
    rollingTickets: 120,
  });
  assert.ok(limits.rollingTickets >= 5 * 20,
    "a member can still publish several maximum-photo-count posts in a rolling day");
  assert.deepEqual(mediaUploadGlobalCircuitBreakerLimits({}), {
    outstandingObjects: 10_000,
    outstandingBytes: 128 * 1024 * 1024 * 1024,
    rollingBytes: 512 * 1024 * 1024 * 1024,
    rollingTickets: 100_000,
  });
  assert.ok(db.prepare("PRAGMA index_list('media_objects')").all()
    .some((index) => index.name === "idx_media_objects_status_bytes"),
  "existing databases receive a covering index for the global outstanding-capability aggregate");
  assert.deepEqual(
    db.prepare("PRAGMA index_info('idx_media_upload_issuances_at_bytes')").all().map((column) => column.name),
    ["issued_at", "byte_size"],
    "the global rolling-byte aggregate is covered without table-row fetches",
  );
  assert.deepEqual(
    db.prepare("PRAGMA index_info('idx_media_objects_owner_accounting_status_bytes')").all().map((column) => column.name),
    ["owner_id", "accounting_class", "status", "byte_size"],
    "member outstanding accounting uses a covering source-class index",
  );
  assert.deepEqual(
    db.prepare("PRAGMA index_info('idx_media_upload_issuances_owner_accounting_at_bytes')").all().map((column) => column.name),
    ["owner_id", "accounting_class", "issued_at", "byte_size"],
    "member rolling accounting uses a covering source-class index",
  );
});

test("service-generated objects bypass member limits but remain inside every global breaker", () => {
  clearMediaTables();
  const owner = addUser("media_generated_breaker_owner");
  const env = {
    ...process.env,
    MEDIA_UPLOAD_OUTSTANDING_OBJECTS: "1",
    MEDIA_UPLOAD_OUTSTANDING_BYTES: String(1024 * 1024),
    MEDIA_UPLOAD_24H_TICKETS: "1",
    MEDIA_UPLOAD_24H_BYTES: String(1024 * 1024),
    MEDIA_UPLOAD_GLOBAL_OUTSTANDING_OBJECTS: "2",
    MEDIA_UPLOAD_GLOBAL_OUTSTANDING_BYTES: String(10 * 1024 * 1024),
    MEDIA_UPLOAD_GLOBAL_24H_TICKETS: "2",
    MEDIA_UPLOAD_GLOBAL_24H_BYTES: String(10 * 1024 * 1024),
  };
  const reserve = (name, at, accountingClass) => reserveMediaUploadTicket(db, {
    ownerId: owner.id,
    objectKey: `users/${owner.id}/post/${name}.jpg`,
    byteSize: 512 * 1024,
    accountingClass,
    at,
    env,
  });

  reserve("original", 1_000, MEDIA_UPLOAD_ACCOUNTING_CLASS.MEMBER_SOURCE);
  reserve("safe-copy", 2_000, MEDIA_UPLOAD_ACCOUNTING_CLASS.SERVICE_GENERATED);
  assert.throws(
    () => reserve("blocked-outstanding", 3_000, MEDIA_UPLOAD_ACCOUNTING_CLASS.SERVICE_GENERATED),
    (error) => error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE",
    "generated work cannot exceed the all-object global outstanding brake",
  );
  db.prepare("UPDATE media_objects SET status='associated' WHERE owner_id=?").run(owner.id);
  assert.throws(
    () => reserve("blocked-rolling", 4_000, MEDIA_UPLOAD_ACCOUNTING_CLASS.SERVICE_GENERATED),
    (error) => error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE",
    "associating objects cannot erase generated work from the global rolling brake",
  );
  assert.deepEqual(db.prepare(`SELECT accounting_class,COUNT(*) count,SUM(byte_size) bytes
    FROM media_upload_issuances WHERE owner_id=? GROUP BY accounting_class ORDER BY accounting_class`).all(owner.id)
    .map((row) => ({ ...row })), [
    { accounting_class: "member_source", count: 1, bytes: 512 * 1024 },
    { accounting_class: "service_generated", count: 1, bytes: 512 * 1024 },
  ]);
});

test("reissues keep their first accounting class and cannot relabel a source around member limits", () => {
  clearMediaTables();
  const owner = addUser("media_accounting_reissue_owner");
  const env = {
    ...process.env,
    MEDIA_UPLOAD_OUTSTANDING_OBJECTS: "10",
    MEDIA_UPLOAD_OUTSTANDING_BYTES: String(10 * 1024 * 1024),
    MEDIA_UPLOAD_24H_TICKETS: "10",
    MEDIA_UPLOAD_24H_BYTES: String(10 * 1024 * 1024),
    MEDIA_UPLOAD_GLOBAL_OUTSTANDING_OBJECTS: "10",
    MEDIA_UPLOAD_GLOBAL_OUTSTANDING_BYTES: String(20 * 1024 * 1024),
    MEDIA_UPLOAD_GLOBAL_24H_TICKETS: "10",
    MEDIA_UPLOAD_GLOBAL_24H_BYTES: String(20 * 1024 * 1024),
  };
  const sourceKey = `users/${owner.id}/post/original.jpg`;
  const generatedKey = `users/${owner.id}/post/safe-copy.jpg`;
  reserveMediaUploadTicket(db, {
    ownerId: owner.id, objectKey: sourceKey, byteSize: 600 * 1024,
    accountingClass: MEDIA_UPLOAD_ACCOUNTING_CLASS.MEMBER_SOURCE, at: 1_000, env,
  });
  const relabelAttempt = reserveMediaUploadTicket(db, {
    ownerId: owner.id, objectKey: sourceKey, byteSize: 600 * 1024,
    accountingClass: MEDIA_UPLOAD_ACCOUNTING_CLASS.SERVICE_GENERATED, at: 2_000, env,
  });
  assert.equal(relabelAttempt.accountingClass, MEDIA_UPLOAD_ACCOUNTING_CLASS.MEMBER_SOURCE,
    "the durable object class wins over a later caller label");
  reserveMediaUploadTicket(db, {
    ownerId: owner.id, objectKey: generatedKey, byteSize: 300 * 1024,
    accountingClass: MEDIA_UPLOAD_ACCOUNTING_CLASS.SERVICE_GENERATED, at: 3_000, env,
  });
  const generatedRetry = reserveMediaUploadTicket(db, {
    ownerId: owner.id, objectKey: generatedKey, byteSize: 300 * 1024,
    accountingClass: MEDIA_UPLOAD_ACCOUNTING_CLASS.SERVICE_GENERATED, at: 4_000, env,
  });
  assert.equal(generatedRetry.duplicate, true);
  assert.deepEqual(db.prepare(`SELECT accounting_class,COUNT(*) count
    FROM media_upload_issuances WHERE owner_id=? GROUP BY accounting_class ORDER BY accounting_class`).all(owner.id)
    .map((row) => ({ ...row })), [
    { accounting_class: "member_source", count: 2 },
    { accounting_class: "service_generated", count: 2 },
  ]);
  assert.throws(
    () => reserveMediaUploadTicket(db, {
      ownerId: owner.id, objectKey: generatedKey, byteSize: 300 * 1024 + 1,
      accountingClass: MEDIA_UPLOAD_ACCOUNTING_CLASS.SERVICE_GENERATED, at: 5_000, env,
    }),
    (error) => error.status === 409 && error.code === "CONFLICT",
    "accounting separation does not weaken exact-byte reissue binding",
  );
});

test("legacy ledger inserts default conservatively to member-selected source accounting", () => {
  clearMediaTables();
  const owner = addUser("media_accounting_legacy_owner");
  const key = `users/${owner.id}/post/legacy.jpg`;
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at)
    VALUES (?,?,'public','post',1024,'issued',1,1)`).run(key, owner.id);
  db.prepare(`INSERT INTO media_upload_issuances (owner_id,object_key,byte_size,issued_at)
    VALUES (?,?,1024,1)`).run(owner.id, key);
  assert.equal(db.prepare("SELECT accounting_class FROM media_objects WHERE object_key=?").get(key).accounting_class,
    MEDIA_UPLOAD_ACCOUNTING_CLASS.MEMBER_SOURCE);
  assert.equal(db.prepare("SELECT accounting_class FROM media_upload_issuances WHERE object_key=?").get(key).accounting_class,
    MEDIA_UPLOAD_ACCOUNTING_CLASS.MEMBER_SOURCE);
});

test("service-wide upload breakers atomically aggregate outstanding capabilities across owners", () => {
  clearMediaTables();
  const first = addUser("media_global_outstanding_first");
  const second = addUser("media_global_outstanding_second");
  const third = addUser("media_global_outstanding_third");
  const env = {
    ...process.env,
    MEDIA_UPLOAD_OUTSTANDING_OBJECTS: "100",
    MEDIA_UPLOAD_OUTSTANDING_BYTES: String(100 * 1024 * 1024),
    MEDIA_UPLOAD_24H_TICKETS: "100",
    MEDIA_UPLOAD_24H_BYTES: String(100 * 1024 * 1024),
    MEDIA_UPLOAD_GLOBAL_OUTSTANDING_OBJECTS: "2",
    MEDIA_UPLOAD_GLOBAL_OUTSTANDING_BYTES: String(100 * 1024 * 1024),
    MEDIA_UPLOAD_GLOBAL_24H_TICKETS: "100",
    MEDIA_UPLOAD_GLOBAL_24H_BYTES: String(100 * 1024 * 1024),
  };
  const reserve = (owner, name, at) => reserveMediaUploadTicket(db, {
    ownerId: owner.id,
    objectKey: `users/${owner.id}/post/${name}.jpg`,
    byteSize: 512 * 1024,
    at,
    env,
  });

  reserve(first, "first", 1_000);
  reserve(second, "second", 2_000);
  assert.throws(
    () => reserve(third, "blocked", 3_000),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, "MEDIA_STORAGE_UNAVAILABLE");
      assert.equal(error.message.includes(first.id), false);
      assert.equal(error.message.includes(third.id), false);
      assert.equal(error.message.toLowerCase().includes("plan"), false);
      return true;
    },
  );
  assert.equal(db.prepare("SELECT 1 FROM media_objects WHERE owner_id=?").get(third.id), undefined,
    "a rejected cross-owner reservation leaves no object capability");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_upload_issuances").get().count, 2,
    "a rejected cross-owner reservation consumes no rolling issuance");

  db.prepare("UPDATE media_objects SET status='associated' WHERE owner_id=?").run(first.id);
  assert.equal(reserve(third, "after-release", 4_000).duplicate, false,
    "associating an object releases global outstanding capability capacity");
});

test("service-wide upload breakers cover aggregate outstanding and rolling bytes and tickets", () => {
  const makeEnv = (overrides) => ({
    ...process.env,
    MEDIA_UPLOAD_OUTSTANDING_OBJECTS: "100",
    MEDIA_UPLOAD_OUTSTANDING_BYTES: String(100 * 1024 * 1024),
    MEDIA_UPLOAD_24H_TICKETS: "100",
    MEDIA_UPLOAD_24H_BYTES: String(100 * 1024 * 1024),
    MEDIA_UPLOAD_GLOBAL_OUTSTANDING_OBJECTS: "100",
    MEDIA_UPLOAD_GLOBAL_OUTSTANDING_BYTES: String(100 * 1024 * 1024),
    MEDIA_UPLOAD_GLOBAL_24H_TICKETS: "100",
    MEDIA_UPLOAD_GLOBAL_24H_BYTES: String(100 * 1024 * 1024),
    ...overrides,
  });
  const reserve = (owner, name, at, byteSize, env) => reserveMediaUploadTicket(db, {
    ownerId: owner.id,
    objectKey: `users/${owner.id}/post/${name}.jpg`,
    byteSize,
    at,
    env,
  });

  clearMediaTables();
  const byteFirst = addUser("media_global_outstanding_bytes_first");
  const byteSecond = addUser("media_global_outstanding_bytes_second");
  const outstandingByteEnv = makeEnv({ MEDIA_UPLOAD_GLOBAL_OUTSTANDING_BYTES: String(1024 * 1024) });
  reserve(byteFirst, "first", 1_000, 700 * 1024, outstandingByteEnv);
  assert.throws(
    () => reserve(byteSecond, "blocked", 2_000, 400 * 1024, outstandingByteEnv),
    (error) => error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE",
    "outstanding bytes aggregate across different owners",
  );

  clearMediaTables();
  const ticketFirst = addUser("media_global_rolling_tickets_first");
  const ticketSecond = addUser("media_global_rolling_tickets_second");
  const rollingTicketEnv = makeEnv({ MEDIA_UPLOAD_GLOBAL_24H_TICKETS: "2" });
  reserve(ticketFirst, "first", 1_000, 256 * 1024, rollingTicketEnv);
  reserve(ticketSecond, "second", 2_000, 256 * 1024, rollingTicketEnv);
  db.prepare("UPDATE media_objects SET status='associated'").run();
  assert.throws(
    () => reserve(ticketFirst, "blocked", 3_000, 1, rollingTicketEnv),
    (error) => error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE",
    "rolling tickets aggregate even after objects are associated",
  );

  clearMediaTables();
  const rollingByteFirst = addUser("media_global_rolling_bytes_first");
  const rollingByteSecond = addUser("media_global_rolling_bytes_second");
  const rollingByteEnv = makeEnv({ MEDIA_UPLOAD_GLOBAL_24H_BYTES: String(1024 * 1024) });
  reserve(rollingByteFirst, "first", 1_000, 700 * 1024, rollingByteEnv);
  db.prepare("UPDATE media_objects SET status='associated'").run();
  assert.throws(
    () => reserve(rollingByteSecond, "blocked", 2_000, 400 * 1024, rollingByteEnv),
    (error) => error.status === 503 && error.code === "MEDIA_STORAGE_UNAVAILABLE",
    "rolling bytes aggregate across different owners",
  );
});

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

test("legacy presign records a private owner ledger and one-time finalize descriptor", () => {
  clearMediaTables();
  const user = addUser("media_ticket_owner");
  const ticket = routes["POST /api/media/presign"]({
    user,
    ip: "ticket-owner",
    body: { purpose: "avatar", contentType: "image/jpeg", fileSize: 1234, name: "show.jpg" },
  });
  const ledger = db.prepare("SELECT owner_id,purpose,status,storage_scope FROM media_objects WHERE object_key=?").get(ticket.key);
  assert.deepEqual({ ...ledger }, { owner_id: user.id, purpose: "avatar", status: "issued", storage_scope: "private" });
  assert.equal(ticket.publicUrl, null);
  assert.equal(ticket.storageLocator, `pit-private:${ticket.key}`);
  assert.equal(typeof ticket.finalizeToken, "string");
  const descriptor = db.prepare("SELECT owner_id,token_hash,status FROM legacy_media_finalize_descriptors WHERE id=?")
    .get(ticket.descriptorId);
  assert.equal(descriptor.owner_id, user.id);
  assert.equal(descriptor.status, "pending");
  assert.equal(descriptor.token_hash.length, 64);
  assert.notEqual(descriptor.token_hash, ticket.finalizeToken);
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

test("stable deletion uses its stored authoritative key after a public-base migration", () => {
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
  const result = enqueueOwnedMediaKeys(db, {
    ownerId: user.id,
    keys: [created.upload.key],
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
  recordMediaObjectTicket(db, { ownerId: owner, objectKey: second, storageScope: "private", at: 1_000, expiresAt: null });
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
  assert.equal(requests.some((request) => request.url.includes("/pit-private-media/users/worker_owner/venue/second.mp4?")), true);
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
  assert.equal(result.deletionRechecks, 1,
    "one optimistic 404 cannot retire a key while a previously signed PUT may still settle");
  const retained = db.prepare("SELECT upload_expires_at,status FROM media_objects WHERE object_key=?").get(key);
  assert.equal(retained.status, "delete_queued");
  const finalAt = retained.upload_expires_at + MEDIA_UPLOAD_SETTLE_BUFFER_MS + MEDIA_OWNER_SWEEP_QUIET_WINDOW_MS;
  const final = await runMediaDeletionBatch({
    database: db,
    env: process.env,
    clock: () => finalAt,
    batchSize: 1,
    fetchImpl: async () => ({ status: 404 }),
  });
  assert.equal(final.deleted, 1);
  assert.equal(final.deletionRechecks, 0);
  assert.equal(db.prepare("SELECT 1 FROM media_objects WHERE object_key=?").get(key), undefined);
});

test("legacy photo presign requires verified email before any storage ledger write and permits admins", () => {
  clearMediaTables();
  const user = addUnverifiedUser("legacy_unverified_owner");
  assert.throws(
    () => routes["POST /api/media/presign"]({
      user,
      ip: "legacy-unverified-owner",
      body: { purpose: "avatar", contentType: "image/jpeg", fileSize: 1234, name: "blocked.jpg" },
    }),
    (error) => error.status === 403 && error.code === "MEDIA_EMAIL_VERIFICATION_REQUIRED" && /email/i.test(error.message),
  );
  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_objects WHERE owner_id=?").get(user.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM media_upload_issuances WHERE owner_id=?").get(user.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM legacy_media_finalize_descriptors WHERE owner_id=?").get(user.id).count, 0);

  const admin = addUnverifiedUser("legacy_unverified_admin", "admin");
  const ticket = routes["POST /api/media/presign"]({
    user: admin,
    ip: "legacy-unverified-admin",
    body: { purpose: "avatar", contentType: "image/jpeg", fileSize: 1234, name: "admin.jpg" },
  });
  assert.equal(typeof ticket.uploadUrl, "string");
});

test("abandoned uploads default to a 48-hour staging window", () => {
  assert.equal(mediaOrphanTtlMs({}), 2 * 24 * 60 * 60_000);
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
  const privateFinal = await runMediaOwnerSweepOnce({
    database: db,
    env: process.env,
    fetchImpl: async (url, options) => {
      requested.push({ url, options });
      assert.equal(url.includes("/pit-private-media?"), true);
      return { status: 200, text: async () => "<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>" };
    },
    clock: () => 5_000 + MEDIA_OWNER_SWEEP_QUIET_WINDOW_MS,
  });
  assert.deepEqual(privateFinal, { processed: 1, discovered: 0, hasMore: false, verificationPending: false, errorCode: null });
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
  assert.equal(barrierDelete.deletionRechecks, 1);
  assert.equal(barrierDelete.sweepPages, 1);
  assert.ok(db.prepare("SELECT 1 FROM media_objects WHERE object_key=?").get(key),
    "the exact-key queue identity survives an early 404 throughout the late-PUT quiet window");
  // The same worker pass performs the first mandatory empty prefix check after
  // the signing + normal-client settle barrier. It must retain the sweep: an
  // S3-style provider can authorize a PUT before expiration while its body is
  // still arriving.
  assert.equal(db.prepare("SELECT verification_passes FROM media_owner_sweeps WHERE owner_id=?").get(owner).verification_passes, 1);

  // Model that deliberately slow PUT completing after the first empty pass.
  // The retained exact-prefix sweep sees it on the next pass. The durable
  // exact-key queue already owns this identity, so discovery does not need to
  // recreate a ledger row.
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
  assert.deepEqual(late, { processed: 1, discovered: 0, hasMore: false, verificationPending: true, errorCode: null });
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
  assert.equal(finalDelete.deletionRechecks, 1);
  assert.ok(db.prepare("SELECT 1 FROM media_objects WHERE object_key=?").get(key));
  assert.ok(db.prepare("SELECT 1 FROM media_owner_sweeps WHERE owner_id=?").get(owner),
    "a successful object DELETE must not retire the independent verification sweep");

  const finalBarrier = barrier + MEDIA_OWNER_SWEEP_QUIET_WINDOW_MS;
  const finalPass = await runMediaDeletionBatch({
    database: db,
    env: process.env,
    batchSize: 1,
    clock: () => finalBarrier,
    fetchImpl: async (_url, options) => options.method === "DELETE"
      ? ({ status: 204 })
      : ({ status: 200, text: async () => "<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>" }),
  });
  assert.equal(finalPass.deleted, 1);
  assert.equal(finalPass.deletionRechecks, 0);
  assert.equal(finalPass.sweepPages, 1);
  assert.equal(db.prepare("SELECT 1 FROM media_objects WHERE object_key=?").get(key), undefined);
  const privateVerification = await runMediaOwnerSweepOnce({
    database: db,
    env: process.env,
    clock: () => finalBarrier,
    fetchImpl: async (url) => {
      assert.equal(url.includes("/pit-private-media?"), true);
      return { status: 200, text: async () => "<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>" };
    },
  });
  assert.deepEqual(privateVerification, {
    processed: 1,
    discovered: 0,
    hasMore: false,
    verificationPending: false,
    errorCode: null,
  });
  assert.equal(db.prepare("SELECT 1 FROM media_owner_sweeps WHERE owner_id=?").get(owner), undefined);
});

test("private account-erasure sweeps survive temporary source-bucket configuration loss", async () => {
  clearMediaTables();
  const owner = "private_config_loss_owner";
  const startedAt = 50_000;
  const finalAt = startedAt + MEDIA_OWNER_SWEEP_QUIET_WINDOW_MS;
  assert.equal(enqueueOwnerMediaSweep(db, { ownerId: owner, at: startedAt }), true);

  const publicPass = await runMediaOwnerSweepOnce({
    database: db,
    env: process.env,
    clock: () => finalAt,
    fetchImpl: async (url) => {
      assert.equal(url.includes("/pit-active-media?"), true);
      return { status: 200, text: async () => "<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>" };
    },
  });
  assert.equal(publicPass.processed, 1);
  assert.equal(db.prepare("SELECT storage_scope FROM media_owner_sweeps WHERE owner_id=?").get(owner).storage_scope,
    "private");

  const missingPrivate = { ...process.env, MEDIA_SOURCE_BUCKET: "" };
  const paused = await runMediaOwnerSweepOnce({
    database: db,
    env: missingPrivate,
    clock: () => finalAt,
    fetchImpl: async () => { throw new Error("missing private config must fail before network access"); },
  });
  assert.deepEqual(paused, {
    processed: 1,
    errorCode: "storage_unconfigured",
    retried: 1,
    configurationPaused: true,
  });
  const retained = db.prepare(`SELECT storage_scope,status,attempts,last_error_code,next_attempt_at
    FROM media_owner_sweeps WHERE owner_id=?`).get(owner);
  assert.deepEqual({ ...retained }, {
    storage_scope: "private",
    status: "pending",
    attempts: 0,
    last_error_code: "storage_unconfigured",
    next_attempt_at: finalAt + MEDIA_OWNER_SWEEP_RECHECK_MS,
  });

  const resumed = await runMediaOwnerSweepOnce({
    database: db,
    env: process.env,
    clock: () => finalAt + MEDIA_OWNER_SWEEP_RECHECK_MS,
    fetchImpl: async (url) => {
      assert.equal(url.includes("/pit-private-media?"), true);
      return { status: 200, text: async () => "<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>" };
    },
  });
  assert.equal(resumed.processed, 1);
  assert.equal(db.prepare("SELECT 1 FROM media_owner_sweeps WHERE owner_id=?").get(owner), undefined);
});

test("dead-letter deletion work is observable and safely redrivable without reviving terminal identities", () => {
  clearMediaTables();
  const owner = "dead_redrive_owner";
  const retryKey = `users/${owner}/post/retryable.jpg`;
  const terminalKey = `users/${owner}/post/terminal.jpg`;
  for (const key of [retryKey, terminalKey]) {
    recordMediaObjectTicket(db, { ownerId: owner, objectKey: key, at: 1_000, expiresAt: null });
  }
  enqueueAllOwnedMedia(db, { ownerId: owner, at: 2_000 });
  db.prepare(`UPDATE media_deletion_queue SET status='dead',attempts=5,next_attempt_at=0,
    last_error_code='http_503',dead_at=3_000,updated_at=3_000 WHERE object_key=?`).run(retryKey);
  db.prepare(`UPDATE media_deletion_queue SET status='dead',attempts=1,next_attempt_at=0,
    last_error_code='invalid_key',dead_at=3_000,updated_at=3_000 WHERE object_key=?`).run(terminalKey);
  db.prepare("UPDATE media_objects SET status='deletion_dead',updated_at=3_000 WHERE owner_id=?")
    .run(owner);

  const eligibleAt = 3_000 + MEDIA_DELETION_DEAD_REDRIVE_MS;
  assert.equal(mediaDeletionHealth(db, { env: process.env, at: eligibleAt - 1 }).redriveEligible, 0);
  assert.equal(mediaDeletionHealth(db, { env: process.env, at: eligibleAt }).redriveEligible, 1);
  assert.deepEqual(redriveMediaDeletionDeadLetters(db, { at: eligibleAt }), {
    objects: 1,
    ownerSweeps: 0,
  });
  assert.deepEqual({ ...db.prepare(`SELECT status,attempts,next_attempt_at,last_error_code,dead_at
    FROM media_deletion_queue WHERE object_key=?`).get(retryKey) }, {
    status: "retry",
    attempts: 0,
    next_attempt_at: eligibleAt,
    last_error_code: "operator_redrive",
    dead_at: null,
  });
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(retryKey).status,
    "delete_queued");
  assert.equal(db.prepare("SELECT status FROM media_deletion_queue WHERE object_key=?").get(terminalKey).status,
    "dead");
  assert.equal(db.prepare("SELECT status FROM media_objects WHERE object_key=?").get(terminalKey).status,
    "deletion_dead");
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
