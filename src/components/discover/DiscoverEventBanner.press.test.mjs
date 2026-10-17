import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";

const require = createRequire(import.meta.url);
const compiled = new Map(["DiscoverEventBanner", "DiscoverEventCard"].map(name => [name, transformSync(
  readFileSync(new URL(`./${name}.jsx`, import.meta.url), "utf8"), {
    filename: `${name}.jsx`, babelrc: false, configFile: false,
    plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
  },
).code]));
const nodes = value => !value || typeof value !== "object" ? [] : Array.isArray(value)
  ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

// Run both real components, their effects/cleanup and interval callbacks against
// a controlled clock. Presses always use the latest rendered callback, as native
// Pressability does when a held press survives a component update.
function fixture(platform = "android", reducedMotion = false) {
  const slots = [], intervals = new Map(), opened = [], listeners = new Set();
  let cursor = 0, pending = [], dirty = false, tree, now = 0, nextTimer = 0;
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
      return [slots[i], next => {
        const value = typeof next === "function" ? next(slots[i]) : next;
        if (!Object.is(value, slots[i])) { slots[i] = value; dirty = true; }
      }];
    },
    useMemo(callback, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: callback() };
      return slots[i].value;
    },
    useEffect(callback, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) pending.push(() => {
        slots[i]?.cleanup?.();
        slots[i] = { deps, cleanup: callback() };
      });
    },
  };
  const jsx = (type, props) => ({ type, props });
  const deps = {
    react, "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": {
      View: "View", Text: "Text", Pressable: "Pressable", Platform: { OS: platform },
      useWindowDimensions: () => ({ width: 360, fontScale: 1 }),
      StyleSheet: { create: styles => styles, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 1 },
      AccessibilityInfo: { announceForAccessibility() {} }, Linking: { openURL: async () => {} },
      AppState: { currentState: "active", addEventListener(_name, callback) {
        listeners.add(callback); return { remove: () => listeners.delete(callback) };
      } },
    },
    "expo-image": { Image: "Image" },
    "../../theme": { colors: {}, radius: {}, shadow: {} },
    "../Icon": "Icon",
    "../../hooks/useReducedMotion": () => reducedMotion,
    "../../domain/dataPolicy.mjs": { calendarDateKey: () => 20261102 },
  };
  const load = name => {
    const module = { exports: {} };
    new Function("require", "module", "exports", "setInterval", "clearInterval", compiled.get(name))(
      dependency => {
        assert.ok(dependency in deps, `Unexpected dependency: ${dependency}`);
        return deps[dependency];
      }, module, module.exports,
      (callback, delay) => { const id = ++nextTimer; intervals.set(id, { callback, delay, next: now + delay }); return id; },
      id => intervals.delete(id),
    );
    return module.exports.default;
  };
  deps["./DiscoverEventCard"] = load("DiscoverEventCard");
  const Banner = load("DiscoverEventBanner");
  const props = {
    slides: ["A", "B"].map(id => ({ id, title: `Event ${id}`, date: "2026-11-02", event: { id } })),
    onOpenEvent: event => opened.push(event.id),
  };
  function render() {
    do {
      dirty = false; cursor = 0; pending = [];
      tree = Banner(props);
      if (typeof tree?.type === "function") tree = tree.type(tree.props);
      pending.forEach(run => run());
    } while (dirty);
    return tree;
  }
  const action = label => nodes(tree).find(node => node.type === "Pressable" && (label
    ? node.props.accessibilityLabel === label : node.props.accessibilityLabel?.startsWith("Open Event ")));
  return {
    opened, render, action, timerCount: () => intervals.size,
    begin(label) {
      if (platform === "web") tree.props.onTouchStart?.();
      else action(label).props.onPressIn?.();
      render();
    },
    release({ cancel = false, label } = {}) {
      const target = action(label);
      if (platform === "web") tree.props.onTouchEnd?.();
      else target.props.onPressOut?.();
      if (!cancel) target.props.onPress?.();
      render();
    },
    advance(milliseconds) {
      const end = now + milliseconds;
      while (true) {
        const next = [...intervals.values()].filter(timer => timer.next <= end).sort((a, b) => a.next - b.next)[0];
        if (!next) break;
        now = next.next; next.next += next.delay; next.callback(); render();
      }
      now = end;
    },
    background() { listeners.forEach(callback => callback("background")); render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    listenerCount: () => listeners.size,
  };
}

test("native press across an autoplay deadline opens the event pressed and resumes afterward", () => {
  for (const platform of ["android", "ios"]) {
    const f = fixture(platform); f.render(); f.advance(8_900); f.begin();
    f.advance(1_000); f.release();
    assert.deepEqual(f.opened, ["A"], `${platform}: release must retain the event pressed before the deadline`);
    assert.equal(f.timerCount(), 1, "release restarts autoplay");
    f.advance(9_000);
    assert.match(f.action().props.accessibilityLabel, /^Open Event B\./);
    f.unmount(); assert.equal(f.timerCount(), 0); assert.equal(f.listenerCount(), 0);
  }
});

test("cancelled native presses resume autoplay without opening an event", () => {
  const f = fixture(); f.render(); f.begin();
  assert.equal(f.timerCount(), 0, "press-in cleans up the active interval");
  f.advance(18_000); f.release({ cancel: true });
  assert.deepEqual(f.opened, []); assert.equal(f.timerCount(), 1);
  f.advance(9_000); assert.match(f.action().props.accessibilityLabel, /^Open Event B\./);
  f.begin(); f.unmount(); assert.equal(f.timerCount(), 0); assert.equal(f.listenerCount(), 0);
});

test("holding slideshow controls pauses autoplay and manual navigation keeps it paused", () => {
  const f = fixture(); f.render(); f.advance(8_900); f.begin("Next event");
  assert.equal(f.timerCount(), 0);
  f.advance(1_000); f.release({ label: "Next event" });
  assert.match(f.action().props.accessibilityLabel, /^Open Event B\./);
  assert.equal(f.timerCount(), 0, "manual slide selection retains the existing permanent pause");
  f.unmount();
});

test("press release does not restart autoplay while reduced motion or backgrounded", () => {
  for (const reducedMotion of [true, false]) {
    const f = fixture("android", reducedMotion); f.render(); f.begin();
    if (!reducedMotion) f.background();
    f.release({ cancel: true }); assert.equal(f.timerCount(), 0);
    f.unmount();
  }
});

test("web touch pause and resume retain the original event across the deadline", () => {
  const f = fixture("web"); f.render(); f.advance(8_900); f.begin();
  f.advance(1_000); f.release(); assert.deepEqual(f.opened, ["A"]);
  f.advance(9_000); assert.match(f.action().props.accessibilityLabel, /^Open Event B\./);
  f.unmount(); assert.equal(f.timerCount(), 0);
});
