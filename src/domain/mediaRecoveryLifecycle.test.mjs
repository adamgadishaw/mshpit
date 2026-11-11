import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const rootUrl = new URL("../../", import.meta.url);
const require = createRequire(new URL("package.json", rootUrl));
const React = require("react");
const reconciler = require("react-reconciler");
const { transformSync } = require("@babel/core");
const componentFile = new URL("src/screens/ClipsScreen.jsx", rootUrl);
const componentRequire = createRequire(componentFile);

// Keep the host style API faithful to the installed React Native version.
// RN 0.86 exposes absoluteFill; the removed alias must not be mocked back in.
const styleFile = new URL("node_modules/react-native/Libraries/StyleSheet/StyleSheetExports.js", rootUrl);
const styleSource = readFileSync(styleFile, "utf8");
const styleAst = require("@babel/parser").parse(styleSource, { sourceType: "module", plugins: ["flow"] });
let absoluteFill, styleKeys;
function visit(node, inspect) {
  if (!node || typeof node !== "object") return;
  inspect(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => visit(child, inspect));
    else if (value && typeof value === "object") visit(value, inspect);
  }
}
visit(styleAst, (node) => {
  if (node.type === "VariableDeclarator" && node.id.name === "absoluteFill") {
    absoluteFill = new Function(`return (${styleSource.slice(node.init.start, node.init.end)});`)();
  }
  if (node.type === "ExportDefaultDeclaration" && node.declaration.type === "ObjectExpression") {
    styleKeys = node.declaration.properties.map((property) => property.key?.name);
  }
});
assert.ok(absoluteFill && styleKeys.includes("absoluteFill"));
assert.equal(styleKeys.includes("absoluteFillObject"), false);

function compile(file, extra = "") {
  return transformSync(readFileSync(file, "utf8") + extra, {
    filename: file.pathname, configFile: false, babelrc: false,
    plugins: [
      ...(file.pathname.endsWith(".ts") ? [require("@babel/plugin-transform-typescript")] : []),
      [require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }],
      require("@babel/plugin-transform-modules-commonjs"),
    ],
  }).code;
}

function execute(code, imports) {
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(imports, module, module.exports);
  return module.exports;
}

// Exercise the installed Expo hook: its initialValue is used only on mount,
// so a source replacement alone does not clear a prior player's last event.
const expoEvents = execute(compile(new URL("node_modules/expo/src/hooks/useEvent.ts", rootUrl)),
  (name) => name === "react" ? React : require(name));
const componentCode = compile(componentFile, "\nexport { ClipPage };");

const noop = () => {};
function createRenderer(videoElement = null) {
  const context = {}, container = { children: [] };
  let priority = 0;
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
      type, props, children: [], ...(type === "VideoView" && videoElement ? { nativeRef: { current: videoElement } } : {}),
    }), createTextInstance: (text) => ({ text }),
    appendInitialChild: append, appendChild: append, appendChildToContainer: append,
    removeChild: remove, removeChildFromContainer: remove, insertBefore: insert, insertInContainerBefore: insert,
    finalizeInitialChildren: () => false, shouldSetTextContent: () => false,
    commitUpdate: (node, type, oldProps, newProps) => { node.props = newProps; },
    commitTextUpdate: (node, oldText, text) => { node.text = text; },
    hideInstance: node => { node.hidden = true; }, unhideInstance: node => { node.hidden = false; },
    hideTextInstance: node => { node.hidden = true; }, unhideTextInstance: node => { node.hidden = false; },
    clearContainer: (node) => { node.children = []; }, resetTextContent: noop, commitMount: noop,
    scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1,
    supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
    getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: (value) => { priority = value; },
    resolveUpdatePriority: () => priority || 32, shouldAttemptEagerTransition: () => false,
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
    container,
    render(element) { renderer.updateContainerSync(element, root, null, null); flush(); },
    act(callback) { renderer.flushSyncFromReconciler(callback); flush(); },
  };
}

const nodes = (node) => node.hidden ? [] : [node, ...(node.children || []).flatMap(nodes)];
const frameEvent = { nativeEvent: {}, type: "topFirstFrameRender" };

// The same installed React reconciler/Expo event harness as clipPlaybackLifecycle.
// Render the actual screen and real scoped refresh; mock only native/Store IO.
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = async (f) => { for (let n = 0; n < 8; n++) await Promise.resolve(); await new Promise(setImmediate); f.act(() => {}); };
const textIn = (f, value) => f.tree.some(node => node.text?.includes(value));
const success = (clips = [], nextCursor = null) => ({ ok: true, clips, nextCursor });
const failure = () => ({ ok: false, error: new Error('Synthetic clip failure') });
const clip = (id = 'clip-a') => ({ id, user: {}, clips: [`https://media.example.invalid/${id}.mp4`] });

function clipsFixture(platform = 'ios') {
  const renderer = createRenderer(), requests = [];
  let account = null;
  const hookFile = new URL('src/hooks/useScopedRefresh.js', rootUrl);
  const hookRequire = createRequire(hookFile);
  const hook = execute(compile(hookFile), name => name === 'react' ? React : hookRequire(name));
  const bindings = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { Platform: { OS: platform }, StyleSheet: { create: v => v, absoluteFill },
      View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', FlatList: 'FlatList', useWindowDimensions: () => ({ height: 800 }) },
    'expo-video': {}, '../theme': { colors: {}, radius: {}, shadow: {} },
    '../components/Icon': 'Icon', '../components/Avatar': 'Avatar', '../components/ClipPoster': 'ClipPoster',
    '../components/VinylRefreshBoundary': 'Refresh', '../hooks/useScopedRefresh': hook,
    '../lib/useAppActive': () => true, '../features/feedImpressions/feedImpressionService': { recordFeedImpressionForSession: noop },
    '../store': { useStore: () => ({ session: account ? { id: account } : null, toggleLike: noop, track: noop,
      loadClips: options => { const request = { ...deferred(), options }; requests.push(request); return request.promise; } }) },
  };
  const pageReturnFile = new URL('src/components/PageReturnContext.jsx', rootUrl);
  const pageReturnRequire = createRequire(pageReturnFile);
  bindings['../components/PageReturnContext'] = execute(compile(pageReturnFile),
    name => name in bindings ? bindings[name] : pageReturnRequire(name));
  const Screen = execute(componentCode, name => name in bindings ? bindings[name] : componentRequire(name)).default;
  const f = {
    requests, get tree() { return nodes(renderer.container); },
    get list() { return f.tree.find(node => node.type === 'FlatList'); },
    button: label => f.tree.find(node => node.props?.accessibilityLabel === label),
    render() { renderer.render(React.createElement(Screen)); },
    act(callback) { renderer.act(callback); },
    refresh() { let result; f.act(() => { result = f.tree.find(node => node.type === 'Refresh').props.onRefresh(); }); return result; },
    more() { f.act(() => f.list.props.onScroll({ nativeEvent: { contentOffset: { y: 0 } } })); },
    async complete(request, value) { request.resolve(value); await settle(f); },
    account(value) { account = value; f.render(); },
    close() { renderer.render(null); },
  };
  f.render(); return f;
}

for (const rows of [[], [clip()]]) test(`iOS failed cold load -> successful ${rows.length ? 'nonempty' : 'empty'} head removes obsolete recovery`, async t => {
  const f = clipsFixture(); t.after(() => f.close());
  await f.complete(f.requests[0], failure());
  assert.ok(textIn(f, 'Clips could not load')); assert.ok(f.button('Retry loading clips'));
  f.refresh(); assert.ok(textIn(f, 'Clips could not load'), 'A tap is not a successful recovery.');
  await f.complete(f.requests[1], success(rows));
  assert.equal(textIn(f, 'Clips could not load'), false);
  assert.equal(!!f.button('Retry loading more clips'), false, 'No inert retry with a null cursor.');
  if (rows.length) assert.equal(f.list.props.data.length, 1);
  else assert.ok(textIn(f, 'No clips yet'));
});

test('iOS repeated failed head retries keep current initial recovery and real scoped refresh settles', async t => {
  const f = clipsFixture(); t.after(() => f.close()); await f.complete(f.requests[0], failure());
  for (let n = 0; n < 3; n++) {
    const work = f.refresh(); const request = f.requests.at(-1);
    assert.equal(f.tree.find(node => node.type === 'Refresh').props.refreshing, true);
    await f.complete(request, failure()); assert.equal((await work).ok, false);
    assert.ok(textIn(f, 'Clips could not load')); assert.ok(f.button('Retry loading clips'));
    assert.equal(f.tree.find(node => node.type === 'Refresh').props.refreshing, false);
  }
});

test('iOS superseded successful refresh cannot erase failure retained by the newer failed refresh', async t => {
  const f = clipsFixture(); t.after(() => f.close()); await f.complete(f.requests[0], failure());
  const old = f.refresh(), a = f.requests.at(-1);
  const current = f.refresh(), b = f.requests.at(-1);
  assert.equal(a.options.signal.aborted, true);
  await f.complete(b, failure()); assert.equal((await current).ok, false);
  await f.complete(a, success([clip()])); assert.equal((await old).ok, false);
  assert.ok(textIn(f, 'Clips could not load')); assert.equal(!!f.list, false);
});

test('iOS aborted refresh preserves recovery and late old failure cannot overwrite accepted new success', async t => {
  const f = clipsFixture(); t.after(() => f.close()); await f.complete(f.requests[0], failure());
  const a = f.refresh(), old = f.requests.at(-1);
  f.refresh(); await f.complete(f.requests.at(-1), success());
  await f.complete(old, failure()); await a;
  assert.ok(textIn(f, 'No clips yet')); assert.equal(textIn(f, 'Clips could not load'), false);
});

test('iOS scope replacement/unmount aborts old head work without clearing new failure', async t => {
  const f = clipsFixture(); t.after(() => f.close()); await f.complete(f.requests[0], failure());
  f.refresh(); const old = f.requests.at(-1);
  f.account('other'); assert.equal(old.options.signal.aborted, true);
  await f.complete(f.requests.at(-1), failure()); await f.complete(old, success());
  assert.ok(textIn(f, 'Clips could not load'));
  f.refresh(); const closing = f.requests.at(-1); f.close();
  assert.equal(closing.options.signal.aborted, true); await f.complete(closing, success());
  assert.equal(f.tree.length, 1);
});

for (const rows of [[], [clip('fresh')]]) test(`iOS old pagination error -> successful ${rows.length ? 'nonempty' : 'empty'} replacement head retires its old cursor error`, async t => {
  const f = clipsFixture(); t.after(() => f.close()); await f.complete(f.requests[0], success([clip()], 'page-2'));
  f.more(); await f.complete(f.requests.at(-1), failure()); assert.ok(f.button('Retry loading more clips'));
  f.refresh(); await f.complete(f.requests.at(-1), success(rows));
  assert.equal(!!f.button('Retry loading more clips'), false);
  assert.equal(textIn(f, 'Clips could not load'), false);
  if (!rows.length) assert.ok(textIn(f, 'No clips yet'));
});

test('iOS head refresh aborts pending old pagination; its late failure cannot create recovery after head success', async t => {
  const f = clipsFixture(); t.after(() => f.close()); await f.complete(f.requests[0], success([clip()], 'page-2'));
  f.more(); const page = f.requests.at(-1);
  f.refresh(); const head = f.requests.at(-1); assert.equal(page.options.signal.aborted, true);
  await f.complete(head, success([clip('fresh')])); await f.complete(page, failure());
  assert.equal(!!f.button('Retry loading more clips'), false);
  assert.equal(f.list.props.data[0].post.id, 'fresh');
});

for (const timing of ['before', 'after']) test(`iOS newer pagination failure ${timing} head settlement retains its own recovery`, async t => {
  const f = clipsFixture(); t.after(() => f.close()); await f.complete(f.requests[0], success([clip()], 'page-2'));
  f.more(); await f.complete(f.requests.at(-1), failure());
  f.refresh(); const head = f.requests.at(-1);
  f.more(); const page = f.requests.at(-1); assert.notEqual(head, page);
  if (timing === 'before') await f.complete(page, failure());
  await f.complete(head, success([clip('fresh')], 'fresh-page-2'));
  if (timing === 'after') await f.complete(page, failure());
  assert.ok(f.button('Retry loading more clips')); assert.ok(textIn(f, "Couldn't load more clips"));
  f.act(() => f.button('Retry loading more clips').props.onPress());
  assert.equal(f.requests.at(-1).options.before, 'fresh-page-2');
});

for (const platform of ['android', 'web']) test(`${platform} head refresh preserves the preexisting load-error behavior`, async t => {
  const f = clipsFixture(platform); t.after(() => f.close()); await f.complete(f.requests[0], failure());
  f.refresh(); await f.complete(f.requests[1], success());
  assert.ok(textIn(f, 'Clips could not load'));
});

function videoFixture({ platform = 'ios', viewer = false, strict = false } = {}) {
  const renderer = createRenderer(), opens = [], players = [], activityListeners = new Set(), faults = {};
  const AppState = { currentState: 'active', addEventListener(_event, listener) {
    activityListeners.add(listener); return { remove: () => activityListeners.delete(listener) };
  } };
  let routeCurrent = true, suspended = false, disposed = false;
  const suspension = new Promise(() => {});
  const props = { uri: clip().clips[0], postId: 'post-a', isCurrentIOSRoute: () => routeCurrent };
  const native = {
    AppState, Platform: { OS: platform }, StyleSheet: { create: v => v, absoluteFill },
    Linking: { openURL(uri) { const work = { uri, ...deferred() }; opens.push(work); if (faults.openSync) throw new Error("Synthetic synchronous native failure"); return work.promise; } },
    ...Object.fromEntries(['View', 'Text', 'Pressable', 'Modal'].map(key => [key, key])),
    Animated: { View: 'AnimatedView', ValueXY: class { setValue() {} getTranslateTransform() { return []; } } },
    PanResponder: { create: () => ({ panHandlers: {} }) },
  };
  const common = { react: React, 'react/jsx-runtime': require('react/jsx-runtime'), 'react-native': native };
  const load = (path, bindings = {}) => {
    const file = new URL(path, rootUrl), local = createRequire(file);
    return execute(compile(file), name => name in bindings ? bindings[name] : name in common ? common[name] : local(name));
  };
  const useAppActive = load('src/lib/useAppActive.js');
  const guard = load(`src/hooks/useIOSVideoExternalAction${platform === 'ios' ? '.ios' : ''}.js`);
  const videoBindings = {
    '../../hooks/useIOSVideoExternalAction': guard, '../../lib/useAppActive': useAppActive,
    '../../theme': { colors: {}, radius: {} }, '../Icon': 'Icon', '../ClipPoster': 'ClipPoster', expo: expoEvents,
    'expo-video': { VideoView: 'VideoView', useVideoPlayer(uri, setup) {
      return React.useMemo(() => {
        const listeners = new Map();
        const player = { uri, status: 'error', playing: false, pause: noop,
          addListener(name, listener) { const rows = listeners.get(name) || new Set(); rows.add(listener); listeners.set(name, rows); return { remove: () => rows.delete(listener) }; },
          listenerCount: () => [...listeners.values()].reduce((sum, rows) => sum + rows.size, 0),
        };
        setup(player); players.push(player); return player;
      }, [uri]);
    } },
  };
  const Video = load('src/components/media-player/MshpitVideoPlayer.jsx', videoBindings).default;
  const PhotoViewer = viewer ? load('src/components/PhotoViewer.jsx', {
    '../theme': { colors: {}, radius: {} }, './Icon': 'Icon', './NativePhotoSwipe': 'NativePhotoSwipe', './NativeGestureRoot': 'GestureRoot',
    './SmartImage': 'SmartImage', './media-player/MshpitVideoPlayer': Video,
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
  }).default : null;
  let photos = [clip('a').clips[0], clip('b').clips[0]], viewerIndex = 0;
  let closeCalls = 0, closeIsNoop = false;
  function MaybeSuspend() { if (suspended) throw suspension; return null; }
  const f = {
    opens, players, activityListeners, AppState, faults,
    get tree() { return nodes(renderer.container); },
    get closeCalls() { return closeCalls; },
    get open() { return f.tree.find(n => n.type === 'Pressable' && nodes(n).some(c => c.text === 'Open video')); },
    get error() { return textIn(f, 'This video could not open.'); },
    get player() { return players.at(-1); },
    act(callback) { renderer.act(callback); },
    press() { let work; f.act(() => { work = f.open.props.onPress(); }); return work; },
    render() {
      const element = viewer ? React.createElement(PhotoViewer, { photos, index: viewerIndex, loadMediaReactions: noop, isCurrentIOSRoute: props.isCurrentIOSRoute, onClose: () => { if (!closeIsNoop) routeCurrent = false; closeCalls++; } }) : React.createElement(Video, props);
      renderer.render(React.createElement(strict ? React.StrictMode : React.Fragment, null,
        React.createElement(React.Suspense, { fallback: React.createElement('Fallback') }, element, React.createElement(MaybeSuspend))));
    },
    app(state, notify = true) { AppState.currentState = state; if (notify) for (const listener of [...activityListeners]) listener(state); },
    foreground(state) { f.act(() => f.app(state)); },
    uri(value) { props.uri = value; f.render(); },
    post(value) { props.postId = value; f.render(); },
    retireRoute() { routeCurrent = false; },
    source(value) { photos = value; f.render(); },
    index(value) { viewerIndex = value; f.render(); },
    noopClose(value = true) { closeIsNoop = value; },
    suspend(value) { suspended = value; f.render(); },
    close() { if (disposed) return; disposed = true; renderer.render(null); assert.equal(activityListeners.size, 0); assert.ok(players.every(p => p.listenerCount() === 0)); },
  };
  f.render(); return f;
}

for (const state of ['background', 'inactive', null]) test(`iOS retained external action cannot start while AppState is ${state}`, async t => {
  const f = videoFixture(); t.after(() => f.close()); const old = f.open.props.onPress;
  f.act(() => { f.app(state, false); old(); });
  assert.equal(f.opens.length, 0, 'Read current native activity even before React commits.');
});

for (const strict of [false, true]) test(`iOS current external opening and failure work with ${strict ? 'StrictMode replay' : 'normal mount'}`, async t => {
  const f = videoFixture({ strict }); t.after(() => f.close());
  const work = f.press(); assert.equal(f.opens.length, 1); assert.equal(f.opens[0].uri, clip().clips[0]);
  f.opens[0].reject(new Error('Synthetic OS rejection')); await work; await settle(f); assert.equal(f.error, true);
  const retry = f.press(); assert.equal(f.opens.length, 2); f.opens[1].resolve(); await retry;
});

for (const batched of [false, true]) test(`iOS ${batched ? 'batched' : 'committed'} background round trip permanently retires old controls and pending failure`, async t => {
  const f = videoFixture(); t.after(() => f.close()); const old = f.open.props.onPress;
  const work = f.press();
  if (batched) f.act(() => { f.app('inactive'); f.app('active'); old(); });
  else { f.foreground('background'); f.foreground('active'); f.act(() => old()); }
  assert.equal(f.opens.length, 1);
  f.opens[0].reject(new Error('Late old error')); await work; await settle(f); assert.equal(f.error, false);
  const fresh = f.press(); assert.equal(f.opens.length, 2); f.opens[1].reject(new Error('Current error')); await fresh; await settle(f); assert.equal(f.error, true);
});

test('iOS current URI/post identity and A-B-A replacement cannot revive old external controls or feedback', async t => {
  const f = videoFixture(); t.after(() => f.close()); const old = f.open.props.onPress; const work = f.press();
  const original = f.player.uri; f.uri('https://media.example.invalid/other.mp4'); f.uri(original);
  f.act(() => old()); assert.equal(f.opens.length, 1);
  f.opens[0].reject(new Error('Old media')); await work; await settle(f); assert.equal(f.error, false);
  const sameURI = f.open.props.onPress; f.post('post-b'); f.post('post-a'); f.act(() => sameURI());
  assert.equal(f.opens.length, 1); f.press(); assert.equal(f.opens.length, 2); f.opens[1].resolve();
});

test('iOS root presentation retirement prevents external work before viewer unmount', async t => {
  const f = videoFixture({ viewer: true }); t.after(() => f.close()); const old = f.open.props.onPress; const work = f.press();
  f.retireRoute(); f.act(() => old()); assert.equal(f.opens.length, 1);
  f.opens[0].reject(new Error('Retired route')); await work; await settle(f); assert.equal(f.error, false);
});

test('actual PhotoViewer keyed replacement B and retry reject retained video A callbacks', async t => {
  const f = videoFixture({ viewer: true }); t.after(() => f.close());
  const a = f.open.props.onPress; const pending = f.press();
  f.act(() => f.tree.find(n => n.props?.accessibilityLabel === 'Next media').props.onPress());
  assert.equal(f.player.uri, clip('b').clips[0]); f.act(() => a()); assert.equal(f.opens.length, 1);
  f.opens[0].reject(new Error('Late A')); await pending; await settle(f); assert.equal(f.error, false);
  const b = f.open.props.onPress;
  f.act(() => f.tree.find(n => n.type === 'Pressable' && nodes(n).some(c => c.text === 'Try again')).props.onPress());
  f.act(() => b()); assert.equal(f.opens.length, 1); f.press(); assert.equal(f.opens.length, 2); assert.equal(f.opens[1].uri, clip('b').clips[0]); f.opens[1].resolve();
});

test('iOS Suspense layout hide/reconnect retires captured controls and accepted work while fresh action recovers', async t => {
  const f = videoFixture(); t.after(() => f.close()); const old = f.open.props.onPress; const work = f.press();
  f.suspend(true); f.act(() => old()); assert.equal(f.opens.length, 1);
  f.suspend(false); f.act(() => old()); assert.equal(f.opens.length, 1);
  f.opens[0].reject(new Error('Before hide')); await work; await settle(f); assert.equal(f.error, false);
  const current = f.press(); assert.equal(f.opens.length, 2); f.opens[1].reject(new Error('Fresh error')); await current; await settle(f); assert.equal(f.error, true);
});

test('iOS true unmount rejects old external admission and late failure, cleaning every subscription', async t => {
  const f = videoFixture(); t.after(() => f.close()); const old = f.open.props.onPress, work = f.press();
  f.close(); old(); assert.equal(f.opens.length, 1);
  f.opens[0].reject(new Error('After unmount')); await work; await settle(f); assert.equal(f.tree.length, 1);
});

test('iOS an older same-presentation opening cannot overwrite the newest accepted opening with its failure', async t => {
  const f = videoFixture(); t.after(() => f.close()); const old = f.press(), current = f.press();
  f.opens[1].resolve(); await current; f.opens[0].reject(new Error('Older error')); await old; await settle(f); assert.equal(f.error, false);
});

for (const platform of ['android', 'web']) test(`${platform} external-opening controls retain their original behavior`, async t => {
  const f = videoFixture({ platform }); t.after(() => f.close()); const old = f.open.props.onPress;
  f.foreground('background'); f.act(() => old()); assert.equal(f.opens.length, 1);
  f.opens[0].reject(new Error('Original mounted feedback')); await settle(f); assert.equal(f.error, true);
  f.close(); old(); assert.equal(f.opens.length, 2); f.opens[1].resolve();
});

test('iOS a malformed successful head that cannot be adopted does not erase its initial recovery', async t => {
  const f = clipsFixture(); t.after(() => f.close()); await f.complete(f.requests[0], failure());
  const work = f.refresh(); await f.complete(f.requests.at(-1), { ok: true, clips: null });
  assert.equal((await work).ok, false); assert.ok(textIn(f, 'Clips could not load'));
});

test('iOS stale activity callbacks after layout reconnect cannot revoke the fresh external action or replace its player', async t => {
  const f = videoFixture(); t.after(() => f.close()); const player = f.player;
  const oldListeners = [...f.activityListeners];
  f.suspend(true); f.suspend(false);
  f.act(() => { for (const listener of oldListeners) listener('inactive'); });
  const current = f.press(); assert.equal(f.opens.length, 1); assert.equal(f.player, player);
  f.opens[0].reject(new Error('Current error')); await current; await settle(f); assert.equal(f.error, true);
  f.foreground('background'); f.foreground('active'); assert.equal(f.player, player);
});

test('iOS a synchronous OS open rejection is current feedback without an unhandled exception', async t => {
  const f = videoFixture(); t.after(() => f.close());
  f.faults.openSync = true;
  await f.press(); await settle(f); assert.equal(f.opens.length, 1); assert.equal(f.error, true);
});

for (const label of ['Next media', 'Previous media']) test(`iOS actual ${label} intent revokes A external Open before selection commits`, async t => {
  const f = videoFixture({ viewer: true }); t.after(() => f.close());
  const old = f.open.props.onPress, move = f.tree.find(n => n.props?.accessibilityLabel === label).props.onPress;
  f.act(() => { move(); old(); });
  assert.equal(f.opens.length, 0); assert.equal(f.player.uri, clip('b').clips[0]);
  const current = f.press(); assert.equal(f.opens[0].uri, clip('b').clips[0]); f.opens[0].resolve(); await current;
});

for (const sequence of [['Next media', 'Previous media'], ['Next media', 'Next media']]) test(`iOS batched ${sequence.join('/')} ABA publishes current Open without reviving A's captured control`, async t => {
  const f = videoFixture({ viewer: true }); t.after(() => f.close());
  const old = f.open.props.onPress, player = f.player, work = f.press();
  const moves = sequence.map(label => f.tree.find(n => n.props?.accessibilityLabel === label).props.onPress);
  f.act(() => { moves.forEach(move => { move(); old(); }); });
  assert.equal(f.opens.length, 1); assert.equal(f.player, player, 'Unchanged final selection preserves the Expo player.');
  f.act(() => old()); assert.equal(f.opens.length, 1, 'Same URI must not revive the old intent.');
  f.opens[0].reject(new Error('Before selection intent')); await work; await settle(f); assert.equal(f.error, false);
  const current = f.press(); assert.equal(f.opens.length, 2); assert.equal(f.opens[1].uri, clip('a').clips[0]);
  f.opens[1].reject(new Error('Current paused/error media')); await current; await settle(f); assert.equal(f.error, true);
});

test('iOS unchanged selected index and display-only dots retain legitimate external Open', async t => {
  const f = videoFixture({ viewer: true }); t.after(() => f.close()); const old = f.open.props.onPress, player = f.player;
  f.index(0); f.source([clip('a').clips[0], clip('b').clips[0]]);
  assert.equal(f.player, player);
  const dots = f.tree.filter(n => n.type === 'View' && n.props?.style?.some?.(v => v?.width === 6 && v?.height === 6));
  assert.equal(dots.length, 2);
  for (const dot of dots) assert.equal(dot.props.onPress, undefined, 'Existing dots remain display-only.');
  let current; f.act(() => { current = old(); }); assert.equal(f.opens.length, 1); f.opens[0].resolve(); await current;
});

test('iOS actual retry revokes old Open synchronously and publishes a current replacement action', async t => {
  const f = videoFixture({ viewer: true }); t.after(() => f.close()); const old = f.open.props.onPress, player = f.player;
  const retry = f.tree.find(n => n.type === 'Pressable' && nodes(n).some(c => c.text === 'Try again')).props.onPress;
  f.act(() => { retry(); old(); });
  assert.equal(f.opens.length, 0); assert.notEqual(f.player, player);
  const current = f.press(); assert.equal(f.opens.length, 1); f.opens[0].resolve(); await current;
});

test('iOS captured Close retires the supplied viewer root route before old Open can start in the same batch', t => {
  const f = videoFixture({ viewer: true }); t.after(() => f.close()); const old = f.open.props.onPress;
  const close = f.tree.find(n => n.props?.accessibilityLabel === 'Close').props.onPress;
  f.act(() => { close(); old(); }); assert.equal(f.closeCalls, 1); assert.equal(f.opens.length, 0);
});

test('iOS source replacement and URI ABA reject captured item ownership without breaking current media', async t => {
  const f = videoFixture({ viewer: true }); t.after(() => f.close()); const old = f.open.props.onPress;
  f.source([clip('c').clips[0], clip('b').clips[0]]); f.source([clip('a').clips[0], clip('b').clips[0]]);
  f.act(() => old()); assert.equal(f.opens.length, 0);
  const current = f.press(); assert.equal(f.opens[0].uri, clip('a').clips[0]); f.opens[0].resolve(); await current;
});

for (const platform of ['android', 'web']) test(`${platform} same-batch item selection keeps the original external action behavior`, async t => {
  const f = videoFixture({ platform, viewer: true }); t.after(() => f.close()); const old = f.open.props.onPress;
  const next = f.tree.find(n => n.props?.accessibilityLabel === 'Next media').props.onPress;
  f.act(() => { next(); old(); }); assert.equal(f.opens.length, 1); assert.equal(f.opens[0].uri, clip('a').clips[0]);
  f.opens[0].resolve(); await settle(f);
});

test('iOS no-op Close leaves the current visible item usable', async t => {
  const f = videoFixture({ viewer: true }); t.after(() => f.close()); f.noopClose(); const current = f.open.props.onPress;
  f.act(() => { f.tree.find(n => n.props?.accessibilityLabel === 'Close').props.onPress(); current(); });
  assert.equal(f.closeCalls, 1); assert.equal(f.opens.length, 1); f.opens[0].resolve(); await settle(f);
});

test('iOS selecting another item with the same URI retires only its captured external action, not the reusable player', async t => {
  const f = videoFixture({ viewer: true }); t.after(() => f.close());
  f.source([clip('a').clips[0], clip('a').clips[0]]); const old = f.open.props.onPress, player = f.player;
  f.act(() => { f.tree.find(n => n.props?.accessibilityLabel === 'Next media').props.onPress(); old(); });
  assert.equal(f.opens.length, 0); assert.equal(f.player, player);
  const current = f.press(); assert.equal(f.opens[0].uri, clip('a').clips[0]); f.opens[0].resolve(); await current;
});
