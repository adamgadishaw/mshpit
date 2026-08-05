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
const { drainCampaign } = await import("./emailQueue.js");

// Every send goes through global fetch in mailer.js, so stubbing it captures the
// exact set of addresses the platform would have mailed.
const realFetch = globalThis.fetch;
let sentTo = [];
let failNext = false;
before(() => {
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (failNext) return { ok: false, status: 403, text: async () => "domain not verified" };
    sentTo.push(body.to[0]);
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
  if (extra.optOut) db.prepare("UPDATE users SET marketing_opt_out=1 WHERE id=?").run(id);
  if (extra.banned) db.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(id);
  return q.userById.get(id);
}

const admin = addUser("u_mail_admin", "admin@example.com", "theadmin", { role: "admin" });
addUser("u_mail_a", "a@example.com", "fanaaa");
addUser("u_mail_b", "b@example.com", "fanbbb");
const optedOut = addUser("u_mail_out", "out@example.com", "fanout", { optOut: true });
addUser("u_mail_ban", "ban@example.com", "fanban", { banned: true });

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
  assert.match(redirect.redirect, /\?unsubscribe=/);
  assert.equal(q.userById.get("u_mail_a").marketing_opt_out, 0, "a scanner following the link must not opt anyone out");

  await routes["POST /api/unsubscribe"](ctxFor(null, { body: { token } }));
  assert.equal(q.userById.get("u_mail_a").marketing_opt_out, 1);

  await routes["POST /api/unsubscribe"](ctxFor(null, { body: { token, resubscribe: true } }));
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
