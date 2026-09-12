import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("./SettingsScreen.jsx", import.meta.url), "utf8");
const compiled = transformSync(source, {
  filename: "SettingsScreen.jsx", babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node)
  ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];

function fixture(initial = { id: "account-a", concertMapVisible: true, ageBand: "18_plus" }) {
  let session = initial, cursor = 0, tree;
  const slots = [], effects = [], calls = [];
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react: {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
      },
      useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
      useEffect(effect, dependencies) {
        const index = cursor++;
        if (!slots[index] || dependencies.some((value, i) => value !== slots[index].dependencies[i])) {
          slots[index]?.cleanup?.();
          slots[index] = { dependencies, cleanup: effect() };
          effects.push(index);
        }
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "expo-constants": { expoConfig: { version: "test" } },
    "react-native": { Linking: {}, View: "View", Text: "Text", ScrollView: "ScrollView", Pressable: "Pressable", StyleSheet: { create: (value) => value } },
    "../theme": { colors: {}, radius: {}, THEMES: [], themeKey: "stage", space: (value) => value },
    "../components/ThemeSwatch": { default: "ThemeSwatch", themeGridStyle: {} },
    "../components/credential-form": { CredentialInput: "CredentialInput", CredentialLabel: "CredentialLabel", CredentialSubmit: "CredentialSubmit" },
    "../store": { isMod: () => false, useStore: () => ({ session, blockedUsers: () => [], mutedUsers: () => [], blockedDirectoryStatus: "ready",
      updateProfile: (patch, options) => new Promise((resolve, reject) => calls.push({ patch, options, resolve, reject })),
    }) },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)((name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (name.startsWith("../components/") || name.startsWith("../features/") || name === "./AuthScreen") return name;
    return require(name);
  }, module, module.exports);
  const render = () => { cursor = 0; tree = module.exports.default({}); };
  const row = () => nodes(tree).find((node) => node.props.label === "Show my concert map");
  render();
  return { calls, render, row, nodes: () => nodes(tree), session: () => session,
    adopt(next) { session = next; render(); },
    unmount() { for (const index of new Set(effects)) slots[index]?.cleanup?.(); },
  };
}

test("map setting is an accessible account-only switch driven by confirmed server state", async () => {
  const f = fixture();
  assert.equal(f.row().props.accessibilityRole, "switch");
  assert.equal(f.row().props.accessibilityState.checked, true);
  const action = f.row().props.onPress;
  const pending = action();
  await action();
  assert.equal(f.calls.length, 1, "same-turn repeat taps cannot create competing privacy writes");
  assert.deepEqual(f.calls[0].patch, { concertMapVisible: false });
  assert.equal(f.calls[0].options.expectedAccountId, "account-a");
  assert.equal(f.calls[0].options.optimistic, false);
  assert.ok(f.calls[0].options.signal instanceof AbortSignal);
  f.render();
  assert.equal(f.row().props.disabled, true);
  assert.equal(f.row().props.accessibilityState.checked, true, "a pending write must not pretend the map is hidden");
  f.calls[0].resolve({ ok: true, user: { id: "account-a", concertMapVisible: false } });
  await pending;
  f.adopt({ id: "account-a", concertMapVisible: false, ageBand: "18_plus" });
  assert.equal(f.row().props.accessibilityState.checked, false);
  assert.equal(f.row().props.disabled, false);
  assert.ok(f.nodes().some((node) => node.props.children === "Your concert map is hidden. Your concert list is unchanged."));
  assert.equal(fixture(null).row(), undefined);
});

test("failed or unconfirmed map saves remain visible and can be retried", async () => {
  for (const response of [{ ok: false }, { ok: true }, { ok: true, user: { id: "other", concertMapVisible: false } }, { ok: true, user: { id: "account-a", concertMapVisible: true } }, new Error("offline")]) {
    const f = fixture(), pending = f.row().props.onPress();
    if (response instanceof Error) f.calls[0].reject(response); else f.calls[0].resolve(response);
    await pending; f.render();
    assert.equal(f.row().props.accessibilityState.checked, true);
    assert.equal(f.row().props.disabled, false);
    assert.ok(f.nodes().some((node) => node.props.children === "Your map preference did not save. Please try again."));
  }
});

test("guest settings unmount safely when no map request exists", () => {
  const f = fixture(null);
  assert.doesNotThrow(() => f.unmount());
});

test("account replacement and unmount cancel pending map requests without showing a stale result", async () => {
  for (const replacement of [null, { id: "account-b", concertMapVisible: true, ageBand: "18_plus" }, "unmount"]) {
    const f = fixture(), pending = f.row().props.onPress();
    if (replacement === "unmount") f.unmount(); else f.adopt(replacement);
    assert.equal(f.calls[0].options.signal.aborted, true);
    f.calls[0].resolve({ ok: true, user: { id: "account-a", concertMapVisible: false } });
    await pending; f.render();
    assert.equal(f.nodes().some((node) => node.props.children === "Your concert map is hidden. Your concert list is unchanged."), false);
    if (replacement?.id) assert.equal(f.row().props.disabled, false);
  }
});
