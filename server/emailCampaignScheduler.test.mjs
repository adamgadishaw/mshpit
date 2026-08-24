import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-email-recovery-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, emailStmts } = await import("./db.js");
const {
  drainCampaign,
  EMAIL_QUEUE_LEASE_MS,
  pauseCampaign,
  resumableCampaigns,
} = await import("./emailQueue.js");
const { createEmailCampaignScheduler, emailCampaignRecoveryEnabled } = await import("./emailCampaignScheduler.js");

test("hosted campaign recovery fails closed until an operator explicitly enables it", () => {
  assert.equal(emailCampaignRecoveryEnabled({ NODE_ENV: "production" }), false);
  assert.equal(emailCampaignRecoveryEnabled({ RENDER: "true", EMAIL_CAMPAIGN_RECOVERY_ENABLED: "false" }), false);
  assert.equal(emailCampaignRecoveryEnabled({ NODE_ENV: "production", EMAIL_CAMPAIGN_RECOVERY_ENABLED: "true" }), true);
  assert.equal(emailCampaignRecoveryEnabled({ NODE_ENV: "development" }), true);
});

let sequence = 0;

function seedCampaign({ status = "sending", recipients = 1, prefix = "recovery" } = {}) {
  sequence += 1;
  const id = `cmp_${prefix}_${sequence}`;
  const createdAt = 1_700_000_000_000 + sequence;
  emailStmts.insertCampaign.run({
    id,
    name: `Recovery ${sequence}`,
    subject: `Recovery ${sequence}`,
    body: "Durable campaign body.",
    cta_label: null,
    cta_url: null,
    audience: "all",
    created_by: null,
    created_at: createdAt,
  });
  emailStmts.setCampaignStatus.run(status, createdAt, id);
  for (let index = 0; index < recipients; index += 1) {
    emailStmts.enqueue.run(id, null, `${prefix}-${sequence}-${index}@example.invalid`, createdAt);
  }
  db.prepare("UPDATE email_campaigns SET started_at=?,total=? WHERE id=?")
    .run(createdAt, recipients, id);
  return id;
}

function queueRows(campaignId) {
  return db.prepare(
    "SELECT id,to_email,status,attempts,claimed_at,claim_token FROM email_queue WHERE campaign_id=? ORDER BY id",
  ).all(campaignId);
}

function schedulerWithDelivery({ deliverImpl, clock = Date.now, batchSize = 25, campaignsPerTick = 4 } = {}) {
  return createEmailCampaignScheduler({
    listCampaigns: resumableCampaigns,
    drain: (campaignId, { max }) => drainCampaign(campaignId, { max, deliverImpl, clock }),
    batchSize,
    campaignsPerTick,
  });
}

beforeEach(() => {
  db.exec("DELETE FROM email_queue; DELETE FROM email_campaigns; DELETE FROM email_log;");
  delete process.env.EMAIL_DAILY_LIMIT;
});

after(() => {
  delete process.env.EMAIL_DAILY_LIMIT;
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test("startup recovery immediately continues persisted pending work in bounded batches exactly once", async () => {
  const campaignId = seedCampaign({ recipients: 5, prefix: "restart" });
  const expectedKeys = queueRows(campaignId).map((row) => `campaign-${campaignId}-${row.id}`);
  const delivered = [];
  const scheduler = schedulerWithDelivery({
    batchSize: 2,
    campaignsPerTick: 1,
    deliverImpl: async ({ to, idempotencyKey }) => {
      delivered.push({ to, idempotencyKey });
      return { sent: true, reason: null };
    },
  });

  scheduler.start();
  const first = await scheduler.tick();
  assert.equal(first.attempted, 2);
  assert.equal(emailStmts.campaignById.get(campaignId).status, "sending");
  assert.equal(emailStmts.campaignById.get(campaignId).sent_count, 2);

  await scheduler.tick();
  const final = await scheduler.tick();
  assert.equal(final.attempted, 1);
  assert.equal(emailStmts.campaignById.get(campaignId).status, "sent");
  assert.deepEqual(delivered.map((item) => item.idempotencyKey), expectedKeys);
  assert.equal(new Set(delivered.map((item) => item.to)).size, 5);

  await scheduler.tick();
  assert.equal(delivered.length, 5, "a later recovery tick cannot resend terminal rows");
  await scheduler.stop();
});

test("periodic worker coalesces overlapping ticks and owns its timer lifecycle", async () => {
  const timers = [];
  const cleared = [];
  let release;
  let entered;
  let calls = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const providerEntered = new Promise((resolve) => { entered = resolve; });
  const scheduler = createEmailCampaignScheduler({
    listCampaigns: () => ["cmp_coalesced"],
    drain: async () => {
      calls += 1;
      if (calls === 1) {
        entered();
        await gate;
      }
      return { attempted: 1, sent: 1 };
    },
    setTimer: (callback, delay) => {
      const handle = { callback, delay, unref() {} };
      timers.push(handle);
      return handle;
    },
    clearTimer: (handle) => { cleared.push(handle); },
  });

  scheduler.start();
  await providerEntered;
  const active = scheduler.tick();
  assert.equal(scheduler.tick(), active, "concurrent ticks share the active operation");
  release();
  await active;
  assert.equal(calls, 1);
  assert.equal(timers.length, 1, "the next tick is scheduled only after the active one settles");

  await timers[0].callback();
  assert.equal(calls, 2);
  assert.equal(timers.length, 2, "a completed periodic tick schedules its successor");
  await scheduler.stop();
  assert.deepEqual(cleared, [timers[1]]);
});

test("periodic recovery waits out live leases and reclaims only expired work", async () => {
  const fixedNow = 20_000_000;
  let now = fixedNow;
  const liveId = seedCampaign({ recipients: 1, prefix: "live" });
  const expiredId = seedCampaign({ recipients: 1, prefix: "expired" });
  db.prepare(`UPDATE email_queue SET status='sending',attempts=1,claimed_at=?,claim_token='live-worker'
    WHERE campaign_id=?`).run(fixedNow, liveId);
  db.prepare(`UPDATE email_queue SET status='sending',attempts=1,claimed_at=?,claim_token='dead-worker'
    WHERE campaign_id=?`).run(fixedNow - EMAIL_QUEUE_LEASE_MS - 1, expiredId);

  const delivered = [];
  const scheduler = schedulerWithDelivery({
    campaignsPerTick: 2,
    batchSize: 1,
    clock: () => now,
    deliverImpl: async ({ to, idempotencyKey }) => {
      delivered.push({ to, idempotencyKey });
      return { sent: true, reason: null };
    },
  });

  await scheduler.tick();
  assert.equal(delivered.length, 1);
  assert.match(delivered[0].to, /^expired-/);
  assert.equal(emailStmts.campaignById.get(expiredId).status, "sent");
  assert.equal(emailStmts.campaignById.get(liveId).status, "sending");
  const stillLive = queueRows(liveId)[0];
  assert.equal(stillLive.status, "sending");
  assert.equal(stillLive.attempts, 1);
  assert.equal(stillLive.claimed_at, fixedNow);
  assert.equal(stillLive.claim_token, "live-worker");

  now = fixedNow + EMAIL_QUEUE_LEASE_MS + 1;
  await scheduler.tick();
  const liveRow = queueRows(liveId)[0];
  assert.equal(emailStmts.campaignById.get(liveId).status, "sent");
  assert.equal(liveRow.status, "sent");
  assert.equal(liveRow.attempts, 2);
  assert.equal(delivered[1].idempotencyKey, `campaign-${liveId}-${liveRow.id}`);
  await scheduler.tick();
  assert.equal(delivered.length, 2);
});

test("daily cap leaves work sending and a later tick resumes when budget returns", async () => {
  const campaignId = seedCampaign({ recipients: 1, prefix: "budget" });
  process.env.EMAIL_DAILY_LIMIT = "1";
  emailStmts.insertLog.run({
    created_at: Date.now(),
    kind: "campaign",
    template_key: null,
    campaign_id: "cmp_prior",
    user_id: null,
    to_email: "prior@example.invalid",
    subject: "Prior",
    status: "sent",
    reason: null,
  });
  let calls = 0;
  const scheduler = schedulerWithDelivery({
    deliverImpl: async () => {
      calls += 1;
      return { sent: true, reason: null };
    },
  });

  const capped = await scheduler.tick();
  assert.equal(capped.stoppedBy, "daily-limit");
  assert.equal(calls, 0);
  assert.equal(emailStmts.campaignById.get(campaignId).status, "sending");
  assert.equal(queueRows(campaignId)[0].status, "pending");

  db.prepare("DELETE FROM email_log").run();
  const resumed = await scheduler.tick();
  assert.equal(resumed.sent, 1);
  assert.equal(calls, 1);
  assert.equal(emailStmts.campaignById.get(campaignId).status, "sent");
});

test("manual and provider-error pauses are authoritative across later ticks", async () => {
  const manualId = seedCampaign({ recipients: 1, prefix: "manual-pause" });
  const providerId = seedCampaign({ recipients: 1, prefix: "provider-pause" });
  assert.equal(pauseCampaign(manualId).ok, true);
  let calls = 0;
  const scheduler = schedulerWithDelivery({
    deliverImpl: async () => {
      calls += 1;
      return { sent: false, reason: "send-failed" };
    },
  });

  await scheduler.tick();
  assert.equal(calls, 1, "the already-paused campaign is never offered to the worker");
  assert.equal(emailStmts.campaignById.get(manualId).status, "paused");
  assert.equal(queueRows(manualId)[0].attempts, 0);
  assert.equal(emailStmts.campaignById.get(providerId).status, "paused");
  assert.equal(queueRows(providerId)[0].status, "pending");

  await scheduler.tick();
  assert.equal(calls, 1, "a provider-error pause requires explicit operator resumption");
  assert.equal(queueRows(providerId)[0].attempts, 1);
});

test("scheduler failures are contained, sanitized, and observable", async () => {
  const messages = [];
  const discovery = createEmailCampaignScheduler({
    listCampaigns: () => { throw Object.assign(new Error("private database text"), { code: "SQLITE_BUSY" }); },
    logger: { error: (message) => messages.push(message) },
  });
  const discoveryResult = await discovery.tick();
  assert.equal(discoveryResult.errors, 1);
  assert.match(messages[0], /discovery failed safely: Error\/SQLITE_BUSY/);
  assert.doesNotMatch(messages[0], /private database text/);

  const drain = createEmailCampaignScheduler({
    listCampaigns: () => ["cmp_observable"],
    drain: async () => { throw Object.assign(new Error("provider response body"), { code: "UPSTREAM" }); },
    logger: { error: (message) => messages.push(message) },
  });
  const drainResult = await drain.tick();
  assert.equal(drainResult.errors, 1);
  assert.match(messages[1], /drain failed safely for campaign cmp_observable: Error\/UPSTREAM/);
  assert.doesNotMatch(messages[1], /provider response body/);
});

test("server startup and shutdown own the campaign recovery worker", () => {
  const source = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  const startup = source.indexOf("emailCampaignScheduler = startEmailCampaignScheduler()");
  const gate = source.indexOf("emailCampaignRecoveryEnabled()");
  const shutdown = source.indexOf("emailCampaignScheduler?.stop()");
  const databaseClose = source.indexOf("db.close()", shutdown);
  assert.ok(startup > source.indexOf("server.listen("), "recovery starts only after the HTTP server is ready");
  assert.ok(gate > source.indexOf("server.listen(") && gate < startup, "hosted recovery is gated before the worker starts");
  assert.ok(shutdown > 0, "graceful shutdown stops future recovery ticks");
  assert.ok(databaseClose > shutdown, "the active bounded tick settles before the database closes");
});
