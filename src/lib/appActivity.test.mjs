import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { appActivityIsActive } from "./appActivity.mjs";

const source = (relativeUrl) => readFileSync(new URL(relativeUrl, import.meta.url), "utf8");

test("web activity follows document visibility rather than React Native AppState", () => {
  assert.equal(appActivityIsActive({ platform: "web", appState: "active", visibilityState: "hidden" }), false);
  assert.equal(appActivityIsActive({ platform: "web", appState: "background", visibilityState: "visible" }), true);
  assert.equal(appActivityIsActive({ platform: "web", visibilityState: "prerender" }), false);
  assert.equal(appActivityIsActive({ platform: "web", visibilityState: null }), true);
});

test("native activity follows AppState and treats an unknown startup state as active", () => {
  assert.equal(appActivityIsActive({ platform: "ios", appState: "active" }), true);
  assert.equal(appActivityIsActive({ platform: "ios", appState: "inactive" }), false);
  assert.equal(appActivityIsActive({ platform: "android", appState: "background" }), false);
  assert.equal(appActivityIsActive({ platform: "android", appState: null }), true);
});

test("only necessary recurring screen work uses the shared application activity hook", () => {
  const post = source("../screens/PostScreen.jsx");
  const admin = source("../screens/AdminScreen.jsx");
  const hook = source("./useAppActive.js");

  assert.ok(hook.includes("useSyncExternalStore(subscribe, readSnapshot, readServerSnapshot)"));
  assert.ok(hook.includes('document.addEventListener("visibilitychange", onVisibilityChange)'));
  assert.ok(hook.includes('window.addEventListener("pagehide", onPageHide)'));
  assert.ok(hook.includes('window.addEventListener("pageshow", onPageShow)'));

  assert.doesNotMatch(post, /useAppActive|setInterval/);
  assert.match(post, /useScopedRefresh/);
  assert.match(post, /VinylRefreshBoundary/);
  assert.ok(post.includes("loadComments(log.id, { limit: 50, force: true, signal"));

  assert.ok(admin.includes("const appActive = useAppActive()"));
  assert.ok(admin.includes('if (!appActive || activeTab !== "catalog" || !seedJob?.running) return undefined'));
  assert.ok(admin.includes("setInterval(refreshSeed, 3000)"));
});
