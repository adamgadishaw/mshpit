import assert from "node:assert/strict";
import test from "node:test";

import { confirmMissingDynamicChunk, dynamicChunkUrl, lazyWithRetry, loadChunk } from "./lazyWithRetry.js";

// A fake sessionStorage and reload spy, so the recovery path is testable without
// a browser.
function harness() {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  let reloads = 0;
  return { storage, reload: () => { reloads += 1; }, reloadCount: () => reloads, delay: () => Promise.resolve(), store };
}

function elementText(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  const children = node?.props?.children;
  return (Array.isArray(children) ? children : [children]).map(elementText).join(" ");
}

function findElement(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  const children = node?.props?.children;
  for (const child of (Array.isArray(children) ? children : [children])) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

test("a chunk that loads first try returns it and leaves no reload guard", async () => {
  const h = harness();
  const mod = await loadChunk(async () => ({ default: "Screen" }), { name: "Ok", ...h });
  assert.equal(mod.default, "Screen");
  assert.equal(h.reloadCount(), 0);
  assert.equal(h.store.size, 0, "no guard left behind on success");
});

test("a transient blip is retried once and then succeeds without reloading", async () => {
  const h = harness();
  let attempts = 0;
  const mod = await loadChunk(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("network blip");
    return { default: "Screen" };
  }, { name: "Blip", ...h });
  assert.equal(attempts, 2, "should have retried exactly once");
  assert.equal(mod.default, "Screen");
  assert.equal(h.reloadCount(), 0, "a recovered blip must not reload the page");
});

test("a stale chunk after a deploy reloads exactly once", async () => {
  const h = harness();
  const alwaysFails = async () => { throw new Error("Loading chunk failed: 404"); };
  const mod = await loadChunk(alwaysFails, { name: "Admin", ...h });
  assert.equal(h.reloadCount(), 1, "reloads to get fresh HTML");
  assert.equal(h.store.get("pit.chunkReload.Admin"), "1", "persists the guard before reloading");
  assert.equal(typeof mod.default, "function");
  const fallback = mod.default();
  assert.equal(fallback.props.role, "status");
  assert.equal(fallback.props["aria-live"], "polite");
  assert.match(elementText(fallback), /Updating Mshpit…/);
});

test("a reload that returns normally leaves an accessible manual escape", async () => {
  const h = harness();
  const stale = async () => { throw new Error("Loading chunk failed: 404"); };
  const mod = await loadChunk(stale, { name: "NoNavigation", ...h });
  assert.equal(h.reloadCount(), 1, "the automatic path still runs only once");

  const fallback = mod.default();
  assert.equal(fallback.props["aria-atomic"], "true");
  const button = findElement(fallback, (node) => node.type === "button");
  assert.ok(button, "fallback has a keyboard-focusable native button");
  assert.equal(button.props["aria-label"], "Reload Mshpit");
  assert.equal(elementText(button), "Try again");
  button.props.onClick();
  assert.equal(h.reloadCount(), 2, "another reload happens only after explicit user action");
  assert.equal(h.store.get("pit.chunkReload.NoNavigation"), "1", "manual escape does not clear the loop guard");
});

test("a stale chunk surfaces its error when session storage is unavailable", async () => {
  const h = harness();
  const stale = async () => { throw new Error("Loading chunk failed: 404"); };

  await assert.rejects(() => loadChunk(stale, {
    name: "NoStorage",
    ...h,
    storage: null,
  }), /Loading chunk failed: 404/);
  assert.equal(h.reloadCount(), 0, "cannot safely reload without a persistent guard");
});

test("a stale chunk surfaces its error when writing the reload guard throws", async () => {
  const h = harness();
  const stale = async () => { throw new Error("Loading chunk failed: 404"); };
  const storage = {
    getItem: () => null,
    setItem: () => { throw new Error("storage denied"); },
    removeItem: () => {},
  };

  await assert.rejects(() => loadChunk(stale, { name: "Denied", ...h, storage }), /Loading chunk failed: 404/);
  assert.equal(h.reloadCount(), 0, "a failed guard write must not reload");
});

test("a stale chunk surfaces its error when the reload guard cannot be read back", async () => {
  const h = harness();
  const stale = async () => { throw new Error("Loading chunk failed: 404"); };
  let stored = null;
  const storage = {
    getItem: () => stored === "1" ? "mismatch" : stored,
    setItem: (_key, value) => { stored = String(value); },
    removeItem: () => { stored = null; },
  };

  await assert.rejects(() => loadChunk(stale, { name: "Mismatch", ...h, storage }), /Loading chunk failed: 404/);
  assert.equal(stored, "1", "the attempted write occurred");
  assert.equal(h.reloadCount(), 0, "an unconfirmed guard must not reload");
});

test("repeated cellular fetch failures never hard-reload the app", async () => {
  const h = harness();
  const offline = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(() => loadChunk(offline, { name: "Composer", ...h }), /Failed to fetch/);
  assert.equal(h.reloadCount(), 0, "a network outage must preserve unsaved composer state");
  assert.equal(h.store.size, 0);
});

test("Expo's real AsyncRequireError reloads only after the hashed asset is confirmed missing", async () => {
  const h = harness();
  const stale = new Error("Loading module https://www.mshpit.com/_expo/static/js/web/LogScreen-deadbeef.js failed.\n(error: https://www.mshpit.com/_expo/static/js/web/LogScreen-deadbeef.js)");
  stale.name = "AsyncRequireError";
  const factory = async () => { throw stale; };
  await loadChunk(factory, {
    name: "Composer",
    ...h,
    online: true,
    baseUrl: "https://www.mshpit.com/feed",
    probe: async () => ({ status: 404, headers: { get: () => "application/json" } }),
  });
  assert.equal(h.reloadCount(), 1);
});

test("a dynamic import failure during a network outage preserves the page", async () => {
  const h = harness();
  const transient = new Error("Failed to fetch dynamically imported module: https://www.mshpit.com/_expo/static/js/web/LogScreen-deadbeef.js");
  await assert.rejects(() => loadChunk(async () => { throw transient; }, {
    name: "Composer",
    ...h,
    online: true,
    baseUrl: "https://www.mshpit.com/feed",
    probe: async () => { throw new TypeError("Failed to fetch"); },
  }), /dynamically imported module/);
  assert.equal(h.reloadCount(), 0);
});

test("dynamic chunk verification is same-origin and recognizes an HTML SPA fallback", async () => {
  const error = Object.assign(new Error("Loading module /_expo/static/js/web/Old.js failed. (error: /_expo/static/js/web/Old.js)"), { name: "AsyncRequireError" });
  assert.equal(dynamicChunkUrl(error, "https://www.mshpit.com/feed"), "https://www.mshpit.com/_expo/static/js/web/Old.js");
  assert.equal(await confirmMissingDynamicChunk(error, {
    baseUrl: "https://www.mshpit.com/feed",
    probe: async () => ({ status: 200, headers: { get: () => "text/html; charset=utf-8" } }),
  }), true);
});

test("it never loops: a second failure after the reload throws instead", async () => {
  const h = harness();
  const alwaysFails = async () => { throw new Error("still 404"); };
  // First load: reloads and returns the placeholder.
  await loadChunk(alwaysFails, { name: "Loop", ...h });
  assert.equal(h.reloadCount(), 1);
  // Second load with the guard already set (as it would be after the reload):
  // it must surface the error, not reload again.
  await assert.rejects(() => loadChunk(alwaysFails, { name: "Loop", ...h }), /still 404/);
  assert.equal(h.reloadCount(), 1, "must not reload a second time");
});

test("recovering one screen does not suppress a reload for a different screen", async () => {
  const h = harness();
  const fail = async () => { throw new Error("404"); };
  await loadChunk(fail, { name: "ScreenA", ...h });
  await loadChunk(fail, { name: "ScreenB", ...h });
  assert.equal(h.reloadCount(), 2, "each chunk gets its own one-shot reload");
});

test("a later success clears the guard so a future failure can recover again", async () => {
  const h = harness();
  const fail = async () => { throw new Error("404"); };
  await loadChunk(fail, { name: "Screen", ...h });     // reload #1, guard set
  assert.equal(h.store.get("pit.chunkReload.Screen"), "1");
  await loadChunk(async () => ({ default: "ok" }), { name: "Screen", ...h }); // recovers
  assert.equal(h.store.has("pit.chunkReload.Screen"), false, "guard cleared on success");
});

test("preloading a lazy screen shares one import with React's later render", async () => {
  let imports = 0;
  const Screen = lazyWithRetry(async () => {
    imports += 1;
    return { default: () => null };
  }, "Preloaded");

  const [first, second] = await Promise.all([Screen.preload(), Screen.preload()]);
  assert.equal(first, second);
  assert.equal(imports, 1, "concurrent warmups must not request the chunk twice");
});
