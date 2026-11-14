import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { parse } from "@babel/parser";
import { canAccessTheme } from "./themeAccess.mjs";
import { createSessionValidationStatus } from "./sessionValidationStatus.mjs";
import { prepareThemeStartup, readStartupTheme } from "../lib/themeStartup.mjs";

const require = createRequire(import.meta.url);
const React = require("react"), reconciler = require("react-reconciler"), { transformSync } = require("@babel/core");
const source = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const declarations = parse(source, { sourceType: "module", plugins: ["jsx"] }).program.body;
const subjectSource = ["ThemeAccessBoundary"].map(name => {
  const node = declarations.find(node => node.type === "FunctionDeclaration" && node.id.name === name);
  assert.ok(node, `${name} must exist in the actual App`);
  return source.slice(node.start, node.end);
}).join("\n");
const compiled = transformSync(`${subjectSource}\nexport default ThemeAccessBoundary;`, {
  babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
const noop = () => {};
const walk = node => [node, ...(node.children || []).flatMap(walk)];
const flattenStyle = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

function createRenderer() {
  const context = {}, container = { children: [] };
  let priority = 0;
  const append = (parent, child) => parent.children.push(child);
  const remove = (parent, child) => { const index = parent.children.indexOf(child); if (index >= 0) parent.children.splice(index, 1); };
  const insert = (parent, child, before) => parent.children.splice(parent.children.indexOf(before), 0, child);
  const renderer = reconciler({
    supportsMutation: true, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
    prepareForCommit: () => null, resetAfterCommit: noop,
    createInstance: (type, props) => ({ type, props, children: [] }), createTextInstance: text => ({ text }),
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, insertBefore: insert, insertInContainerBefore: insert,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate: (node, type, oldProps, newProps) => { node.props = newProps; }, commitTextUpdate: (node, oldText, text) => { node.text = text; },
    hideInstance: noop, unhideInstance: noop, hideTextInstance: noop, unhideTextInstance: noop,
    clearContainer: node => { node.children = []; }, resetTextContent: noop, commitMount: noop,
    scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1, supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
    getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: value => { priority = value; }, resolveUpdatePriority: () => priority || 32,
    shouldAttemptEagerTransition: () => false, detachDeletedInstance: noop, maySuspendCommit: () => false, preloadInstance: () => true,
    startSuspendingCommit: noop, suspendInstance: noop, waitForCommitToBeReady: () => null, NotPendingTransition: null,
    HostTransitionContext: React.createContext(null), resetFormInstance: noop, bindToConsole: (method, args) => console[method].bind(console, ...args),
  });
  const fail = error => { throw error; };
  const root = renderer.createContainer(container, 1, null, false, null, "", fail, fail, fail, null);
  const flush = () => { for (let i = 0; i < 5; i++) { renderer.flushSyncWork(); if (!renderer.flushPassiveEffects()) break; } };
  return { container, render(element) { renderer.updateContainerSync(element, root, null, null); flush(); },
    act(callback) { renderer.flushSyncFromReconciler(callback); flush(); } };
}

function fixture({ platform = "ios", themeKey = "forest", authReady = false, session = null } = {}) {
  const renderer = createRenderer(), status = createSessionValidationStatus();
  const owner = status.begin(), state = { authReady, session, sessionValidationStatus: status };
  let reloads = 0;
  const native = { View: "View", ScrollView: "ScrollView", ActivityIndicator: "ActivityIndicator", Text: "Text", Pressable: "Pressable", StyleSheet: { create: value => value } };
  const pendingCode = transformSync(readFileSync(new URL("../components/SessionValidationPending.ios.jsx", import.meta.url), "utf8"), {
    babelrc: false, configFile: false,
    plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
  }).code;
  const pendingModule = { exports: {} };
  new Function("require", "module", "exports", pendingCode)(name => name === "react-native" ? native
    : name === "../theme" ? { colors: { bg: "restricted-bg", amber: "restricted-amber", text: "restricted-text", textDim: "restricted-dim" } }
    : require(name), pendingModule, pendingModule.exports);
  const dependencies = {
    useStore: () => state, useEffect: React.useEffect,
    canAccessTheme, themeKey, Platform: { OS: platform }, reloadTheme: () => reloads++,
    Root: "Root", SessionValidationPending: pendingModule.exports.default, ...native,
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(dependencies), compiled)(require, module, module.exports, ...Object.values(dependencies));
  const render = () => renderer.render(React.createElement(module.exports.default));
  render();
  return { renderer, status, owner, state, render, reloads: () => reloads,
    nodes: () => walk(renderer.container), texts: () => walk(renderer.container).filter(node => node.text != null).map(node => node.text),
    button: () => walk(renderer.container).find(node => node.props?.accessibilityRole === "button"),
    close: () => renderer.render(null),
  };
}

test("authorized saved team palette keeps iOS session failure and Retry visible without rendering restricted styles", async t => {
  await prepareThemeStartup({ readSelection: () => ({ theme: "forest", ownerId: "team-a" }),
    fetchAccount: async () => ({ id: "team-a", role: "admin", theme: "forest" }), signedOut: () => false });
  assert.equal(readStartupTheme(), "forest");
  const f = fixture({ themeKey: readStartupTheme() }); t.after(f.close);
  assert.ok(f.texts().includes("Checking your sign-in status…"));
  assert.equal(f.nodes().find(node => node.type === "ActivityIndicator").props.color, "#F2A65A");
  let retries = 0;
  f.renderer.act(() => f.owner.unavailable(() => { retries++; f.owner.checking(); }));
  assert.ok(f.texts().includes("MSHPIT couldn’t finish loading"));
  assert.ok(f.texts().includes("We couldn’t confirm your sign-in status. We’ll try again automatically."));
  assert.equal(f.nodes().some(node => node.type === "Root"), false);
  assert.equal(f.reloads(), 0, "pending validation must not start a reload loop");
  const button = f.button();
  assert.equal(button.props.accessibilityLabel, "Retry loading MSHPIT");
  assert.equal(button.props.disabled, false);
  assert.ok(button.props.style.minHeight >= 44 && button.props.style.minWidth >= 44);
  const publicColors = new Set(["#09090B", "#F2A65A", "#F4EFE7", "#A7A4AD"]);
  for (const node of f.nodes()) for (const [key, value] of Object.entries(flattenStyle(node.props?.style))) {
    if (key.endsWith("Color") || key === "color") assert.ok(publicColors.has(value), `private palette must not color ${key}`);
  }
  assert.ok(f.nodes().some(node => node.type === "ScrollView" && node.props.contentContainerStyle.flexGrow === 1));
  assert.ok(f.nodes().filter(node => node.type === "Text").every(node => node.props.numberOfLines == null && node.props.allowFontScaling !== false));
  f.renderer.act(button.props.onPress);
  assert.equal(retries, 1); assert.equal(f.button(), undefined);
  assert.ok(f.texts().includes("Checking your sign-in status…"));
  f.state.authReady = true; f.state.session = { id: "team-a", role: "admin" }; f.render();
  assert.ok(f.nodes().some(node => node.type === "Root"));
  assert.equal(f.reloads(), 0);
});

test("neutral iOS recovery respects server waiting and retired status-owner callbacks", t => {
  const f = fixture(); t.after(f.close); let retries = 0;
  f.renderer.act(() => f.owner.unavailable(() => retries++));
  const retiredRetry = f.button().props.onPress;
  f.renderer.act(() => f.owner.waiting());
  assert.ok(f.texts().includes("A retry is scheduled. We’ll check your sign-in status again automatically."));
  assert.equal(f.button().props.disabled, true); assert.equal(f.button().props.onPress, null);
  f.renderer.act(retiredRetry); assert.equal(retries, 0);
  f.renderer.act(() => f.status.begin());
  f.renderer.act(retiredRetry); assert.equal(retries, 0);
  assert.equal(f.button(), undefined); assert.equal(f.reloads(), 0);
});

test("observed role loss hides the restricted root and keeps the existing explicit reload retry", t => {
  const f = fixture({ authReady: true, session: { id: "team-a", role: "admin" } }); t.after(f.close);
  assert.ok(f.nodes().some(node => node.type === "Root"));
  f.state.session = { id: "team-a", role: "fan" }; f.render();
  assert.equal(f.nodes().some(node => node.type === "Root"), false);
  assert.equal(f.reloads(), 1);
  assert.ok(f.texts().includes("Reload appearance"));
  f.renderer.act(f.button().props.onPress); assert.equal(f.reloads(), 2);
});

for (const themeKey of ["stage", "daylight"]) test(`${themeKey} keeps the normal Root pending surface`, t => {
  const f = fixture({ themeKey }); t.after(f.close);
  assert.ok(f.nodes().some(node => node.type === "Root")); assert.equal(f.reloads(), 0);
});

for (const platform of ["android", "web"]) test(`${platform} keeps the existing restricted-theme pending surface`, t => {
  const f = fixture({ platform }); t.after(f.close);
  f.renderer.act(() => f.owner.unavailable(noop));
  assert.ok(f.nodes().some(node => node.type === "ActivityIndicator" && node.props.accessibilityLabel === "Checking appearance access"));
  assert.equal(f.button(), undefined); assert.equal(f.reloads(), 0);
});
