import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const template = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const bootSource = readFileSync(new URL("../public/mshpit-web-boot-v1.js", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../App.js", import.meta.url), "utf8");
const entrySource = readFileSync(new URL("../index.js", import.meta.url), "utf8");

function bootHarness() {
  const attributes = new Map();
  const listeners = new Map();
  const timers = new Map();
  let nextTimerId = 1;

  const html = {
    getAttribute: (name) => attributes.has(name) ? attributes.get(name) : null,
    removeAttribute: (name) => attributes.delete(name),
    setAttribute: (name, value) => attributes.set(name, String(value)),
  };
  const globalObject = {
    document: { documentElement: html },
    addEventListener(type, listener, capture = false) {
      const key = `${type}:${capture}`;
      listeners.set(key, [...(listeners.get(key) || []), listener]);
    },
    removeEventListener(type, listener, capture = false) {
      const key = `${type}:${capture}`;
      listeners.set(key, (listeners.get(key) || []).filter((candidate) => candidate !== listener));
    },
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay, cleared: false });
      return id;
    },
    clearTimeout(id) {
      const timer = timers.get(id);
      if (timer) timer.cleared = true;
    },
  };
  globalObject.window = globalObject;
  runInNewContext(bootSource, { window: globalObject });

  return {
    attributes,
    globalObject,
    listeners,
    timers,
    dispatch(type, event, capture = false) {
      for (const listener of [...(listeners.get(`${type}:${capture}`) || [])]) listener(event);
    },
  };
}

test("web boot template installs a parser-blocking same-origin handoff before the body", () => {
  const statusMarkup = '<div class="mshpit-web-boot-status" role="status" aria-live="polite" aria-atomic="true">Loading Mshpit</div>';
  const styleStart = template.indexOf('<style id="mshpit-web-boot-style">');
  const scriptTag = '<script src="/mshpit-web-boot-v1.js"></script>';
  const scriptStart = template.indexOf(scriptTag);
  const headEnd = template.indexOf("</head>");
  const bodyStart = template.indexOf("<body>");
  const statusStart = template.indexOf(statusMarkup);
  const rootStart = template.indexOf('<div id="root"></div>');

  assert.ok(styleStart >= 0 && styleStart < scriptStart, "boot CSS precedes its marker script");
  assert.ok(scriptStart < headEnd && headEnd < bodyStart && bodyStart < rootStart, "script blocks parsing before #root");
  assert.ok(bodyStart < statusStart && statusStart < rootStart, "the live status immediately precedes #root");
  assert.equal(template.slice(statusStart, rootStart).trim(), statusMarkup);
  assert.equal((template.match(/<script\b[^>]*>/gi) || []).length, 1);
  assert.doesNotMatch(scriptTag, /\b(?:async|defer)\b/i);
  assert.doesNotMatch(template, /<script(?![^>]*\bsrc=)[^>]*>/i, "CSP-safe boot code stays external");
});

test("default and no-JS markup leaves the exact semantic injection target visible", () => {
  const bootStyle = template.match(/<style id="mshpit-web-boot-style">([\s\S]*?)<\/style>/i)?.[1] || "";
  const statusMarkup = template.match(/<div class="mshpit-web-boot-status"[^>]*>Loading Mshpit<\/div>/i)?.[0] || "";
  assert.match(template, /html\[data-mshpit-web-boot="pending"\] #root > \.seo-document\s*\{\s*visibility:\s*hidden;/);
  assert.equal((template.match(/visibility:\s*hidden/gi) || []).length, 1, "the SEO document has no unconditional hiding rule");
  assert.match(template, /html\[data-mshpit-web-boot="pending"\] #root::before/);
  assert.match(bootStyle, /\.mshpit-web-boot-status\s*\{\s*display:\s*none;/);
  assert.match(bootStyle, /html\[data-mshpit-web-boot="pending"\] \.mshpit-web-boot-status\s*\{\s*display:\s*block;[\s\S]*?position:\s*absolute;[\s\S]*?clip-path:\s*inset\(50%\);/);
  assert.equal((bootStyle.match(/\.mshpit-web-boot-status/g) || []).length, 2, "only the default-hidden and pending-visible status rules exist");
  assert.match(statusMarkup, /role="status"/i);
  assert.match(statusMarkup, /aria-live="polite"/i);
  assert.match(statusMarkup, /aria-atomic="true"/i);
  assert.doesNotMatch(statusMarkup, /\btabindex\b/i);
  assert.doesNotMatch(template.match(/<html\b[^>]*>/i)?.[0] || "", /data-mshpit-web-boot/i);
  assert.doesNotMatch(template, /(?:animation|transition)\s*:/i);
  assert.equal((template.match(/<div id="root"><\/div>/g) || []).length, 1);
  assert.match(template, /<noscript>[\s\S]*?<div id="root"><\/div>/i);
});

test("web boot completion is exposed, idempotent, and removes every pending hook", () => {
  const harness = bootHarness();
  const timer = [...harness.timers.values()][0];

  assert.equal(harness.attributes.get("data-mshpit-web-boot"), "pending");
  assert.equal(typeof harness.globalObject.__MSHPIT_WEB_BOOT__?.complete, "function");
  assert.equal(timer.delay, 8000);
  assert.equal(harness.listeners.get("error:true")?.length, 1);
  assert.equal(harness.listeners.get("unhandledrejection:false")?.length, 1);

  harness.globalObject.__MSHPIT_WEB_BOOT__.complete();
  harness.globalObject.__MSHPIT_WEB_BOOT__.complete();

  assert.equal(harness.attributes.has("data-mshpit-web-boot"), false);
  assert.equal(timer.cleared, true);
  assert.equal(harness.listeners.get("error:true")?.length, 0);
  assert.equal(harness.listeners.get("unhandledrejection:false")?.length, 0);
});

test("web boot fails open after its bounded timeout", () => {
  const harness = bootHarness();
  const timer = [...harness.timers.values()][0];
  timer.callback();
  assert.equal(harness.attributes.has("data-mshpit-web-boot"), false);
});

test("web boot fails open for application script errors but ignores media errors", () => {
  const resourceHarness = bootHarness();
  resourceHarness.dispatch("error", { target: { tagName: "IMG" } }, true);
  assert.equal(resourceHarness.attributes.get("data-mshpit-web-boot"), "pending");
  resourceHarness.dispatch("error", { target: { tagName: "SCRIPT" } }, true);
  assert.equal(resourceHarness.attributes.has("data-mshpit-web-boot"), false);

  const runtimeHarness = bootHarness();
  runtimeHarness.dispatch("error", { target: runtimeHarness.globalObject }, true);
  assert.equal(runtimeHarness.attributes.has("data-mshpit-web-boot"), false);

  const rejectionHarness = bootHarness();
  rejectionHarness.dispatch("unhandledrejection", { reason: new Error("chunk failed") });
  assert.equal(rejectionHarness.attributes.has("data-mshpit-web-boot"), false);
});

test("the top-level Expo app completes the handoff in a layout effect", () => {
  const appBlock = appSource.match(/export default function App\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(appBlock, /useLayoutEffect\(\(\) => \{/);
  assert.match(appBlock, /Platform\.OS !== "web"/);
  assert.match(appBlock, /__MSHPIT_WEB_BOOT__\?\.complete\?\.\(\)/);
  assert.match(appBlock, /\}, \[\]\);/);
});

test("the Expo entry removes only the injected SEO document before mounting", () => {
  const clearAt = entrySource.indexOf("clearInjectedPublicDocument(document)");
  const mountAt = entrySource.indexOf("registerRootComponent(App)");
  assert.ok(clearAt >= 0 && mountAt > clearAt);
  assert.match(entrySource, /typeof document !== "undefined"/);
});
