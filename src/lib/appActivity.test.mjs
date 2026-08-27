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

test("recurring screen work is gated by the shared application activity hook", () => {
  const post = source("../screens/PostScreen.jsx");
  const admin = source("../screens/AdminScreen.jsx");
  const hook = source("./useAppActive.js");

  assert.match(hook, /useSyncExternalStore\(subscribe, readSnapshot, readServerSnapshot\)/);
  assert.match(hook, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
  assert.match(hook, /window\.addEventListener\("pagehide", onPageHide\)/);
  assert.match(hook, /window\.addEventListener\("pageshow", onPageShow\)/);

  assert.match(post, /const appActive = useAppActive\(\)/);
  assert.match(post, /if \(!appActive\) return undefined;[\s\S]*setInterval\(\(\) => void refresh\(\{ background: true \}\), 15_000\)/);

  assert.match(admin, /const appActive = useAppActive\(\)/);
  assert.match(admin, /if \(!appActive \|\| activeTab !== "catalog" \|\| !seedJob\?\.running\) return undefined;[\s\S]*setInterval\(refreshSeed, 3000\)/);
});
