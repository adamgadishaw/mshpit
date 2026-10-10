import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, beforeEach } from "node:test";

const directory = mkdtempSync(join(tmpdir(), "pit-alert-delivery-"));
process.env.PIT_DATA_DIR = directory;
process.env.ADMIN_EMAIL = "owner@example.com";
delete process.env.RESEND_API_KEY;
delete process.env.MAIL_FROM;
const packets = [];
let send = async () => ({ sent: true });
globalThis.__pitAlertTestSend = async (packet) => { packets.push(packet); return send(packet); };
const mailModule = "data:text/javascript," + encodeURIComponent("export async function sendTemplate(key, packet) { return globalThis.__pitAlertTestSend(packet); }");
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./emailService.js" && context.parentURL?.endsWith("/server/errorLog.js")) {
      return { shortCircuit: true, url: mailModule };
    }
    return nextResolve(specifier, context);
  },
});
const { db } = await import("./db.js");
const { maybeAlert, recordError, recentErrors, resetAlertStateForTests, scheduleErrorAlert, stopErrorAlertScheduler } = await import("./errorLog.js");
after(async () => { await stopErrorAlertScheduler(); db.close(); hooks.deregister(); delete globalThis.__pitAlertTestSend; rmSync(directory, { recursive: true, force: true }); });
beforeEach(() => {
  db.exec("DELETE FROM error_events");
  db.exec("DELETE FROM error_event_details");
  db.exec("UPDATE error_alert_delivery SET last_sent_at=0,pending_key=NULL,pending_payload=NULL WHERE singleton=1");
  delete process.env.ERROR_ALERTS_ENABLED;
  delete process.env.ERROR_ALERT_COOLDOWN_MIN;
  delete process.env.ALERT_EMAIL;
  resetAlertStateForTests({ scheduleTask: () => ({ unref() {} }), cancelTask: () => undefined });
  packets.length = 0;
  send = async () => ({ sent: true });
});
const HOUR = Date.UTC(2026, 8, 8, 16);
const minute = (n) => HOUR + n * 60_000;
const firstId = "6d77b04d-5334-45f8-87f9-8fab09b78e05";
const secondId = "123e4567-e89b-42d3-a456-426614174001";
function crash({ requestId = firstId, cause = "RenderError.Web", at = minute(5) } = {}) {
  return recordError({ level: "fatal", code: "PIT-APP-001", status: 0, method: "POST", route: "/client/landing", cause, requestId, at });
}

test("the same crash is not resent after the cooldown, manual force, or a restart", async () => {
  crash();
  assert.equal((await maybeAlert({ now: minute(6) })).sent, true);
  assert.equal((await maybeAlert({ now: minute(37) })).reason, "nothing-serious");
  assert.equal((await maybeAlert({ now: minute(38), force: true })).reason, "nothing-serious");
  resetAlertStateForTests();
  assert.equal((await maybeAlert({ now: minute(62) })).reason, "nothing-serious");
  assert.equal(packets.length, 1);
  assert.equal(recentErrors()[0].count, 1);
});

test("a new crash kind does not bring the old hour's already-delivered crash into its digest", async () => {
  crash();
  await maybeAlert({ now: minute(6) });
  crash({ cause: "RenderError.Web.Type", requestId: secondId, at: minute(79) });
  const next = await maybeAlert({ now: minute(80) });
  assert.equal(next.occurrences, 1);
  assert.equal(next.kinds, 1);
  assert.equal(packets.length, 2);
  assert.equal(packets[1].vars.detail.includes(firstId), false);
  assert.equal(packets[1].vars.detail.includes(secondId), true);
});

test("successful cooldown persists across restart and new occurrences use delta counts", async () => {
  crash();
  await maybeAlert({ now: minute(6) });
  resetAlertStateForTests();
  crash({ requestId: secondId, at: minute(10) });
  assert.equal((await maybeAlert({ now: minute(11) })).reason, "cooling-down");
  const next = await maybeAlert({ now: minute(37) });
  assert.equal(next.occurrences, 1);
  assert.equal(recentErrors()[0].count, 2);
  assert.match(packets[1].vars.detail, /^1x /);
  assert.equal(packets[1].vars.detail.includes(secondId), true);
});

test("an occurrence arriving during delivery is not acknowledged by the earlier snapshot", async () => {
  crash();
  send = async () => { crash({ requestId: secondId, at: minute(7) }); return { sent: true }; };
  await maybeAlert({ now: minute(6) });
  send = async () => ({ sent: true });
  const next = await maybeAlert({ now: minute(37) });
  assert.equal(next.occurrences, 1);
  assert.equal(packets.length, 2);
  assert.equal(packets[0].vars.detail.includes(firstId), true);
  assert.equal(packets[1].vars.detail.includes(secondId), true);
});

test("failed sends retain the frozen batch and key across restart and newer errors", async () => {
  crash();
  send = async () => ({ sent: false, reason: "provider-unavailable" });
  assert.equal((await maybeAlert({ now: minute(6) })).sent, false);
  resetAlertStateForTests();
  crash({ requestId: secondId, at: minute(10) });
  send = async () => ({ sent: true });
  assert.equal((await maybeAlert({ now: minute(37) })).occurrences, 1);
  assert.deepEqual(packets[0], packets[1], "uncertain retries must keep exactly the same payload and idempotency key");
  assert.match(packets[1].vars.detail, /Last occurred: 2026-09-08 16:05:00\.000 UTC/);
  assert.equal((await maybeAlert({ now: minute(68) })).occurrences, 1);
  assert.equal(packets[2].vars.detail.includes(secondId), true);
  assert.match(packets[2].vars.detail, /Last occurred: 2026-09-08 16:10:00\.000 UTC/);
  assert.notEqual(packets[2].idempotencyKey, packets[1].idempotencyKey);
});

test("a legacy frozen alert without timestamps preserves its body and key across retries", async () => {
  crash();
  const row = db.prepare(`SELECT fingerprint,level,code,status,method,route,cause,
    last_request_id,first_seen,count through_count,count,
    0 acknowledged_count,0 legacy_through_count FROM error_events`).get();
  const payload = JSON.stringify({ rows: [row], initialCatchUp: false });
  const key = "error-alert-v2-" + createHash("sha256").update(payload).digest("hex").slice(0, 40);
  db.prepare("UPDATE error_alert_delivery SET pending_key=?,pending_payload=? WHERE singleton=1").run(key, payload);
  send = async () => ({ sent: false, reason: "provider-unavailable" });
  await maybeAlert({ now: minute(6) });
  assert.equal(packets[0].idempotencyKey, key);
  assert.equal(packets[0].vars.detail, `1x  FATAL  POST /client/landing  PIT-APP-001  (RenderError.Web)  request ${firstId}`);
  crash({ requestId: secondId, at: minute(10) });
  resetAlertStateForTests();
  send = async () => ({ sent: true });
  await maybeAlert({ now: minute(37) });
  assert.deepEqual(packets[1], packets[0]);
  assert.equal((await maybeAlert({ now: minute(68) })).occurrences, 1);
  assert.match(packets[2].vars.detail, /Last occurred: 2026-09-08 16:10:00\.000 UTC/);
  assert.notEqual(packets[2].idempotencyKey, key);
});

test("a skipped send does not consume pending counts", async () => {
  crash();
  send = async () => ({ sent: false, reason: "not-configured" });
  await maybeAlert({ now: minute(6) });
  assert.equal(db.prepare("SELECT COUNT(*) count FROM error_alert_checkpoints").get().count, 0);
  send = async () => ({ sent: true });
  assert.equal((await maybeAlert({ now: minute(37) })).occurrences, 1);
});

test("a post-delivery checkpoint failure leaves a safely retryable frozen batch", async () => {
  crash();
  db.exec("CREATE TRIGGER fail_alert_ack BEFORE INSERT ON error_alert_checkpoints BEGIN SELECT RAISE(ABORT,'injected checkpoint failure'); END");
  try {
    assert.equal((await maybeAlert({ now: minute(6) })).reason, "alert-failed");
  } finally { db.exec("DROP TRIGGER fail_alert_ack"); }
  resetAlertStateForTests();
  await maybeAlert({ now: minute(37) });
  assert.deepEqual(packets[0], packets[1]);
  assert.equal((await maybeAlert({ now: minute(68) })).reason, "nothing-serious");
});

test("the alert says where and why each problem happened, and which release produced it", async () => {
  const previousRelease = process.env.RENDER_GIT_COMMIT;
  process.env.RENDER_GIT_COMMIT = "4603cb3e6084abcdef0123456789abcdef012345";
  try {
    recordError({
      level: "fatal", code: "PIT-APP-002", status: 0, method: "POST", route: "/client/landing",
      cause: "RuntimeError.Web.Type", requestId: firstId, at: minute(5),
      detail: {
        location: "src/screens/LandingScreen.jsx:88:12 in LandingHero",
        reason: "TypeError: Cannot read properties of undefined (reading 'photos') for jane@example.com",
      },
    });
    function coalescedProviderJob() {
      return new DOMException("All provider callers disconnected.", "AbortError");
    }
    recordError({
      level: "fatal", code: "PROCESS", status: 0, method: "", route: "unhandledRejection",
      cause: "AbortError/20", error: coalescedProviderJob(), at: minute(6),
    });
    assert.equal((await maybeAlert({ now: minute(7) })).sent, true);
    const body = packets[0].vars.detail;
    assert.match(body, /Where: src\/screens\/LandingScreen\.jsx:88:12 in LandingHero/);
    assert.match(body, /Why: TypeError: Cannot read properties of undefined \(reading 'photos'\) for <email>/);
    assert.match(body, /Where: server\/errorLogDelivery\.test\.mjs:\d+:\d+ in coalescedProviderJob/);
    assert.match(body, /Why: AbortError \[20\]: All provider callers disconnected\./);
    assert.match(body, /Release: 4603cb3e6084/);
    assert.equal(body.includes("jane@example.com"), false);
    // With detail present, each problem becomes its own paragraph.
    assert.equal(body.split("\n\n").length, 2);
  } finally {
    if (previousRelease === undefined) delete process.env.RENDER_GIT_COMMIT;
    else process.env.RENDER_GIT_COMMIT = previousRelease;
  }
});

function scheduledClock(t, initial = minute(6)) {
  let now = initial;
  const timers = new Set();
  const options = {
    clock: () => now,
    scheduleTask(task, delay) {
      const timer = { task, at: now + delay, unref() {} };
      timers.add(timer);
      return timer;
    },
    cancelTask: (timer) => timers.delete(timer),
  };
  t.mock.method(Date, "now", () => now);
  resetAlertStateForTests(options);
  t.after(() => stopErrorAlertScheduler());
  const next = () => [...timers].sort((left, right) => left.at - right.at)[0];
  return {
    options,
    set: (value) => { now = value; },
    size: () => timers.size,
    nextAt: () => next()?.at,
    async runNext() {
      const timer = next();
      assert.ok(timer, "expected one pending alert timer");
      timers.delete(timer);
      now = Math.max(now, timer.at);
      await timer.task();
    },
  };
}

test("a new fault during cooldown sends once at expiry without another request", async (t) => {
  const clock = scheduledClock(t);
  crash();
  await maybeAlert();
  clock.set(minute(10));
  crash({ requestId: secondId, at: minute(10) });
  scheduleErrorAlert();
  await clock.runNext();
  assert.equal(clock.nextAt(), minute(36));
  for (let index = 0; index < 100; index += 1) scheduleErrorAlert();
  assert.equal(clock.size(), 1);
  await clock.runNext();
  assert.equal(packets.length, 2);
  assert.match(packets[1].vars.detail, /^1x /);
  assert.ok(packets[1].vars.detail.includes(secondId));
  assert.equal(clock.size(), 0);
  assert.equal((await maybeAlert({ now: minute(70) })).reason, "nothing-serious");
});

test("empty, subthreshold and disabled alerts do not keep cooldown timers alive", async (t) => {
  const clock = scheduledClock(t);
  crash();
  await maybeAlert();
  clock.set(minute(10));
  scheduleErrorAlert();
  await clock.runNext();
  assert.equal(clock.size(), 0, "acknowledged counts need no timer");
  recordError({ code: "PROVIDER_UNAVAILABLE", status: 502, method: "GET", route: "/api/artists/resolve", cause: "ProviderError/network" });
  scheduleErrorAlert();
  await clock.runNext();
  assert.equal(clock.size(), 0, "one network blip remains below the unchanged threshold");
  crash({ requestId: secondId, at: minute(10) });
  scheduleErrorAlert();
  await clock.runNext();
  assert.equal(clock.nextAt(), minute(36));
  process.env.ERROR_ALERTS_ENABLED = "false";
  await clock.runNext();
  assert.equal(packets.length, 1);
  assert.equal(clock.size(), 0);
  assert.equal(recentErrors().find((row) => row.code === "PIT-APP-001").count, 2);
});

test("a manual send postpones an existing wake-up to the new durable cooldown", async (t) => {
  const clock = scheduledClock(t);
  crash();
  await maybeAlert();
  clock.set(minute(10));
  crash({ requestId: secondId, at: minute(10) });
  scheduleErrorAlert();
  await clock.runNext();
  clock.set(minute(20));
  assert.equal((await maybeAlert({ force: true })).sent, true);
  clock.set(minute(21));
  crash({ requestId: firstId, at: minute(21) });
  scheduleErrorAlert();
  assert.equal(clock.size(), 1);
  await clock.runNext();
  assert.equal(packets.length, 2, "the old wake-up must not send before the manual send's cooldown");
  assert.equal(clock.nextAt(), minute(50));
  await clock.runNext();
  assert.equal(packets.length, 3);
  assert.match(packets[2].vars.detail, /^1x /);
  assert.equal(clock.size(), 0);
});

test("a failed scheduled send stops and retains the same batch for the next incident trigger", async (t) => {
  const clock = scheduledClock(t);
  crash();
  await maybeAlert();
  clock.set(minute(10));
  crash({ requestId: secondId, at: minute(10) });
  scheduleErrorAlert();
  await clock.runNext();
  send = async () => ({ sent: false, reason: "provider-unavailable" });
  await clock.runNext();
  assert.equal(clock.size(), 0, "failed delivery must not start a new automatic retry policy");
  const frozen = packets[1];
  clock.set(minute(40));
  crash({ at: minute(40) });
  scheduleErrorAlert();
  await clock.runNext();
  assert.equal(packets.length, 2, "local failed-attempt cooldown still blocks another send");
  assert.equal(clock.nextAt(), minute(66));
  send = async () => ({ sent: true });
  await clock.runNext();
  assert.deepEqual(packets[2], frozen);
  assert.equal(clock.nextAt(), minute(96), "successful retry drains newer eligible arrivals after another cooldown");
  await clock.runNext();
  assert.equal(packets.length, 4);
  assert.notEqual(packets[3].idempotencyKey, frozen.idempotencyKey);
  assert.match(packets[3].vars.detail, /Last occurred: 2026-09-08 16:40:00\.000 UTC/);
  assert.equal(clock.size(), 0);
});

test("a trigger after restart reconstructs the durable cooldown without a startup send", async (t) => {
  const clock = scheduledClock(t);
  crash();
  await maybeAlert();
  clock.set(minute(10));
  crash({ requestId: secondId, at: minute(10) });
  scheduleErrorAlert();
  await clock.runNext();
  assert.equal(clock.nextAt(), minute(36));
  resetAlertStateForTests(clock.options);
  assert.equal(clock.size(), 0, "restart alone neither sends nor retries mail");
  clock.set(minute(11));
  scheduleErrorAlert();
  await clock.runNext();
  assert.equal(clock.nextAt(), minute(36));
  await clock.runNext();
  assert.equal(packets.length, 2);
  assert.match(packets[1].vars.detail, /^1x /);
  assert.equal(clock.size(), 0);
});

test("a scheduled wake-up waits for a manual delivery and preserves arrivals during it", async (t) => {
  const clock = scheduledClock(t);
  crash();
  await maybeAlert();
  clock.set(minute(10));
  crash({ requestId: secondId, at: minute(10) });
  scheduleErrorAlert();
  await clock.runNext();
  let finish;
  send = () => new Promise((resolve) => { finish = resolve; });
  clock.set(minute(20));
  const manual = maybeAlert({ force: true });
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  clock.set(minute(30));
  crash({ at: minute(30) });
  scheduleErrorAlert();
  const wake = clock.runNext();
  await Promise.resolve();
  assert.equal(packets.length, 2);
  finish({ sent: true });
  await Promise.all([manual, wake]);
  assert.equal(clock.nextAt(), minute(50));
  send = async () => ({ sent: true });
  await clock.runNext();
  assert.equal(packets.length, 3);
  assert.match(packets[2].vars.detail, /Last occurred: 2026-09-08 16:30:00\.000 UTC/);
  assert.equal(clock.size(), 0);
});

test("shutdown while a scheduled drain waits for manual delivery cannot start another send", async (t) => {
  const clock = scheduledClock(t);
  crash();
  let finish;
  send = () => new Promise((resolve) => { finish = resolve; });
  const manual = maybeAlert({ force: true });
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  crash({ requestId: secondId, at: minute(6) });
  scheduleErrorAlert();
  const wake = clock.runNext();
  await Promise.resolve();
  const stop = stopErrorAlertScheduler();
  finish({ sent: true });
  await Promise.all([manual, wake, stop]);
  assert.equal(packets.length, 1);
  assert.equal(clock.size(), 0);
  assert.equal(scheduleErrorAlert(), false);
  assert.equal(recentErrors()[0].count, 2, "the later occurrence remains saved for a future process/trigger");
});

test("a coalesced backlog drains capped batches at cooldown boundaries without repeating counts", async (t) => {
  const clock = scheduledClock(t);
  for (let index = 0; index < 45; index += 1) {
    crash({ cause: `RenderError.Kind${index}` });
    scheduleErrorAlert();
  }
  assert.equal(clock.size(), 1);
  await clock.runNext();
  assert.match(packets[0].vars.summary, /^20 errors across 20 kinds$/);
  assert.equal(clock.nextAt(), minute(36));
  await clock.runNext();
  assert.match(packets[1].vars.summary, /^20 errors across 20 kinds$/);
  assert.equal(clock.nextAt(), minute(66));
  await clock.runNext();
  assert.match(packets[2].vars.summary, /^5 errors across 5 kinds$/);
  assert.equal(clock.size(), 0);
  assert.equal(db.prepare("SELECT SUM(through_count) count FROM error_alert_checkpoints").get().count, 45);
  const causes = packets.flatMap((packet) => [...packet.vars.detail.matchAll(/\(RenderError\.Kind(\d+)\)/g)].map((match) => match[1]));
  assert.equal(causes.length, 45);
  assert.equal(new Set(causes).size, 45);
});

test("a failed or skipped manual send invalidates an older cooldown wake-up", async (t) => {
  const clock = scheduledClock(t);
  crash();
  await maybeAlert();
  clock.set(minute(10));
  crash({ requestId: secondId, at: minute(10) });
  scheduleErrorAlert();
  await clock.runNext();
  assert.equal(clock.nextAt(), minute(36));
  clock.set(minute(20));
  send = async () => ({ sent: false, reason: "not-configured" });
  assert.equal((await maybeAlert({ force: true })).sent, false);
  assert.equal(clock.size(), 0, "an earlier timer must not retry the skipped manual send");
  const frozen = packets[1];
  clock.set(minute(25));
  crash({ at: minute(25) });
  scheduleErrorAlert();
  await clock.runNext();
  assert.equal(clock.nextAt(), minute(50), "a later incident retains its own trigger");
  send = async () => ({ sent: true });
  await clock.runNext();
  assert.deepEqual(packets[2], frozen);
});

test("a wake-up awaiting a failed manual delivery stops until another incident", async (t) => {
  const clock = scheduledClock(t);
  crash();
  await maybeAlert();
  clock.set(minute(10));
  crash({ requestId: secondId, at: minute(10) });
  scheduleErrorAlert();
  await clock.runNext();
  let finish;
  send = () => new Promise((resolve) => { finish = resolve; });
  clock.set(minute(20));
  const manual = maybeAlert({ force: true });
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  const wake = clock.runNext();
  await Promise.resolve();
  finish({ sent: false, reason: "provider-unavailable" });
  await Promise.all([manual, wake]);
  assert.equal(packets.length, 2);
  assert.equal(clock.size(), 0);
  clock.set(minute(40));
  crash({ at: minute(40) });
  scheduleErrorAlert();
  await clock.runNext();
  assert.equal(clock.nextAt(), minute(50));
});

test("an incident during a failed scheduled delivery retains one cooldown trigger", async (t) => {
  const clock = scheduledClock(t);
  crash();
  let finish;
  send = () => new Promise((resolve) => { finish = resolve; });
  scheduleErrorAlert();
  const first = clock.runNext();
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  clock.set(minute(7));
  crash({ requestId: secondId, at: minute(7) });
  scheduleErrorAlert();
  finish({ sent: false, reason: "provider-unavailable" });
  await first;
  assert.equal(clock.size(), 1, "the new incident, rather than the failure, still owns a trigger");
  await clock.runNext();
  assert.equal(clock.nextAt(), minute(36));
  assert.equal(packets.length, 1);
  send = async () => ({ sent: true });
  await clock.runNext();
  assert.deepEqual(packets[1], packets[0], "the uncertain first batch remains unchanged");
  assert.equal(clock.nextAt(), minute(66));
  await clock.runNext();
  assert.ok(packets[2].vars.detail.includes(secondId));
  assert.equal(clock.size(), 0);
});

test("a new incident during a failed manual send survives cancellation of the older wake-up", async (t) => {
  const clock = scheduledClock(t);
  crash();
  await maybeAlert();
  clock.set(minute(10));
  crash({ requestId: secondId, at: minute(10) });
  scheduleErrorAlert();
  await clock.runNext();
  let finish;
  send = () => new Promise((resolve) => { finish = resolve; });
  clock.set(minute(20));
  const manual = maybeAlert({ force: true });
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  clock.set(minute(21));
  crash({ at: minute(21) });
  scheduleErrorAlert();
  finish({ sent: false, reason: "provider-unavailable" });
  await manual;
  assert.equal(clock.size(), 1);
  await clock.runNext();
  assert.equal(clock.nextAt(), minute(50));
  assert.equal(packets.length, 2);
  send = async () => ({ sent: true });
  await clock.runNext();
  assert.deepEqual(packets[2], packets[1]);
});
