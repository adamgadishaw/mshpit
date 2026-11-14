import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createIOSCommentDrafts } from "../domain/iosCommentDrafts.mjs";
const require = createRequire(import.meta.url);
const React = require("react");
const reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const codes = new Map();
function execute(path, imports) {
  const file = new URL(path, import.meta.url);
  if (!codes.has(path)) codes.set(path, transformSync(readFileSync(file, "utf8"), {
    filename: file.pathname, babelrc: false, configFile: false,
    plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
  }).code);
  const module = { exports: {} };
  new Function("require", "module", "exports", codes.get(path))(name => imports(name, createRequire(file)), module, module.exports);
  return module.exports.default;
}
const noop = () => {};
function createRenderer(measurements) {
  const context = {}, container = { children: [] };
  let priority = 0, focusedInput = null;
  const append = (parent, child) => parent.children.push(child);
  const remove = (parent, child) => {
    const index = parent.children.indexOf(child);
    if (index >= 0) parent.children.splice(index, 1);
  };
  const insert = (parent, child, before) => parent.children.splice(parent.children.indexOf(before), 0, child);
  const renderer = reconciler({
    supportsMutation: true, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: (node) => node,
    prepareForCommit: () => null, resetAfterCommit: noop,
    createInstance: (type, props) => ({
      type, props, children: [], measureInWindow: callback => measurements.push(callback), focus() { if (focusedInput) focusedInput.focused = false; focusedInput = this; this.focused = true; },
      blur() { this.focused = false; this.blurs = (this.blurs || 0) + 1; if (focusedInput === this) focusedInput = null; }, scrollToEnd() {},
    }), createTextInstance: (text) => ({ text }),
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, insertBefore: insert, insertInContainerBefore: insert,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate: (node, type, oldProps, newProps) => { node.props = newProps; },
    commitTextUpdate: (node, oldText, text) => { node.text = text; },
    clearContainer: (node) => { node.children = []; }, resetTextContent: noop, commitMount: noop,
    scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1,
    supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
    getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: (value) => { priority = value; },
    resolveUpdatePriority: () => priority || 32, shouldAttemptEagerTransition: () => false,
    hideInstance: node => { node.hidden = true; }, unhideInstance: node => { node.hidden = false; },
    hideTextInstance: node => { node.hidden = true; }, unhideTextInstance: node => { node.hidden = false; },
    detachDeletedInstance: noop, maySuspendCommit: () => false, preloadInstance: () => true,
    startSuspendingCommit: noop, suspendInstance: noop, waitForCommitToBeReady: () => null,
    NotPendingTransition: null, HostTransitionContext: React.createContext(null), resetFormInstance: noop,
    bindToConsole: (method, args) => console[method].bind(console, ...args),
  });
  const fail = (error) => { throw error; };
  const root = renderer.createContainer(container, 1, null, false, null, "", fail, fail, fail, null);
  const flush = () => {
    for (let iteration = 0; iteration < 5; iteration++) {
      renderer.flushSyncWork();
      if (!renderer.flushPassiveEffects()) break;
    }
  };
  return {
    container, focusedInput: () => focusedInput,
    render(element) { renderer.updateContainerSync(element, root, null, null); flush(); },
    act(callback) { renderer.flushSyncFromReconciler(callback); flush(); },
  };
}

const nodes = node => [node, ...(node.children || []).flatMap(nodes)];
const flattenStyle = value => Array.isArray(value) ? Object.assign({}, ...value.map(flattenStyle)) : value || {};
const keyboardFrame = { screenX: 0, screenY: 510, width: 390, height: 334 };
// Real React/component/hooks and draft owner, synthetic native events and bounds.
// This cannot establish actual iOS animation, Yoga text layout or VoiceOver output.
function fixture({ managed = false, platform = "ios", metrics = null, strict = false, failure = false, guest = false } = {}) {
  const measurements = [], listeners = new Map(), animations = [], sends = [];
  const detailContext = require("../components/iosDetailPresentationContext.mjs");
  let admission = null;
  const admit = active => {
    if (admission) admission.token.live = false;
    const token = { live: active }, current = () => token.live;
    admission = { managed: true, active, current, token, scope: "post-occurrence", preview: !active,
      guard: callback => typeof callback === "function" ? (...args) => current() ? callback(...args) : undefined : callback };
  };
  if (managed) admit(true);
  const renderer = createRenderer(measurements);
  let window = { width: 390, height: 844, fontScale: 1 };
  let currentMetrics = metrics;
  const rows = [{ id: "parent", userId: "author", name: "A very long author name for a reply at large text sizes", text: "Original comment" }];
  const owner = createIOSCommentDrafts(); owner.account("member", 1);
  const lease = owner.lease("post");
  const listen = (event, callback) => {
    const set = listeners.get(event) || new Set(); set.add(callback); listeners.set(event, set);
    return { remove: () => set.delete(callback) };
  };
  const AppState = { currentState: "active", addEventListener: listen };
  const native = {
    View: "View", Text: "Text", TextInput: "TextInput", Pressable: "Pressable", ScrollView: "ScrollView", ActivityIndicator: "ActivityIndicator",
    Platform: { OS: platform }, StyleSheet: { create: value => value }, Alert: { alert() {} },
    Dimensions: { get: () => window }, useWindowDimensions: () => window, AppState,
    Keyboard: { metrics: () => currentMetrics, addListener: listen, scheduleLayoutAnimation: event => animations.push(event) },
  };
  const imports = (name, local) => {
    if (name === "../features/publicNavigation/publicNavigationService") return { readPublicPost: async () => null, resolvePublicEntity: async () => null };
    if (name.endsWith("/useIOSDetailPresentation")) return execute("../hooks/useIOSDetailPresentation.ios.js", imports);
    if (name === "../components/iosDetailPresentationContext.mjs") return detailContext;
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return native;
    if (name === "../theme") return { colors: {}, radius: {}, roleColor: () => null };
    if (name === "../store") return { useStore: () => ({
      session: guest ? null : { id: "member" }, feed: [], commentsFor: () => rows, userById: () => null, userBadges: () => [],
      loadComments: async () => ({ ok: true }), addComment: async (...args) => { sends.push(args); return { ok: !failure }; },
    }) };
    if (name === "../hooks/useScopedRefresh") return () => ({ refreshing: false, refresh() {} });
    if (name === "../components/IOSPostKeyboardView") return KeyboardView;
    if (name === "../components/Badge") return { BadgeRow: "BadgeRow" };
    if (name === "../components/PublicWebLinks") return { PublicTextLink: "PublicTextLink" };
    if (name === "../components/SocialReactionButtons") return { CommentLikeButton: "CommentLikeButton" };
    if (name.startsWith("../components/")) return name.split("/").at(-1);
    return local(name);
  };
  const KeyboardView = execute(platform === "ios" ? "../components/IOSPostKeyboardView.ios.jsx" : "../components/IOSPostKeyboardView.jsx", imports);
  const Post = execute(`./PostScreen${platform === "ios" ? ".ios" : ""}.jsx`, imports);
  const props = { log: { id: "post", review: "Review" }, commentDraft: lease };
  let suspended = false, successor = false;
  const pending = new Promise(noop);
  function Content() { if (suspended) throw pending; return React.createElement(Post, props); }
  const f = {
    measurements, listeners, sends, animations, lease, owner,
    all: () => nodes(renderer.container),
    find: predicate => { const node = f.all().find(predicate); assert.ok(node); return node; },
    get input() { return f.find(n => n.type === "TextInput"); },
    get shell() { return f.find(n => n.props?.testID === "post-content-shell"); },
    get bottom() { return flattenStyle(f.shell.props.style).paddingBottom || 0; },
    button: label => f.find(n => n.type === "Pressable" && n.props.accessibilityLabel === label),
    act: callback => renderer.act(callback),
    render: () => renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null,
      React.createElement(detailContext.IOSDetailPresentationContext.Provider, { value: admission },
        React.createElement(React.Suspense, { fallback: React.createElement("Loading") }, React.createElement(Content)),
        successor ? React.createElement("TextInput", { testID: "successor-input" }) : null))),
    get focusedInput() { return renderer.focusedInput(); },
    suspend(value) { suspended = value; f.render(); },
    showSuccessor() { successor = true; f.render(); return f.find(n => n.props?.testID === "successor-input"); },
    cover() { admit(false); f.render(); }, reveal() { admit(true); f.render(); },
    event(name, frame = keyboardFrame) {
      if (name === "keyboardDidShow") currentMetrics = frame;
      if (name === "keyboardDidHide") currentMetrics = null;
      f.act(() => { for (const callback of [...listeners.get(name) || []]) callback({ endCoordinates: frame, duration: 250, easing: "keyboard", isEventFromThisApp: true }); });
    },
    measure(bounds = [0, 90, 390, 720]) {
      // Complete the newest request; previous callbacks remain available for race tests.
      const callback = measurements.pop(); assert.ok(callback, "a native measure must have been requested");
      f.act(() => callback(...bounds));
    },
    state(state, metrics = null) {
      AppState.currentState = state; currentMetrics = metrics;
      f.act(() => { for (const callback of [...listeners.get("change") || []]) callback(state); });
    },
    dimensions(next) { window = { ...window, ...next }; f.render(); },
    async settle() { for (let i = 0; i < 4; i++) await Promise.resolve(); f.act(() => {}); },
    close: () => renderer.render(null),
  };
  f.render();
  return f;
}

test("iOS measured frame accounts for actual safe area/banner/player, origin-only shifts and size changes without remount", async t => {
  const f = fixture(); t.after(f.close); await f.settle();
  const input = f.input, shell = f.shell;
  f.act(() => input.props.onChangeText("Keep\nmy draft"));
  f.event("keyboardWillShow"); f.measure();
  assert.equal(f.bottom, 300, "810 container bottom minus 510 keyboard top, no second 34pt safe inset");
  f.render(); f.measure([0, 120, 390, 720]); assert.equal(f.bottom, 330, "origin-only shift");
  f.act(() => shell.props.onLayout()); f.measure([0, 160, 390, 650]); assert.equal(f.bottom, 300);
  assert.equal(f.input, input); assert.equal(f.shell, shell); assert.equal(input.props.value, "Keep\nmy draft");
  f.measure([0, 160, 390, 650]); assert.equal(f.bottom, 300, "padding never feeds back into outer bounds");
  assert.equal(f.sends.length, 0);
  const scroll = f.find(n => n.type === "ScrollView");
  assert.equal(scroll.props.keyboardDismissMode, "interactive"); assert.equal(scroll.props.automaticallyAdjustKeyboardInsets, false);
});

test("rotation and large font rerenders retain the actual native input and clamp small-height overlap", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); const input = f.input;
  f.act(() => input.props.onChangeText("Before resize"));
  f.event("keyboardWillShow"); f.measure();
  f.dimensions({ width: 844, height: 390, fontScale: 3.2 });
  f.event("keyboardWillChangeFrame", { screenX: 0, screenY: 180, width: 844, height: 210 });
  f.measure([200, 44, 444, 312]); assert.equal(f.bottom, 176);
  f.act(() => f.shell.props.onLayout()); f.measure([200, 220, 444, 80]); assert.equal(f.bottom, 80, "overlap cannot exceed container height");
  assert.equal(f.input, input); assert.equal(input.props.value, "Before resize");
  assert.equal(input.props.allowFontScaling, undefined); assert.equal(input.props.maxFontSizeMultiplier, undefined);
});

test("latest keyboard/layout request wins A-to-B-to-A and hide invalidates pending native measures", async t => {
  const f = fixture(); t.after(f.close); await f.settle();
  f.event("keyboardWillShow"); const a = f.measurements.at(-1);
  f.event("keyboardWillChangeFrame", { ...keyboardFrame, screenY: 600, height: 244 }); const b = f.measurements.at(-1);
  f.event("keyboardWillChangeFrame"); f.measure(); assert.equal(f.bottom, 300);
  f.act(() => { b(0, 100, 390, 700); a(0, 300, 390, 500); }); assert.equal(f.bottom, 300);
  const beforeHide = f.measurements.at(-1); f.event("keyboardWillHide"); assert.equal(f.bottom, 0);
  f.act(() => beforeHide(0, 90, 390, 720)); assert.equal(f.bottom, 0);
  f.event("keyboardWillChangeFrame"); assert.equal(f.bottom, 0, "undocking frame changes cannot reopen hidden keyboard space");
});

test("foreground and StrictMode restore an already visible keyboard, clean subscriptions and reject old callbacks", async t => {
  const f = fixture({ metrics: keyboardFrame, strict: true }); t.after(f.close); await f.settle();
  f.measure(); assert.equal(f.bottom, 300);
  const pending = f.measurements.at(-1); f.state("background"); assert.equal(f.bottom, 0);
  f.act(() => pending(0, 90, 390, 720)); assert.equal(f.bottom, 0);
  f.state("active", keyboardFrame); f.measure(); assert.equal(f.bottom, 300);
  const stale = f.measurements.at(-1), oldShow = [...f.listeners.get("keyboardWillShow")][0];
  f.state("inactive"); f.state("active", null); f.act(() => stale(0, 90, 390, 720)); assert.equal(f.bottom, 0);
  assert.ok([...f.listeners.values()].every(set => set.size === 1));
  f.close(); assert.ok([...f.listeners.values()].every(set => set.size === 0));
  f.act(() => { oldShow({ endCoordinates: keyboardFrame }); stale(0, 90, 390, 720); });
});

for (const [name, frame] of [
  ["hardware keyboard", { ...keyboardFrame, height: 0 }],
  ["floating keyboard", { screenX: 80, screenY: 400, width: 230, height: 200 }],
  ["cross-fade zero Y", { ...keyboardFrame, screenY: 0 }],
  ["offscreen keyboard", { ...keyboardFrame, screenY: 844 }],
  ["invalid metrics", { ...keyboardFrame, screenY: NaN }],
]) test(`${name} leaves no bottom obstruction`, async t => {
  const f = fixture(); t.after(f.close); await f.settle();
  f.event("keyboardWillShow", frame); f.measure(); assert.equal(f.bottom, 0);
});

test("iOS comment and reply labels, explicit Send, wrapping retry/error text and contained targets retain the draft", async t => {
  const f = fixture({ failure: true }); t.after(f.close); await f.settle(); const input = f.input;
  assert.equal(input.props.accessibilityLabel, "Comment on post");
  f.act(() => f.button("Reply to comment").props.onPress());
  assert.equal(f.input, input); assert.equal(input.props.accessibilityLabel, "Reply to comment");
  const reply = f.find(n => n.type === "Text" && String(n.props.children).startsWith("Replying to "));
  assert.equal(reply.props.numberOfLines, undefined); assert.equal(flattenStyle(reply.props.style).minWidth, 0);
  const clear = f.button("Clear reply target"), send = f.button("Send comment");
  for (const control of [clear, send]) {
    const style = flattenStyle(control.props.style);
    assert.ok(style.width >= 44 && style.height >= 44); assert.equal(style.flexShrink, 0);
  }
  assert.equal(clear.props.hitSlop, undefined);
  assert.equal(input.props.returnKeyType, "default"); assert.equal(input.props.onSubmitEditing, undefined);
  assert.equal(input.props.submitBehavior, undefined); assert.equal(input.props.multiline, true);
  f.act(() => input.props.onChangeText("First line\nSecond line")); assert.equal(f.sends.length, 0);
  await f.button("Send comment").props.onPress(); await f.settle();
  assert.equal(f.sends[0][1], "First line\nSecond line"); assert.equal(f.sends[0][2], "parent");
  const retry = f.button("Retry previous comment"); assert.equal(flattenStyle(retry.props.style).maxWidth, "100%");
  assert.equal(flattenStyle(retry.props.style).flexShrink, 1);
  const error = f.find(n => n.props?.accessibilityRole === "alert"); assert.equal(error.props.numberOfLines, undefined);
  f.dimensions({ fontScale: 3.2 }); assert.equal(f.input, input); assert.equal(input.props.value, "First line\nSecond line");
  f.act(() => clear.props.onPress()); assert.equal(input.props.value, "First line\nSecond line");
  await f.button("Retry previous comment").props.onPress(); await f.settle(); assert.deepEqual(f.sends[1], f.sends[0]);
});

for (const platform of ["android", "web"]) test(`${platform} retains original container, keyboard props, Send geometry and newline callback`, async t => {
  const f = fixture({ platform }); t.after(f.close); await f.settle();
  assert.equal(f.listeners.size, 0); assert.equal(f.measurements.length, 0);
  assert.equal(f.shell.type, "View"); assert.equal(f.shell.props.onLayout, undefined);
  assert.equal(Array.isArray(f.shell.props.style), false);
  assert.equal(f.input.props.accessibilityLabel, undefined); assert.equal(f.input.props.returnKeyType, "send");
  assert.equal(typeof f.input.props.onSubmitEditing, "function");
  const scroll = f.find(n => n.type === "ScrollView"); assert.equal(scroll.props.keyboardDismissMode, undefined);
  assert.equal(scroll.props.automaticallyAdjustKeyboardInsets, undefined);
  assert.equal(flattenStyle(f.button("Send comment").props.style).width, 40);
  f.act(() => f.input.props.onChangeText("Legacy")); await f.input.props.onSubmitEditing(); await f.settle(); assert.equal(f.sends[0][1], "Legacy");
});

test("iOS guest still has no editable composer or publication path", async t => {
  const f = fixture({ guest: true }); t.after(f.close); await f.settle();
  assert.equal(f.all().some(n => n.type === "TextInput"), false); assert.equal(f.sends.length, 0);
  assert.ok(f.button("Sign in to comment"));
});

test("foreign-app notifications and invalid bounds cannot claim keyboard space; didShow/didHide recover missed will events", async t => {
  const f = fixture(); t.after(f.close); await f.settle();
  f.act(() => [...f.listeners.get("keyboardWillShow")][0]({ endCoordinates: keyboardFrame, isEventFromThisApp: false }));
  assert.equal(f.measurements.length, 0);
  f.event("keyboardDidShow"); f.measure(); assert.equal(f.bottom, 300);
  f.act(() => f.shell.props.onLayout()); f.measure([0, NaN, 390, 720]); assert.equal(f.bottom, 0);
  f.act(() => f.shell.props.onLayout()); f.measure(); assert.equal(f.bottom, 300);
  f.event("keyboardDidHide"); assert.equal(f.bottom, 0);
  f.state("background"); f.event("keyboardWillShow"); assert.equal(f.bottom, 0);
});

test("platform resolution leaves Android/web with a bare native View and no keyboard implementation", () => {
  assert.equal(readFileSync(new URL("../components/IOSPostKeyboardView.jsx", import.meta.url), "utf8").trim(), 'export { View as default } from "react-native";');
  assert.ok(readFileSync(new URL("./PostScreen.jsx", import.meta.url), "utf8").includes('from "../components/IOSPostKeyboardView"'));
});


for (const strict of [false, true]) test(`retained keyboard (${strict ? "StrictMode" : "normal"}) pauses hidden measurement and rejects old native callbacks after Back`, async t => {
  const f = fixture({ managed: true, strict }); t.after(f.close); await f.settle();
  f.event("keyboardDidShow"); f.measure();
  const input = f.input, shell = f.shell, inset = f.bottom;
  assert.ok(inset > 0);
  const show = [...f.listeners.get("keyboardDidShow")][0], hide = [...f.listeners.get("keyboardDidHide")][0];
  const oldLayout = shell.props.onLayout;
  f.event("keyboardDidShow"); const pending = f.measurements.at(-1);
  f.cover(); const count = f.measurements.length;
  f.act(() => { show({ endCoordinates: keyboardFrame }); hide({}); oldLayout(); pending(0, 0, 390, 700); });
  assert.equal(f.measurements.length, count); assert.equal(f.bottom, inset); assert.equal(f.input, input);
  f.reveal(); f.measure(); const returned = f.bottom, freshCount = f.measurements.length;
  f.act(() => { oldLayout(); hide({}); show({ endCoordinates: keyboardFrame }); pending(0, 0, 390, 700); });
  assert.equal(f.measurements.length, freshCount); assert.equal(f.bottom, returned); assert.equal(f.shell, shell); assert.equal(f.input, input);
  f.event("keyboardDidHide"); assert.equal(f.bottom, 0);
});


for (const strict of [false, true]) test(`retained Post responder (${strict ? 'StrictMode' : 'normal'}) blurs only its own native input on cover and Suspense`, async t => {
  const f = fixture({ managed: true, strict }); t.after(f.close); await f.settle();
  const input = f.input; f.act(() => { input.props.onChangeText('Keep native draft'); input.focus(); });
  assert.equal(f.focusedInput, input); const initial = input.blurs || 0;
  f.cover(); assert.equal(input.focused, false); assert.equal(input.blurs, initial + 1);
  const next = f.showSuccessor(); next.focus(); f.render();
  assert.equal(f.focusedInput, next); assert.equal(f.lease.read().text, 'Keep native draft');
  f.reveal(); input.focus(); assert.equal(f.focusedInput, input);
  const beforeSuspend = input.blurs;
  f.suspend(true); assert.equal(input.focused, false); assert.equal(input.blurs, beforeSuspend + 1);
  next.focus(); f.render(); assert.equal(f.focusedInput, next);
  f.suspend(false); assert.equal(f.find(n => n.type === 'TextInput' && !n.props.testID), input);
  assert.equal(f.lease.read().text, 'Keep native draft'); assert.equal(f.focusedInput, next);
});
