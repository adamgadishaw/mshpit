import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";
import * as experience from "../domain/feedExperience.mjs";
import * as menu from "../domain/iosMenuSections.mjs";
const require = createRequire(import.meta.url);
const code = transformSync(readFileSync(new URL("./useIOSFeedSelection.ios.js", import.meta.url), "utf8"), {
  filename: "useIOSFeedSelection.ios.js", babelrc: false, configFile: false, plugins: [require("@babel/plugin-transform-modules-commonjs")],
}).code;
function fixture() {
  const slots = [], effects = new Map(), pending = [], storage = new Map(), writes = [];
  let cursor = 0, dirty = false, accountId = "A";
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === "function" ? value() : value; return [slots[i], next => { slots[i] = typeof next === "function" ? next(slots[i]) : next; dirty = true; }]; },
    useMemo(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useLayoutEffect(fn, deps) { const i = cursor++; if (!same(effects.get(i)?.deps, deps)) pending.push(() => { effects.get(i)?.cleanup?.(); effects.set(i, { deps, fn, cleanup: fn() }); }); },
  };
  const modules = { react, "../domain/feedExperience.mjs": experience, "../domain/iosMenuSections.mjs": menu,
    "../lib/persist": { load: (key, fallback) => storage.get(key) ?? fallback, save: (key, value) => { writes.push([key, value]); storage.set(key, value); } } };
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(name => { assert.ok(name in modules, name); return modules[name]; }, module, module.exports);
  return { writes, storage,
    render(id = accountId, commit = true) { accountId = id; let view; do { cursor = 0; dirty = false; view = module.exports.default(accountId); if (commit) while (pending.length) pending.shift()(); } while (commit && dirty); return view; },
    disconnect() { for (const effect of effects.values()) effect.cleanup?.(); },
    reconnect() { for (const effect of effects.values()) effect.cleanup = effect.fn(); },
  };
}
test("one iOS selection persists for menu and Feed across tab navigation", () => {
  const f = fixture(); const first = f.render(); assert.equal(first.filter, "everyone");
  assert.equal(first.select("local"), true); assert.equal(f.render().filter, "local");
  assert.deepEqual(f.writes, [[experience.feedFilterStorageKey("A"), "local"]]);
  assert.equal(f.render().select("not-a-filter"), false); assert.equal(f.render().filter, "local");
});
test("account first frames, A→B→A and logout never expose another account's selection or callback", () => {
  const f = fixture(); f.storage.set(experience.feedFilterStorageKey("B"), "news");
  const old = f.render(); old.select("following"); f.render();
  assert.equal(f.render("B", false).filter, "news"); assert.equal(old.select("local"), false);
  const b = f.render(); assert.equal(b.filter, "news");
  const returned = f.render("A"); assert.equal(returned.filter, "following"); assert.equal(old.select("news"), false); assert.equal(b.select("local"), false);
  const guest = f.render(null); assert.equal(guest.filter, "everyone"); assert.equal(guest.select("following"), false); assert.equal(returned.select("news"), false);
});
test("cleanup/reconnect fences old queued selections while admitting new menu actions", () => {
  const f = fixture(), old = f.render(); f.disconnect(); assert.equal(old.select("local"), false);
  f.reconnect(); assert.equal(old.select("local"), false); const fresh = f.render(); assert.equal(fresh.select("news"), true);
  f.disconnect(); assert.equal(fresh.select("following"), false);
});
test("shared selection adapter stays inert for web and Android", async () => {
  const shared = await import("./useIOSFeedSelection.js"); assert.equal(shared.default("A"), null);
});

test("actual App menu callback preserves root Feed frames and navigates only from another destination", () => {
  const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  const match = app.match(/onSelectFeedFilter=\{(value => \{[\s\S]*?\n\s*\})\}/);
  assert.ok(match, "App exposes the drawer's real selection callback");
  for (const [route, expected] of [
    [{ tab: "feed", stack: [{}], landing: false }, []],
    [{ tab: "discover", stack: [{}], landing: false }, ["feed"]],
    [{ tab: "feed", stack: [{}, { user: "someone" }], landing: false }, ["feed"]],
    [{ tab: "feed", stack: [{}], landing: true }, ["feed"]],
  ]) {
    const selected = [], navigated = [], frame = route.stack[0];
    const callback = new Function("iosFeedSelection", "navigationRef", "switchTab", `return (${match[1]});`)(
      { select: value => { selected.push(value); return true; } }, { current: route }, value => navigated.push(value),
    );
    callback("local"); assert.deepEqual(selected, ["local"]); assert.deepEqual(navigated, expected); assert.equal(route.stack[0], frame);
  }
  const denied = new Function("iosFeedSelection", "navigationRef", "switchTab", `return (${match[1]});`)(
    { select: () => false }, { current: { tab: "discover", stack: [{}] } }, () => assert.fail("retired selection cannot navigate"),
  );
  denied("news");
});
