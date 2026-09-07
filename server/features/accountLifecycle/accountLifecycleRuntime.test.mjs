import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ownerIdentity, OWNER_IDENTITY_KEY } from "../../ownerIdentity.js";
import { ensureAccountLifecycleSchema, ACCOUNT_INACTIVITY_DAY_MS as DAY } from "./accountLifecycleSchema.js";
import { runAccountLifecycleSweep, recordInteractiveAccountActivity } from "./accountLifecycle.js";
import { startAccountLifecycleScheduler } from "./accountLifecycleScheduler.js";
import { createAccountInactivityWarningSender } from "./accountInactivityWarning.js";
import { isSuccessfulInteractiveMutation, recordSuccessfulInteractiveMutation } from "./interactiveActivity.js";
import { getEmailDeliveryReceipt, sendEmail } from "../../mailer.js";

const START = Date.UTC(2026, 8, 7);
const PROVIDER_ID = "4ef9a417-02e9-4d39-ad75-9611e0fcc33c";
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE app_meta (key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT,handle TEXT,created_at INTEGER);
    INSERT INTO users VALUES ('fan','fan@example.test','fan',1);`);
  db.prepare("INSERT INTO app_meta VALUES (?,?)").run(OWNER_IDENTITY_KEY,
    JSON.stringify(ownerIdentity("owner@example.test", "owner", START)));
  ensureAccountLifecycleSchema(db, { at: START });
  return db;
}

test("activity classifier admits explicit successful writes, never background or switched-account traffic", () => {
  const user = { id: "one" };
  for (const routePattern of ["/api/posts", "/api/users/:id/follow", "/api/me/export", "/api/going"]) {
    assert.equal(isSuccessfulInteractiveMutation({ method: "POST", routePattern, user, result: { ok: true } }), true);
  }
  for (const routePattern of ["/api/feed/impressions", "/api/events", "/api/events/batch", "/api/client-errors",
    "/api/me/notifications/read", "/api/media/reactions", "/api/media/assets/:id/finalize", "/api/feed/revalidate",
    "/api/me/accounts/switch", "/api/me/accounts/connect", "/api/login", "/api/reset", "/api/future-background-job"]) {
    assert.equal(isSuccessfulInteractiveMutation({ method: "POST", routePattern, user }), false, routePattern);
  }
  for (const extra of [{ method: "GET" }, { user: null }, { result: { ok: false } }, { result: { error: "invalid" } }]) {
    assert.equal(isSuccessfulInteractiveMutation({ method: "POST", routePattern: "/api/posts", user, ...extra }), false);
  }
  assert.equal(isSuccessfulInteractiveMutation({ method: "DELETE", routePattern: "/api/me", user }), false);
});

test("daily scheduler persists its bounded claim across instances and drains shutdown", async (t) => {
  const db = fixture(t);
  let now = START;
  const calls = [];
  const dependencies = { database: db, now: () => now, sendWarning: async () => ({}), eraseAccount() {},
    sweep: async (options) => { calls.push(options); return { checked: 0 }; },
    setTimeoutFn: () => 1, clearTimeoutFn() {}, setIntervalFn: () => 2, clearIntervalFn() {} };
  const first = startAccountLifecycleScheduler(dependencies);
  const second = startAccountLifecycleScheduler(dependencies);
  await Promise.all([first.tick(), first.tick(), second.tick()]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].limit, 100);
  now += DAY - 1;
  await second.tick(); assert.equal(calls.length, 1);
  now += 1;
  await second.tick(); assert.equal(calls.length, 2);
  await first.stop(); await second.stop();
  assert.equal(calls[0].signal.aborted, true);
  now += DAY;
  await first.tick(); assert.equal(calls.length, 2);
});

test("activity bookkeeping failures cannot replace a committed mutation response with an error", () => {
  const result = { ok: true, post: { id: "committed-post" } };
  const original = structuredClone(result);
  const failure = new Error("fixture database unavailable");
  let reported = 0;
  assert.equal(recordSuccessfulInteractiveMutation({ method: "POST", routePattern: "/api/posts",
    user: { id: "fan" }, result, recordActivity() { throw failure; },
    reportFailure(error) { assert.equal(error, failure); reported++; },
  }), false);
  assert.deepEqual(result, original);
  assert.equal(reported, 1);
  let called = false;
  assert.equal(recordSuccessfulInteractiveMutation({ method: "POST", routePattern: "/api/events",
    user: { id: "fan" }, result, recordActivity() { called = true; },
  }), false);
  assert.equal(called, false);
  assert.doesNotThrow(() => recordSuccessfulInteractiveMutation({ method: "POST", routePattern: "/api/posts",
    user: { id: "fan" }, result, recordActivity() { throw failure; }, reportFailure() { throw failure; },
  }));
});

test("scheduler refuses incomplete erasure plumbing and corrupt/future daily claims fail closed", async (t) => {
  const db = fixture(t);
  assert.throws(() => startAccountLifecycleScheduler({ database: db, sendWarning() {} }), /complete account erasure/);
  db.prepare("INSERT INTO app_meta VALUES ('accounts.inactivity.last_daily_run.v1','corrupt')").run();
  let calls = 0;
  const scheduler = startAccountLifecycleScheduler({ database: db, now: () => START,
    sendWarning() {}, eraseAccount() {}, sweep: async () => { calls++; },
    setTimeoutFn: () => 1, clearTimeoutFn() {}, setIntervalFn: () => 2, clearIntervalFn() {} });
  await scheduler.tick(); assert.equal(calls, 0);
  await scheduler.stop();
});

test("warning acceptance is durable but only later verified delivery starts deletion grace", async (t) => {
  const db = fixture(t);
  const sent = [];
  let delivered = false;
  const sender = createAccountInactivityWarningSender({ database: db, origin: "https://www.mshpit.com",
    deliver: async (message) => { sent.push(message); return { sent: true, providerId: PROVIDER_ID }; },
    getDeliveryReceipt: async ({ providerId, to }) => {
      assert.equal(providerId, PROVIDER_ID); assert.equal(to, "fan@example.test");
      return delivered ? { delivered: true, receiptId: `resend:${providerId}:delivered` } : { delivered: false };
    } });
  const execute = (day) => runAccountLifecycleSweep({ database: db, at: START + day * DAY, sendWarning: sender,
    eraseAccount: (user) => db.prepare("DELETE FROM users WHERE id=?").run(user.id) });
  assert.equal((await execute(700)).pending, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /@fan/);
  assert.equal(db.prepare("SELECT inactivity_warning_sent_at at FROM users WHERE id='fan'").get().at, null);
  assert.equal((await execute(701)).pending, 1);
  assert.equal(sent.length, 1, "receipt polling must not resend an accepted warning");
  delivered = true;
  assert.equal((await execute(702)).warned, 1);
  assert.equal((await execute(730)).deleted, 0);
  assert.equal((await execute(732)).deleted, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM account_inactivity_warnings").get().n, 0);
});

test("warning lookup state is cleared by activity and an accepted message without ID never authorizes erasure", async (t) => {
  const db = fixture(t);
  let sent = 0;
  const sender = createAccountInactivityWarningSender({ database: db, origin: "https://www.mshpit.com",
    deliver: async () => { sent++; return { sent: true }; }, getDeliveryReceipt: async () => { throw new Error("must not guess a receipt"); } });
  await runAccountLifecycleSweep({ database: db, at: START + 700 * DAY, sendWarning: sender });
  await runAccountLifecycleSweep({ database: db, at: START + 701 * DAY, sendWarning: sender });
  assert.equal(sent, 1);
  assert.equal(db.prepare("SELECT receipt_unavailable state FROM account_inactivity_warnings").get().state, 1);
  recordInteractiveAccountActivity(db, { userId: "fan", at: START + 702 * DAY, kind: "login", reactivate: true });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM account_inactivity_warnings").get().n, 0);
});

test("mail provider receipt requires matching ID, exact recipient and delivered state", async (t) => {
  const previous = { key: process.env.RESEND_API_KEY, from: process.env.MAIL_FROM, fetch: globalThis.fetch };
  t.after(() => {
    if (previous.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previous.key;
    if (previous.from === undefined) delete process.env.MAIL_FROM; else process.env.MAIL_FROM = previous.from;
    globalThis.fetch = previous.fetch;
  });
  process.env.RESEND_API_KEY = "test-only";
  process.env.MAIL_FROM = "Mshpit <noreply@example.test>";
  globalThis.fetch = async () => new Response(JSON.stringify({ id: PROVIDER_ID }), { status: 200 });
  assert.equal((await sendEmail({ to: "fan@example.test", subject: "fixture", text: "fixture" })).providerId, PROVIDER_ID);
  for (const record of [
    { id: PROVIDER_ID, to: ["fan@example.test"], last_event: "sent" },
    { id: PROVIDER_ID, to: ["fan@example.test"], last_event: "bounced" },
    { id: PROVIDER_ID, to: ["wrong@example.test"], last_event: "delivered" },
    { id: "other", to: ["fan@example.test"], last_event: "delivered" },
  ]) {
    globalThis.fetch = async () => new Response(JSON.stringify(record), { status: 200 });
    assert.equal((await getEmailDeliveryReceipt({ providerId: PROVIDER_ID, to: "fan@example.test" })).delivered, false);
  }
  globalThis.fetch = async (url, options) => {
    assert.equal(url, `https://api.resend.com/emails/${PROVIDER_ID}`);
    assert.equal(options.method, "GET"); assert.equal(options.redirect, "error");
    return new Response(JSON.stringify({ id: PROVIDER_ID, to: ["fan@example.test"], last_event: "delivered" }), { status: 200 });
  };
  assert.equal((await getEmailDeliveryReceipt({ providerId: PROVIDER_ID, to: "fan@example.test" })).delivered, true);
  assert.equal((await getEmailDeliveryReceipt({ providerId: "../../secret", to: "fan@example.test" })).delivered, false);
  globalThis.fetch = async () => new Response("forbidden", { status: 403 });
  assert.equal((await getEmailDeliveryReceipt({ providerId: PROVIDER_ID, to: "fan@example.test" })).delivered, false);
});
