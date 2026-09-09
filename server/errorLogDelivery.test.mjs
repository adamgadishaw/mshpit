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
const { maybeAlert, recordError, recentErrors, resetAlertStateForTests } = await import("./errorLog.js");
after(() => { db.close(); hooks.deregister(); delete globalThis.__pitAlertTestSend; rmSync(directory, { recursive: true, force: true }); });
beforeEach(() => {
  db.exec("DELETE FROM error_events");
  db.exec("UPDATE error_alert_delivery SET last_sent_at=0,pending_key=NULL,pending_payload=NULL WHERE singleton=1");
  delete process.env.ERROR_ALERTS_ENABLED;
  delete process.env.ERROR_ALERT_COOLDOWN_MIN;
  delete process.env.ALERT_EMAIL;
  resetAlertStateForTests();
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
