import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync, parseSync } from "@babel/core";
import { convertingClipSummary } from "../domain/convertingClips.mjs";

const require = createRequire(import.meta.url);
const compiled = transformSync(readFileSync(new URL("./ConvertingClipNotice.jsx", import.meta.url), "utf8"), {
  filename: "ConvertingClipNotice.jsx", babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node)
  ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];

// Run the production component with deterministic React lifecycle/platform seams.
// Effects clean up on dependency changes, and render can precede effect commit
// to exercise the account-change window that API callbacks must not cross.
function fixture(initial = {}) {
  const slots = [], effects = [], subscriptions = [], retries = [], accepted = [], visibility = [];
  const retryResult = deferred(), refreshResult = deferred();
  let cursor = 0, dirty = false, tree, appActive = true, viewable = true, surfaceVisible = true;
  let props = { clips: [{ id: "clip", state: "processing" }], accountId: "owner", onReady: () => refreshResult.promise, ...initial };
  const jsx = (type, nodeProps) => ({ type, props: nodeProps });
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (name === "react") return {
      useContext: () => surfaceVisible,
      useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
      useState(value) {
        const i = cursor++; if (!(i in slots)) slots[i] = typeof value === "function" ? value() : value;
        return [slots[i], (next) => { const value = typeof next === "function" ? next(slots[i]) : next; if (!Object.is(slots[i], value)) { slots[i] = value; dirty = true; } }];
      },
      useEffect(create, deps) {
        const i = cursor++, old = slots[i];
        if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) {
          const slot = { deps, cleanup: old?.cleanup }; slots[i] = slot;
          effects.push(() => { slot.cleanup?.(); slot.cleanup = create(); });
        }
      },
    };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "react-native") return { View: "View", Text: "Text", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator", StyleSheet: { create: (value) => value } };
    if (name === "./Icon") return "Icon";
    if (name === "./CompletionVisibilityContext") return { CompletionVisibilityContext: {} };
    if (name === "../theme") return { colors: {}, radius: {} };
    if (name === "../domain/convertingClips.mjs") return { convertingClipSummary };
    if (name === "../lib/useAppActive") return () => appActive;
    if (name === "../lib/usePosterViewability") return (explicit) => { visibility.push(explicit); return { targetRef: {}, autoViewable: viewable, onLayout() {} }; };
    if (name === "../lib/convertingClipsApi") return {
      convertingClipPoller: {
        subscribe(options) { const sub = { ...options, stopped: false }; subscriptions.push(sub); return () => { sub.stopped = true; }; },
        retryAccepted: (...args) => accepted.push(args),
      },
      retryConvertingClip(...args) { retries.push(args); return retryResult.promise; },
    };
    throw Error(`Unexpected dependency: ${name}`);
  }, module, module.exports);
  const paint = () => { cursor = 0; dirty = false; tree = module.exports.default(props); };
  const commit = () => {
    for (let i = 0; i < 20; i++) {
      effects.splice(0).forEach((effect) => effect());
      if (!dirty) return;
      paint();
    }
    assert.fail("component must settle");
  };
  const render = (update = {}, shouldCommit = true) => { props = { ...props, ...update }; paint(); if (shouldCommit) commit(); };
  render();
  return { subscriptions, retries, accepted, visibility, retryResult, refreshResult, render, commit,
    tree: () => tree, button: () => nodes(tree).find((node) => node.type === "Pressable"),
    activity(value) { appActive = value; render(); }, viewability(value) { viewable = value; render(); },
    surface(value) { surfaceVisible = value; render(); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

test("polling requires account, active screen, active app and notice intersection", () => {
  const f = fixture({ active: false }); assert.equal(f.subscriptions.length, 0);
  f.activity(false); f.render({ active: true }); assert.equal(f.subscriptions.length, 0);
  f.viewability(false); f.activity(true); assert.equal(f.subscriptions.length, 0);
  f.viewability(true); assert.equal(f.subscriptions.length, 1);
  assert.equal(f.visibility.at(-1), null, "card visibility does not bypass notice measurement");
  f.activity(false); assert.equal(f.subscriptions[0].stopped, true);
  assert.equal(f.subscriptions[0].isCurrent(), false);
  f.activity(true); assert.equal(f.subscriptions.length, 2);
  f.unmount(); assert.equal(f.subscriptions[1].stopped, true);
  assert.equal(f.subscriptions[1].isCurrent(), false);
  const guest = fixture({ accountId: null }); assert.equal(guest.subscriptions.length, 0); guest.unmount();
});

test("account replacement fences an old callback before effect cleanup", async () => {
  let refreshes = 0;
  const f = fixture({ onReady: () => { refreshes++; return true; } }); const old = f.subscriptions[0];
  f.render({ accountId: "next" }, false);
  assert.equal(old.isCurrent(), false); old.onState("failed");
  assert.equal(await old.onReady({ signal: new AbortController().signal }), false);
  f.commit(); f.render(); assert.equal(f.button(), undefined); assert.equal(refreshes, 0);
  assert.equal(f.subscriptions.at(-1).accountId, "next"); f.unmount();
});

test("repeated retry taps send one account-bound cancellable mutation", async () => {
  const f = fixture({ clips: [{ id: "clip", state: "failed" }] });
  const press = f.button().props.onPress, first = press(), second = press();
  assert.equal(f.retries.length, 1);
  assert.equal(f.retries[0][1].accountId, "owner"); assert.equal(f.retries[0][1].signal.aborted, false);
  f.retryResult.resolve("ready"); await Promise.all([first, second]); f.render();
  assert.deepEqual(f.accepted, [["owner", "clip"]]); assert.equal(f.subscriptions.length, 1);
  assert.ok(f.tree(), "already-ready retries wait for reconciled feed data");
  const signal = new AbortController().signal;
  const refreshed = f.subscriptions[0].onReady({ signal }); f.refreshResult.resolve(true);
  assert.equal(await refreshed, true);
  f.subscriptions[0].onState("ready"); f.render(); assert.equal(f.tree(), null); f.unmount();
});

test("refused retries stay failed and can be tried again", async () => {
  const f = fixture({ clips: [{ id: "clip", state: "failed" }] });
  const result = f.button().props.onPress(); f.retryResult.reject(Error("refused")); await result; f.render();
  assert.ok(f.button()); assert.equal(f.button().props.disabled, false);
  assert.deepEqual(f.accepted, []); assert.equal(f.subscriptions.length, 1);
  assert.equal(f.subscriptions[0].state, "failed", "failed clips keep only a passive subscription"); f.unmount();
});

for (const transition of ["hidden", "unmount", "account", "server-state"]) {
  test(`retry is cancelled or fenced on ${transition}, with no replay`, async () => {
    const f = fixture({ clips: [{ id: "clip", state: "failed" }] }); const result = f.button().props.onPress();
    if (transition === "hidden") f.activity(false);
    else if (transition === "unmount") f.unmount();
    else if (transition === "account") f.render({ accountId: "next" }, false);
    else f.render({ clips: [{ id: "different", state: "failed" }] });
    f.retryResult.resolve("processing"); await result;
    assert.deepEqual(f.accepted, []);
    if (transition !== "unmount") { f.commit(); f.activity(true); f.render(); assert.ok(f.button()); f.unmount(); }
    assert.equal(f.retries[0][1].signal.aborted, true); assert.equal(f.retries.length, 1);
  });
}

test("server clip/state replacement starts from the new server projection", () => {
  const f = fixture(); f.subscriptions[0].onState("failed"); f.render(); assert.ok(f.button());
  f.render({ clips: [{ id: "new", state: "processing" }] });
  assert.equal(f.button(), undefined); assert.equal(f.subscriptions.at(-1).assetId, "new"); f.unmount();
});

test("shell visibility stops mounted cards behind global menus and verification overlays", () => {
  const f = fixture(); f.surface(false);
  assert.equal(f.subscriptions[0].stopped, true); assert.equal(f.subscriptions[0].isCurrent(), false);
  f.surface(true); assert.equal(f.subscriptions.length, 2); f.unmount();

  const source = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  const ast = parseSync(source, { babelrc: false, configFile: false, parserOpts: { plugins: ["jsx"] } });
  let expression;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "JSXOpeningElement" && node.name.object?.name === "CompletionVisibilityContext") {
      expression = node.attributes.find((attr) => attr.name?.name === "value").value.expression;
    }
    Object.values(node).forEach((value) => Array.isArray(value) ? value.forEach(visit) : typeof value === "object" && visit(value));
  };
  visit(ast); assert.ok(expression, "shell supplies completion visibility to all card surfaces");
  const keys = ["status", "landing", "acctOpen", "welcome", "resetToken", "unsubToken", "verifyToken", "ownerApprovalToken", "publicNavigationNotice", "newsStoryNotice"];
  const visible = new Function(...keys, `return (${source.slice(expression.start, expression.end)});`);
  const baseline = ["ok", ...keys.slice(1).map(() => false)];
  assert.equal(visible(...baseline), true);
  for (let i = 0; i < keys.length; i++) { const values = [...baseline]; values[i] = i ? true : "blocked"; assert.equal(visible(...values), false, keys[i]); }
});
