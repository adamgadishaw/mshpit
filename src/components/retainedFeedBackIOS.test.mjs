import assert from "node:assert/strict";
import { readFileSync, statSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import { retainNativeFeedForMedia } from "../domain/nativeFeedRetention.ios.js";
const require = createRequire(import.meta.url), React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const noop = () => {}, context = React.createContext(false);
function createRenderer() {
  const context = {}, container = { children: [] };
  let priority = 0;
  const append = (parent, child) => parent.children.push(child);
  const remove = (parent, child) => { const index = parent.children.indexOf(child); if (index >= 0) parent.children.splice(index, 1); };
  const insert = (parent, child, before) => parent.children.splice(parent.children.indexOf(before), 0, child);
  const renderer = reconciler({
    supportsMutation: true, hideInstance: n => { n.hidden = true; }, unhideInstance: n => { n.hidden = false; }, hideTextInstance: n => { n.hidden = true; }, unhideTextInstance: n => { n.hidden = false; }, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
    prepareForCommit: () => null, resetAfterCommit: noop,
    createInstance: (type, props) => ({ type, props, children: [], focus() {}, scrollToEnd() {} }), createTextInstance: text => ({ text }),
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, insertBefore: insert, insertInContainerBefore: insert,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate: (node, type, oldProps, newProps) => { node.props = newProps; }, commitTextUpdate: (node, oldText, text) => { node.text = text; },
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
  return { container, renderLayout(element) { renderer.updateContainerSync(element, root, null, null); renderer.flushSyncWork(); }, flush, render(element) { renderer.updateContainerSync(element, root, null, null); flush(); },
    act(callback) { renderer.flushSyncFromReconciler(callback); flush(); } };
}

const file = new URL("./NativeFeedMediaLayer.ios.jsx", import.meta.url);
const code = transformSync(readFileSync(file, "utf8"), { filename: file.pathname, babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")] }).code;
const module = { exports: {} };
new Function("require", "module", "exports", code)(name => {
  if (name === "react-native") return { View: "View", StyleSheet: { create: value => value, absoluteFill: { position: "absolute" } } };
  if (name === "./nativeFeedBackContext.mjs") return { NativeFeedBackContext: context };
  return require(name);
}, module, module.exports);
const Layer = module.exports.default, walk = node => [node, ...(node.children || []).flatMap(walk)];
function fixture() {
  const renderer = createRenderer(); let frames = [{}], account = "A", key = 0, serial = 0; const actions = [];
  function Feed() { const [id] = React.useState(() => ++serial); return React.createElement("Feed", { id }); }
  function Detail() { return React.createElement("Detail", { reveal: React.useContext(context) }); }
  function render() {
    renderer.render(React.createElement(Layer, { key: account + key, frames, obscured: frames.length > 1,
      header: React.createElement("Header", { onPost: () => actions.push("post") }), tabBar: React.createElement("Tabs", { onChange: value => actions.push(value) }), media: React.createElement(Detail) }, React.createElement(Feed)));
  }
  render(); const all = () => walk(renderer.container);
  return { renderer, all, actions, feed: () => all().find(node => node.type === "Feed"), detail: () => all().find(node => node.type === "Detail"),
    push(frame) { frames = [...frames, frame]; render(); }, back() { frames = frames.slice(0, -1); render(); },
    remount() { key++; render(); }, account() { account = "B"; render(); }, replaceBase() { frames = [{}, ...frames.slice(1)]; render(); }, close() { renderer.render(null); } };
}
const options = { platform: "ios", accountId: "A", tab: "feed", frames: [{}], hasOverlay: false };
test("iOS retains one Feed across only uninterrupted readable/photo stacks", () => {
  assert.equal(retainNativeFeedForMedia(options), true);
  for (const frames of [[{}, { profileId: "P" }], [{}, { artistName: "A" }, { openLog: { id: "S" } }], [{}, { profileId: "P" }, { photos: {} }]]) {
    assert.equal(retainNativeFeedForMedia({ ...options, frames, hasOverlay: true }), true);
  }
  for (const patch of [{ platform: "android" }, { platform: "web" }, { tab: "discover" }, { accountId: null }, { wide: true },
    { frames: [{}, { auth: true }] }, { frames: [{}, { profileId: "P" }, { editingPost: {} }] }, { frames: [{ profileId: "P" }, { openLog: {} }] },
    { hasOverlay: false }]) {
    assert.equal(retainNativeFeedForMedia({ ...options, frames: [{}, { profileId: "P" }], hasOverlay: true, ...patch }), false);
  }
});
test("actual iOS layer retains exact Feed and hides its controls/accessibility during reveal", () => {
  const f = fixture(), feed = f.feed();
  f.push({ profileId: "P" }); assert.equal(f.feed(), feed); assert.equal(f.detail().props.reveal, true);
  const base = f.all().find(node => node.props?.pointerEvents === "none");
  assert.ok(base); assert.equal(base.props.accessibilityElementsHidden, true); assert.equal(base.props.importantForAccessibility, "no-hide-descendants");
  assert.equal(base.props.style[1], false);
  assert.ok(f.all().some(node => node.props?.accessibilityViewIsModal));
  f.back(); assert.equal(f.feed(), feed); assert.equal(f.detail(), undefined); f.close();
});
test("Feed to Artist to Show to Artist to Feed keeps one base and reveals only its exact parent", () => {
  const f = fixture(), feed = f.feed();
  f.push({ artistName: "A" }); assert.equal(f.detail().props.reveal, true);
  f.push({ openLog: { id: "S" } }); assert.equal(f.detail().props.reveal, false); assert.equal(f.feed(), feed);
  f.back(); assert.equal(f.detail().props.reveal, true); assert.equal(f.feed(), feed);
  f.back(); assert.equal(f.feed(), feed); f.close();
});
for (const boundary of ["remount", "account", "replaceBase"]) test(`a hidden ${boundary} cannot impersonate the previously visible Feed`, () => {
  const f = fixture(); f.push({ profileId: "P" }); assert.equal(f.detail().props.reveal, true);
  f[boundary](); assert.equal(f.detail().props.reveal, false);
  f.back(); f.push({ profileId: "Q" }); assert.equal(f.detail().props.reveal, true); f.close();
});
test("protected/gallery routes never enable the Back reveal even with a retained base", () => {
  for (const frame of [{ photos: {} }, { auth: true }, { profileId: "P", reporting: true }]) {
    const f = fixture(); f.push(frame); assert.equal(f.detail().props.reveal, false); f.close();
  }
});
test("installed Metro selects retention policy and layer only on iOS", () => {
  const { resolve } = require("metro-resolver");
  const resolver = { originModulePath: fileURLToPath(new URL("../../App.js", import.meta.url)), assetExts: new Set(), sourceExts: ["js", "jsx", "json", "ts", "tsx"], preferNativePlatform: true,
    mainFields: ["react-native", "browser", "main"], getPackageForModule: () => null, fileSystemLookup(path) {
      try { const stat = statSync(path); return { exists: true, type: stat.isDirectory() ? "d" : "f", realPath: realpathSync(path) }; } catch { return { exists: false }; }
    } };
  for (const platform of ["ios", "android", "web"]) {
    for (const [path, extension] of [["components/NativeFeedMediaLayer", "jsx"], ["domain/nativeFeedRetention", "js"]]) {
      assert.equal(resolve(resolver, `./src/${path}`, platform).filePath, fileURLToPath(new URL(`../${path}.${platform === "ios" ? "ios." : ""}${extension}`, import.meta.url)));
    }
  }
});

test("retained header and tab presses cannot run while hidden or revive after Back", () => {
  const f = fixture();
  const oldPost = f.all().find(node => node.type === "Header").props.onPost;
  const oldTab = f.all().find(node => node.type === "Tabs").props.onChange;
  f.push({ profileId: "P" }); oldPost(); oldTab("search");
  f.all().find(node => node.type === "Header").props.onPost(); assert.deepEqual(f.actions, []);
  f.back(); oldPost(); oldTab("search"); assert.deepEqual(f.actions, []);
  f.all().find(node => node.type === "Header").props.onPost();
  f.all().find(node => node.type === "Tabs").props.onChange("discover");
  assert.deepEqual(f.actions, ["post", "discover"]); f.close();
});
