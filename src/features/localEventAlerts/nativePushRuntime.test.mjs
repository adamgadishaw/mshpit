import test from "node:test";
import assert from "node:assert/strict";
import { createNativePushRuntime } from "./nativePushRuntime.mjs";
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const toAppError = error => Object.assign(new Error(error.message), { name: "AppError", code: "PIT-NET-001", retryable: true });
function fixture({ enabled = true, cold = null } = {}) {
  const calls = [], handlers = {}, opened = [];
  const record = { installationId: "native_fixture_installation", secret: "x".repeat(64), binding: null };
  let generation = 0, activity = 0, permission = "granted", prefs = { datesPush: true, salesPush: false }, offline = false;
  const add = kind => callback => { handlers[kind] = callback; return { remove() { delete handlers[kind]; calls.push(`remove:${kind}`); } }; };
  const notifications = { AndroidImportance: { DEFAULT: 3 }, setNotificationChannelAsync: async () => calls.push("channel"),
    getPermissionsAsync: async () => ({ status: permission }), requestPermissionsAsync: async () => { calls.push("prompt"); return { status: permission }; },
    getExpoPushTokenAsync: async () => { calls.push("token"); return { data: "ExpoPushToken[fixturetoken12345]" }; },
    addPushTokenListener: add("token"), addNotificationReceivedListener: add("received"), addNotificationResponseReceivedListener: add("tap"),
    getLastNotificationResponseAsync: async () => cold };
  const api = { preferences: async () => { if (offline) throw Error("offline"); return { preferences: prefs }; },
    binding: async () => { if (offline) throw Error("offline"); return { generation }; },
    register: async value => { calls.push(`register:${value.accountId}`); return { installationId: record.installationId, generation: record.binding?.accountId === value.accountId ? generation : ++generation, enabled: true }; },
    revoke: async value => { calls.push(`revoke:${value.accountId}`); return { generation: ++generation, enabled: false }; },
    target: async value => { calls.push(`target:${value.accountId}`); return { target: { alertId: value.alertId, eventId: "tm_real", event: { id: "tm_real", venue: "Actual Hall" } } }; } };
  const storage = { readExisting: async () => structuredClone(record), getOrCreate: async () => structuredClone(record),
    saveBinding: async (binding, context) => { context.assertCurrent(); record.binding = binding; } };
  const runtime = createNativePushRuntime({ api, notifications, installationStorage: storage, platform: "android", projectId: "11111111-1111-1111-1111-111111111111", enabled, toAppError });
  runtime.updateCallbacks({ onOpenEvent: event => opened.push(event), onActivity: () => activity++ });
  const tap = () => ({ notification: { request: { identifier: "tap1", content: { data: { kind: "local_event_alert", alertId: "alert1", installationId: record.installationId, generation } } } } });
  return { runtime, record, calls, handlers, opened, api, notifications, storage, tap, activity: () => activity,
    prefs: value => { prefs = value; }, permission: value => { permission = value; }, offline: value => { offline = value; } };
}
test("guest, unconfigured build, ordinary startup and unselected channels never register", async () => {
  const f = fixture(); f.runtime.start(); await f.runtime.activate(); assert.deepEqual(f.calls, []);
  f.runtime.setAccount("A", 1); await f.runtime.activate(); assert.deepEqual(f.calls, []);
  f.prefs({ datesPush: false, salesPush: false }); await f.runtime.enableDevice(); assert.deepEqual(f.calls, []);
  const disabled = fixture({ enabled: false }); disabled.runtime.setAccount("A", 1); disabled.runtime.start(); await disabled.runtime.enableDevice();
  assert.deepEqual(disabled.calls, []); assert.equal(disabled.runtime.snapshot().capable, false);
});
test("explicit opt-in, restart and rotation refresh only the bound account without prompting", async () => {
  const f = fixture(); f.runtime.setAccount("A", 1); f.runtime.start();
  assert.equal((await f.runtime.enableDevice()).value.enabled, true); assert.equal(f.record.binding.accountId, "A");
  f.handlers.token(); await settle(); assert.equal(f.calls.filter(value => value === "register:A").length, 2);
  assert.equal(f.calls.includes("prompt"), false);
  f.runtime.stop(); f.runtime.setAccount("A", 2); f.runtime.start(); await f.runtime.activate();
  assert.equal(f.calls.filter(value => value === "register:A").length, 3);
  f.runtime.setAccount("B", 3); await f.runtime.activate(); assert.equal(f.calls.includes("register:B"), false);
  f.runtime.setAccount(null, 4); f.handlers.token(); await settle(); assert.equal(f.calls.includes("register:null"), false);
});
test("permission denial and channel opt-out revoke; offline failure is visible and retryable", async () => {
  const f = fixture(); f.runtime.setAccount("A", 1); await f.runtime.enableDevice();
  f.permission("denied"); await f.runtime.activate(); assert.equal(f.record.binding, null); assert.equal(f.runtime.snapshot().data.reason, "permission-denied");
  assert.equal(f.calls.includes("prompt"), false);
  f.permission("granted"); await f.runtime.enableDevice(); f.prefs({ datesPush: false, salesPush: false }); await f.runtime.activate();
  assert.equal(f.record.binding, null);
  f.offline(true); assert.equal((await f.runtime.enableDevice()).ok, false); assert.equal(f.runtime.snapshot().status, "error");
  f.offline(false); f.prefs({ datesPush: true }); assert.equal((await f.runtime.enableDevice()).ok, true);
});
test("taps use the authorized canonical target, reject foreign generations and deduplicate", async () => {
  const f = fixture(); f.runtime.setAccount("A", 1); f.runtime.start(); await f.runtime.enableDevice();
  const response = f.tap(); f.handlers.tap(response); await settle(); f.handlers.tap(response); await settle();
  assert.deepEqual(f.opened, [{ id: "tm_real", venue: "Actual Hall" }]);
  f.runtime.setAccount("B", 2); f.handlers.tap(response); await settle(); assert.equal(f.calls.includes("target:B"), false);
  f.runtime.setAccount("A", 3); response.notification.request.content.data.generation = 999;
  f.handlers.tap(response); await settle(); assert.equal(f.opened.length, 1);
});
test("pending SDK work, stale controls, and token refresh cannot cross account change or logout", async () => {
  const f = fixture(), token = deferred(); f.runtime.setAccount("A", 1); f.runtime.start();
  f.notifications.getExpoPushTokenAsync = () => token.promise;
  const commands = f.runtime.commands(), pending = commands.enableDevice(); await settle();
  f.runtime.setAccount("B", 2); token.resolve({ data: "ExpoPushToken[fixturetoken12345]" }); assert.equal((await pending).ok, false);
  assert.equal((await commands.enableDevice()).ok, false); assert.equal(f.calls.some(value => value.startsWith("register:")), false);
  f.runtime.reset(); f.runtime.stop(); assert.equal(Object.keys(f.handlers).length, 0);
});
test("account preparation is single flight and blocks refresh until cancelled", async () => {
  const f = fixture(); f.runtime.setAccount("A", 1); f.runtime.start(); await f.runtime.enableDevice();
  const [one, two] = await Promise.all([f.runtime.prepare(), f.runtime.prepare()]); assert.deepEqual(one, two);
  assert.equal(f.calls.filter(value => value === "revoke:A").length, 1);
  f.handlers.token(); await settle(); assert.equal(f.calls.filter(value => value === "register:A").length, 1);
  f.runtime.cancelPreparation(); await f.runtime.enableDevice(); assert.equal(f.calls.filter(value => value === "register:A").length, 2);
});
test("delayed tap target cannot navigate after logout or unmount", async () => {
  const f = fixture(), target = deferred(); f.runtime.setAccount("A", 1); f.runtime.start(); await f.runtime.enableDevice();
  f.api.target = () => target.promise; f.handlers.tap(f.tap()); await settle(); f.runtime.reset(); f.runtime.stop();
  target.resolve({ target: { alertId: "alert1", eventId: "tm_real", event: { id: "tm_real" } } }); await settle(); assert.equal(f.opened.length, 0);
});
test("cold response waits for authenticated scope even when SDK lookup crosses validation", async () => {
  const f = fixture(), cold = deferred();
  f.runtime.setAccount("A", 1); await f.runtime.enableDevice(); const response = f.tap();
  f.runtime.stop(); f.notifications.getLastNotificationResponseAsync = () => cold.promise;
  f.runtime.start(); f.runtime.setAccount("A", 2); cold.resolve(response); await settle();
  assert.equal(f.opened.length, 1); assert.equal(f.opened[0].id, "tm_real");
});

const namedTap = (f, name) => { const value = f.tap(); value.notification.request.identifier = name; value.notification.request.content.data.alertId = name; return value; };
const targetFor = id => ({ target: { alertId: id, eventId: id, event: { id } } });
test("newer warm tap wins over a delayed older target and its error", async () => {
  for (const failure of [false, true]) {
    const f = fixture(), older = deferred(); f.runtime.setAccount("A", 1); f.runtime.start(); await f.runtime.enableDevice();
    f.api.target = ({ alertId }) => alertId === "older" ? older.promise.then(() => { if (failure) throw Error("old failure"); return targetFor(alertId); }) : Promise.resolve(targetFor(alertId));
    f.handlers.tap(namedTap(f, "older")); await settle(); f.handlers.tap(namedTap(f, "newer")); await settle();
    older.resolve(); await settle();
    assert.deepEqual(f.opened, [{ id: "newer" }]); assert.equal(f.runtime.snapshot().error, null);
    f.handlers.tap(namedTap(f, "older")); await settle(); assert.deepEqual(f.opened, [{ id: "newer" }]);
  }
});
test("cold SDK lookup cannot replace a newer warm response or manual navigation", async () => {
  for (const manual of [false, true]) {
    const f = fixture(), cold = deferred(); f.runtime.setAccount("A", 1); await f.runtime.enableDevice();
    f.notifications.getLastNotificationResponseAsync = () => cold.promise; f.api.target = async ({ alertId }) => targetFor(alertId); f.runtime.start();
    if (manual) f.runtime.cancelNavigation(); else { f.handlers.tap(namedTap(f, "warm")); await settle(); }
    cold.resolve(namedTap(f, "cold")); await settle();
    assert.deepEqual(f.opened, manual ? [] : [{ id: "warm" }]);
  }
});
test("manual navigation and composer guards retire pending native destinations", async () => {
  const f = fixture(), target = deferred(); f.runtime.setAccount("A", 1); f.runtime.start(); await f.runtime.enableDevice();
  f.api.target = () => target.promise; f.handlers.tap(namedTap(f, "pending")); await settle(); f.runtime.cancelNavigation();
  target.resolve(targetFor("pending")); await settle(); assert.deepEqual(f.opened, []);
  const guards = []; f.runtime.updateCallbacks({ onOpenEvent: (_event, current) => guards.push(current), onActivity: () => {} });
  f.api.target = async ({ alertId }) => targetFor(alertId);
  f.handlers.tap(namedTap(f, "dialog1")); await settle(); assert.equal(guards[0](), true);
  f.handlers.tap(namedTap(f, "dialog2")); await settle(); assert.equal(guards[0](), false); assert.equal(guards[1](), true);
  f.runtime.cancelNavigation(); assert.equal(guards[1](), false);
});
test("guest warm response supersedes a pending cold lookup before authentication", async () => {
  const f = fixture(), cold = deferred(); f.runtime.setAccount("A", 1); await f.runtime.enableDevice();
  const warm = namedTap(f, "warm"), old = namedTap(f, "cold"); f.runtime.stop();
  f.notifications.getLastNotificationResponseAsync = () => cold.promise; f.runtime.start(); f.handlers.tap(warm);
  cold.resolve(old); await settle(); f.runtime.setAccount("A", 2);
  f.api.target = async ({ alertId }) => targetFor(alertId);
  await f.runtime.activate(); await settle();
  assert.deepEqual(f.opened, [{ id: "warm" }]);
});
test("retained SDK listeners from an old mount cannot override the new mount", async () => {
  const f = fixture(); f.runtime.setAccount("A", 1); await f.runtime.enableDevice(); f.runtime.start();
  const oldTap = f.handlers.tap, oldToken = f.handlers.token, stale = namedTap(f, "old-mount");
  f.runtime.stop(); f.runtime.setAccount("A", 2); f.runtime.start(); f.api.target = async ({ alertId }) => targetFor(alertId);
  f.handlers.tap(namedTap(f, "new-mount")); await settle(); oldTap(stale); oldToken(); await settle();
  assert.deepEqual(f.opened, [{ id: "new-mount" }]); assert.equal(f.calls.filter(value => value === "register:A").length, 1);
});
