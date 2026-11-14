import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ensureLocalAlertSchema } from "./localAlertSchema.js";
import { ensureLocalAlertRuntimeSchema, createLocalAlertRuntime, startLocalAlertRuntime } from "./localAlertRuntime.js";

function fixture(t) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY,home_city TEXT,favorite_artists TEXT);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires_at INTEGER);
    CREATE TABLE notifications(id TEXT PRIMARY KEY,user_id TEXT);
    CREATE TABLE tour_dates(id TEXT PRIMARY KEY,release_at INTEGER DEFAULT 0);
    CREATE TABLE creator_follows(account_id TEXT,entity_type TEXT,entity_key TEXT,notify_updates INTEGER);
    CREATE TABLE fan_club_members(user_id TEXT,artist TEXT);
    INSERT INTO tour_dates(id) VALUES ('old_a'),('old_b'),('old_c');`);
  ensureLocalAlertSchema(db); ensureLocalAlertRuntimeSchema(db);
  const calls = [], alerts = {
    reconcileEvent: (id, options) => { calls.push({ id, ...options }); return { more: false }; },
    planEventPage: id => { calls.push({ plan: id }); }, planAccountSalesPage: id => { calls.push({ account: id }); },
    cancelPendingPushPage: () => ({ cancelled: 0 }), deliverDue: () => ({ delivered: 0 }),
  };
  return { db, alerts, calls };
}
test("bounded historical migration stays quiet while new inserts and interrupted bootstrap retain their classification", t => {
  const { db, alerts, calls } = fixture(t);
  db.exec("INSERT INTO tour_dates(id) VALUES ('new'); UPDATE tour_dates SET release_at=12 WHERE id='old_c'");
  createLocalAlertRuntime({ db, alerts, now: () => 100 }).tick({ events: 1 });
  assert.equal(calls.length, 1); assert.equal(calls[0].id, "new"); assert.equal(calls[0].baseline, false);
  ensureLocalAlertRuntimeSchema(db);
  const restarted = createLocalAlertRuntime({ db, alerts, now: () => 100 });
  restarted.tick({ events: 1 }); restarted.tick({ events: 1 }); restarted.tick({ events: 1 });
  assert.deepEqual(calls.filter(row => row.id.startsWith("old")).map(row => row.baseline), [true, true, true]);
  assert.equal(Number(db.prepare("SELECT value FROM local_alert_runtime WHERE key='baseline_cursor'").get().value), 3);
});
test("durable outer cursors prevent unfinished large events and accounts starving later work", t => {
  const { db, alerts, calls } = fixture(t);
  for (const id of ["a", "b", "c"]) {
    db.prepare("INSERT INTO users VALUES (?,NULL,'[]')").run(id);
    db.prepare("INSERT INTO local_alert_account_scans(account_id,requested_at) VALUES (?,0)").run(id);
    db.prepare("INSERT INTO local_event_observations(event_id,fingerprint,first_seen_at,announce_until,reconcile_complete) VALUES (?,'fp',0,0,1)").run(`old_${id}`);
  }
  for (let i = 0; i < 3; i++) createLocalAlertRuntime({ db, alerts, now: () => 100 }).tick({ events: 1, recipients: 2 });
  assert.deepEqual(calls.filter(row => row.plan).map(row => row.plan), ["old_a", "old_b", "old_c"]);
  assert.deepEqual(calls.filter(row => row.account).map(row => row.account), ["a", "b", "c"]);
});
test("first activation baselines accumulated events without misclassifying reused SQLite rowids", t => {
  const { db, alerts, calls } = fixture(t);
  db.exec("INSERT INTO tour_dates(id) VALUES ('backlog')");
  const runtime = createLocalAlertRuntime({ db, alerts, now: () => 100 }); runtime.activate();
  runtime.tick({ events: 20 });
  assert.equal(calls.find(row => row.id === "backlog").baseline, true);
  db.exec("DELETE FROM tour_dates; INSERT INTO tour_dates(id) VALUES ('fresh')");
  assert.equal(db.prepare("SELECT rowid FROM tour_dates WHERE id='fresh'").get().rowid, 1);
  const restarted = createLocalAlertRuntime({ db, alerts, now: () => 100 }); restarted.activate(); restarted.tick();
  assert.equal(calls.find(row => row.id === "fresh").baseline, false);
});
test("disabled runtime makes no timers or deliveries; shutdown waits for coordinated current tick", async () => {
  let calls = 0, release;
  const disabled = startLocalAlertRuntime({ tick: () => calls++ });
  await disabled.trigger(); await disabled.stop(); assert.equal(calls, 0);
  const job = startLocalAlertRuntime({ tick: () => { calls++; return new Promise(resolve => { release = resolve; }); } }, {
    enabled: true, coordinate: task => task(), setTimer: () => 1, clearTimer: () => {}, setRepeatingTimer: () => 2, clearRepeatingTimer: () => {},
  });
  const first = job.trigger(), repeated = job.trigger(); await Promise.resolve();
  assert.equal(calls, 1);
  let stopped = false; const stop = job.stop().then(() => { stopped = true; });
  await Promise.resolve(); assert.equal(stopped, false); release(true);
  await Promise.all([first, repeated, stop]); assert.equal(stopped, true);
  await job.trigger(); assert.equal(calls, 1);
});
