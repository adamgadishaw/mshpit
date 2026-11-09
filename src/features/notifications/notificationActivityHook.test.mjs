import "./notificationPageLoad.mjs";
import "./notificationReadCommand.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createNotificationActivity } from "./notificationActivityState.mjs";
import { createNotificationActivityBootstrap } from "./notificationActivityBootstrap.mjs";
import { isLoadCancellation } from "../../domain/loadState.mjs";

const require = createRequire(import.meta.url);
const compile = name => require("@babel/core").transformSync(readFileSync(new URL(name, import.meta.url), "utf8"), {
  babelrc: false, configFile: false, plugins: [require.resolve("@babel/plugin-transform-modules-commonjs")],
}).code;
const hookSource = compile("./useNotificationActivity.js");
const serviceSource = compile("./notificationsApi.js");
const runtimeSource = compile("./notificationRuntime.mjs");
class AppError extends Error {
  constructor(message, options = {}) { super(message); this.name = "AppError"; Object.assign(this, options); }
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const identity = (accountId = "A", epoch = 1, ready = true) => ({ accountId, epoch, ready });
const payload = (id = "row", unread = 1) => ({
  notifications: [{ id, ts: 1, read: false, actorId: "actor", text: "Private activity body" }],
  unread, nextCursor: null, readContract: "notification-ids-v1",
});
function loadModule(source, dependencies, extras = {}) {
  const module = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(extras), source)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, module, module.exports, ...Object.values(extras));
  return module.exports;
}
function serviceHarness() {
  const calls = [];
  const service = loadModule(serviceSource, { "../../lib/api": {
    AppError, api: (url, options) => new Promise((resolve, reject) => calls.push({ url, options, resolve, reject })),
  } });
  return { service, calls };
}
// Only React scheduling, app lifecycle, transport and storage are adapters.
// The hook, service, controller and domain transitions are production code.
function harness(initial = identity()) {
  const { service, calls } = serviceHarness();
  const runtime = loadModule(runtimeSource, {
    "./notificationActivityState.mjs": { createNotificationActivity },
    "./notificationsApi.js": service, "../../lib/diagnostics": { AppError },
  });
  let current = initial, active = true, refIndex = 0, effectIndex = 0;
  const refs = [], effects = [], pending = [], timers = new Map(), saved = [];
  let timerId = 0;
  const same = (a, b) => a && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useRef(value) { const index = refIndex++; return refs[index] ||= { current: value }; },
    useEffect(effect, deps) {
      const index = effectIndex++;
      if (!same(effects[index]?.deps, deps)) pending.push(() => {
        effects[index]?.cleanup?.(); effects[index] = { deps, cleanup: effect() };
      });
    },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
  };
  const hook = loadModule(hookSource, {
    react, "../../lib/useAppActive": { __esModule: true, default: () => active },
    "../../lib/diagnostics": { toAppError: (error, options) => error instanceof AppError ? error : new AppError(options.message, options) }, "../../lib/persist": { save: (...args) => saved.push(args) },
    "../../domain/loadState.mjs": { isLoadCancellation },
    "./notificationActivityBootstrap.mjs": { createNotificationActivityBootstrap: options => createNotificationActivityBootstrap({
      ...options, loadRuntime: async () => runtime,
    }) },
  }, {
    setInterval: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearInterval: id => timers.delete(id),
  }).default;
  const getIdentity = () => current;
  return {
    calls, saved, timers,
    render(next = current, appActive = active) {
      current = next; active = appActive; refIndex = 0; effectIndex = 0;
      const result = hook({ getIdentity });
      while (pending.length) pending.shift()();
      return result;
    },
    tick() { for (const timer of [...timers.values()]) timer.fn(); },
    dispose() { for (const effect of effects) effect.cleanup?.(); effects.length = 0; },
  };
}

test("real hook boot and guest do not fetch; account readiness starts exactly one initial head", async () => {
  const h = harness(identity(null, 0, false));
  try {
    h.render(); await settle(); assert.equal(h.calls.length, 0); assert.equal(h.timers.size, 0);
    h.render(identity("A", 1, false)); await settle(); assert.equal(h.calls.length, 0);
    h.render(identity()); h.render(identity()); await settle();
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0].url, "/api/me/notifications?limit=100");
    assert.equal(h.calls[0].options.expectedAccountId, "A");
    h.calls[0].resolve(payload()); await settle();
    assert.equal(h.render().notifications[0].id, "row"); assert.equal(h.calls.length, 1);
  } finally { h.dispose(); }
});

test("active polling is one bounded summary request, never polls in background or persists content", async () => {
  const h = harness();
  try {
    h.render(); await settle(); h.calls[0].resolve(payload()); await settle();
    assert.equal(h.timers.size, 1); assert.equal([...h.timers.values()][0].delay, 60_000);
    h.tick(); h.tick(); await settle(); assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1].url, "/api/me/notifications?limit=1");
    h.calls[1].resolve(payload("summary-only", 8)); await settle();
    const state = h.render(); assert.equal(state.notifications[0].id, "row"); assert.equal(state.notificationActivity.data.unread, 8);
    h.render(identity(), false); h.tick(); await settle(); assert.equal(h.timers.size, 0); assert.equal(h.calls.length, 2);
    assert.deepEqual(h.saved, [["pit.notifications", []]]);
  } finally { h.dispose(); }
});

test("Activity head in flight coalesces foreground summary and repeated screen refresh", async () => {
  const h = harness();
  try {
    h.render(); await settle(); h.calls[0].resolve(payload()); await settle();
    const background = h.render(identity(), false);
    const first = background.refreshNotifications(); const second = background.refreshNotifications();
    h.render(identity(), true); await settle();
    assert.equal(h.calls.length, 2); assert.equal(h.calls[1].url, "/api/me/notifications?limit=100");
    h.calls[1].resolve(payload("fresh")); await Promise.all([first, second]); await settle();
    assert.equal(h.calls.length, 2); assert.equal(h.render().notifications[0].id, "fresh");
  } finally { h.dispose(); }
});

test("A-B-A scope switches retire old closures and responses before new account adoption", async () => {
  const h = harness();
  try {
    const oldA = h.render(); await settle();
    const b = h.render(identity("B", 2)); assert.deepEqual(b.notifications, []); await settle();
    assert.equal(h.calls[0].options.signal.aborted, true);
    const newA = h.render(identity("A", 3)); assert.deepEqual(newA.notifications, []); await settle();
    assert.equal(h.calls.length, 3);
    await assert.rejects(oldA.refreshNotifications(), { name: "AbortError" });
    const staleWrite = await oldA.markNotificationsRead({ notificationIds: ["old"] }); assert.equal(staleWrite.ok, false);
    oldA.setNotifications([{ id: "leak", userId: "A", ts: 8 }]);
    h.calls[0].resolve(payload("old-A")); h.calls[1].resolve(payload("old-B")); h.calls[2].resolve(payload("new-A")); await settle();
    assert.deepEqual(h.render().notifications.map(n => n.id), ["new-A"]);
    assert.equal(h.calls.length, 3);
  } finally { h.dispose(); }
});

test("unmount aborts transport and cleans timer; effect remount starts usable fresh request", async () => {
  const h = harness();
  try {
    h.render(); await settle(); h.dispose();
    assert.equal(h.calls[0].options.signal.aborted, true); assert.equal(h.timers.size, 0);
    h.calls[0].resolve(payload("discarded")); await settle();
    h.render(); await settle(); assert.equal(h.calls.length, 2);
    h.calls[1].resolve(payload("remounted")); await settle();
    assert.equal(h.render().notifications[0].id, "remounted");
    assert.ok(h.saved.every(([key, value]) => key === "pit.notifications" && value.length === 0));
  } finally { h.dispose(); }
});

test("real hook plus service sends only selected IDs to scoped route and adopts only confirmed IDs", async () => {
  const h = harness();
  try {
    h.render(); await settle();
    const data = payload("first", 2); data.notifications.push({ ...data.notifications[0], id: "second" });
    h.calls[0].resolve(data); await settle();
    const pending = h.render().markNotificationsRead({ notificationIds: ["first", "second"] }); await settle();
    assert.equal(h.calls[1].url, "/api/me/notifications/read/scoped");
    assert.deepEqual(h.calls[1].options.body, { notificationIds: ["first", "second"] });
    assert.equal(h.calls[1].options.expectedAccountId, "A"); assert.equal(h.calls[1].options.method, "POST");
    h.calls[1].resolve({ ok: true, readContract: "notification-ids-v1", notificationIds: ["first"], unread: 1 });
    assert.equal((await pending).ok, true);
    const rows = h.render().notifications; assert.equal(rows.find(n => n.id === "first").read, true);
    assert.equal(rows.find(n => n.id === "second").read, false);
  } finally { h.dispose(); }
});

test("service preserves exact IDs, account fence, cancellation and encoded cursor", async () => {
  const h = serviceHarness(), signal = new AbortController().signal;
  const read = h.service.fetchNotificationPage({ accountId: "B", cursor: "cursor/+?=", limit: 1, signal });
  assert.equal(h.calls[0].url, "/api/me/notifications?limit=1&before=cursor%2F%2B%3F%3D");
  assert.equal(h.calls[0].options.signal, signal); assert.equal(h.calls[0].options.expectedAccountId, "B");
  h.calls[0].resolve(payload()); await read;
  const write = h.service.writeNotificationReads({ accountId: "B", notificationIds: ["two", "one"], signal });
  assert.deepEqual(h.calls[1].options.body.notificationIds, ["two", "one"]);
  assert.equal(h.calls[1].options.signal, signal); assert.equal(h.calls[1].options.expectedAccountId, "B");
  h.calls[1].resolve({ ok: true, readContract: "notification-ids-v1", notificationIds: ["one"], unread: 4 });
  assert.deepEqual(await write, { readContract: "notification-ids-v1", notificationIds: ["one"], unread: 4 });
});

test("service rejects missing, false and non-boolean success rather than confirming a write", async () => {
  for (const response of [null, {}, { ok: false }, { ok: "true" }, { ok: 1 }]) {
    const h = serviceHarness();
    const request = h.service.writeNotificationReads({ accountId: "A", notificationIds: ["row"] });
    const rejected = assert.rejects(request, error => error instanceof AppError && error.code === "PIT-API-001");
    h.calls[0].resolve(response); await rejected;
  }
});

test("foreground summary first serializes a required Activity head without replacing its rows", async () => {
  const h = harness();
  try {
    h.render(); await settle(); h.calls[0].resolve(payload("cached")); await settle();
    h.render(identity(), false);
    const foreground = h.render(identity(), true); await settle();
    assert.equal(h.calls[1].url, "/api/me/notifications?limit=1");
    const head = foreground.refreshNotifications(); await settle();
    assert.equal(h.calls.length, 2, "head waits rather than racing an earlier summary");
    h.calls[1].resolve(payload("summary", 4)); await settle();
    assert.equal(h.calls.length, 3); assert.equal(h.calls[2].url, "/api/me/notifications?limit=100");
    assert.equal(h.render().notifications[0].id, "cached");
    h.calls[2].resolve(payload("fresh-head", 4)); await head;
    assert.equal(h.render().notifications[0].id, "fresh-head");
  } finally { h.dispose(); }
});

test("summary failure retains confirmed count and the next timer retries without persisting bodies", async () => {
  const h = harness();
  try {
    h.render(); await settle(); h.calls[0].resolve(payload("cached", 7)); await settle();
    h.tick(); await settle(); h.calls[1].reject(new Error("offline")); await settle();
    assert.equal(h.render().notificationActivity.data.unread, 7);
    assert.equal(h.render().notifications[0].id, "cached");
    h.tick(); await settle(); assert.equal(h.calls[2].url, "/api/me/notifications?limit=1");
    h.calls[2].resolve(payload("summary", 8)); await settle();
    assert.equal(h.render().notificationActivity.data.unread, 8);
    assert.deepEqual(h.saved, [["pit.notifications", []]]);
  } finally { h.dispose(); }
});


test("lazy runtime preserves the three explicit demo fixtures without transport", async () => {
  const { service, calls } = serviceHarness();
  const { createNotificationRuntime } = loadModule(runtimeSource, {
    "./notificationActivityState.mjs": { createNotificationActivity },
    "./notificationsApi.js": service, "../../lib/diagnostics": { AppError },
  });
  const controller = createNotificationRuntime({ getIdentity: () => identity("u_demo"), demo: true });
  await controller.load();
  assert.deepEqual(controller.getSnapshot().data.rows.map(row => row.id), ["nf1", "nf2", "nf3"]);
  assert.equal(controller.getSnapshot().data.unread, 2);
  assert.equal(calls.length, 0);
  controller.unmount();
});
