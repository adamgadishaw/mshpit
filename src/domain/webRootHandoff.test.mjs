import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { clearInjectedPublicDocument, shouldPreservePublicDocument } from "./webRootHandoff.mjs";

test("web root handoff clears the exact crawler document before Expo mounts", () => {
  let cleared = 0;
  const root = {
    querySelector: (selector) => selector === ":scope > .seo-document" ? {} : null,
    replaceChildren: () => { cleared += 1; },
  };
  assert.equal(clearInjectedPublicDocument({ getElementById: () => root }), true);
  assert.equal(cleared, 1);
});

test("web root handoff leaves ordinary and no-document roots untouched", () => {
  let cleared = 0;
  const root = {
    querySelector: () => null,
    replaceChildren: () => { cleared += 1; },
  };
  assert.equal(clearInjectedPublicDocument({ getElementById: () => root }), false);
  assert.equal(clearInjectedPublicDocument(null), false);
  assert.equal(cleared, 0);
});

test("server-only collection entry keeps its actual paginated public document", () => {
  const document = { getElementById: () => ({ querySelector: (selector) => selector === ":scope > .seo-document" ? {} : null }) };
  for (const path of ["/concerts", "/concerts/page/2", "/events/page/2", "/artists/page/3", "/venues/page/2", "/venues/us/davis", "/concerts/ca/toronto", "/artist/band/concerts/page/2"]) {
    assert.equal(shouldPreservePublicDocument(document, path), true, path);
  }
  for (const path of ["/", "/artists", "/events", "/venues", "/cities", "/city/ca/toronto", "/artist/band/concerts", "/event/one", "/login"]) {
    assert.equal(shouldPreservePublicDocument(document, path), false, path);
  }
});

test("server-only route without a real public document still mounts the app", () => {
  assert.equal(shouldPreservePublicDocument(null, "/concerts"), false);
  assert.equal(shouldPreservePublicDocument({ getElementById: () => null }, "/concerts"), false);
  assert.equal(shouldPreservePublicDocument({ getElementById: () => ({ querySelector: () => null }) }, "/events/page/2"), false);
});

function bootHarness(pathname, { hasPublicDocument = true } = {}) {
  const attributes = new Map();
  const listeners = new Map();
  let mounts = 0, clears = 0, watchdogsCleared = 0;
  const document = {
    documentElement: {
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute: (name) => attributes.get(name),
      removeAttribute: (name) => attributes.delete(name),
    },
    getElementById: () => ({
      querySelector: (selector) => hasPublicDocument && selector === ":scope > .seo-document" ? {} : null,
      replaceChildren: () => { clears += 1; },
    }),
  };
  const context = {
    document, location: { pathname }, App: function App() {},
    clearInjectedPublicDocument, shouldPreservePublicDocument,
    registerRootComponent: () => { mounts += 1; },
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
    setTimeout: (_callback, delay) => { assert.equal(delay, 8000); return 1; },
    clearTimeout: () => { watchdogsCleared += 1; },
  };
  context.window = context;
  runInNewContext(readFileSync(new URL("../../public/mshpit-web-boot-v1.js", import.meta.url), "utf8"), context);
  assert.equal(attributes.get("data-mshpit-web-boot"), "pending", "real boot script hides SSR before it is parsed");
  const entry = readFileSync(new URL("../../index.js", import.meta.url), "utf8").replace(/^import[^\n]+;\r?\n/gm, "");
  runInNewContext(entry, context);
  return { attributes, listeners, context, mounts: () => mounts, clears: () => clears, watchdogsCleared: () => watchdogsCleared };
}

test("real web entry releases the boot marker immediately for a preserved server document", () => {
  for (const pathname of ["/concerts", "/events/page/2", "/venues/us/davis"]) {
    const harness = bootHarness(pathname);
    assert.equal(harness.attributes.has("data-mshpit-web-boot"), false, pathname);
    assert.equal(harness.mounts(), 0);
    assert.equal(harness.clears(), 0, "complete server document is not removed");
    assert.equal(harness.watchdogsCleared(), 1, "visibility does not wait for the eight-second watchdog");
    assert.equal(harness.listeners.size, 0);
  }
});

test("interactive web entry still hands visibility completion to the React root", () => {
  for (const [pathname, hasPublicDocument] of [["/event/one", true], ["/concerts", false]]) {
    const harness = bootHarness(pathname, { hasPublicDocument });
    assert.equal(harness.attributes.get("data-mshpit-web-boot"), "pending");
    assert.equal(harness.mounts(), 1);
    assert.equal(harness.clears(), hasPublicDocument ? 1 : 0);
    harness.context.__MSHPIT_WEB_BOOT__.complete();
    assert.equal(harness.attributes.has("data-mshpit-web-boot"), false);
  }
});
