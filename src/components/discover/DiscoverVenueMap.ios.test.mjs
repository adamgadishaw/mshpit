import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "@babel/core";
import * as domain from "../../domain/iosVenueMap.mjs";
const require = createRequire(import.meta.url);
const code = transformSync(readFileSync(new URL("./DiscoverVenueMap.ios.jsx", import.meta.url), "utf8"), {
  filename: "DiscoverVenueMap.ios.jsx", babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;

// Execute the real component with deterministic hook lifetimes and native/timer
// ports. These are component contract tests, not device MapKit rendering tests.
function fixture({ native = true, openURL = async () => {} } = {}) {
  const states = [], refs = [], effects = [], pending = [], timers = new Map();
  let stateIndex = 0, refIndex = 0, effectIndex = 0, timerIndex = 0;
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  const react = {
    Component: class { constructor(props) { this.props = props; } },
    useMemo: fn => fn(),
    useState: initial => { const i = stateIndex++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial;
      return [states[i], next => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; },
    useRef: initial => refs[refIndex++] ||= { current: initial },
    useEffect: (fn, deps) => { const i = effectIndex++; if (!effects[i] || deps.some((dep, j) => dep !== effects[i].deps[j])) pending.push(() => {
      effects[i]?.cleanup?.(); effects[i] = { deps, fn, cleanup: fn() };
    }); },
  };
  const modules = {
    "../NativeTabScroll": { ScrollView: "ScrollView", TextInput: "TextInput" },
    "../NativeTabSwipeExclusion": "NativeTabSwipeExclusion",
    react, "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { Linking: { openURL }, Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View", StyleSheet: { create: value => value, absoluteFill: {} } },
    "expo-modules-core": { requireOptionalNativeModule: () => native ? {} : null, requireNativeViewManager: () => "NativeVenueMap" },
    "../../theme": { colors: {}, font: "font", radius: {}, space: value => value * 4 },
    "../../domain/iosVenueMap.mjs": domain,
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", code)(name => {
    assert.ok(name in modules, `Unexpected dependency: ${name}`); return modules[name];
  }, module, module.exports, (fn, ms) => { const id = ++timerIndex; timers.set(id, { fn, ms }); return id; }, id => timers.delete(id));
  return { exports: module.exports, timers,
    render: (props, name = "default") => { stateIndex = 0; refIndex = 0; effectIndex = 0; return module.exports[name](props); },
    flush: () => { while (pending.length) pending.shift()(); },
    unmount: () => effects.forEach(effect => effect.cleanup?.()),
    replayEffects: () => effects.forEach(effect => { effect.cleanup?.(); effect.cleanup = effect.fn(); }),
  };
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const byType = (tree, name) => nodes(tree).find(node => node.type === name || node.type?.name === name);
const choices = tree => nodes(tree).filter(node => node.type === "Pressable" && node.props.accessibilityLabel?.startsWith("Select venue"));
const venue = (id, coord = { lat: 43.64, lng: -79.4 }) => ({ id, name: `Room ${id}`, coord });
const sessionProps = () => ({ revision: "rev-a", points: [{ id: "a", name: "Room a", latitude: 43.64, longitude: -79.4, number: 1 }], city: "Toronto", selectedId: null, onSelect: () => {}, onRetry: () => {} });

test("real iOS component passes atomic native snapshot and preserves current list IDs", () => {
  const selected = [], c = fixture();
  let tree = c.render({ venues: [venue(7), venue("b")], selected: 7, city: "Toronto", onSelect: id => selected.push(id) }); c.flush();
  const session = byType(tree, "VenueMapSession"), buttons = choices(tree);
  assert.equal(session.props.points.length, 2);
  assert.equal(session.props.selectedId, "7");
  assert.equal(buttons[0].props.accessibilityState.selected, true);
  buttons[0].props.onPress(); assert.deepEqual(selected, [7]);
  session.props.onSelect({ revision: session.props.revision, id: "missing" }); assert.deepEqual(selected, [7]);
  tree = c.render({ venues: [venue("new")], city: "Ottawa", onSelect: id => selected.push(id) });
  buttons[1].props.onPress(); assert.deepEqual(selected, [7], "old city callback is fenced before cleanup");
  choices(tree)[0].props.onPress(); assert.deepEqual(selected, [7, "new"]);
  const current = choices(tree)[0]; c.unmount(); current.props.onPress(); assert.deepEqual(selected, [7, "new"]);
});

test("missing bridge and empty coordinates leave truthful list access, with no fake street image", () => {
  const c = fixture({ native: false });
  const tree = c.render({ venues: [venue("a")], selected: "a", city: "Toronto" });
  assert.equal(byType(tree, "MapUnavailable").props.missing, true);
  assert.equal(byType(tree, "VenueMapSession"), undefined);
  assert.equal(choices(tree).length, 1);
  assert.ok(nodes(tree).some(node => node.props.accessibilityLabel === "Open Room a in Apple Maps"));
  const empty = c.render({ venues: [venue("bad", { lat: null, lng: "" })] });
  assert.equal(choices(empty).length, 0); assert.equal(byType(empty, "VenueMapSession"), undefined);
});

test("loading only ends on a matching complete render; partial tile failures stay retryable", () => {
  const c = fixture(), props = sessionProps();
  let tree = c.render(props, "VenueMapSession"); c.flush();
  const native = byType(tree, "NativeVenueMap");
  assert.deepEqual(native.props.snapshot, { revision: props.revision, venues: props.points, selectedId: "" });
  native.props.onMapStatus({ nativeEvent: { revision: "old", status: "ready" } });
  assert.equal(c.render(props, "VenueMapSession").props.children[1].props.children.startsWith("Loading"), true);
  native.props.onMapStatus({ nativeEvent: { revision: props.revision, status: "partial" } });
  tree = c.render(props, "VenueMapSession");
  assert.ok(byType(tree, "NativeVenueMap"));
  assert.ok(nodes(tree).some(node => node.props.accessibilityLabel === "Retry venue street map"));
  native.props.onMapStatus({ nativeEvent: { revision: props.revision, status: "ready" } });
  [...c.timers.values()][0].fn();
  assert.ok(byType(c.render(props, "VenueMapSession"), "NativeVenueMap"));
  native.props.onMapStatus({ nativeEvent: { revision: props.revision, status: "partial" } });
  assert.ok(byType(c.render(props, "VenueMapSession"), "NativeVenueMap"), "a functioning map is not removed by overlapping tile failures");
});

test("native snapshot never sends nested null and keeps selection clear on the same lifetime", () => {
  const c = fixture(), props = sessionProps();
  for (const [selectedId, expected] of [[null, ""], ["a", "a"], [null, ""], [undefined, ""], ["a", "a"], ["", ""]]) {
    const tree = c.render({ ...props, selectedId }, "VenueMapSession"); c.flush();
    const snapshot = byType(tree, "NativeVenueMap").props.snapshot;
    assert.deepEqual(snapshot, { revision: props.revision, venues: props.points, selectedId: expected });
    assert.equal(typeof snapshot.selectedId, "string", "Expo Fabric nested null is not castable by Record");
    assert.equal(snapshot.venues, props.points, "selection does not replace the venue data");
  }
});

test("timeout becomes explicit fallback and fences late ready/selection; cleanup clears timers", () => {
  const c = fixture(), selected = [], props = { ...sessionProps(), onSelect: event => selected.push(event) };
  const tree = c.render(props, "VenueMapSession"); c.flush(); const native = byType(tree, "NativeVenueMap");
  const timer = [...c.timers.values()][0]; assert.equal(timer.ms, 15000); timer.fn();
  assert.ok(byType(c.render(props, "VenueMapSession"), "MapUnavailable"));
  native.props.onMapStatus({ nativeEvent: { revision: props.revision, status: "ready" } });
  native.props.onVenueSelect({ nativeEvent: { revision: props.revision, id: "a" } });
  assert.ok(byType(c.render(props, "VenueMapSession"), "MapUnavailable")); assert.deepEqual(selected, []);
  c.unmount(); assert.equal(c.timers.size, 0);
  const mounted = fixture(), p = { ...sessionProps(), onSelect: event => selected.push(event) };
  const n = byType(mounted.render(p, "VenueMapSession"), "NativeVenueMap"); mounted.flush(); mounted.unmount();
  n.props.onVenueSelect({ nativeEvent: { revision: p.revision, id: "a" } }); assert.deepEqual(selected, []);
});

test("retry creates a new native lifetime, while ordinary selection preserves it", () => {
  const c = fixture(), props = { venues: [venue("a"), venue("b")], city: "Toronto" };
  const tree = c.render(props); c.flush(); const first = byType(tree, "VenueMapBoundary");
  const selection = c.render({ ...props, selected: "b" });
  assert.equal(byType(selection, "VenueMapBoundary").key, first.key);
  byType(selection, "VenueMapBoundary").props.onRetry();
  assert.notEqual(byType(c.render(props), "VenueMapBoundary").key, first.key);
  const boundary = new c.exports.VenueMapBoundary({ onRetry: first.props.onRetry });
  boundary.state = c.exports.VenueMapBoundary.getDerivedStateFromError();
  assert.ok(byType(boundary.render(), "MapUnavailable"));
});

test("external Maps rejection is handled and stale failures do not affect another selection", async () => {
  let reject, calls = 0; const c = fixture({ openURL: () => { calls++; return new Promise((_, r) => { reject = r; }); } });
  const props = { venues: [venue("a"), venue("b")], selected: "a" };
  let tree = c.render(props); c.flush();
  const link = nodes(tree).find(node => node.props.accessibilityRole === "link");
  const pending = link.props.onPress(); link.props.onPress(); assert.equal(calls, 1);
  tree = c.render({ ...props, selected: "b" }); reject(Error("synthetic offline")); await pending;
  assert.equal(nodes(c.render({ ...props, selected: "b" })).some(node => node.props.accessibilityRole === "alert"), false);
  tree = c.render(props); const again = nodes(tree).find(node => node.props.accessibilityRole === "link").props.onPress();
  reject(Error("synthetic offline")); await again;
  assert.equal(nodes(c.render(props)).some(node => node.props.accessibilityRole === "alert"), true);
});


test("StrictMode setup restores selection and disposal fences retained external/retry actions", async () => {
  const selected = [], opened = [], c = fixture({ openURL: async url => opened.push(url) });
  const props = { venues: [venue("a"), venue("b")], selected: "a", onSelect: id => selected.push(id) };
  let tree = c.render(props); c.flush(); c.replayEffects();
  choices(tree)[0].props.onPress(); assert.deepEqual(selected, ["a"]);
  const oldLink = nodes(tree).find(node => node.props.accessibilityRole === "link");
  const oldRetry = byType(tree, "VenueMapBoundary").props.onRetry;
  const originalKey = byType(tree, "VenueMapBoundary").key;
  c.render({ ...props, selected: "b" });
  await oldLink.props.onPress(); oldRetry(); assert.equal(opened.length, 0);
  tree = c.render(props);
  assert.equal(byType(tree, "VenueMapBoundary").key, originalKey, "stale retry did not change lifetime");
  await oldLink.props.onPress(); assert.equal(opened.length, 0, "A to B to A cannot revive an old action");
  const link = nodes(tree).find(node => node.props.accessibilityRole === "link"), retry = byType(tree, "VenueMapBoundary").props.onRetry;
  await link.props.onPress(); assert.equal(opened.length, 1);
  c.unmount(); await link.props.onPress(); retry(); assert.equal(opened.length, 1);
});

test("a pending Maps launch cannot block a newer selection or surface a retired failure", async () => {
  const requests = [], c = fixture({ openURL: url => new Promise((resolve, reject) => requests.push({ url, resolve, reject })) });
  const props = { venues: [venue("a"), venue("b")], selected: "a" };
  let tree = c.render(props); c.flush();
  const a = nodes(tree).find(node => node.props.accessibilityRole === "link").props.onPress();
  tree = c.render({ ...props, selected: "b" });
  const b = nodes(tree).find(node => node.props.accessibilityRole === "link").props.onPress();
  assert.equal(requests.length, 2);
  requests[0].reject(Error("retired failure")); await a;
  assert.equal(nodes(c.render({ ...props, selected: "b" })).some(node => node.props.accessibilityRole === "alert"), false);
  requests[1].resolve(); await b;
});
