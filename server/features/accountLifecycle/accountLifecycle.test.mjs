import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { OWNER_IDENTITY_KEY, ownerIdentity } from "../../ownerIdentity.js";
import { ensureAccountLifecycleSchema } from "./accountLifecycleSchema.js";
import { accountIsPublic, activeAccountSql } from "../../accountVisibility.js";
import {
  ACCOUNT_INACTIVITY_DAY_MS as DAY, accountLifecycleDecision,
  recordInteractiveAccountActivity, runAccountLifecycleSweep, eraseInactiveAccount,
} from "./accountLifecycle.js";

const START = Date.UTC(2026, 8, 7);
const OWNER = "permanent-owner";

function fixture(t, { legacy = false } = {}) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE app_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT NOT NULL,name TEXT,handle TEXT,
      role TEXT,is_banned INTEGER DEFAULT 0,suspended_until INTEGER,
      onboarding_version INTEGER,email_verified_at INTEGER,created_at INTEGER);
    CREATE TABLE cleanup (user_id TEXT NOT NULL);`);
  db.prepare("INSERT INTO app_meta VALUES (?,?)").run(OWNER_IDENTITY_KEY,
    JSON.stringify(ownerIdentity("owner@example.test", OWNER, START)));
  if (legacy) db.prepare("INSERT INTO users (id,email,created_at) VALUES (?,?,?)")
    .run("legacy", "legacy@example.test", START - 2000 * DAY);
  ensureAccountLifecycleSchema(db, { at: START });
  return db;
}

function add(db, id, { activeAt = START, email = `${id}@example.test`, onboarding = 1, verified = START, role = "fan" } = {}) {
  db.prepare(`INSERT INTO users
    (id,email,role,onboarding_version,email_verified_at,created_at,last_active_at,inactivity_next_check_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, email, role, onboarding, verified, START - 1000 * DAY, activeAt, activeAt + 365 * DAY);
}
const user = (db, id) => db.prepare("SELECT * FROM users WHERE id=?").get(id);
const ack = async () => ({ delivered: true, receiptId: "provider-delivery-receipt" });
const erase = (db) => (account) => {
  // Deliberately tiny fixture substitute. Runtime must inject the full existing
  // erasure implementation, including storage cleanup and privacy relations.
  db.prepare("INSERT INTO cleanup VALUES (?)").run(account.id);
  db.prepare("DELETE FROM users WHERE id=?").run(account.id);
};

test("365-day dormancy and 730-day deletion use exact UTC-duration boundaries", () => {
  const account = { id: "fan", last_active_at: START };
  const decision = (day, extra = {}) => accountLifecycleDecision({ ...account, ...extra }, { at: START + day * DAY, ownerId: OWNER });
  assert.equal(decision(365 - 1 / DAY).suspend, false);
  assert.equal(decision(365).suspend, true);
  assert.equal(decision(700 - 1 / DAY).warn, false);
  assert.equal(decision(700).warn, true);
  const warning = { inactivity_warning_sent_at: START + 700 * DAY,
    inactivity_warning_activity_at: START, inactivity_warning_receipt: "delivery" };
  assert.equal(decision(730 - 1 / DAY, warning).delete, false);
  assert.equal(decision(730, warning).delete, true);
  assert.equal(decision(900).delete, false);
});

test("legacy rollout does not derive inactivity from creation time or delete immediately", async (t) => {
  const db = fixture(t, { legacy: true });
  assert.equal(user(db, "legacy").last_active_at, START);
  assert.equal(user(db, "legacy").dormant_at, null);
  assert.equal((await runAccountLifecycleSweep({ database: db, at: START, sendWarning: ack, eraseAccount: erase(db) })).checked, 0);
  ensureAccountLifecycleSchema(db, { at: START + DAY });
  assert.equal(user(db, "legacy").last_active_at, START);
  assert.equal(db.prepare("SELECT count(*) n FROM cleanup").get().n, 0);
});

test("new rows initialize tracking at insert time, even with ancient created_at", (t) => {
  const db = fixture(t);
  const before = Date.now();
  db.prepare("INSERT INTO users (id,email,created_at) VALUES ('new','new@example.test',1)").run();
  const row = user(db, "new");
  assert.ok(row.last_active_at >= before - 1);
  assert.ok(row.last_active_at <= Date.now());
  assert.equal(row.inactivity_next_check_at, row.last_active_at + 365 * DAY);
});

test("Owner is excluded at selection, pure policy, and transactional erasure boundaries", async (t) => {
  const db = fixture(t);
  add(db, OWNER, { activeAt: START - 1000 * DAY, role: "admin" });
  db.prepare(`UPDATE users SET inactivity_warning_sent_at=?,inactivity_warning_activity_at=?,
    inactivity_warning_receipt='delivery' WHERE id=?`).run(START - 100 * DAY, START - 1000 * DAY, OWNER);
  assert.equal(accountLifecycleDecision(user(db, OWNER), { at: START, ownerId: OWNER }).state, "protected");
  assert.equal((await runAccountLifecycleSweep({ database: db, at: START, sendWarning: ack, eraseAccount: erase(db) })).checked, 0);
  assert.equal(eraseInactiveAccount(db, { userId: OWNER, expectedLastActiveAt: START - 1000 * DAY,
    at: START, eraseAccount: erase(db) }), false);
  assert.ok(user(db, OWNER));
  assert.equal(recordInteractiveAccountActivity(db, { userId: OWNER, at: START, kind: "login", reactivate: true }), false);
  assert.equal(user(db, OWNER).last_active_at, START - 1000 * DAY);
  assert.throws(() => db.prepare("UPDATE users SET dormant_at=? WHERE id=?").run(START, OWNER), /Owner account cannot become dormant/);
});

test("dormant public-account projections and SQL agree without changing moderation", (t) => {
  const db = fixture(t);
  add(db, "active"); add(db, "dormant"); add(db, "banned"); add(db, "suspended");
  db.prepare("UPDATE users SET dormant_at=? WHERE id='dormant'").run(START);
  db.prepare("UPDATE users SET is_banned=1 WHERE id='banned'").run();
  db.prepare("UPDATE users SET suspended_until=? WHERE id='suspended'").run(Date.now() + DAY);
  assert.equal(accountIsPublic(user(db, "active")), true);
  for (const id of ["dormant", "banned", "suspended"]) assert.equal(accountIsPublic(user(db, id)), false);
  assert.deepEqual(db.prepare(`SELECT u.id FROM users u WHERE ${activeAccountSql("u")} ORDER BY u.id`).all()
    .map((row) => row.id), ["active"]);
  assert.throws(() => activeAccountSql("u; DROP TABLE users"), /Invalid SQL alias/);
});

test("missing, invalid, or unlocked Owner identity fails closed", async (t) => {
  const db = fixture(t);
  add(db, "old", { activeAt: START - 1000 * DAY });
  for (const value of ["bad json", JSON.stringify({ version: 1, email: "owner@example.test", userId: OWNER })]) {
    db.prepare("UPDATE app_meta SET value=? WHERE key=?").run(value, OWNER_IDENTITY_KEY);
    const result = await runAccountLifecycleSweep({ database: db, at: START, sendWarning: ack, eraseAccount: erase(db) });
    assert.equal(result.disabledReason, "durable-owner-unavailable");
    assert.equal(result.checked, 0);
    assert.equal(user(db, "old").dormant_at, null);
  }
  db.prepare("DELETE FROM app_meta").run();
  assert.equal((await runAccountLifecycleSweep({ database: db, at: START })).disabledReason, "durable-owner-unavailable");
});

test("unverified, unfinished, artist and delegated staff accounts are all included", async (t) => {
  const db = fixture(t);
  add(db, "unfinished", { onboarding: 0, verified: 0 });
  add(db, "unverified", { verified: 0 });
  add(db, "legacy", { onboarding: null });
  add(db, "artist", { role: "artist" });
  add(db, "staff", { role: "admin" });
  const result = await runAccountLifecycleSweep({ database: db, at: START + 365 * DAY });
  assert.equal(result.dormant, 5);
  assert.equal(result.deleted, 0);
  assert.equal(result.warned, 0);
  for (const id of ["unfinished", "unverified", "legacy", "artist", "staff"]) {
    assert.equal(user(db, id).dormant_at, START + 365 * DAY);
  }
});

test("successful login reactivates only selected account and never removes moderation restrictions", (t) => {
  const db = fixture(t);
  add(db, "one", { email: "shared@example.test" });
  add(db, "two", { email: "shared@example.test" });
  db.prepare(`UPDATE users SET dormant_at=?,is_banned=1,suspended_until=?,
    inactivity_warning_sent_at=?,inactivity_warning_activity_at=?,inactivity_warning_receipt='delivery'`)
    .run(START + 365 * DAY, START + 900 * DAY, START + 700 * DAY, START);
  assert.equal(recordInteractiveAccountActivity(db, { userId: "one", at: START + 710 * DAY, kind: "login", reactivate: true }), true);
  const selected = user(db, "one");
  assert.equal(selected.dormant_at, null);
  assert.equal(selected.inactivity_warning_sent_at, null);
  assert.equal(selected.is_banned, 1);
  assert.equal(selected.suspended_until, START + 900 * DAY);
  assert.equal(user(db, "two").last_active_at, START);
  assert.equal(user(db, "two").dormant_at, START + 365 * DAY);
  assert.equal(recordInteractiveAccountActivity(db, { userId: "two", at: START + 710 * DAY, kind: "account-switch", reactivate: true }), true);
  assert.equal(user(db, "two").dormant_at, null);
});

test("polling and arbitrary activity kinds cannot extend retention or reactivate dormancy", (t) => {
  const db = fixture(t);
  add(db, "fan");
  for (const kind of [undefined, "poll", "analytics", "impression", "session", "background"]) {
    assert.equal(recordInteractiveAccountActivity(db, { userId: "fan", kind, at: START + DAY, reactivate: true }), false);
  }
  assert.equal(user(db, "fan").last_active_at, START);
  assert.throws(() => recordInteractiveAccountActivity(db, { userId: "fan", kind: "mutation", reactivate: true }), /Only successful login/);
  recordInteractiveAccountActivity(db, { userId: "fan", kind: "mutation", at: START });
  assert.equal(user(db, "fan").last_active_at, START + 1);
});

test("late warning requires a full further 30 days and retries cannot duplicate deletion", async (t) => {
  const db = fixture(t);
  add(db, "fan");
  const execute = (day) => runAccountLifecycleSweep({ database: db, at: START + day * DAY, sendWarning: ack, eraseAccount: erase(db) });
  assert.equal((await execute(730)).warned, 1);
  assert.ok(user(db, "fan"));
  assert.equal((await execute(759)).deleted, 0);
  assert.equal((await execute(760)).deleted, 1);
  assert.equal((await execute(761)).deleted, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM cleanup").get().n, 1);
});

test("queued, failed, ambiguous and missing-receipt warnings fail closed and retry stably", async (t) => {
  const db = fixture(t);
  add(db, "fan");
  const keys = [];
  const outcomes = [{ queued: true }, { delivered: false, receiptId: "failed" }, { delivered: true }, null];
  for (let index = 0; index < outcomes.length; index++) {
    const result = await runAccountLifecycleSweep({ database: db, at: START + (730 + index) * DAY,
      sendWarning: async ({ idempotencyKey }) => { keys.push(idempotencyKey); return outcomes[index]; }, eraseAccount: erase(db) });
    assert.equal(result.deleted, 0);
    assert.equal(result.failed, 1);
    assert.equal(user(db, "fan").inactivity_warning_sent_at, null);
  }
  assert.equal(new Set(keys).size, 1);
  const result = await runAccountLifecycleSweep({ database: db, at: START + 734 * DAY,
    sendWarning: async () => { throw new Error("provider unavailable"); }, eraseAccount: erase(db) });
  assert.equal(result.failed, 1);
  assert.ok(user(db, "fan"));
});

test("activity while a warning is in flight discards stale delivery acknowledgement", async (t) => {
  const db = fixture(t);
  add(db, "fan");
  const at = START + 700 * DAY;
  const result = await runAccountLifecycleSweep({ database: db, at,
    sendWarning: async () => {
      recordInteractiveAccountActivity(db, { userId: "fan", at, kind: "login", reactivate: true });
      return ack();
    }, eraseAccount: erase(db) });
  assert.equal(result.warned, 0);
  assert.equal(user(db, "fan").dormant_at, null);
  assert.equal(user(db, "fan").inactivity_warning_receipt, null);
});

test("login after candidate selection cancels deletion at the locked live recheck", async (t) => {
  const db = fixture(t);
  add(db, "fan");
  await runAccountLifecycleSweep({ database: db, at: START + 700 * DAY, sendWarning: ack });
  const stale = user(db, "fan");
  recordInteractiveAccountActivity(db, { userId: "fan", at: START + 730 * DAY, kind: "login", reactivate: true });
  assert.equal(eraseInactiveAccount(db, { userId: "fan", expectedLastActiveAt: stale.last_active_at,
    at: START + 730 * DAY, eraseAccount: erase(db) }), false);
  assert.ok(user(db, "fan"));
  assert.equal(db.prepare("SELECT count(*) n FROM cleanup").get().n, 0);
});

test("failed complete-erasure callback rolls back all work and can retry next day", async (t) => {
  const db = fixture(t);
  add(db, "fan");
  await runAccountLifecycleSweep({ database: db, at: START + 700 * DAY, sendWarning: ack });
  const failed = await runAccountLifecycleSweep({ database: db, at: START + 730 * DAY,
    eraseAccount: (account) => { erase(db)(account); throw new Error("cleanup failed"); } });
  assert.equal(failed.failed, 1);
  assert.ok(user(db, "fan"));
  assert.equal(db.prepare("SELECT count(*) n FROM cleanup").get().n, 0);
  const retry = await runAccountLifecycleSweep({ database: db, at: START + 731 * DAY, eraseAccount: erase(db) });
  assert.equal(retry.deleted, 1);
});

test("incomplete or asynchronous erasure callbacks cannot be accepted", async (t) => {
  const db = fixture(t);
  add(db, "fan");
  await runAccountLifecycleSweep({ database: db, at: START + 700 * DAY, sendWarning: ack });
  const options = { userId: "fan", expectedLastActiveAt: START, at: START + 730 * DAY };
  assert.throws(() => eraseInactiveAccount(db, { ...options, eraseAccount: async () => {} }), /synchronous/);
  assert.throws(() => eraseInactiveAccount(db, { ...options, eraseAccount: () => {} }), /did not erase/);
  assert.ok(user(db, "fan"));
});

test("bounded next-check queue does not let undeliverable oldest accounts starve others", async (t) => {
  const db = fixture(t);
  add(db, "a"); add(db, "b"); add(db, "c");
  const sweep = () => runAccountLifecycleSweep({ database: db, at: START + 730 * DAY, limit: 1,
    sendWarning: async () => ({ queued: true }) });
  assert.equal((await sweep()).checked, 1);
  assert.ok(user(db, "a").inactivity_warning_attempted_at);
  assert.equal((await sweep()).checked, 1);
  assert.ok(user(db, "b").inactivity_warning_attempted_at);
  assert.equal((await sweep()).checked, 1);
  assert.ok(user(db, "c").inactivity_warning_attempted_at);
  assert.equal((await sweep()).checked, 0);
});
