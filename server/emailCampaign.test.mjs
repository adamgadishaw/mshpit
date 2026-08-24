import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-email-"));
process.env.PIT_DATA_DIR = dataDir;
process.env.RESEND_API_KEY = "re_test_key";
process.env.MAIL_FROM = "Pit <noreply@mail.example.com>";
process.env.PUBLIC_ORIGIN = "https://www.example.com";

const { db, q, emailStmts } = await import("./db.js");
const { routes } = await import("./api.js");
const { renderEmail, fillTokens, safeUrl } = await import("./emails.js");
const { drainCampaign, pauseCampaign, startCampaign, EMAIL_QUEUE_LEASE_MS } = await import("./emailQueue.js");

// Every send goes through global fetch in mailer.js, so stubbing it captures the
// exact set of addresses the platform would have mailed.
const realFetch = globalThis.fetch;
let sentTo = [];
let sentKeys = [];
let failNext = false;
let nextFetchGate = null;
function deferNextFetch() {
  let release;
  let markEntered;
  const wait = new Promise((resolve) => { release = resolve; });
  const entered = new Promise((resolve) => { markEntered = resolve; });
  nextFetchGate = { wait, markEntered };
  return { entered, release };
}
before(() => {
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (nextFetchGate) {
      const gate = nextFetchGate;
      nextFetchGate = null;
      gate.markEntered();
      await gate.wait;
    }
    if (failNext) return { ok: false, status: 403, text: async () => "domain not verified" };
    sentTo.push(body.to[0]);
    sentKeys.push(init.headers?.["Idempotency-Key"] || null);
    return { ok: true, status: 200, text: async () => "{}" };
  };
});
after(() => {
  globalThis.fetch = realFetch;
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id, email, handle, extra = {}) {
  q.insertUser.run(id, email, handle, handle, "hash", extra.role || "fan", null, null, null, "XX", "#111111", Date.now());
  db.prepare(`UPDATE users SET email_verified_at=?,marketing_opt_out=?,marketing_consent_at=?,
    marketing_consent_version='test',marketing_consent_source='test',marketing_withdrawn_at=? WHERE id=?`)
    .run(extra.unverified ? 0 : Date.now(), extra.optOut ? 1 : 0, extra.noConsent ? null : Date.now(), extra.optOut ? Date.now() : null, id);
  if (extra.banned) db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(id);
  return q.userById.get(id);
}

const admin = addUser("u_mail_admin", "admin@example.com", "theadmin", { role: "admin" });
addUser("u_mail_a", "a@example.com", "fanaaa");
addUser("u_mail_b", "b@example.com", "fanbbb");
const optedOut = addUser("u_mail_out", "out@example.com", "fanout", { optOut: true });
addUser("u_mail_ban", "ban@example.com", "fanban", { banned: true });
addUser("u_mail_unverified", "unverified@example.com", "fanunverified", { unverified: true });

const ctxFor = (user, extra = {}) => ({ user, ip: "127.0.0.1", ua: "test", body: {}, params: {}, query: {}, ...extra });
// Several routes are synchronous and throw rather than reject, which
// assert.rejects does not accept. Route every call through a promise so both
// shapes are asserted the same way.
const call = (route, ctx) => Promise.resolve().then(() => routes[route](ctx));

test("template copy falls back to the built-in default and can be overridden then restored", async () => {
  const before = await routes["GET /api/admin/email/templates/:key"](ctxFor(admin, { params: { key: "welcome" } }));
  assert.equal(before.template.customized, false);

  await routes["PUT /api/admin/email/templates/:key"](ctxFor(admin, {
    params: { key: "welcome" },
    body: { subject: "Custom hello {{name}}", body: "Edited copy.", ctaLabel: "Go", ctaUrl: "{{origin}}" },
  }));
  const edited = await routes["GET /api/admin/email/templates/:key"](ctxFor(admin, { params: { key: "welcome" } }));
  assert.equal(edited.template.customized, true);
  assert.equal(edited.template.subject, "Custom hello {{name}}");

  await routes["DELETE /api/admin/email/templates/:key"](ctxFor(admin, { params: { key: "welcome" } }));
  const restored = await routes["GET /api/admin/email/templates/:key"](ctxFor(admin, { params: { key: "welcome" } }));
  assert.equal(restored.template.customized, false, "deleting the override restores the built-in copy");
});

test("rendering escapes user-supplied values instead of trusting them as markup", () => {
  const rendered = renderEmail({
    subject: "Hi {{name}}", body: "Welcome {{name}}", kind: "transactional",
    vars: { name: "<script>alert(1)</script>", origin: "https://www.example.com" },
  });
  assert.ok(!rendered.html.includes("<script>"), "raw script tag must not reach the HTML part");
  assert.ok(rendered.html.includes("&lt;script&gt;"));
});

test("a value that looks like a token is not expanded a second time", () => {
  const out = fillTokens("Hello {{name}}", { name: "{{origin}}", origin: "https://evil.example" });
  assert.equal(out, "Hello {{origin}}", "substitution is single-pass");
});

test("a non-http button target is dropped rather than rendered", () => {
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("data:text/html,x"), null);
  assert.equal(safeUrl("https://ok.example/x"), "https://ok.example/x");
  const rendered = renderEmail({ subject: "s", body: "b", ctaLabel: "Click", ctaUrl: "javascript:alert(1)", vars: {} });
  assert.ok(!rendered.html.includes("javascript:"));
});

test("a broadcast cannot go out until a test has been sent and the send is confirmed", async () => {
  const { campaign } = await routes["POST /api/admin/email/campaigns"](ctxFor(admin, {
    body: { name: "Launch", subject: "Pit is live", body: "Hey {{name}}, we launched.", audience: "all" },
  }));

  await assert.rejects(
    () => call("POST /api/admin/email/campaigns/:id/send", ctxFor(admin, { params: { id: campaign.id }, body: { confirm: true } })),
    /test first/i,
    "sending without a test must be refused",
  );

  sentTo = [];
  await routes["POST /api/admin/email/campaigns/:id/test"](ctxFor(admin, { params: { id: campaign.id } }));
  assert.deepEqual(sentTo, ["admin@example.com"], "a test goes only to the acting admin");

  await assert.rejects(
    () => call("POST /api/admin/email/campaigns/:id/send", ctxFor(admin, { params: { id: campaign.id }, body: {} })),
    /Confirmation is required/i,
  );
});

test("editing a tested campaign preserves omitted fields but requires a fresh test", async () => {
  const { campaign } = await routes["POST /api/admin/email/campaigns"](ctxFor(admin, {
    body: {
      name: "Revision gate",
      subject: "Original",
      body: "Original body",
      ctaLabel: "Open Pit",
      ctaUrl: "https://www.example.com/open",
      audience: "staff",
    },
  }));
  await routes["POST /api/admin/email/campaigns/:id/test"](ctxFor(admin, { params: { id: campaign.id } }));
  const testedAt = emailStmts.campaignById.get(campaign.id).test_sent_at;
  assert.ok(testedAt);

  routes["PATCH /api/admin/email/campaigns/:id"](ctxFor(admin, {
    params: { id: campaign.id }, body: {},
  }));
  assert.equal(emailStmts.campaignById.get(campaign.id).test_sent_at, testedAt,
    "a no-op patch does not manufacture a new approval requirement");

  const edited = routes["PATCH /api/admin/email/campaigns/:id"](ctxFor(admin, {
    params: { id: campaign.id },
    body: { subject: "Revised" },
  })).campaign;
  assert.equal(edited.cta_label, "Open Pit", "an omitted CTA label is preserved");
  assert.equal(edited.cta_url, "https://www.example.com/open", "an omitted CTA URL is preserved");
  assert.equal(edited.test_sent_at, null, "material copy changes invalidate the approval");
  await assert.rejects(
    () => call("POST /api/admin/email/campaigns/:id/send", ctxFor(admin, { params: { id: campaign.id }, body: { confirm: true } })),
    /test first/i,
  );

  await assert.rejects(
    () => call("PATCH /api/admin/email/campaigns/:id", ctxFor(admin, {
      params: { id: campaign.id }, body: { ctaUrl: "javascript:alert(1)" },
    })),
    /http or https/i,
  );
});

test("a delayed test of old copy cannot approve a newer campaign revision", async () => {
  const { campaign } = routes["POST /api/admin/email/campaigns"](ctxFor(admin, {
    body: { name: "Delayed test", subject: "Old copy", body: "Old body", audience: "staff" },
  }));
  const originalRevision = emailStmts.campaignById.get(campaign.id).content_revision;
  const gate = deferNextFetch();
  sentTo = [];
  const testing = call("POST /api/admin/email/campaigns/:id/test", ctxFor(admin, {
    params: { id: campaign.id },
  }));
  await gate.entered;

  const edited = routes["PATCH /api/admin/email/campaigns/:id"](ctxFor(admin, {
    params: { id: campaign.id }, body: { subject: "New copy" },
  })).campaign;
  assert.equal(edited.content_revision, originalRevision + 1);
  assert.equal(edited.tested_revision, null);
  assert.equal(edited.test_sent_at, null);

  gate.release();
  await assert.rejects(testing,
    (error) => error.status === 409 && /changed.*fresh test/i.test(error.message));
  assert.deepEqual(sentTo, ["admin@example.com"], "only the superseded test copy was delivered");
  const afterOldDelivery = emailStmts.campaignById.get(campaign.id);
  assert.equal(afterOldDelivery.content_revision, originalRevision + 1);
  assert.equal(afterOldDelivery.tested_revision, null, "the old delivery cannot approve the new revision");
  assert.equal(afterOldDelivery.test_sent_at, null);
  await assert.rejects(
    () => call("POST /api/admin/email/campaigns/:id/send", ctxFor(admin, {
      params: { id: campaign.id }, body: { confirm: true },
    })),
    /test first/i,
  );

  await routes["POST /api/admin/email/campaigns/:id/test"](ctxFor(admin, { params: { id: campaign.id } }));
  const freshlyTested = emailStmts.campaignById.get(campaign.id);
  assert.equal(freshlyTested.tested_revision, freshlyTested.content_revision);
  assert.ok(freshlyTested.test_sent_at);
});

test("PATCH and send transitions serialize so exactly one revision wins", async () => {
  const sendWins = routes["POST /api/admin/email/campaigns"](ctxFor(admin, {
    body: { name: "Send wins", subject: "Approved copy", body: "Approved body", audience: "staff" },
  })).campaign;
  await routes["POST /api/admin/email/campaigns/:id/test"](ctxFor(admin, { params: { id: sendWins.id } }));
  const sendGate = deferNextFetch();
  const sending = call("POST /api/admin/email/campaigns/:id/send", ctxFor(admin, {
    params: { id: sendWins.id }, body: { confirm: true, batch: 1 },
  }));
  await sendGate.entered;
  await assert.rejects(
    () => call("PATCH /api/admin/email/campaigns/:id", ctxFor(admin, {
      params: { id: sendWins.id }, body: { subject: "Too late" },
    })),
    (error) => error.status === 409,
  );
  sendGate.release();
  await sending;
  const sentCampaign = emailStmts.campaignById.get(sendWins.id);
  assert.equal(sentCampaign.subject, "Approved copy");
  assert.equal(sentCampaign.status, "sent");
  assert.equal(sentCampaign.tested_revision, sentCampaign.content_revision);

  const patchWins = routes["POST /api/admin/email/campaigns"](ctxFor(admin, {
    body: { name: "Patch wins", subject: "First copy", body: "First body", audience: "staff" },
  })).campaign;
  await routes["POST /api/admin/email/campaigns/:id/test"](ctxFor(admin, { params: { id: patchWins.id } }));
  const [patchResult, sendResult] = await Promise.allSettled([
    call("PATCH /api/admin/email/campaigns/:id", ctxFor(admin, {
      params: { id: patchWins.id }, body: { subject: "Edited first" },
    })),
    call("POST /api/admin/email/campaigns/:id/send", ctxFor(admin, {
      params: { id: patchWins.id }, body: { confirm: true },
    })),
  ]);
  assert.equal(patchResult.status, "fulfilled");
  assert.equal(sendResult.status, "rejected");
  assert.match(sendResult.reason.message, /test first/i);
  const editedCampaign = emailStmts.campaignById.get(patchWins.id);
  assert.equal(editedCampaign.status, "draft");
  assert.equal(editedCampaign.subject, "Edited first");
  assert.equal(editedCampaign.tested_revision, null);
  assert.equal(emailStmts.countQueued.get(patchWins.id).c, 0, "a losing send cannot expand its audience");
});

test("campaign drains use single-flight and expiring token-owned claims", async () => {
  const makeStaffCampaign = (name) => {
    const { campaign } = routes["POST /api/admin/email/campaigns"](ctxFor(admin, {
      body: { name, subject: name, body: name, audience: "staff" },
    }));
    assert.equal(startCampaign(campaign.id, { requireCurrentTest: false }).ok, true);
    return campaign.id;
  };

  const concurrentId = makeStaffCampaign("Concurrent claim");
  let release;
  let entered;
  const gate = new Promise((resolve) => { release = resolve; });
  const providerEntered = new Promise((resolve) => { entered = resolve; });
  let providerCalls = 0;
  const first = drainCampaign(concurrentId, {
    max: 10,
    deliverImpl: async () => {
      providerCalls += 1;
      entered();
      await gate;
      return { sent: true, reason: null };
    },
  });
  await providerEntered;
  const second = drainCampaign(concurrentId, {
    max: 10,
    deliverImpl: async () => { providerCalls += 1; return { sent: true, reason: null }; },
  });
  release();
  await Promise.all([first, second]);
  assert.equal(providerCalls, 1, "two concurrent drains share one in-process operation");
  assert.equal(emailStmts.campaignById.get(concurrentId).status, "sent");

  const fixedNow = 9_000_000;
  const staleId = makeStaffCampaign("Stale claim");
  db.prepare(`UPDATE email_queue SET status='sending',attempts=1,claimed_at=?,claim_token='dead-worker'
    WHERE campaign_id=?`).run(fixedNow - EMAIL_QUEUE_LEASE_MS - 1, staleId);
  let staleCalls = 0;
  await drainCampaign(staleId, {
    clock: () => fixedNow,
    deliverImpl: async () => { staleCalls += 1; return { sent: true, reason: null }; },
  });
  assert.equal(staleCalls, 1, "an expired lease is reclaimed");

  const liveId = makeStaffCampaign("Live claim");
  db.prepare(`UPDATE email_queue SET status='sending',attempts=1,claimed_at=?,claim_token='live-worker'
    WHERE campaign_id=?`).run(fixedNow, liveId);
  let liveCalls = 0;
  await drainCampaign(liveId, {
    clock: () => fixedNow,
    deliverImpl: async () => { liveCalls += 1; return { sent: true, reason: null }; },
  });
  assert.equal(liveCalls, 0, "a current worker's lease is never reset by another drain");
  assert.equal(db.prepare("SELECT status FROM email_queue WHERE campaign_id=?").get(liveId).status, "sending");

  const ownershipId = makeStaffCampaign("Token ownership");
  const ownership = await drainCampaign(ownershipId, {
    clock: () => fixedNow,
    deliverImpl: async () => {
      db.prepare(`UPDATE email_queue SET claim_token='replacement-worker',claimed_at=?
        WHERE campaign_id=? AND status='sending'`).run(fixedNow + 1, ownershipId);
      return { sent: true, reason: null };
    },
  });
  const replacementClaim = db.prepare("SELECT status,claim_token FROM email_queue WHERE campaign_id=?").get(ownershipId);
  assert.equal(ownership.stoppedBy, "lease-lost");
  assert.equal(replacementClaim.status, "sending");
  assert.equal(replacementClaim.claim_token, "replacement-worker",
    "a stale provider response cannot settle a row now owned by another worker");
});

test("a concurrent pause settles only the in-flight row and cannot be overwritten", async () => {
  const createStarted = (name, audience) => {
    const { campaign } = routes["POST /api/admin/email/campaigns"](ctxFor(admin, {
      body: { name, subject: name, body: name, audience },
    }));
    assert.equal(startCampaign(campaign.id, { requireCurrentTest: false }).ok, true);
    return campaign.id;
  };
  const deferredProvider = () => {
    let release;
    let markEntered;
    const wait = new Promise((resolve) => { release = resolve; });
    const entered = new Promise((resolve) => { markEntered = resolve; });
    let calls = 0;
    return {
      entered,
      release,
      calls: () => calls,
      deliver: async () => {
        calls += 1;
        markEntered();
        await wait;
        return { sent: true, reason: null };
      },
    };
  };

  const multiId = createStarted("Pause authority multi", "all");
  const multiProvider = deferredProvider();
  const multiDrain = drainCampaign(multiId, { max: 50, deliverImpl: multiProvider.deliver });
  await multiProvider.entered;
  assert.equal(pauseCampaign(multiId).ok, true);
  multiProvider.release();
  const multiResult = await multiDrain;
  const multiRows = db.prepare("SELECT status,COUNT(*) c FROM email_queue WHERE campaign_id=? GROUP BY status")
    .all(multiId).reduce((out, row) => ({ ...out, [row.status]: row.c }), {});
  assert.equal(multiProvider.calls(), 1, "no recipient after the in-flight row may be claimed");
  assert.equal(multiRows.sent, 1);
  assert.equal(multiRows.pending, 2);
  assert.equal(multiResult.stoppedBy, "status-paused");
  assert.equal(emailStmts.campaignById.get(multiId).status, "paused");

  const finalId = createStarted("Pause authority final row", "staff");
  const finalProvider = deferredProvider();
  const finalDrain = drainCampaign(finalId, { max: 50, deliverImpl: finalProvider.deliver });
  await finalProvider.entered;
  assert.equal(pauseCampaign(finalId).ok, true);
  finalProvider.release();
  const finalResult = await finalDrain;
  assert.equal(db.prepare("SELECT status FROM email_queue WHERE campaign_id=?").get(finalId).status, "sent");
  assert.equal(emailStmts.campaignById.get(finalId).status, "paused",
    "conditional finalization cannot overwrite an authoritative pause");
  assert.equal(finalResult.finished, undefined);
  assert.equal(finalResult.finalStatus, "paused");
});

test("provider and deployment outages pause after one address and keep it retryable", async () => {
  const reasons = [
    "error",
    "send-failed",
    "sender-not-verified",
    "not-configured",
    "missing-api-key",
    "missing-api-key-and-from",
    "missing-from",
    "invalid-from",
  ];
  for (const reason of reasons) {
    const { campaign } = routes["POST /api/admin/email/campaigns"](ctxFor(admin, {
      body: { name: `Outage ${reason}`, subject: reason, body: reason, audience: "staff" },
    }));
    assert.equal(startCampaign(campaign.id, { requireCurrentTest: false }).ok, true);
    let calls = 0;
    const result = await drainCampaign(campaign.id, {
      max: 50,
      deliverImpl: async () => { calls += 1; return { sent: false, reason }; },
    });
    const durable = emailStmts.campaignById.get(campaign.id);
    const queue = db.prepare("SELECT status,attempts,last_error FROM email_queue WHERE campaign_id=?").get(campaign.id);
    assert.equal(calls, 1, `${reason} must stop before touching another recipient`);
    assert.equal(result.stoppedBy, "provider-error");
    assert.equal(result.retryable, true);
    assert.equal(queue.status, "pending", `${reason} must release the token-owned claim`);
    assert.equal(queue.attempts, 1);
    assert.equal(queue.last_error, reason);
    assert.equal(durable.status, "paused");
    assert.equal(durable.failed_count, 0);
    assert.equal(durable.sent_count, 0);
  }
});

test("a network outage resumes the same row and delivers it exactly once", async () => {
  const { campaign } = routes["POST /api/admin/email/campaigns"](ctxFor(admin, {
    body: { name: "Network retry", subject: "Retry copy", body: "Retry body", audience: "staff" },
  }));
  assert.equal(startCampaign(campaign.id, { requireCurrentTest: false }).ok, true);
  let firstKey = null;
  const failed = await drainCampaign(campaign.id, {
    max: 10,
    deliverImpl: async ({ idempotencyKey }) => {
      firstKey = idempotencyKey;
      return { sent: false, reason: "error" };
    },
  });
  assert.equal(failed.retryable, true);
  assert.equal(emailStmts.campaignById.get(campaign.id).status, "paused");
  assert.equal(db.prepare("SELECT status FROM email_queue WHERE campaign_id=?").get(campaign.id).status, "pending");

  sentTo = [];
  sentKeys = [];
  const resumed = await routes["POST /api/admin/email/campaigns/:id/resume"](ctxFor(admin, {
    params: { id: campaign.id }, body: { batch: 10 },
  }));
  assert.deepEqual(sentTo, ["admin@example.com"]);
  assert.deepEqual(sentKeys, [firstKey], "the row-derived idempotency key survives retry");
  assert.equal(resumed.campaign.status, "sent");
  assert.equal(resumed.campaign.sent_count, 1);
  assert.equal(resumed.campaign.failed_count, 0);
  assert.equal(db.prepare("SELECT attempts,status FROM email_queue WHERE campaign_id=?").get(campaign.id).attempts, 2);
});

test("an all-outage campaign exhausts bounded attempts as failed, never sent", async () => {
  const { campaign } = routes["POST /api/admin/email/campaigns"](ctxFor(admin, {
    body: { name: "Persistent outage", subject: "Outage", body: "Outage", audience: "staff" },
  }));
  assert.equal(startCampaign(campaign.id, { requireCurrentTest: false }).ok, true);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (attempt > 1) emailStmts.setCampaignStatus.run("sending", Date.now(), campaign.id);
    const result = await drainCampaign(campaign.id, {
      max: 10,
      deliverImpl: async () => ({ sent: false, reason: "error" }),
    });
    const current = emailStmts.campaignById.get(campaign.id);
    if (attempt < 3) {
      assert.equal(result.retryable, true);
      assert.equal(current.status, "paused");
    } else {
      assert.equal(result.retryable, false);
      assert.equal(result.finalStatus, "failed");
      assert.equal(current.status, "failed");
      assert.equal(current.failed_count, 1);
      assert.notEqual(current.status, "sent");
    }
  }
  const row = db.prepare("SELECT attempts,status FROM email_queue WHERE campaign_id=?").get(campaign.id);
  assert.equal(row.attempts, 3);
  assert.equal(row.status, "failed");
});

test("two campaigns cannot spend the same final process-local daily slot", async () => {
  const makeCampaign = (name) => {
    const { campaign } = routes["POST /api/admin/email/campaigns"](ctxFor(admin, {
      body: { name, subject: name, body: name, audience: "staff" },
    }));
    assert.equal(startCampaign(campaign.id, { requireCurrentTest: false }).ok, true);
    return campaign.id;
  };
  const firstId = makeCampaign("Cap race one");
  const secondId = makeCampaign("Cap race two");
  const sentBefore = db.prepare("SELECT COUNT(*) c FROM email_log WHERE status='sent' AND created_at>=?")
    .get(Date.now() - 24 * 60 * 60 * 1000).c;
  const priorLimit = process.env.EMAIL_DAILY_LIMIT;
  process.env.EMAIL_DAILY_LIMIT = String(sentBefore + 1);
  sentTo = [];
  sentKeys = [];
  const gate = deferNextFetch();
  try {
    const first = drainCampaign(firstId, { max: 1 });
    await gate.entered;
    const second = drainCampaign(secondId, { max: 1 });
    gate.release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.equal(firstResult.sent, 1);
    assert.equal(secondResult.sent, 0);
    assert.equal(secondResult.stoppedBy, "daily-limit");
    assert.deepEqual(sentTo, ["admin@example.com"], "only one campaign consumes the final slot");
    assert.equal(emailStmts.campaignById.get(firstId).status, "sent");
    assert.equal(emailStmts.campaignById.get(secondId).status, "sending");
    assert.equal(db.prepare("SELECT status FROM email_queue WHERE campaign_id=?").get(secondId).status, "pending");
  } finally {
    gate.release();
    if (priorLimit === undefined) delete process.env.EMAIL_DAILY_LIMIT;
    else process.env.EMAIL_DAILY_LIMIT = priorLimit;
  }
});

test("a broadcast skips opted-out and banned accounts and records why", async () => {
  const { campaign } = await routes["POST /api/admin/email/campaigns"](ctxFor(admin, {
    body: { name: "Announce", subject: "News", body: "Hi {{name}}.", audience: "all" },
  }));
  await routes["POST /api/admin/email/campaigns/:id/test"](ctxFor(admin, { params: { id: campaign.id } }));

  sentTo = [];
  const result = await routes["POST /api/admin/email/campaigns/:id/send"](ctxFor(admin, {
    params: { id: campaign.id }, body: { confirm: true },
  }));

  assert.ok(!sentTo.includes("out@example.com"), "an opted-out account must never receive a broadcast");
  assert.ok(!sentTo.includes("ban@example.com"), "a banned account must never receive a broadcast");
  assert.ok(!sentTo.includes("unverified@example.com"), "an unverified address must never receive a broadcast");
  assert.ok(sentTo.includes("a@example.com") && sentTo.includes("b@example.com"));
  assert.equal(result.campaign.status, "sent");

  const logged = db.prepare("SELECT to_email,status FROM email_log WHERE campaign_id=? AND status='sent'").all(campaign.id);
  assert.ok(logged.length >= 2, "every delivered message is recorded in the log");
});

test("re-running a finished campaign does not mail anyone twice", async () => {
  const { campaign } = await routes["POST /api/admin/email/campaigns"](ctxFor(admin, {
    body: { name: "Once", subject: "Once", body: "Once.", audience: "all" },
  }));
  await routes["POST /api/admin/email/campaigns/:id/test"](ctxFor(admin, { params: { id: campaign.id } }));
  sentTo = [];
  await routes["POST /api/admin/email/campaigns/:id/send"](ctxFor(admin, { params: { id: campaign.id }, body: { confirm: true } }));
  const firstPass = sentTo.length;

  sentTo = [];
  const again = await drainCampaign(campaign.id, { max: 50 });
  assert.equal(sentTo.length, 0, "a completed campaign has nothing left to send");
  assert.equal(again.ok, false, "draining a finished campaign reports that it is not sending");
  assert.ok(firstPass > 0);
});

test("a provider failure pauses the campaign instead of burning the whole queue", async () => {
  const { campaign } = await routes["POST /api/admin/email/campaigns"](ctxFor(admin, {
    body: { name: "Broken", subject: "Broken", body: "Broken.", audience: "all" },
  }));
  await routes["POST /api/admin/email/campaigns/:id/test"](ctxFor(admin, { params: { id: campaign.id } }));

  failNext = true;
  const result = await routes["POST /api/admin/email/campaigns/:id/send"](ctxFor(admin, {
    params: { id: campaign.id }, body: { confirm: true },
  }));
  failNext = false;

  assert.equal(result.drained.stoppedBy, "provider-error");
  assert.equal(result.campaign.status, "paused");
  assert.ok(result.campaign.pending > 0, "the untouched recipients stay queued for a resume");
});

test("unsubscribe needs the POST; following the emailed GET link alone changes nothing", async () => {
  const token = emailStmts.userUnsubToken.get("u_mail_a")?.unsub_token;
  assert.ok(token, "a token is minted the first time the user is mailed");

  const redirect = await routes["GET /api/unsubscribe"](ctxFor(null, { query: { token } }));
  assert.match(redirect.redirect, /#unsubscribe=/);
  assert.equal(q.userById.get("u_mail_a").marketing_opt_out, 0, "a scanner following the link must not opt anyone out");

  await routes["POST /api/unsubscribe"](ctxFor(null, { body: { token } }));
  assert.equal(q.userById.get("u_mail_a").marketing_opt_out, 1);

  await routes["POST /api/unsubscribe"](ctxFor(null, { body: { token, resubscribe: true } }));
  assert.equal(q.userById.get("u_mail_a").marketing_opt_out, 1, "a bearer link must never opt an account back in");

  const signedIn = q.userById.get("u_mail_a");
  const preference = routes["POST /api/me/email-preferences"](ctxFor(signedIn, {
    body: { announcements: true },
  }));
  assert.equal(preference.user.marketingOptOut, false);
  assert.equal(q.userById.get("u_mail_a").marketing_opt_out, 0);
});

test("an unknown unsubscribe token answers exactly like a real one", async () => {
  const real = await routes["POST /api/unsubscribe"](ctxFor(null, { body: { token: emailStmts.userUnsubToken.get("u_mail_b")?.unsub_token || "x" } }));
  const fake = await routes["POST /api/unsubscribe"](ctxFor(null, { body: { token: "definitely-not-a-real-token" } }));
  assert.deepEqual(real, fake, "the response must not reveal whether a token exists");
});

test("non-admins cannot reach any of the email management routes", async () => {
  const fan = q.userById.get("u_mail_b");
  for (const route of [
    "GET /api/admin/email/overview",
    "GET /api/admin/email/log",
    "POST /api/admin/email/campaigns",
  ]) {
    await assert.rejects(() => call(route, ctxFor(fan, { body: {}, params: {}, query: {} })), /Admins only/i, route);
  }
  await assert.rejects(() => call("GET /api/admin/email/overview", ctxFor(null)), /Log in first/i);
});

test("the log records mail that was never sent, with the reason", async () => {
  const prevKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const before = db.prepare("SELECT COUNT(*) c FROM email_log WHERE status='skipped'").get().c;
  const { sendTemplate } = await import("./emailService.js");
  const result = await sendTemplate("welcome", { user: q.userById.get("u_mail_b") });
  process.env.RESEND_API_KEY = prevKey;

  assert.equal(result.sent, false);
  const after = db.prepare("SELECT COUNT(*) c FROM email_log WHERE status='skipped'").get().c;
  assert.equal(after, before + 1, "an unsent message still leaves an audit row");
  const row = db.prepare("SELECT reason FROM email_log WHERE status='skipped' ORDER BY id DESC LIMIT 1").get();
  assert.equal(row.reason, "missing-api-key");
});
