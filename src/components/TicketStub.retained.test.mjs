import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const React = require("react");
const reconciler = require("react-reconciler");
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

const compiled = new Map();
const compile = path => {
  if (!compiled.has(path)) compiled.set(path, transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), {
    babelrc: false, configFile: false,
    plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
  }).code);
  return compiled.get(path);
};
const nodes = node => [node, ...(node.children || []).flatMap(nodes)];
const review = { id: "fixture-post", userId: "author", user: { name: "Author", handle: "author" },
  kind: "review", artist: "Fixture artist", venue: "Fixture venue", date: "2026-11-01", review: "A fixture concert", overall: 4,
  likes: 3, reposts: 2, photos: ["https://fixture.invalid/photo.jpg"], taggedPeople: [{ id: "viewer", name: "Viewer", handle: "viewer" }] };

// Run actual production components and platform hook through React commits.
// Native effects, store writes, timers, and network boundaries are synthetic.
function fixture({ strict = false, own = false, guest = false, detail = false, composed = false, managed = false, log = review } = {}) {
  const renderer = createRenderer();
  const Preview = React.createContext(false), City = React.createContext(null);
  let reducedMotion = false;
  let privacy = 0;
  const lifecycleToken = Object.freeze({});
  const detailCurrent = () => true;
  const makeDetail = () => {
    const revision = privacy;
    return { managed, active: true, current: detailCurrent, token: lifecycleToken,
      canAct: () => privacy === revision, commandToken: Object.freeze({}) };
  };
  let detailPresentation = makeDetail();
  const calls = [], saves = [], tags = [], retries = [], checks = [], sheets = [], speech = [], alerts = [], shareLoads = [], timers = new Set();
  const pending = (list, args) => new Promise((resolve, reject) => list.push({ args, resolve, reject }));
  const store = { session: guest ? null : { id: own ? "author" : "viewer" }, userById: () => null, userBadges: () => [], commentsFor: () => [],
    likeInfo: () => ({ count: 3, liked: false }), toggleLike: (...args) => { calls.push(["like", ...args]); return Promise.resolve({ ok: true }); },
    setPostRepost: (...args) => pending(saves, args), deleteOwnPost: (...args) => calls.push(["deleteFallback", ...args]),
    refreshFeed: () => calls.push(["refresh"]),
  };
  const color = new Proxy({}, { get: (_, key) => String(key) });
  const modules = {
    react: React, "react/jsx-runtime": require("react/jsx-runtime"),
    "./useIOSDetailPresentation": () => detailPresentation, "../hooks/useIOSDetailPresentation": () => detailPresentation,
    "react-native": { useWindowDimensions: () => ({ width: 390, fontScale: 1 }), View: "View", Text: "Text", Pressable: "Pressable", Modal: "Modal", ActivityIndicator: "ActivityIndicator", Platform: { OS: "ios" },
      StyleSheet: { create: value => value, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 0.5 },
      Alert: { alert: (...args) => alerts.push(args) }, AccessibilityInfo: { announceForAccessibility: value => speech.push(value) }, Linking: { openURL: url => calls.push(["external", url]) } },
    "expo-image": { Image: "ExpoImage" },
    "../theme": { colors: color, radius: {}, shadow: {}, glow: {}, space: value => value, roleColor: () => null },
    "../store": { useStore: () => store }, "../config/runtime.mjs": { ENABLE_MUSIC_PLAYER: false },
    "../hooks/useReducedMotion": () => reducedMotion, "../hooks/useNativeTabPreview": () => React.useContext(Preview),
    "../lib/useAppActive": () => true,
    "../lib/lazyWithRetry": { lazyWithRetry: (_load, name) => name, loadChunk: (_, options) => { shareLoads.push(options); return new Promise(noop); } },
    "../lib/convertingClipsApi": { checkConvertingClip: (...args) => pending(checks, args), retryConvertingClip: (...args) => pending(retries, args) },
    "../components/showIOSPostActions": (options, choose) => sheets.push({ options, choose }),
    "./PublicWebLinks": { PublicPressableLink: "PublicPressableLink", PublicTextLink: "PublicTextLink" },
    "./Badge": { BadgeRow: "BadgeRow" }, "./cities/CityNavigationContext": { CityNavigationContext: City },
    "../cityIdentity.js": { cityIdentityForLocation: () => null },
    "./NativeSwipeRail": "NativeSwipeRail",
    "react-native-gesture-handler": { Gesture: {}, GestureDetector: "GestureDetector" },
    "./nativeTabSwipeContext.mjs": require("./nativeTabSwipeContext.mjs"),
  };
  const real = { "../hooks/usePostCardData.ios": "../hooks/usePostCardData.ios.js", "../hooks/useTicketPresentation": "../hooks/useTicketPresentation.ios.js",
    "./RetainedPostSwipeActions.ios.jsx": "./RetainedPostSwipeActions.ios.jsx", "./NativeTabSwipeExclusion": "./NativeTabSwipeExclusion.ios.jsx",
    "./SocialReactionButtons": "./SocialReactionButtons.ios.jsx", "./PostSwipeActions": "./PostSwipeActions.ios.jsx",
    "./ConvertingClipNotice": "./ConvertingClipNotice.ios.jsx", "./SocialShareStudio": "./SocialShareStudio.ios.jsx" };
  const load = path => {
    const module = { exports: {} };
    const moduleRequire = name => {
      if (name in modules) return modules[name];
      if (name in real) return modules[name] = load(real[name]);
      if (name.startsWith("./")) return name.slice(2);
      return require(name);
    };
    const timer = callback => { timers.add(callback); return callback; };
    new Function("require", "module", "exports", "setInterval", "clearInterval", "setTimeout", "clearTimeout", compile(path))
      (moduleRequire, module, module.exports, timer, token => timers.delete(token), timer, token => timers.delete(token));
    return module.exports;
  };
  const TicketStub = load("./TicketStub.ios.jsx").default;
  const useFeedPresentation = composed ? load("../hooks/useFeedPresentation.ios.js").default : null;
  let presentation = { active: true, current() { return this.active; } };
  let props = { log, compactContent: true, swipeActions: true,
    ...(detail ? {} : { mediaViewable: true, contextPresentation: presentation }),
    ...Object.fromEntries(["onOpen", "onOpenPost", "onOpenShow", "onComment", "onRequireAuth", "onOpenProfile", "onOpenArtist", "onOpenArtistArchive", "onOpenVenue", "onOpenPhotos", "onReport", "onEdit", "onDelete", "onNotInterested", "onSelfTagRemoved"]
      .map(name => [name, (...args) => calls.push([name, ...args])])),
    onRemoveMyPostTag: (...args) => pending(tags, args),
  };
  let preview = false;
  const suspended = new Promise(noop);
  function FeedOwner(input) {
    const { current } = useFeedPresentation({ active: !preview, presentation: input.contextPresentation,
      scope: store.session?.id || "guest" });
    const cardPresentation = React.useMemo(() => ({ current }), [current]);
    return React.createElement(TicketStub, { ...input, contextPresentation: cardPresentation });
  }
  function Gate({ suspend, ...input }) { if (suspend) throw suspended; return React.createElement(composed ? FeedOwner : TicketStub, input); }
  const f = { calls, saves, tags, retries, checks, sheets, speech, alerts, shareLoads, timers, store,
    render(update = {}) { props = { ...props, ...update }; React.act(() => renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null,
      React.createElement(Preview.Provider, { value: preview }, React.createElement(React.Suspense, { fallback: null }, React.createElement(Gate, props)))))); },
    all: () => nodes(renderer.container),
    find: predicate => { const node = nodes(renderer.container).find(predicate); assert.ok(node, "real component control must be rendered"); return node; },
    button: prefix => f.find(node => node.props?.accessibilityLabel?.startsWith(prefix)),
    act: callback => React.act(() => renderer.act(callback)),
    obscure() { presentation.active = false; presentation = { active: false, current() { return this.active; } }; preview = true; f.render({ mediaViewable: false, contextPresentation: presentation }); },
    reveal() { presentation.active = false; presentation = { active: true, current() { return this.active; } }; preview = false; f.render({ mediaViewable: true, contextPresentation: presentation }); },
    retireWithoutRender() { presentation.active = false; },
    privacyRevoke() { privacy++; },
    freshPrivacy() { detailPresentation = makeDetail(); f.render(); },
    detailCurrent,
    motion(value) { reducedMotion = value; f.render(); },
    async settle(callback) { await React.act(async () => { renderer.act(callback); for (let i = 0; i < 6; i++) await Promise.resolve(); }); },
    close: () => React.act(() => renderer.render(null)),
  };
  f.render(); return f;
}

for (const strict of [false, true]) test(`real retained card Like callbacks expire while hidden and after Back (StrictMode ${strict})`, t => {
  const f = fixture({ strict }); t.after(f.close);
  const card = f.all()[1], old = f.button("Like,").props.onPress;
  f.act(old); assert.equal(f.calls.length, 1);
  f.obscure(); const hidden = f.button("Like,").props.onPress;
  f.act(old); f.act(hidden); assert.equal(f.calls.length, 1);
  f.reveal(); assert.equal(f.all()[1], card, "the card itself is retained");
  f.act(old); f.act(hidden); assert.equal(f.calls.length, 1);
  f.act(f.button("Like,").props.onPress); assert.equal(f.calls.length, 2);
});

test("real native card guards dynamically before its next render and preserves active detail Like", t => {
  const f = fixture(); t.after(f.close); const old = f.button("Like,").props.onPress;
  f.retireWithoutRender(); f.act(old); assert.deepEqual(f.calls, []);
  const detail = fixture({ detail: true }); t.after(detail.close);
  detail.act(detail.button("Like,").props.onPress); assert.deepEqual(detail.calls, [["like", review.id, 3]]);
});

for (const scope of ["account", "post"]) test(`real card ${scope} A-B-A cannot revive captured Like or navigation`, t => {
  const f = fixture(); t.after(f.close);
  const old = f.button("Like,").props.onPress, media = f.find(node => node.type === "PostMediaGrid").props.onOpen;
  if (scope === "account") { f.store.session = { id: "other" }; f.render(); f.store.session = { id: "viewer" }; f.render(); }
  else { f.render({ log: { ...review, id: "other" } }); f.render({ log: review }); }
  f.act(old); f.act(() => media(0)); assert.deepEqual(f.calls, []);
  f.act(f.button("Like,").props.onPress); assert.equal(f.calls.length, 1);
});

test("real card layout cleanup and reconnect never revive pre-suspend callbacks", t => {
  const f = fixture(); t.after(f.close); const old = f.button("Like,").props.onPress;
  f.render({ suspend: true }); f.act(old); f.render({ suspend: false }); f.act(old); assert.deepEqual(f.calls, []);
  f.act(f.button("Like,").props.onPress); assert.equal(f.calls.length, 1);
  const last = f.button("Like,").props.onPress; f.close(); f.act(last); assert.equal(f.calls.length, 1);
});

test("real Repost rejects hidden queued actions and old save completion cannot release a newer save", async t => {
  const f = fixture(); t.after(f.close); const old = f.button("Repost,").props.onPress;
  f.act(old); assert.equal(f.saves.length, 1);
  f.obscure(); const hidden = f.button("Repost,").props.onPress; f.act(old); f.act(hidden);
  f.reveal(); f.act(old); f.act(hidden); assert.equal(f.saves.length, 1);
  f.act(f.button("Repost,").props.onPress); assert.equal(f.saves.length, 2);
  await f.settle(() => f.saves[0].resolve({ ok: true, reposted: true, reposts: 99 }));
  assert.equal(f.button("Repost,").props.disabled, true); assert.equal(f.button("Repost,").props.accessibilityLabel, "Repost, 2");
  f.act(f.button("Repost,").props.onPress); assert.equal(f.saves.length, 2);
  await f.settle(() => f.saves[1].resolve({ ok: true, reposted: true, reposts: 3 }));
  assert.equal(f.button("Undo repost,").props.accessibilityLabel, "Undo repost, 3");
});

test("real delayed Repost failure remains silent while obscured, and returning allows deliberate retry", async t => {
  const f = fixture(); t.after(f.close); f.act(f.button("Repost,").props.onPress);
  f.obscure(); await f.settle(() => f.saves[0].reject(new Error("fixture failure")));
  assert.ok(!f.all().some(node => node.props?.children === "Not saved. Try again."));
  f.reveal(); assert.equal(f.button("Repost,").props.disabled, false);
  f.act(f.button("Repost,").props.onPress); assert.equal(f.saves.length, 2);
});

test("real swipe save and undo callbacks retire with the retained Feed presentation", async t => {
  const f = fixture(); t.after(f.close); const old = f.find(node => node.type === "NativeSwipeRail").props.onCommit;
  f.act(() => old("negative")); f.obscure(); f.reveal();
  f.act(() => old("negative")); assert.equal(f.saves.length, 1);
  await f.settle(() => f.saves[0].resolve({ ok: true }));
  assert.ok(!f.all().some(node => node.props?.accessibilityLabel === "Undo this repost")); assert.deepEqual(f.speech, []);
  f.act(() => f.find(node => node.type === "NativeSwipeRail").props.onCommit("negative"));
  await f.settle(() => f.saves[1].resolve({ ok: true }));
  const undo = f.button("Undo this repost").props.onPress; f.obscure(); f.reveal(); f.act(undo);
  assert.equal(f.saves.length, 2);
});

test("real tag mutation completion and queued media/profile controls stay silent after hide-return", async t => {
  const f = fixture(); t.after(f.close);
  const remove = f.button("Remove your tag").props.onPress;
  const media = f.find(node => node.type === "PostMediaGrid").props.onOpen;
  f.act(remove); assert.equal(f.tags.length, 1); f.obscure(); f.reveal();
  f.act(remove); f.act(() => media(0)); assert.equal(f.tags.length, 1);
  await f.settle(() => f.tags[0].resolve({ ok: false, error: { message: "fixture failure" } }));
  assert.deepEqual(f.calls, []); assert.deepEqual(f.alerts, []);
  f.act(f.button("Remove your tag").props.onPress); assert.equal(f.tags.length, 2);
  await f.settle(() => f.tags[1].resolve({ ok: true })); assert.equal(f.calls[0][0], "onSelfTagRemoved");
});

test("real conversion retries cannot replay after hide-return or refresh from a retired completion", async t => {
  const f = fixture({ own: true, log: { ...review, convertingMedia: [{ id: "clip", state: "failed" }] } }); t.after(f.close);
  const retry = f.button("Try converting").props.onPress; f.act(retry); assert.equal(f.retries.length, 1);
  f.obscure(); const hidden = f.button("Try converting").props.onPress; f.act(hidden); f.reveal(); f.act(retry); f.act(hidden);
  assert.equal(f.retries.length, 1); await f.settle(() => f.retries[0].resolve("ready")); assert.deepEqual(f.calls, []);
  f.act(f.button("Try converting").props.onPress); assert.equal(f.retries.length, 2);
  await f.settle(() => f.retries[1].resolve("ready")); assert.deepEqual(f.calls, [["refresh"]]);
});

test("real share editor closes on concealment and captured triggers cannot reopen it after Back", t => {
  const f = fixture(); t.after(f.close); const old = f.button("Share review").props.onPress;
  assert.deepEqual(f.shareLoads, [], "retained cards do not load the heavy share editor eagerly");
  f.act(old); assert.ok(f.all().some(node => node.type === "Modal"));
  assert.deepEqual(f.shareLoads, [{ name: "SocialShareModal", reload: null }]);
  f.obscure(); const hidden = f.button("Share review").props.onPress; f.act(hidden);
  assert.ok(!f.all().some(node => node.type === "Modal")); f.reveal(); f.act(old); f.act(hidden);
  assert.ok(!f.all().some(node => node.type === "Modal"));
  assert.equal(f.shareLoads.length, 1, "hidden and retired triggers cannot load another editor");
  f.act(f.button("Share review").props.onPress);
  assert.ok(f.all().some(node => node.type === "Modal"));
});

test("real animated campaign background pauses on retained concealment and resumes only in the new presentation", t => {
  const campaign = { ...review, kind: "status", campaign: { version: 1, treatment: "after-dark", backgroundAssetId: "ma_fixture_art" },
    photos: ["https://fixture.invalid/art.gif"], media: [{ id: "ma_fixture_art", kind: "image", uri: "https://fixture.invalid/art.gif", status: "ready" }] };
  const f = fixture({ log: campaign }); t.after(f.close);
  const image = () => f.find(node => node.type === "ExpoImage" && node.props.contentFit === "cover");
  const node = image(), display = node.props.onDisplay;
  assert.equal(node.props.autoplay, true); assert.equal(node.animations.at(-1), "play");
  f.obscure(); assert.equal(image(), node); assert.equal(node.props.autoplay, false); assert.equal(node.animations.at(-1), "stop");
  const count = node.animations.length; f.act(display); assert.equal(node.animations.length, count, "queued display cannot resume obscured media");
  f.reveal(); assert.equal(node.props.autoplay, true); assert.equal(node.animations.at(-1), "play");
  const returned = node.animations.length; f.act(display); assert.equal(node.animations.length, returned, "old display cannot drive new presentation");
  const currentDisplay = node.props.onDisplay;
  f.motion(true); assert.equal(node.props.autoplay, false); assert.equal(node.animations.at(-1), "stop");
  f.act(currentDisplay); assert.equal(node.animations.at(-1), "stop", "queued display observes the latest motion preference");
  f.motion(false); assert.equal(node.animations.at(-1), "play");
});

test("real guest callbacks remain public but cannot request authentication from a hidden old card", t => {
  const f = fixture({ guest: true }); t.after(f.close);
  const like = f.button("Like,").props.onPress, repost = f.button("Repost,").props.onPress;
  f.obscure(); f.reveal(); f.act(like); f.act(repost); assert.deepEqual(f.calls, []);
  f.act(f.button("Like,").props.onPress); f.act(f.button("Repost,").props.onPress);
  assert.deepEqual(f.calls, [["onRequireAuth"], ["onRequireAuth"]]); assert.deepEqual(f.saves, []);
});


test("media viewability alone expires old controls even when the same navigation presentation returns", t => {
  const f = fixture(); t.after(f.close); const old = f.button("Like,").props.onPress;
  f.render({ mediaViewable: false }); const hidden = f.button("Like,").props.onPress;
  f.act(old); f.act(hidden); f.render({ mediaViewable: true }); f.act(old); f.act(hidden);
  assert.deepEqual(f.calls, []); f.act(f.button("Like,").props.onPress); assert.equal(f.calls.length, 1);
});

test("real pending saves cannot publish after account A-B-A even while the card remains mounted", async t => {
  const f = fixture(); t.after(f.close); const old = f.button("Repost,").props.onPress;
  f.act(old); f.store.session = { id: "other" }; f.render(); f.store.session = { id: "viewer" }; f.render();
  f.act(old); assert.equal(f.saves.length, 1);
  await f.settle(() => f.saves[0].resolve({ ok: true, reposted: true, reposts: 99 }));
  assert.equal(f.button("Repost,").props.accessibilityLabel, "Repost, 2");
  f.act(f.button("Repost,").props.onPress); assert.equal(f.saves.length, 2);
});

test("real native action sheet and confirmation callbacks remain retired after Back", t => {
  const f = fixture({ own: true }); t.after(f.close);
  const hold = f.find(node => typeof node.props?.onLongPress === "function").props.onLongPress;
  f.act(hold); const sheet = f.sheets[0];
  f.act(() => sheet.choose(sheet.options.options.indexOf("Delete post")));
  const confirm = f.alerts[0][2].find(button => button.style === "destructive").onPress;
  f.obscure(); f.reveal(); f.act(hold); f.act(confirm);
  assert.equal(f.sheets.length, 1); assert.deepEqual(f.calls, []);
  f.act(f.find(node => typeof node.props?.onLongPress === "function").props.onLongPress);
  assert.equal(f.sheets.length, 2);
});

test("real conversion polling aborts when hidden and old ready results cannot refresh the returned Feed", async t => {
  const f = fixture({ own: true, log: { ...review, convertingMedia: [{ id: "clip", state: "processing" }] } }); t.after(f.close);
  assert.equal(f.checks.length, 1); f.obscure(); assert.equal(f.checks[0].args[1].signal.aborted, true);
  for (const callback of f.timers) f.act(callback); assert.equal(f.checks.length, 1);
  f.reveal(); assert.equal(f.checks.length, 2);
  await f.settle(() => f.checks[0].resolve("ready")); assert.deepEqual(f.calls, []);
  await f.settle(() => f.checks[1].resolve("ready")); assert.deepEqual(f.calls, [["refresh"]]);
});


for (const strict of [false, true]) test(`production Feed admission and Ticket ownership compose on first mount and Back, strict=${strict}`, t => {
  const f = fixture({ composed: true, strict }); t.after(f.close);
  const old = f.button("Like,").props.onPress; f.act(old);
  assert.equal(f.calls.length, 1, "the first committed Feed admits card actions without an unrelated update");
  f.obscure(); f.act(old); assert.equal(f.calls.length, 1);
  f.reveal(); f.act(old); assert.equal(f.calls.length, 1);
  f.act(f.button("Like,").props.onPress); assert.equal(f.calls.length, 2, "Back publishes usable new controls");
  const returned = f.button("Like,").props.onPress; f.render({ suspend: true }); f.render({ suspend: false });
  f.act(returned); assert.equal(f.calls.length, 2); f.act(f.button("Like,").props.onPress); assert.equal(f.calls.length, 3);
});

test("production Feed admission starts campaign animation after parent layout and restarts it after Back", t => {
  const log = { ...review, kind: "status", photos: ["https://fixture.invalid/art.gif"],
    media: [{ id: "ma_fixture_art", kind: "image", uri: "https://fixture.invalid/art.gif", status: "ready" }],
    campaign: { version: 1, treatment: "after-dark", backgroundAssetId: "ma_fixture_art" } };
  const f = fixture({ composed: true, log }); t.after(f.close);
  const node = f.find(node => node.type === "ExpoImage" && node.props.contentFit === "cover");
  assert.equal(node.props.autoplay, true); assert.equal(node.animations.at(-1), "play");
  f.obscure(); assert.equal(node.props.autoplay, false); assert.equal(node.animations.at(-1), "stop");
  f.reveal(); assert.equal(node.props.autoplay, true); assert.equal(node.animations.at(-1), "play");
});


test("actual retained Ticket rejects privacy-stale commands while receipt current remains true", t => {
  const f = fixture({ managed: true }); t.after(f.close);
  const oldLike = f.button("Like,").props.onPress;
  f.privacyRevoke(); assert.equal(f.detailCurrent(), true);
  f.act(oldLike); assert.deepEqual(f.calls, []);
  f.freshPrivacy(); f.act(oldLike); assert.deepEqual(f.calls, []);
  f.act(f.button("Like,").props.onPress); assert.equal(f.calls.length, 1);
});
test("actual share modal closes across privacy commands and never reopens from a stale trigger", t => {
  const f = fixture({ managed: true }); t.after(f.close);
  const open = f.button("Share review").props.onPress;
  f.act(open); assert.ok(f.all().some(node => node.type === "Modal"));
  f.privacyRevoke(); f.freshPrivacy();
  assert.ok(!f.all().some(node => node.type === "Modal"));
  f.act(open); assert.ok(!f.all().some(node => node.type === "Modal"));
  f.act(f.button("Share review").props.onPress);
  assert.ok(f.all().some(node => node.type === "Modal"));
});
