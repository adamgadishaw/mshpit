import test from "node:test";
import assert from "node:assert/strict";
import { createLocalAlertSettingsController } from "./localAlertSettingsController.mjs";
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const toAppError = value => Object.assign(new Error(value.message), { name: "AppError", code: "PIT-NET-001", retryable: true });
const data = { preferences: { datesInbox: true, salesInbox: true, datesPush: false, salesPush: false }, homeCity: { city: "Toronto" } };
test("A to B to A and auth epoch changes synchronously hide old preferences and reject late reads", async () => {
  const pending = deferred(); let signal;
  const controller = createLocalAlertSettingsController({ toAppError, api: { preferences: options => { signal = options.signal; return pending.promise; } } });
  controller.setAccount("A", 1); const load = controller.load();
  controller.setAccount("B", 2); assert.equal(signal.aborted, true); assert.equal(controller.snapshot().data, null);
  controller.setAccount("A", 3); pending.resolve(data); assert.equal((await load).ok, false);
  assert.equal(controller.snapshot().data, null);
});
test("failed settings writes retain confirmed values, retries save complete channel preferences, and unmount cancels", async () => {
  let fail = true, body;
  const controller = createLocalAlertSettingsController({ toAppError, api: { preferences: async () => data,
    setPreferences: async options => { body = options.body; if (fail) throw new Error("offline"); return { preferences: body }; } } });
  controller.setAccount("A", 1); assert.equal((await controller.load()).ok, true);
  const next = { ...data.preferences, datesInbox: false };
  assert.equal((await controller.save(next)).ok, false);
  assert.equal(controller.snapshot().data.preferences.datesInbox, true);
  fail = false; assert.equal((await controller.save(next)).ok, true);
  assert.deepEqual(body, next); assert.equal(controller.snapshot().data.homeCity.city, "Toronto");
  const pending = deferred(); let signal;
  const second = createLocalAlertSettingsController({ toAppError, api: { preferences: options => { signal = options.signal; return pending.promise; } } });
  second.setAccount("A", 1); const read = second.load(); second.stop(); pending.resolve(data);
  assert.equal(signal.aborted, true); assert.equal((await read).ok, false);
});
