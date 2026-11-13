import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const React = require("react"), reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const noop = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function createRenderer(onCommit) {
  const context = {}, container = { children: [] };
  let priority = 0;
  const append = (parent, child) => parent.children.push(child);
  const remove = (parent, child) => { const index = parent.children.indexOf(child); if (index >= 0) parent.children.splice(index, 1); };
  const insert = (parent, child, before) => parent.children.splice(parent.children.indexOf(before), 0, child);
  const renderer = reconciler({
    supportsMutation: true, isPrimaryRenderer: true, supportsPersistence: false, supportsHydration: false,
    getRootHostContext: () => context, getChildHostContext: () => context, getPublicInstance: node => node,
    prepareForCommit: () => null, resetAfterCommit: () => onCommit?.(),
    createInstance: (type, props) => {
      const node = { type, props, children: [], animations: [] };
      if (type === "ExpoImage") {
        node.startAnimating = () => { node.animations.push("play"); return Promise.resolve(); };
        node.stopAnimating = () => { node.animations.push("stop"); return Promise.resolve(); };
      }
      return node;
    }, createTextInstance: text => ({ text }),
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, insertBefore: insert, insertInContainerBefore: insert,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate: (node, type, oldProps, newProps) => { node.props = newProps; },
    commitTextUpdate: (node, oldText, text) => { node.text = text; },
    clearContainer: node => { node.children = []; }, resetTextContent: noop, commitMount: noop,
    scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1,
    supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
    getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: value => { priority = value; },
    resolveUpdatePriority: () => priority || 32, shouldAttemptEagerTransition: () => false,
    hideInstance: node => { node.hidden = true; }, unhideInstance: node => { node.hidden = false; },
    hideTextInstance: node => { node.hidden = true; }, unhideTextInstance: node => { node.hidden = false; },
    detachDeletedInstance: noop, maySuspendCommit: () => false, preloadInstance: () => true,
    startSuspendingCommit: noop, suspendInstance: noop, waitForCommitToBeReady: () => null,
    NotPendingTransition: null, HostTransitionContext: React.createContext(null), resetFormInstance: noop,
    bindToConsole: (method, args) => console[method].bind(console, ...args),
  });
  const fail = error => { throw error; };
  const root = renderer.createContainer(container, 1, null, false, null, "", fail, fail, fail, null);
  const flush = () => { for (let i = 0; i < 5; i++) { renderer.flushSyncWork(); if (!renderer.flushPassiveEffects()) break; } };
  return {
    container,
    render(element) { renderer.updateContainerSync(element, root, null, null); flush(); },
    act(callback) { renderer.flushSyncFromReconciler(callback); flush(); },
  };
}

const code = new Map();
const story = { id: "story-fixture", postId: "news_fixture", headline: "Fixture concert announcement", summary: "Fixture summary", body: "The full fixture story.",
  category: "music", publishedAt: Date.parse("2026-11-01T00:00:00Z"), author: { id: "author", name: "News desk", handle: "desk" },
  likes: 4, reposts: 2, commentCount: 3, sources: [{ kind: "article", name: "Fixture Source", url: "https://fixture.invalid/article" }],
  artists: [{ key: "fixture-artist", name: "Fixture Artist" }] };
const nodes = node => [node, ...(node.children || []).flatMap(nodes)];

// Actual NewsStoryCard, NewsPostActions, reactions, share UI and native card
// ownership render through React. No backend, links or native sheets execute.
function fixture({ own = false, guest = false, compact = false, full = false, strict = false, unscoped = false, composed = false } = {}) {
  const renderer = createRenderer(), Preview = React.createContext(false), Context = React.createContext({});
  const calls = [], likes = [], saves = [], deletions = [], alerts = [], timers = new Set();
  const pending = (list, args) => new Promise((resolve, reject) => list.push({ args, resolve, reject }));
  let context = { session: guest ? null : { id: own ? "author" : "viewer" }, removedIds: [], blockedIds: [],
    likeInfo: (_, count, liked) => ({ count, liked }), toggleLike: (...args) => pending(likes, args),
    setPostRepost: (...args) => pending(saves, args), deleteOwnPost: (...args) => pending(deletions, args) };
  const native = { View: "View", Text: "Text", Pressable: "Pressable", Modal: "Modal", Platform: { OS: "ios" },
    StyleSheet: { create: value => value, absoluteFill: {}, absoluteFillObject: {} },
    Alert: { alert: (...args) => alerts.push(args) }, Linking: { openURL: url => { calls.push(["external", url]); return Promise.resolve(); } } };
  const theme = { colors: new Proxy({}, { get: (_, key) => String(key) }), radius: {}, space: value => value };
  const modules = { react: React, "react/jsx-runtime": require("react/jsx-runtime"), "react-native": native, "expo-image": { Image: "ExpoImage" },
    "../../theme": theme, "../theme": theme, "../Icon": "Icon", "./Icon": "Icon", "./BrandMark": "BrandMark",
    "./NewsInteractionContext": { useNewsInteractions: () => React.useContext(Context) },
    "../../hooks/useNativeTabPreview": () => React.useContext(Preview),
    "../components/showIOSPostActions": () => assert.fail("News does not open a ticket action sheet"),
    "../lib/lazyWithRetry": { loadChunk: () => new Promise(noop) } };
  const paths = { "../../hooks/useTicketPresentation": "../../hooks/useTicketPresentation.ios.js",
    "./NewsPostActions": "./NewsPostActions.ios.jsx", "../SocialReactionButtons": "../SocialReactionButtons.ios.jsx",
    "../SocialShareStudio": "../SocialShareStudio.ios.jsx", "../PostBrand": "../PostBrand.jsx" };
  const load = path => {
    const url = new URL(path, import.meta.url), localRequire = createRequire(url), module = { exports: {} };
    if (!code.has(path)) code.set(path, transformSync(readFileSync(url, "utf8"), { babelrc: false, configFile: false,
      plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")] }).code);
    const moduleRequire = name => {
      if (name in modules) return modules[name];
      if (name in paths) return modules[name] = load(paths[name]);
      return localRequire(name);
    };
    new Function("require", "module", "exports", "setTimeout", "clearTimeout", code.get(path))
      (moduleRequire, module, module.exports, callback => { timers.add(callback); return callback; }, token => timers.delete(token));
    return module.exports;
  };
  const Card = load("./NewsStoryCard.ios.jsx").default;
  const useFeedPresentation = composed ? load("../../hooks/useFeedPresentation.ios.js").default : null;
  let preview = false, presentation = { active: true, current() { return this.active; } };
  let props = { story, compact, full, accountId: compact ? undefined : context.session?.id || null,
    ...(unscoped ? {} : { contextPresentation: presentation }),
    ...Object.fromEntries(["onOpen", "onOpenArtist", "onOpenProfile", "onReport", "onRequireAuth"].map(name => [name, (...args) => calls.push([name, ...args])])) };
  const suspension = new Promise(noop);
  function FeedOwner(input) {
    const { current } = useFeedPresentation({ active: !preview, presentation: input.contextPresentation,
      scope: context.session?.id || "guest" });
    const cardPresentation = React.useMemo(() => ({ current }), [current]);
    return React.createElement(Card, { ...input, contextPresentation: cardPresentation });
  }
  function Gate({ suspend, ...input }) { if (suspend) throw suspension; return React.createElement(composed ? FeedOwner : Card, input); }
  const f = { calls, likes, saves, deletions, alerts,
    render(update = {}) { props = { ...props, ...update }; React.act(() => renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null,
      React.createElement(Context.Provider, { value: { ...context } }, React.createElement(Preview.Provider, { value: preview },
        React.createElement(React.Suspense, { fallback: null }, React.createElement(Gate, props))))))); },
    all: () => nodes(renderer.container),
    find(predicate) { const node = f.all().find(predicate); assert.ok(node, "real News card control must exist"); return node; },
    button(label) { return f.find(node => node.props?.accessibilityLabel === label); },
    source() { return f.find(node => node.type === "Text" && node.props?.children === "Fixture Source"); },
    act(callback) { React.act(() => renderer.act(callback)); },
    hide() { presentation.active = false; presentation = { active: false, current() { return this.active; } }; preview = true; f.render({ contextPresentation: presentation }); },
    show() { presentation.active = false; presentation = { active: true, current() { return this.active; } }; preview = false; f.render({ contextPresentation: presentation }); },
    retire() { presentation.active = false; },
    account(id) { context.session = id ? { id } : null; f.render({ accountId: id || null }); },
    privacy(update) { context = { ...context, ...update }; f.render(); },
    async settle(callback) { await React.act(async () => { renderer.act(callback); for (let i = 0; i < 6; i++) await Promise.resolve(); }); },
    close() { React.act(() => renderer.render(null)); },
  };
  f.render(); return f;
}

for (const strict of [false, true]) test(`actual News cards fence queued direct actions and source navigation across cover-return, strict=${strict}`, t => {
  const f = fixture({ strict }); t.after(f.close);
  const capture = () => [f.button("4 likes").props.onPress, f.button("Repost, 2").props.onPress, f.button("3 comments").props.onPress,
    f.button("Open News desk profile").props.onPress, f.button("Open Fixture Artist's profile").props.onPress,
    f.button("Report").props.onPress, f.source().props.onPress, f.button("Share this story").props.onPress];
  const old = capture(); f.hide(); const hidden = capture(); for (const callback of [...old, ...hidden]) f.act(callback);
  f.show(); for (const callback of [...old, ...hidden]) f.act(callback);
  assert.deepEqual(f.calls, []); assert.deepEqual(f.likes, []); assert.deepEqual(f.saves, []);
  assert.ok(!f.all().some(node => node.type === "Modal"));
  f.act(f.button("4 likes").props.onPress); f.act(f.button("Repost, 2").props.onPress); f.act(f.source().props.onPress);
  assert.equal(f.likes.length, 1); assert.equal(f.saves.length, 1); assert.deepEqual(f.calls, [["external", "https://fixture.invalid/article"]]);
});

test("News metadata follows the feed surface while sources, controls and signature remain", t => {
  const f = fixture(); t.after(f.close);
  const text = () => f.all().map(node => node.text || "").join("");
  const original = text();
  f.render({ showPostMeta: false });
  assert.notEqual(text(), original, "For You omits the published age");
  assert.ok(f.button("4 likes")); assert.ok(f.button("3 comments")); assert.ok(f.source());
  assert.equal(f.all().filter(node => node.props?.testID === "post-brand").length, 1);
  f.render({ showPostMeta: true });
  assert.equal(text(), original, "profile and News surfaces retain publication metadata");
});

test("actual News reads dynamic presentation retirement before rerender", t => {
  const f = fixture(); t.after(f.close); f.retire();
  f.act(f.button("4 likes").props.onPress); f.act(f.button("Repost, 2").props.onPress); f.act(f.source().props.onPress);
  assert.deepEqual(f.calls, []); assert.deepEqual(f.likes, []); assert.deepEqual(f.saves, []);
});

test("actual News pending mutations cannot publish stale failures or release fresh pending saves after Back", async t => {
  const f = fixture(); t.after(f.close);
  f.act(f.button("4 likes").props.onPress); f.act(f.button("Repost, 2").props.onPress); f.hide(); f.show();
  f.act(f.button("4 likes").props.onPress); f.act(f.button("Repost, 2").props.onPress);
  await f.settle(() => { f.likes[0].reject(new Error("fixture failure")); f.saves[0].resolve({ ok: true, reposted: true, reposts: 99 }); });
  assert.equal(f.button("4 likes").props.disabled, true); assert.equal(f.button("Repost, 2").props.disabled, true);
  assert.ok(!f.all().some(node => typeof node.props?.children === "string" && /wasn't saved|Not saved/.test(node.props.children)));
  await f.settle(() => { f.likes[1].resolve({ ok: false }); f.saves[1].resolve({ ok: true, reposted: true, reposts: 3 }); });
  assert.ok(f.all().some(node => node.props?.children === "That change wasn't saved. Please try again."));
  assert.ok(f.button("Undo repost, 3"));
});

test("actual News delete confirmation is retired across cover-return, and deliberate current deletion still requires confirmation", t => {
  const f = fixture({ own: true }); t.after(f.close); const old = f.button("Delete").props.onPress;
  f.act(old); assert.equal(f.deletions.length, 0); const confirm = f.alerts[0][2].find(button => button.style === "destructive").onPress;
  f.hide(); f.show(); f.act(old); f.act(confirm); assert.equal(f.alerts.length, 1); assert.equal(f.deletions.length, 0);
  f.act(f.button("Delete").props.onPress); assert.equal(f.alerts.length, 2); assert.equal(f.deletions.length, 0);
  f.act(f.alerts[1][2].find(button => button.style === "destructive").onPress); assert.equal(f.deletions.length, 1);
});

test("actual News share preview closes on cover and old triggers cannot reopen it", t => {
  const f = fixture(); t.after(f.close); const share = f.button("Share this story").props.onPress;
  f.act(share); assert.ok(f.all().some(node => node.type === "Modal")); f.hide(); assert.ok(!f.all().some(node => node.type === "Modal"));
  f.show(); f.act(share); assert.ok(!f.all().some(node => node.type === "Modal"));
  f.act(f.button("Share this story").props.onPress); assert.ok(f.all().some(node => node.type === "Modal"));
});

for (const transition of ["account", "post", "removed", "blocked", "suspend"]) test(`actual News ${transition} round trip does not revive queued callbacks`, t => {
  const f = fixture(); t.after(f.close); const old = f.button("4 likes").props.onPress, source = f.source().props.onPress;
  if (transition === "account") { f.account("other"); f.account("viewer"); }
  if (transition === "post") { f.render({ story: { ...story, postId: "other" } }); f.render({ story }); }
  if (transition === "removed") { f.privacy({ removedIds: [story.postId] }); f.privacy({ removedIds: [] }); }
  if (transition === "blocked") { f.privacy({ blockedIds: ["author"] }); f.privacy({ blockedIds: [] }); }
  if (transition === "suspend") { f.render({ suspend: true }); f.render({ suspend: false }); }
  f.act(old); f.act(source); assert.deepEqual(f.calls, []); assert.deepEqual(f.likes, []);
  f.act(f.button("4 likes").props.onPress); assert.equal(f.likes.length, 1);
});

test("actual full News detail without a Feed lease retains source links and member actions", t => {
  const f = fixture({ full: true, unscoped: true }); t.after(f.close);
  f.act(f.source().props.onPress); f.act(f.button("4 likes").props.onPress);
  assert.equal(f.calls.length, 1); assert.equal(f.likes.length, 1);
  const old = f.source().props.onPress; f.close(); f.act(old); assert.equal(f.calls.length, 1);
});

test("actual compact News cards remain public with omitted accountId but retire hidden taps", t => {
  const f = fixture({ compact: true }); t.after(f.close);
  const button = () => f.find(node => node.type === "Pressable"); const old = button().props.onPress;
  f.act(old); assert.equal(f.calls.length, 1); f.hide(); f.show(); f.act(old); assert.equal(f.calls.length, 1);
  f.act(button().props.onPress); assert.equal(f.calls.length, 2);
});

test("actual guest News Like and Repost ask for authentication only from current visible controls", t => {
  const f = fixture({ guest: true }); t.after(f.close); const old = f.button("4 likes").props.onPress;
  f.hide(); f.show(); f.act(old); assert.deepEqual(f.calls, []);
  f.act(f.button("4 likes").props.onPress); f.act(f.button("Repost, 2").props.onPress);
  assert.deepEqual(f.calls, [["onRequireAuth"], ["onRequireAuth"]]); assert.deepEqual(f.likes, []); assert.deepEqual(f.saves, []);
});


for (const strict of [false, true]) test(`production Feed admission and News ownership compose on first mount and Back, strict=${strict}`, async t => {
  const f = fixture({ composed: true, strict }); t.after(f.close);
  const oldSource = f.source().props.onPress, oldLike = f.button("4 likes").props.onPress;
  f.act(oldLike); f.act(oldSource); assert.equal(f.likes.length, 1); assert.equal(f.calls.length, 1);
  f.hide(); f.act(oldLike); f.act(oldSource); assert.equal(f.likes.length, 1); assert.equal(f.calls.length, 1);
  f.show(); f.act(oldLike); f.act(oldSource); assert.equal(f.likes.length, 1); assert.equal(f.calls.length, 1);
  f.act(f.button("4 likes").props.onPress); f.act(f.source().props.onPress);
  assert.equal(f.likes.length, 2, "newly admitted News mutations work without another parent update"); assert.equal(f.calls.length, 2);
  await f.settle(() => f.likes[0].resolve({ ok: false }));
  assert.equal(f.button("4 likes").props.disabled, true, "old completion cannot release a fresh save");
  f.act(f.button("Share this story").props.onPress); assert.ok(f.all().some(node => node.type === "Modal"));
});


for (const mode of ["compact", "card", "full"]) test(`actual iOS News ${mode} raw editorial and artist images stay static through cover-return`, t => {
  const f = fixture({ compact: mode === "compact", full: mode === "full" }); t.after(f.close);
  f.render({ story: { ...story, media: [{ kind: "image", url: "https://fixture.invalid/editorial.gif" }],
    artists: [{ key: "fixture-artist", name: "Fixture Artist", photo: "https://fixture.invalid/artist.webp" }] } });
  const assertStatic = () => {
    const images = f.all().filter(node => node.type === "ExpoImage");
    assert.equal(images.length, mode === "compact" ? 1 : 2, "cover both editorial and artist raw Image paths");
    for (const image of images) assert.equal(image.props.autoplay, false);
  };
  assertStatic(); f.hide(); assertStatic(); f.show(); assertStatic();
});
