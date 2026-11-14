import assert from "node:assert/strict";
import { readFileSync, statSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url), React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core"), noop = () => {};
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

const codes = new Map();
function execute(path, imports) {
  const file = new URL(path, import.meta.url);
  if (!codes.has(path)) codes.set(path, transformSync(readFileSync(file, "utf8"), { filename: file.pathname, babelrc: false, configFile: false,
    plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")] }).code);
  const module = { exports: {} };
  new Function("require", "module", "exports", codes.get(path))(name => imports(name, createRequire(file)), module, module.exports);
  return module.exports;
}
function fixture({ realSources = false, component = "smart" } = {}) {
  const renderer = createRenderer(), commands = []; let preview = false, reduced = false, active = true, hidden = false, reject = false, serial = 0;
  let props = { uri: "https://test.invalid/animated.webp", mediaKind: "image", cachePolicy: "none" };
  const never = new Promise(() => {});
  const NativeImage = React.forwardRef((props, ref) => {
    const [id] = React.useState(() => ++serial);
    React.useImperativeHandle(ref, () => ({ startAnimating() { commands.push([id, "start"]); return reject ? Promise.reject(new Error("detached")) : Promise.resolve(); },
      stopAnimating() { commands.push([id, "stop"]); return reject ? Promise.reject(new Error("detached")) : Promise.resolve(); } }), [id]);
    return React.createElement("Image", { ...props, id });
  });
  const imports = (name, local) => {
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return { View: "View", Text: "Text", Pressable: "Pressable", Platform: { OS: "ios" }, PixelRatio: { get: () => 3 }, StyleSheet: { create: value => value, absoluteFill: {} } };
    if (name === "expo-image") return { Image: NativeImage };
    if (name.endsWith("/useIOSDetailPresentation")) return { __esModule: true, default: () => ({ active: true, current: () => true, token: null, scope: null }) };
    if (name === "../hooks/useNativeTabPreview") return () => preview;
    if (name === "../hooks/useReducedMotion") return () => reduced;
    if (name === "../lib/useAppActive") return () => active;
    if (name === "../hooks/useFeedPresentation") return execute("../hooks/useFeedPresentation.ios.js", imports);
    if (name === "../hooks/useImageAttempt") return execute("../hooks/useImageAttempt.ios.js", imports);
    if (name === "../hooks/feedImageRetry") return { useFeedImageRetryPulse: () => null };
    if (name === "../theme") return { colors: {}, mono: "mono" };
    if (name === "./Icon") return "Icon";
    if (name === "./ClipPoster") return "ClipPoster";
    if (name === "../lib/img") return realSources ? local("../lib/img.js") : { displaySrc: value => value, previewSrc: value => value, isHttp: () => true, proxied: value => value + "?fallback", isVideoUrl: value => value?.endsWith(".mp4") };
    return local(name);
  };
  const Image = execute(component === "avatar" ? "./Avatar.jsx" : "./SmartImage.ios.jsx", imports).default;
  function Gate() { if (hidden) throw never; return null; }
  function render() { renderer.render(React.createElement(React.Suspense, { fallback: React.createElement("Fallback") }, React.createElement(Image, props), React.createElement(Gate))); }
  const walk = node => [node, ...(node.children || []).flatMap(walk)];
  const image = () => walk(renderer.container).find(node => node.type === "Image");
  render();
  return { renderer, image, commands, render,
    preview(value) { preview = value; render(); }, reduce(value) { reduced = value; render(); }, active(value) { active = value; render(); },
    hide() { hidden = true; render(); }, show() { hidden = false; render(); },
    props(value) { props = { ...props, ...value }; render(); }, reject() { reject = true; }, close() { renderer.render(null); } };
}
test("real SmartImage pauses an existing animated view under retained Feed and preserves source/cache/view identity", () => {
  const f = fixture(), image = f.image(), oldDisplay = image.props.onDisplay;
  assert.equal(f.commands.at(-1)[1], "start");
  f.preview(true); assert.equal(f.image(), image); assert.equal(f.commands.at(-1)[1], "stop");
  assert.equal(f.image().props.autoplay, false); assert.equal(f.image().props.cachePolicy, "none");
  assert.equal(f.image().props.source.uri, "https://test.invalid/animated.webp");
  const before = f.commands.length; oldDisplay(); assert.equal(f.commands.length, before);
  f.preview(false); assert.equal(f.image(), image); assert.equal(f.commands.at(-1)[1], "start");
  const after = f.commands.length; oldDisplay(); assert.equal(f.commands.length, after); f.close();
});
for (const boundary of ["reduce", "active", "viewable"]) test(`SmartImage native animation stops at ${boundary} boundary`, () => {
  const f = fixture(), old = f.image().props.onDisplay;
  if (boundary === "reduce") f.reduce(true); else if (boundary === "active") f.active(false); else f.props({ viewable: false });
  assert.equal(f.image().props.autoplay, false); assert.equal(f.commands.at(-1)[1], "stop");
  const before = f.commands.length; old(); assert.equal(f.commands.length, before); f.close();
});
test("SmartImage reconnect retires old display callbacks while restoring current animation", () => {
  const f = fixture(), old = f.image().props.onDisplay;
  f.hide(); assert.equal(f.commands.at(-1)[1], "stop"); f.show();
  assert.equal(f.commands.at(-1)[1], "start"); const before = f.commands.length;
  old(); assert.equal(f.commands.length, before); f.image().props.onDisplay(); assert.equal(f.commands.length, before + 1); f.close();
});
test("SmartImage primary/fallback/URI lifetimes cannot animate the successor view", () => {
  const f = fixture(), old = f.image().props.onDisplay, id = f.image().props.id;
  f.renderer.act(() => f.image().props.onError()); assert.notEqual(f.image().props.id, id);
  assert.match(f.image().props.source.uri, /fallback/); let before = f.commands.length; old(); assert.equal(f.commands.length, before);
  const fallback = f.image().props.onDisplay; f.props({ uri: "https://test.invalid/second.gif" }); before = f.commands.length;
  fallback(); assert.equal(f.commands.length, before); f.close();
});
test("detached native command rejections remain bounded best-effort cleanup", async () => {
  const f = fixture(); f.reject(); f.preview(true); f.close(); await new Promise(resolve => setImmediate(resolve));
});
test("Metro selects SmartImage native animation lifecycle only for iOS", () => {
  const { resolve } = require("metro-resolver"); const context = { originModulePath: fileURLToPath(new URL("../../App.js", import.meta.url)), assetExts: new Set(), sourceExts: ["js", "jsx", "json", "ts", "tsx"], preferNativePlatform: true,
    mainFields: ["react-native", "browser", "main"], getPackageForModule: () => null, fileSystemLookup(path) { try { const stat = statSync(path); return { exists: true, type: stat.isDirectory() ? "d" : "f", realPath: realpathSync(path) }; } catch { return { exists: false }; } } };
  for (const platform of ["ios", "android", "web"]) assert.equal(resolve(context, "./src/components/SmartImage", platform).filePath, fileURLToPath(new URL(`./SmartImage.${platform === "ios" ? "ios." : ""}jsx`, import.meta.url)));
});

test("iOS profile hero decodes the stored HEIC before trying the existing conversion fallback", () => {
  const f = fixture({ realSources: true });
  const uri = "https://media.test/profile.heic";
  f.props({ uri, preferOriginal: true, contain: false, previewWidth: 320 });
  const original = f.image().props;
  assert.equal(original.source.uri, uri, "native HEIC support must not start with an external conversion");
  assert.equal(original.enforceEarlyResizing, false, "decode must not fit legacy portrait pixels into a wide banner before cover");
  assert.equal(original.allowDownscaling, true, "final display-size memory bound remains enabled");
  assert.equal(original.source.cacheKey, `original:${uri}`);
  f.renderer.act(original.onError);
  assert.match(f.image().props.source.uri, /wsrv\.nl.*output=jpg/);
  f.props({ uri: "https://media.test/replacement.jpg" });
  const replacement = f.image();
  f.renderer.act(original.onError);
  assert.equal(f.image(), replacement, "late failure must not advance a replacement photo");
  assert.equal(f.image().props.source.uri, "https://media.test/replacement.jpg");
  f.close();
});

test("ordinary iOS images retain bounded previews and early decode when hero quality is disabled", () => {
  const f = fixture({ realSources: true });
  f.props({ uri: "https://media.test/photo.jpg", previewWidth: 720 });
  assert.match(f.image().props.source.uri, /wsrv\.nl.*w=720.*q=80/);
  assert.equal(f.image().props.enforceEarlyResizing, true);
  assert.equal(f.image().props.source.cacheKey, f.image().props.source.uri);
  f.close();
});

test("profile avatar uses stored detail with a separate cache identity and bounded failure fallback", () => {
  const f = fixture({ realSources: true, component: "avatar" });
  const user = { id: "member", name: "Member", avatarUri: "https://media.test/avatar.jpg", profileUpdatedAt: 5 };
  f.props({ user, size: 96 });
  const thumbnail = f.image().props;
  assert.match(thumbnail.source.uri, /wsrv\.nl.*w=288.*q=80/);
  f.props({ preferOriginal: true, priority: "high" });
  const hero = f.image().props;
  assert.equal(hero.source.uri, user.avatarUri);
  assert.notEqual(hero.source.cacheKey, thumbnail.source.cacheKey);
  assert.equal(hero.enforceEarlyResizing, false);
  assert.equal(hero.allowDownscaling, true);
  assert.equal(hero.priority, "high");
  f.renderer.act(hero.onError);
  assert.match(f.image().props.source.uri, /wsrv\.nl.*w=288/);
  f.props({ user: { ...user, avatarUri: "https://media.test/changed.jpg", profileUpdatedAt: 6 } });
  f.renderer.act(hero.onError);
  assert.equal(f.image().props.source.uri, "https://media.test/changed.jpg");
  assert.notEqual(f.image().props.source.cacheKey, hero.source.cacheKey);
  f.close();
});
