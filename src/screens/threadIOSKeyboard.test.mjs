import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createIOSMessageDrafts } from "../domain/iosMessageDrafts.mjs";
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
const fixtureColors = { amber: "theme-amber", amberStrong: "theme-amber-strong" };
// Actual ThreadScreen, keyboard owner, React and retained DM draft. Native
// bounds/events and Store are fixtures: this does not certify native glyphs,
// per-frame interactive dismissal or VoiceOver, and never touches live DMs.
function fixture({ platform = "ios", metrics = null, strict = false, failure = false } = {}) {
  const measurements = [], listeners = new Map(), animations = [], sends = [], retries = [];
  const renderer = createRenderer(measurements);
  let window = { width: 390, height: 844, fontScale: 1 };
  let currentMetrics = metrics, sendSucceeds = !failure;
  const drafts = createIOSMessageDrafts(); drafts.account("member", 1);
  const lease = drafts.lease("recipient");
  const listen = (event, callback) => {
    const set = listeners.get(event) || new Set(); set.add(callback); listeners.set(event, set);
    return { remove: () => set.delete(callback) };
  };
  const AppState = { currentState: "active", addEventListener: listen };
  const native = {
    ...Object.fromEntries(["View", "Text", "TextInput", "Pressable", "ScrollView", "ActivityIndicator", "KeyboardAvoidingView"].map(name => [name, name])),
    Platform: { OS: platform }, StyleSheet: { create: value => value },
    Dimensions: { get: () => window }, useWindowDimensions: () => window, AppState,
    Keyboard: { metrics: () => currentMetrics, addListener: listen, scheduleLayoutAnimation: event => animations.push(event) },
  };
  const recipient = { id: "recipient", name: "Fixture member", avatarUri: "fixture:avatar" };
  const rows = [
    { id: "received", text: "Hello there", from: "recipient", ts: "10:01" },
    { id: "sent", text: "Testing", from: "member", ts: "10:02" },
    { id: "failed", text: "Failed draft", from: "member", ts: "10:03", failed: true },
  ];
  const imports = (name, local) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return native;
    if (name.endsWith("/useIOSDetailPresentation")) return execute("../hooks/useIOSDetailPresentation.js", imports);
    if (name === "../theme") return { colors: fixtureColors, radius: {}, mono: "mono" };
    if (name === "../store") return { useStore: () => ({
      session: { id: "member" }, chatAuthEpoch: 1, userById: () => recipient, threadMessages: () => rows,
      sendDM: async (...args) => { sends.push(args); return { ok: sendSucceeds }; },
      retryChatMessage: async (...args) => { retries.push(args); return { ok: true }; },
      cancelChatMessage: noop, loadThread: async () => ({}), markThreadRead: noop, loadUser: noop,
    }) };
    if (name === "../hooks/useScopedRefresh") return () => ({ refreshing: false, refresh: noop });
    if (name === "../hooks/useIOSThreadRefreshAnnouncement") return () => ({ begin: noop, finish: noop });
    if (name === "../hooks/useIOSThreadControls") return () => () => true;
    if (name === "../lib/useLiveChat") return noop;
    if (name === "../lib/useChatScroll") return () => ({ scrollRef: { current: null }, onScroll: noop, onContentSizeChange: noop, onLayout: noop, onScrollBeginDrag: noop });
    if (name === "../components/IOSPostKeyboardView") return KeyboardView;
    if (name.startsWith("../components/")) return name.split("/").at(-1);
    return local(name);
  };
  const KeyboardView = execute(platform === "ios" ? "../components/IOSPostKeyboardView.ios.jsx" : "../components/IOSPostKeyboardView.jsx", imports);
  const Thread = execute("./ThreadScreen.jsx", imports);
  const props = { otherId: "recipient", draftLease: lease, onClose: noop, onReport: noop, onOpenProfile: noop };
  const f = {
    measurements, listeners, sends, retries, animations, lease,
    all: () => nodes(renderer.container),
    find: predicate => { const node = f.all().find(predicate); assert.ok(node, "Expected rendered node"); return node; },
    get input() { return f.find(n => n.type === "TextInput"); },
    get shell() { return f.find(n => n.props?.testID === "message-thread-shell"); },
    get bottom() { return flattenStyle(f.shell.props.style).paddingBottom || 0; },
    button: label => f.find(n => n.type === "Pressable" && n.props.accessibilityLabel === label),
    act: callback => renderer.act(callback),
    render: () => renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null, React.createElement(Thread, props))),
    edit(value) { f.act(() => f.input.props.onChangeText(value)); },
    event(name, frame = keyboardFrame) {
      if (name === "keyboardDidShow") currentMetrics = frame;
      if (name === "keyboardDidHide") currentMetrics = null;
      f.act(() => { for (const callback of [...listeners.get(name) || []]) callback({ endCoordinates: frame, duration: 250, easing: "keyboard", isEventFromThisApp: true }); });
    },
    measure(bounds = [0, 90, 390, 720]) {
      const callback = measurements.pop(); assert.ok(callback, "A native measurement must have been requested");
      f.act(() => callback(...bounds));
    },
    state(state, metrics = null) {
      AppState.currentState = state; currentMetrics = metrics;
      f.act(() => { for (const callback of [...listeners.get("change") || []]) callback(state); });
    },
    dimensions(next) { window = { ...window, ...next }; f.render(); },
    succeed() { sendSucceeds = true; },
    async settle() { for (let i = 0; i < 4; i++) await Promise.resolve(); f.act(noop); },
    close: () => renderer.render(null),
  };
  f.render(); return f;
}

test("installed RN local-frame overlap reproduces the missing origin; thread measures the window instead", async t => {
  // Execute the installed RN method rather than assuming its overlap formula.
  const path = require.resolve("react-native/Libraries/Components/Keyboard/KeyboardAvoidingView.js");
  const source = readFileSync(path, "utf8");
  const ast = require("@babel/parser").parse(source, { sourceType: "module", plugins: ["flow", "jsx"] });
  const owner = ast.program.body.find(node => node.type === "ClassDeclaration");
  const method = owner.body.body.find(node => node.key?.name === "_relativeKeyboardHeight");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const originalOverlap = new AsyncFunction("keyboardFrame", "Platform", "AccessibilityInfo", source.slice(method.body.start + 1, method.body.end - 1));
  const oldBottom = await originalOverlap.call({ _frame: { y: 0, height: 720 }, props: { behavior: "padding" }, state: { bottom: 0 } }, keyboardFrame, { OS: "ios" }, {});
  assert.equal(oldBottom, 210);
  assert.equal(90 + 720 - oldBottom - keyboardFrame.screenY, 90, "old composer remains behind keyboard by its ancestor's origin");
  const f = fixture(); t.after(f.close); await f.settle();
  f.event("keyboardWillShow"); f.measure();
  assert.equal(f.bottom, 300);
  assert.equal(90 + 720 - f.bottom, keyboardFrame.screenY, "new content bottom meets keyboard top with no duplicate safe area");
});

test("show, keyboard frame changes and dismissal preserve the same input and draft", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); const input = f.input;
  f.edit("Keep\nthis draft");
  f.event("keyboardWillShow"); f.measure(); assert.equal(f.bottom, 300);
  f.event("keyboardWillChangeFrame", { ...keyboardFrame, screenY: 600, height: 244 });
  f.measure(); assert.equal(f.bottom, 210);
  f.event("keyboardWillChangeFrame", keyboardFrame); f.measure(); assert.equal(f.bottom, 300, "canceled dismissal restores overlap");
  f.event("keyboardWillHide"); assert.equal(f.bottom, 0);
  f.event("keyboardDidHide"); assert.equal(f.bottom, 0);
  assert.equal(f.input, input); assert.equal(input.props.value, "Keep\nthis draft");
  assert.equal(f.lease.read().text, "Keep\nthis draft"); assert.equal(f.sends.length, 0);
  const scroll = f.find(n => n.type === "ScrollView");
  assert.equal(scroll.props.keyboardDismissMode, "interactive");
  assert.equal(scroll.props.keyboardShouldPersistTaps, "handled");
  assert.equal(scroll.props.automaticallyAdjustKeyboardInsets, false);
  assert.equal(typeof scroll.props.onLayout, "function");
  assert.equal(typeof scroll.props.onScrollBeginDrag, "function");
  assert.ok(f.animations.length > 0, "layout changes request keyboard animation synchronization");
});

test("banner origin shifts, rotation and Dynamic Type remeasure without replacing a draft", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); const input = f.input;
  f.edit("Before resizing"); f.event("keyboardWillShow"); f.measure();
  f.render(); f.measure([0, 120, 390, 720]); assert.equal(f.bottom, 330);
  f.dimensions({ width: 844, height: 390, fontScale: 3.2 });
  f.event("keyboardWillChangeFrame", { screenX: 0, screenY: 180, width: 844, height: 210 });
  f.measure([200, 44, 444, 312]); assert.equal(f.bottom, 176);
  f.act(() => f.shell.props.onLayout()); f.measure([200, 220, 444, 80]); assert.equal(f.bottom, 80);
  assert.equal(f.input, input); assert.equal(input.props.value, "Before resizing");
  assert.equal(input.props.allowFontScaling, undefined); assert.equal(input.props.maxFontSizeMultiplier, undefined);
});

test("newer keyboard measurements and hide reject pending stale callbacks", async t => {
  const f = fixture(); t.after(f.close); await f.settle();
  f.event("keyboardWillShow"); const stale = f.measurements.at(-1);
  f.event("keyboardWillChangeFrame", { ...keyboardFrame, screenY: 600, height: 244 }); f.measure();
  f.act(() => stale(0, 90, 390, 720)); assert.equal(f.bottom, 210);
  const beforeHide = f.measurements.at(-1);
  f.event("keyboardWillHide"); f.act(() => beforeHide(0, 90, 390, 720)); assert.equal(f.bottom, 0);
  f.event("keyboardWillChangeFrame"); assert.equal(f.bottom, 0);
});

test("already visible keyboard and foreground restoration work in StrictMode with subscription cleanup", async t => {
  const f = fixture({ metrics: keyboardFrame, strict: true }); t.after(f.close); await f.settle();
  f.measure(); assert.equal(f.bottom, 300);
  const pending = f.measurements.at(-1);
  f.state("background"); f.act(() => pending(0, 90, 390, 720)); assert.equal(f.bottom, 0);
  f.state("active", keyboardFrame); f.measure(); assert.equal(f.bottom, 300);
  assert.ok([...f.listeners.values()].every(set => set.size === 1));
  f.close(); assert.ok([...f.listeners.values()].every(set => set.size === 0));
});

for (const [name, frame] of [
  ["hardware keyboard", { ...keyboardFrame, height: 0 }],
  ["floating keyboard", { screenX: 80, screenY: 400, width: 230, height: 200 }],
  ["cross-fade zero Y", { ...keyboardFrame, screenY: 0 }],
  ["offscreen keyboard", { ...keyboardFrame, screenY: 844 }],
]) test(`${name} does not reserve an artificial composer obstruction`, async t => {
  const f = fixture(); t.after(f.close); await f.settle();
  f.event("keyboardWillShow", frame); f.measure(); assert.equal(f.bottom, 0);
});

test("multiline iOS editing uses explicit Send, preserves a failed draft, and clears only a successful send", async t => {
  const f = fixture({ failure: true }); t.after(f.close); await f.settle(); const input = f.input;
  assert.equal(input.props.multiline, true); assert.equal(input.props.submitBehavior, "newline");
  assert.equal(input.props.placeholder, "Message…"); assert.ok(input.props.accessibilityHint);
  assert.ok(flattenStyle(input.props.style).maxHeight > 0);
  f.edit("First line\nSecond line"); assert.equal(f.sends.length, 0);
  const send = f.button("Send direct message to Fixture member");
  const sendStyle = flattenStyle(send.props.style);
  assert.ok(sendStyle.width >= 44 && sendStyle.height >= 44);
  await send.props.onPress(); await f.settle();
  assert.deepEqual(f.sends[0], ["recipient", "First line\nSecond line"]);
  assert.equal(f.input, input); assert.equal(input.props.value, "First line\nSecond line");
  f.event("keyboardWillShow"); f.measure(); f.event("keyboardWillHide");
  assert.equal(input.props.value, "First line\nSecond line");
  f.succeed(); await send.props.onPress(); await f.settle(); assert.equal(input.props.value, "");
});

test("the composer height stays bounded by the remaining chat viewport while a long draft survives", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); const input = f.input;
  f.edit("A long draft\n".repeat(50));
  const body = f.find(n => n.type === "View" && typeof n.props.onLayout === "function"
    && n.children.some(child => child.type === "VinylRefreshBoundary"));
  f.act(() => body.props.onLayout({ nativeEvent: { layout: { height: 200 } } }));
  assert.equal(flattenStyle(input.props.style).maxHeight, 80);
  f.act(() => body.props.onLayout({ nativeEvent: { layout: { height: 600 } } }));
  assert.equal(flattenStyle(input.props.style).maxHeight, 132);
  assert.equal(f.input, input); assert.equal(input.props.value, "A long draft\n".repeat(50));
});

test("large Dynamic Type retains one complete input line in a short keyboard-visible viewport", async t => {
  const f = fixture(); t.after(f.close); await f.settle(); const input = f.input;
  f.edit("Keep the entire editable line");
  const body = f.find(n => n.type === "View" && typeof n.props.onLayout === "function"
    && n.children.some(child => child.type === "VinylRefreshBoundary"));
  f.act(() => body.props.onLayout({ nativeEvent: { layout: { height: 140 } } }));
  f.dimensions({ fontScale: 3 });
  const style = flattenStyle(input.props.style);
  assert.equal(style.minHeight, 88); assert.equal(style.maxHeight, 88);
  assert.ok(style.minHeight >= style.lineHeight * 3 + style.paddingVertical * 2 + style.borderWidth * 2,
    "the scaled line, vertical padding and borders fit in the editor");
  assert.ok(style.maxHeight < 140 - 17, "the composer bar and remaining history share the available viewport");
  assert.equal(f.input, input); assert.equal(input.props.value, "Keep the entire editable line");
  assert.equal(input.props.allowFontScaling, undefined); assert.equal(input.props.maxFontSizeMultiplier, undefined);
});

test("iOS compact painted bubbles exclude timestamps and controls, with recipient photo beside incoming content", async t => {
  const f = fixture(); t.after(f.close); await f.settle();
  for (const message of ["Hello there", "Testing", "Failed draft"]) {
    const text = f.find(n => n.type === "MentionText" && n.props.text === message);
    const bubble = f.find(n => n.children?.includes(text));
    assert.equal(bubble.children.length, 1, "metadata cannot enlarge the painted text bubble");
    assert.equal(flattenStyle(bubble.props.style).maxWidth, "100%");
  }
  const photo = f.find(n => n.type === "Avatar" && n.props.size === 28);
  assert.equal(photo.props.user.avatarUri, "fixture:avatar");
  const incoming = f.find(n => n.type === "MentionText" && n.props.text === "Hello there");
  const bubble = f.find(n => n.children?.includes(incoming));
  const column = f.find(n => n.children?.includes(bubble));
  const row = f.find(n => n.children?.includes(column));
  const report = f.button("Report message from Fixture member");
  assert.ok(row.children.includes(report), "Report belongs beside the incoming message");
  assert.ok(!nodes(column).includes(report), "Report does not enlarge the timestamp/footer column");
  for (const label of ["Retry direct message", "Cancel failed direct message", "Report message from Fixture member"]) {
    const style = flattenStyle(f.button(label).props.style);
    assert.ok(style.minWidth >= 44 && style.minHeight >= 44);
    assert.equal(style.marginVertical, 0, "controls occupy their layout space rather than overlapping adjacent messages");
  }
});

test("MentionText retains default mention color while iOS own messages supply readable underlined mentions", async t => {
  const f = fixture(); t.after(f.close); await f.settle();
  const sent = f.find(n => n.type === "MentionText" && n.props.text === "Testing");
  const bubble = f.find(n => n.children?.includes(sent));
  assert.equal(flattenStyle(bubble.props.style).backgroundColor, fixtureColors.amberStrong);
  assert.equal(flattenStyle(sent.props.mentionStyle).color, "#1A1206");
  assert.equal(flattenStyle(sent.props.mentionStyle).textDecorationLine, "underline");
  const incoming = f.find(n => n.type === "MentionText" && n.props.text === "Hello there");
  assert.equal(incoming.props.mentionStyle, undefined);

  const renderer = createRenderer([]), mentions = [];
  t.after(() => renderer.render(null));
  const MentionText = execute("../components/MentionText.jsx", (name, local) => {
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react-native") return { Text: "Text" };
    if (name === "../theme") return { colors: fixtureColors };
    return local(name);
  });
  const mention = () => nodes(renderer.container).find(n => n.type === "Text" && typeof n.props.onPress === "function");
  const props = { text: "Ask @listener", onMention: handle => mentions.push(handle) };
  renderer.render(React.createElement(MentionText, props));
  assert.equal(flattenStyle(mention().props.style).color, fixtureColors.amber);
  assert.equal(flattenStyle(mention().props.style).textDecorationLine, undefined);
  mention().props.onPress();
  renderer.render(React.createElement(MentionText, { ...props, mentionStyle: sent.props.mentionStyle }));
  assert.equal(flattenStyle(mention().props.style).color, "#1A1206");
  assert.equal(flattenStyle(mention().props.style).textDecorationLine, "underline");
  assert.equal(flattenStyle(mention().props.style).fontWeight, "700");
  mention().props.onPress(); assert.deepEqual(mentions, ["listener", "listener"]);
});

for (const platform of ["android", "web"]) test(`${platform} retains its existing keyboard owner and one-line send behavior`, async t => {
  const f = fixture({ platform }); t.after(f.close); await f.settle();
  assert.equal(f.shell.type, "KeyboardAvoidingView"); assert.equal(f.shell.props.behavior, undefined);
  assert.equal(f.listeners.size, 0); assert.equal(f.measurements.length, 0);
  assert.equal(f.input.props.multiline, undefined); assert.equal(f.input.props.submitBehavior, undefined);
  assert.equal(f.input.props.returnKeyType, "send"); assert.equal(typeof f.input.props.onSubmitEditing, "function");
  const scroll = f.find(n => n.type === "ScrollView");
  assert.equal(scroll.props.keyboardDismissMode, undefined); assert.equal(scroll.props.automaticallyAdjustKeyboardInsets, undefined);
  f.edit("Original platform send"); await f.input.props.onSubmitEditing(); await f.settle();
  assert.deepEqual(f.sends[0], ["recipient", "Original platform send"]);
});
