import { test } from "node:test";
import assert from "node:assert/strict";
import { createLocalPushController } from "./localPushController.mjs";
import { createLocalAlertApi } from "./localAlertApi.mjs";
import { createSecureInstallationStorage } from "./secureInstallationStorage.mjs";

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const appError = error => Object.assign(new Error(error.message), { name: "AppError", code: "PIT-NET-001", retryable: true });
function fixture(options = {}) {
  const calls = [], opened = [], changes = [];
  const installation = { installationId: "fixture_installation_12345", secret: "a".repeat(43), binding: null };
  const installationStorage = { getOrCreate: async () => structuredClone(installation), saveBinding: async (binding, ctx) => { ctx?.assertCurrent(); installation.binding = binding; } };
  const notifications = {
    AndroidImportance: { DEFAULT: 3 }, setNotificationChannelAsync: async () => calls.push("channel"),
    getPermissionsAsync: async () => { calls.push("read-permission"); return { status: "granted" }; },
    requestPermissionsAsync: async () => { calls.push("request-permission"); return { status: "granted" }; },
    getExpoPushTokenAsync: async () => { calls.push("token"); return { data: "ExpoPushToken[fixturetoken12345]" }; },
    ...options.notifications,
  };
  const api = {
    binding: async args => { calls.push(["binding", args.accountId]); return { generation: 0 }; },
    register: async args => { calls.push(["register", args.accountId]); return { installationId: installation.installationId, generation: 1, enabled: true }; },
    revoke: async args => { calls.push(["revoke", args.accountId]); return { enabled: false, generation: 1 }; },
    target: async args => { calls.push(["target", args.accountId]); return { target: { alertId: args.alertId, eventId: "tm_1" } }; },
    ...options.api,
  };
  const controller = createLocalPushController({ api, installationStorage, notifications, platform: options.platform || "ios", projectId: options.projectId === undefined ? "11111111-1111-1111-1111-111111111111" : options.projectId,
    toAppError: appError, onChange: state => changes.push(state), onOpenEvent: id => opened.push(id) });
  controller.setAccount("A", 1);
  const response = { notification: { request: { identifier: "response1", content: { data: { kind: "local_event_alert", alertId: "alert1", installationId: installation.installationId, generation: 1 } } } } };
  return { controller, calls, opened, changes, installation, response };
}

test("no permission prompt at construction; Android channel precedes explicit enable", async () => {
  const f = fixture({ platform: "android" }); assert.equal(f.calls.length, 0);
  const [first, second] = await Promise.all([f.controller.enableDevice(), f.controller.enableDevice()]);
  assert.equal(first.ok, true); assert.deepEqual(first, second);
  assert.deepEqual(f.calls.slice(0, 2), ["channel", "read-permission"]);
  assert.equal(f.calls.filter(call => Array.isArray(call) && call[0] === "register").length, 1);
});

test("iOS provisional permission registers quietly without a second prompt", async () => {
  const f = fixture({ notifications: { IosAuthorizationStatus: { PROVISIONAL: 3 }, getPermissionsAsync: async () => ({ status: "undetermined", ios: { status: 3 } }) } });
  assert.equal((await f.controller.enableDevice()).value.enabled, true);
  assert.equal(f.calls.includes("request-permission"), false);
});

test("denied OS permission cannot register and revokes an old binding", async () => {
  const f = fixture({ notifications: { getPermissionsAsync: async () => ({ status: "denied" }), requestPermissionsAsync: async () => ({ status: "denied" }) } });
  f.installation.binding = { accountId: "A", installationId: f.installation.installationId, generation: 1 };
  const result = await f.controller.enableDevice(); assert.equal(result.value.reason, "permission-denied");
  assert.deepEqual(f.calls, [["binding", "A"], ["revoke", "A"]]); assert.equal(f.installation.binding, null);
});

test("silent resume never prompts; web and missing project report unavailable", async () => {
  const f = fixture({ notifications: { getPermissionsAsync: async () => ({ status: "denied" }) } });
  await f.controller.enableDevice({ requestPermission: false }); assert.equal(f.calls.includes("request-permission"), false);
  for (const options of [{ platform: "web" }, { projectId: null }]) {
    const unavailable = fixture(options); const result = await unavailable.controller.enableDevice();
    assert.equal(result.value.reason, "native-configuration-required"); assert.equal(unavailable.calls.length, 0);
  }
});

test("A to B to guest resets private data synchronously and discards delayed enable", async () => {
  const permission = deferred();
  const f = fixture({ notifications: { getPermissionsAsync: () => permission.promise } });
  const pending = f.controller.enableDevice(); f.controller.setAccount("B", 2);
  assert.equal(f.controller.getState().scope, "B:2"); assert.equal(f.controller.getState().data, null);
  permission.resolve({ status: "granted" }); await assert.rejects(pending, { name: "AbortError" });
  assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === "register"), false);
  f.controller.setAccount(null, 3); assert.equal(f.controller.getState().scope, "guest:3"); assert.equal(f.controller.getState().error, null);
});

test("disable supersedes an interrupted enable and cannot be undone by it", async () => {
  const token = deferred();
  const f = fixture({ notifications: { getExpoPushTokenAsync: () => token.promise } });
  const enabling = f.controller.enableDevice(); await new Promise(resolve => setImmediate(resolve));
  const disabled = await f.controller.disableDevice(); assert.equal(disabled.value.enabled, false);
  token.resolve({ data: "ExpoPushToken[fixturetoken12345]" }); await assert.rejects(enabling, { name: "AbortError" });
  assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === "register"), false);
});

test("network failure surfaces AppError and retry can succeed", async () => {
  let attempts = 0;
  const f = fixture({ api: { binding: async () => { if (++attempts === 1) throw Error("offline"); return { generation: 0 }; } } });
  assert.equal((await f.controller.enableDevice()).ok, false); assert.equal(f.controller.getState().status, "error");
  assert.equal((await f.controller.enableDevice()).ok, true); assert.equal(f.controller.getState().status, "ready");
});

test("tap validates current installation/account and opens only a canonical event", async () => {
  const f = fixture(); await f.controller.enableDevice();
  const concurrent = await Promise.all([f.controller.openResponse(f.response), f.controller.openResponse(f.response)]);
  assert.equal(concurrent.filter(result => result.value.opened).length, 1);
  assert.equal((await f.controller.openResponse(f.response)).value.opened, false); assert.deepEqual(f.opened, ["tm_1"]);
  f.controller.setAccount("B", 2); assert.equal((await f.controller.openResponse(f.response)).value.opened, false);
  f.controller.setAccount(null, 3); assert.equal((await f.controller.openResponse(f.response)).value.opened, false);
});

test("stale generation, unknown event and account switch during tap cannot navigate", async () => {
  const target = deferred(); const f = fixture({ api: { target: () => target.promise } }); await f.controller.enableDevice();
  const wrong = structuredClone(f.response); wrong.notification.request.content.data.generation = 99;
  assert.equal((await f.controller.openResponse(wrong)).value.opened, false);
  const pending = f.controller.openResponse(f.response); await new Promise(resolve => setImmediate(resolve));
  f.controller.setAccount("B", 2); target.resolve({ target: { eventId: "tm_1", alertId: "alert1" } });
  await assert.rejects(pending, { name: "AbortError" }); assert.deepEqual(f.opened, []);
});

test("API binds every operation to expected account and observes cancellation", async () => {
  const calls = []; const api = createLocalAlertApi({ apiCall: async (...args) => { calls.push(args); return {}; } });
  await api.preferences({ accountId: "A" }); await api.target({ accountId: "A", alertId: "tm/1" });
  assert.equal(calls[0][1].expectedAccountId, "A"); assert.equal(calls[1][0], "/api/me/local-alerts/tm%2F1/target");
  await assert.rejects(api.register({ accountId: null }));
  const abort = new AbortController(); abort.abort(); await assert.rejects(api.preferences({ accountId: "A", signal: abort.signal }), { name: "AbortError" });
  assert.equal(calls.length, 2);
});

test("secure storage serializes identity creation and does not persist push tokens", async () => {
  let stored = null, created = 0;
  const secureStore = { getItemAsync: async () => stored, setItemAsync: async (_key, value) => { stored = value; } };
  const storage = createSecureInstallationStorage({ secureStore, createIdentity: async () => { created++; return { installationId: "fixture_installation_12345", secret: "a".repeat(43) }; } });
  const [a, b] = await Promise.all([storage.getOrCreate(), storage.getOrCreate()]); assert.deepEqual(a, b); assert.equal(created, 1);
  await storage.saveBinding({ accountId: "A", installationId: a.installationId, generation: 1 });
  assert.equal((await storage.getOrCreate()).binding.accountId, "A"); assert.equal(stored.includes("token"), false);
  const previous = stored; stored = "bad record"; await assert.rejects(storage.getOrCreate()); assert.equal(stored, "bad record"); stored = previous;
});

test("account-change preparation revokes before credentials change and prevents an overlapping enable", async () => {
  const fence = deferred(); let body;
  const f = fixture({ api: { binding: async () => ({ generation: 4 }), revoke: async args => { body = args; return fence.promise; } } });
  f.installation.binding = { accountId: "A", installationId: f.installation.installationId, generation: 4 };
  const preparing = f.controller.prepareAccountChange(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(body.accountId, "A"); assert.equal(body.body.expectedGeneration, 4);
  assert.equal((await f.controller.enableDevice()).ok, false);
  fence.resolve({ enabled: false, generation: 5 }); assert.equal((await preparing).ok, true);
  assert.equal(f.installation.binding, null);
  f.controller.setAccount("B", 2); assert.equal(f.controller.getState().data, null);
  assert.equal(f.calls.some(call => Array.isArray(call) && call[0] === "register"), false);
});

test("revocation failure is visible and retry remains required before switching", async () => {
  let attempts = 0;
  const f = fixture({ api: { revoke: async () => { if (++attempts === 1) throw Error("offline"); return { enabled: false, generation: 1 }; } } });
  assert.equal((await f.controller.prepareAccountChange()).ok, false);
  assert.equal(f.controller.getState().status, "error");
  assert.equal((await f.controller.enableDevice()).ok, false);
  assert.equal((await f.controller.prepareAccountChange()).ok, true);
  f.controller.cancelAccountChange(); assert.equal((await f.controller.enableDevice()).ok, true);
});

test("a registration response arriving after preparation cannot restore local binding", async () => {
  const registration = deferred();
  const f = fixture({ api: { register: () => registration.promise, binding: async () => ({ generation: 1 }), revoke: async () => ({ enabled: false, generation: 2 }) } });
  const pending = f.controller.enableDevice(); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.controller.prepareAccountChange()).ok, true);
  registration.resolve({ installationId: f.installation.installationId, generation: 1, enabled: true });
  await assert.rejects(pending, { name: "AbortError" }); assert.equal(f.installation.binding, null);
});

test("unconfirmed revocation cannot report a successful account-change preparation", async () => {
  const f = fixture({ api: { revoke: async () => ({ enabled: true, generation: 1 }) } });
  assert.equal((await f.controller.prepareAccountChange()).ok, false);
  assert.equal(f.controller.getState().status, "error");
});
