import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after, afterEach } from "node:test";

// Give this test file its own database because Node may execute test files in
// parallel. Importing dynamically keeps the path in force for emailService.
const applicationDataDir = mkdtempSync(join(tmpdir(), "pit-site-health-"));
process.env.PIT_DATA_DIR = applicationDataDir;
process.env.PIT_ALLOW_EMPTY_DB_BOOTSTRAP = "true";
const {
  SITE_HEALTH_CLAIM_LEASE_MS,
  claimSiteHealthDigest,
  collectSiteHealthDigest,
  recordLiveDeploymentStamp,
  runSiteHealthDigest,
  settleSiteHealthDigestClaim,
  startFounderOperationsScheduler,
  siteHealthDigestEnabled,
  siteHealthDigestHour,
  siteHealthDigestSlot,
} = await import("./siteHealthDigest.js");
const { ownerIdentityDeliveryScope } = await import("./ownerApprovals.js");
const { backupDirectory, recordOffhostBackupReceipt } = await import("./backupScheduler.js");
const { db, q } = await import("./db.js");

const markerPattern = "operations.site_health_digest.v1:*";
const founderIdentity = Object.freeze({
  version: 2,
  email: "founder@mshpit.com",
  userId: "founder_health_owner",
  lockedAt: 1,
});
const founderScope = ownerIdentityDeliveryScope(founderIdentity);
const productionEnv = Object.freeze({
  NODE_ENV: "production",
  PIT_ENV: "production",
  OWNER_EMAIL: "founder@mshpit.com",
  PIT_DATA_DIR: process.env.PIT_DATA_DIR,
});

q.insertUser.run(
  founderIdentity.userId,
  founderIdentity.email,
  "Mshpit Founder",
  "mshpit_founder_health",
  "test-only-hash",
  "admin",
  "",
  null,
  null,
  "MF",
  "gold",
  1,
);
db.prepare("INSERT INTO app_meta (key,value) VALUES (?,?)").run(
  "security.bootstrap_admin_identity.v1",
  JSON.stringify(founderIdentity),
);

afterEach(() => {
  db.prepare("DELETE FROM app_meta WHERE key GLOB ?").run(markerPattern);
  db.prepare("DELETE FROM owner_approval_requests").run();
  db.prepare("DELETE FROM error_events").run();
  db.prepare("DELETE FROM email_log").run();
});

after(() => {
  db.close();
  rmSync(applicationDataDir, { recursive: true, force: true });
});

test("daily digest defaults on only for the live production deployment", () => {
  assert.equal(siteHealthDigestEnabled(productionEnv), true);
  assert.equal(siteHealthDigestEnabled({ ...productionEnv, PIT_ENV: "staging" }), false);
  assert.equal(siteHealthDigestEnabled({ ...productionEnv, NODE_ENV: "development" }), false);
  assert.equal(siteHealthDigestEnabled({ ...productionEnv, SITE_HEALTH_DIGEST_ENABLED: "invalid" }), false);
  assert.equal(siteHealthDigestEnabled({ ...productionEnv, SITE_HEALTH_DIGEST_ENABLED: "false" }), false);
  assert.equal(siteHealthDigestHour({ SITE_HEALTH_DIGEST_HOUR: "7" }), 7);
  assert.equal(siteHealthDigestHour({ SITE_HEALTH_DIGEST_HOUR: "" }), 9);
  assert.equal(siteHealthDigestHour({ SITE_HEALTH_DIGEST_HOUR: "24" }), 9);
});

test("the 09:00 Toronto slot follows both EST and EDT", () => {
  const winterBefore = siteHealthDigestSlot(Date.parse("2026-01-15T13:59:00Z"), productionEnv);
  const winterDue = siteHealthDigestSlot(Date.parse("2026-01-15T14:00:00Z"), productionEnv);
  const summerBefore = siteHealthDigestSlot(Date.parse("2026-07-15T12:59:00Z"), productionEnv);
  const summerDue = siteHealthDigestSlot(Date.parse("2026-07-15T13:00:00Z"), productionEnv);
  assert.equal(winterBefore.due, false);
  assert.equal(winterDue.due, true);
  assert.equal(summerBefore.due, false);
  assert.equal(summerDue.due, true);
  assert.equal(winterDue.date, "2026-01-15");
  assert.equal(summerDue.date, "2026-07-15");
});

test("a durable lease suppresses overlap, permits stale recovery, and seals sent days", () => {
  const at = Date.parse("2026-01-15T14:00:00Z");
  const first = claimSiteHealthDigest(db, { date: "2026-01-15", ownerScope: founderScope, at });
  assert.equal(first.claimed, true);
  assert.equal(claimSiteHealthDigest(db, {
    date: "2026-01-15",
    ownerScope: founderScope,
    at: at + 1,
  }).reason, "in-progress");

  const recovered = claimSiteHealthDigest(db, {
    date: "2026-01-15",
    ownerScope: founderScope,
    at: at + SITE_HEALTH_CLAIM_LEASE_MS + 1,
  });
  assert.equal(recovered.claimed, true);
  assert.equal(recovered.attempts, 2);
  assert.equal(settleSiteHealthDigestClaim(db, {
    key: recovered.key,
    claimId: recovered.claimId,
    at: at + SITE_HEALTH_CLAIM_LEASE_MS + 2,
    sent: true,
    status: "healthy",
  }).state, "sent");
  assert.equal(claimSiteHealthDigest(db, {
    date: "2026-01-15",
    ownerScope: founderScope,
    at: at + 2 * SITE_HEALTH_CLAIM_LEASE_MS,
  }).reason, "sent");
});

test("the founder digest uses the fixed template, stable idempotency key, and sends once per day", async () => {
  const at = Date.parse("2026-01-15T14:05:00Z");
  const calls = [];
  const sendTemplateImpl = async (...args) => {
    calls.push(args);
    return { sent: true };
  };
  const first = await runSiteHealthDigest(db, {
    env: productionEnv,
    at,
    uptimeSeconds: 123,
    sendTemplateImpl,
  });
  const duplicate = await runSiteHealthDigest(db, {
    env: productionEnv,
    at: at + 60_000,
    sendTemplateImpl,
  });

  assert.equal(first.sent, true);
  assert.equal(duplicate.sent, false);
  assert.equal(duplicate.reason, "sent");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "site_health_digest");
  assert.equal(calls[0][1].to, "founder@mshpit.com");
  assert.equal(calls[0][1].idempotencyKey, `site-health-2026-01-15-${founderScope}`);
  assert.equal(calls[0][1].idempotencyKey.includes("@"), false);
  assert.match(calls[0][1].vars.detail, /external Render and uptime notifications enabled/u);
});

test("a v1 daily claim cannot suppress the locked v2 Founder's digest on the same day", async (t) => {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE);
    CREATE TABLE app_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
  `);
  database.prepare("INSERT INTO users (id,email) VALUES (?,?),(?,?)")
    .run("legacy_health_owner", "legacy-owner@example.test", "founder_health_owner", "founder@example.test");
  database.prepare("INSERT INTO app_meta (key,value) VALUES (?,?)").run(
    "security.bootstrap_admin_identity.v1",
    JSON.stringify({ version: 1, email: "legacy-owner@example.test", userId: "legacy_health_owner" }),
  );

  const at = Date.parse("2026-01-18T14:00:00Z");
  const deliveries = [];
  const sendTemplateImpl = async (_key, options) => {
    deliveries.push(options);
    return { sent: true };
  };
  const legacy = await runSiteHealthDigest(database, { env: productionEnv, at, sendTemplateImpl });
  database.prepare("UPDATE app_meta SET value=? WHERE key=?").run(
    JSON.stringify({
      version: 2,
      email: "founder@example.test",
      userId: "founder_health_owner",
      lockedAt: at + 1,
    }),
    "security.bootstrap_admin_identity.v1",
  );
  const founder = await runSiteHealthDigest(database, {
    env: productionEnv,
    at: at + 60_000,
    sendTemplateImpl,
  });
  const duplicate = await runSiteHealthDigest(database, {
    env: productionEnv,
    at: at + 120_000,
    sendTemplateImpl,
  });

  assert.equal(legacy.sent, true);
  assert.equal(founder.sent, true);
  assert.equal(duplicate.reason, "sent");
  assert.deepEqual(deliveries.map((delivery) => delivery.to), [
    "legacy-owner@example.test",
    "founder@example.test",
  ]);
  assert.equal(new Set(deliveries.map((delivery) => delivery.idempotencyKey)).size, 2);
  assert.equal(deliveries.every((delivery) => !delivery.idempotencyKey.includes("@")), true);
  const markers = database.prepare("SELECT key FROM app_meta WHERE key GLOB ? ORDER BY key").all(markerPattern);
  assert.equal(markers.length, 2);
  assert.equal(markers.every((marker) => !marker.key.includes("@")), true);
});

test("a failed delivery waits for its durable backoff and then retries", async () => {
  const at = Date.parse("2026-01-16T14:00:00Z");
  let attempts = 0;
  const sendTemplateImpl = async () => ({
    sent: ++attempts > 1,
    reason: attempts > 1 ? null : "provider-rejected",
  });
  const failed = await runSiteHealthDigest(db, { env: productionEnv, at, sendTemplateImpl });
  const early = await runSiteHealthDigest(db, { env: productionEnv, at: at + 4 * 60_000, sendTemplateImpl });
  const retried = await runSiteHealthDigest(db, { env: productionEnv, at: at + 5 * 60_000, sendTemplateImpl });
  assert.equal(failed.settled.state, "retry");
  assert.equal(early.reason, "waiting");
  assert.equal(retried.sent, true);
  assert.equal(attempts, 2);
});

test("health content is aggregate-only and states what the process cannot verify", () => {
  const at = Date.parse("2026-01-17T14:00:00Z");
  db.prepare(`INSERT INTO error_events
    (fingerprint,level,code,status,method,route,cause,last_request_id,count,first_seen,last_seen)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run("secret-fingerprint", "fatal", "PRIVATE_FAILURE", 500, "GET", "/api/users/private-person", "C:/private/raw/path", "request-private", 99, at - 1000, at - 1000);
  db.prepare("INSERT INTO error_occurrence_buckets (fingerprint,hour_start,count) VALUES (?,?,?)")
    .run("secret-fingerprint", Math.floor((at - 1000) / 3_600_000) * 3_600_000, 1);
  db.prepare(`INSERT INTO email_log
    (created_at,kind,template_key,campaign_id,user_id,to_email,subject,status,reason)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(at - 1000, "transactional", "private", null, "user-private", "person@example.com", "Private subject", "failed", "private-reason");
  db.prepare(`INSERT INTO owner_approval_requests
    (id,kind,status,requested_by,target_user_id,safe_summary,payload,payload_hash,token_hash,requested_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run("approval-private", "security_release", "pending", null, null, "private summary", "{\"url\":\"https://private.example\"}", "hash", "token-private", at - 1000, at + 60_000);

  const env = {
    ...productionEnv,
    RESEND_API_KEY: "resend-secret-value",
    MAIL_FROM: "Mshpit <noreply@mail.mshpit.com>",
    MAIL_REPLY_TO: "support@mshpit.com",
    PUBLIC_ORIGIN: "https://private-origin.example/private-path",
    MEDIA_ENDPOINT: "https://private-account.r2.cloudflarestorage.com",
    MEDIA_BUCKET: "private-public-bucket",
    MEDIA_SOURCE_BUCKET: "private-source-bucket",
    MEDIA_REGION: "auto",
    MEDIA_ACCESS_KEY_ID: "private-access-key",
    MEDIA_SECRET_ACCESS_KEY: "private-media-secret",
    MEDIA_PUBLIC_BASE_URL: "https://private-cdn.example/media",
  };
  const digest = collectSiteHealthDigest(db, { env, at, uptimeSeconds: 77 });
  const serialized = JSON.stringify(digest);

  assert.equal(digest.aggregate.activeServerErrorKinds, 1);
  assert.equal(digest.aggregate.activeServerErrorOccurrences, 1);
  assert.equal(digest.aggregate.mail24h.failed, 1);
  assert.equal(digest.aggregate.pendingOwnerApprovals, 1);
  for (const forbidden of [
    "person@example.com", "/api/users/private-person", "C:/private/raw/path",
    "request-private", "private summary", "private-origin.example", "private-public-bucket",
    "private-source-bucket", "private-access-key", "private-media-secret", "resend-secret-value",
  ]) assert.equal(serialized.includes(forbidden), false, `digest leaked ${forbidden}`);
  assert.match(digest.detail, /cannot prove public DNS, Render control-plane\/build status, Google Workspace delivery/u);
  assert.match(digest.detail, /local receipt is written only after the backup child confirms a private remote upload/u);
});

test("health digest distinguishes unconfigured, current, and stale off-host backup evidence", () => {
  const at = Date.parse("2026-09-02T12:00:00Z");
  const unconfigured = collectSiteHealthDigest(db, { env: productionEnv, at });
  assert.equal(unconfigured.aggregate.offhostBackupStatus, "unconfigured");
  assert.equal(unconfigured.aggregate.offhostBackupAgeHours, null);
  assert.equal(unconfigured.aggregate.warnings.includes("offhost_backup_unconfigured"), true);

  const root = mkdtempSync(join(tmpdir(), "pit-site-health-offhost-"));
  const configured = {
    ...productionEnv,
    PIT_DATA_DIR: root,
    BACKUP_S3_ENDPOINT: "https://private.example",
    BACKUP_S3_BUCKET: "pit-private-backups",
    BACKUP_S3_ACCESS_KEY_ID: "backup-id",
    BACKUP_S3_SECRET_ACCESS_KEY: "backup-secret",
    MEDIA_BUCKET: "pit-public-media",
  };
  try {
    mkdirSync(backupDirectory(configured));
    writeFileSync(join(backupDirectory(configured), "pit-20260902-060000.db"), "verified snapshot");
    recordOffhostBackupReceipt(configured, {
      backupName: "pit-20260902-060000.db",
      uploadedAt: at - 6 * 60 * 60 * 1000,
    });
    const current = collectSiteHealthDigest(db, { env: configured, at });
    assert.equal(current.aggregate.offhostBackupStatus, "current");
    assert.equal(current.aggregate.offhostBackupAgeHours, 6);
    assert.equal(current.aggregate.warnings.some((code) => code.startsWith("offhost_backup_")), false);

    const stale = collectSiteHealthDigest(db, { env: configured, at: at + 37 * 60 * 60 * 1000 });
    assert.equal(stale.aggregate.offhostBackupStatus, "stale");
    assert.equal(stale.aggregate.offhostBackupAgeHours, 43);
    assert.equal(stale.aggregate.warnings.includes("offhost_backup_stale"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("strict readiness polling is component state, not 127 app crashes", () => {
  const at = Date.parse("2026-01-17T14:00:00Z");
  const hour = Math.floor((at - 1000) / 3_600_000) * 3_600_000;
  const insertEvent = db.prepare("INSERT INTO error_events (fingerprint,level,code,status,method,route,cause,last_request_id,count,first_seen,last_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  const insertBucket = db.prepare("INSERT INTO error_occurrence_buckets (fingerprint,hour_start,count) VALUES (?,?,?)");
  insertEvent.run("readiness-probe", "error", "MEDIA_STORAGE_UNAVAILABLE", 503, "GET", "/api/readiness", "ApiError", null, 127, at - 1000, at - 1000);
  insertBucket.run("readiness-probe", hour, 127);
  insertEvent.run("real-media-failure", "error", "MEDIA_STORAGE_UNAVAILABLE", 503, "POST", "/api/media/assets/:id/finalize", "ApiError", null, 2, at - 1000, at - 1000);
  insertBucket.run("real-media-failure", hour, 2);

  const digest = collectSiteHealthDigest(db, { env: productionEnv, at, uptimeSeconds: 77 });
  assert.equal(digest.aggregate.activeServerErrorKinds, 1);
  assert.equal(digest.aggregate.activeServerErrorOccurrences, 2);
  assert.equal(digest.aggregate.warnings.includes("server_error_patterns"), true);
});

test("live deployment stamps are production-only and use a bounded commit readout", async () => {
  const calls = [];
  const env = { ...productionEnv, RENDER_GIT_COMMIT: "ABCDEF0123456789abcdef" };
  const created = await recordLiveDeploymentStamp(db, {
    env,
    at: 123,
    recordAndEmail: async (_database, options) => {
      calls.push(options);
      return { created: true };
    },
  });
  assert.equal(created.created, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].commit, env.RENDER_GIT_COMMIT);
  assert.match(calls[0].summary, /abcdef012345 is live/u);
  assert.equal((await recordLiveDeploymentStamp(db, {
    env: { ...env, PIT_ENV: "staging" },
    recordAndEmail: async () => assert.fail("staging must not stamp production"),
  })).reason, "not-production");
  assert.equal((await recordLiveDeploymentStamp(db, {
    env: { ...productionEnv, RENDER_GIT_COMMIT: "not-a-commit" },
    recordAndEmail: async () => assert.fail("invalid commits must not be recorded"),
  })).reason, "no-commit");
});

test("the founder scheduler starts deployment and digest work only for production", async () => {
  const timers = [];
  const cleared = [];
  let stamps = 0;
  let digests = 0;
  const setTimer = (callback, delay) => {
    const handle = { callback, delay, unref() {} };
    timers.push(handle);
    return handle;
  };
  const scheduler = startFounderOperationsScheduler({
    database: db,
    env: productionEnv,
    clock: () => Date.parse("2026-01-17T14:00:00Z"),
    deploymentDelayMs: 5_000,
    initialDelayMs: 30_000,
    intervalMs: 60_000,
    stampDeployment: async () => { stamps += 1; },
    runDigest: async () => { digests += 1; },
    setTimer,
    clearTimer: (handle) => cleared.push(handle),
    logger: { log() {}, error() {} },
  });
  assert.deepEqual(timers.map((timer) => timer.delay), [5_000, 30_000]);
  timers[0].callback();
  await timers[1].callback();
  assert.equal(stamps, 1);
  assert.equal(digests, 1);
  assert.equal(timers[2].delay, 60_000);
  await scheduler.stop();
  assert.ok(cleared.includes(timers[2]));

  const stagingTimers = [];
  const staging = startFounderOperationsScheduler({
    database: db,
    env: { ...productionEnv, PIT_ENV: "staging" },
    setTimer: (...args) => stagingTimers.push(args),
    logger: { log() {}, error() {} },
  });
  assert.equal(staging.hostedProduction, false);
  assert.equal(staging.enabled, false);
  assert.equal(stagingTimers.length, 0);
  await staging.stop();
});
