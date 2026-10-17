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

const nodes = (node) => [node, ...(node.children || []).flatMap(nodes)];
const frameEvent = { nativeEvent: {}, type: "topFirstFrameRender" };

function fixture(platform = "android", { rejectInitialPlay = false, deferNativePlayback = false, videoElement = null } = {}) {
  const renderer = createRenderer(videoElement);
  const players = [], tracked = [], failures = [];
  let appActive = true;
  const props = {
    post: { id: "synthetic-clip", user: {} }, uri: "https://media.example.invalid/clip.mp4",
    height: 600, active: true, posterEnabled: true,
    onTrack: (...event) => tracked.push(event), onPlaybackError: (failure) => failures.push(failure),
  };
  const dependencies = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "react-native": {
      Platform: { OS: platform },
      StyleSheet: { create: (value) => value, absoluteFill },
      View: "View", Text: "Text", Pressable: "Pressable",
    },
    expo: expoEvents,
    "expo-video": {
      VideoView: "VideoView",
      useVideoPlayer(source, setup) {
        const player = React.useMemo(() => {
          const listeners = new Map();
          const player = {
            source, status: source ? "loading" : "idle", playing: false,
            rejectPlay: rejectInitialPlay && players.length === 0,
            playRequested: false, pauseCalls: 0,
            currentTime: 0, duration: 30, playbackRate: 1,
            emit(name, event) {
              if (name === "statusChange") this.status = event.status;
              for (const listener of [...(listeners.get(name) || [])]) listener(event);
            },
            play() {
              if (this.rejectPlay) throw new Error("synthetic start rejection");
              this.playRequested = true;
              if (!deferNativePlayback) this.settlePlayback();
            },
            pause() {
              this.pauseCalls++; this.playRequested = false;
              if (!deferNativePlayback) this.settlePlayback();
            },
            settlePlayback() {
              this.playing = this.playRequested;
              this.emit("playingChange", { isPlaying: this.playing });
            },
            addListener(name, listener) {
              const rows = listeners.get(name) || new Set(); rows.add(listener); listeners.set(name, rows);
              return { remove: () => rows.delete(listener) };
            },
            listenersFor(name) { return [...(listeners.get(name) || [])]; },
            listenerCount() { return [...listeners.values()].reduce((count, rows) => count + rows.size, 0); },
          };
          setup?.(player); players.push(player); return player;
        }, [JSON.stringify(source)]);
        return player;
      },
    },
    "../theme": { colors: {}, radius: {}, shadow: {}, mono: "mono" },
    "../components/Icon": "Icon", "../components/Avatar": "Avatar", "../components/ClipPoster": "ClipPoster",
    "../components/VinylRefreshBoundary": "Refresh", "../hooks/useScopedRefresh": () => ({}),
    "../lib/useAppActive": () => appActive, "../features/feedImpressions/feedImpressionService": {}, "../store": {},
  };
  const { ClipPage } = execute(componentCode, (name) => name in dependencies ? dependencies[name] : componentRequire(name));
  const f = {
    players, tracked, failures,
    get player() { return players.at(-1); },
    get tree() { return nodes(renderer.container); },
    get video() { return f.tree.find((node) => node.type === "VideoView"); },
    get retry() { return f.tree.find((node) => node.props?.accessibilityLabel === "Try loading this clip again"); },
    get poster() { return f.tree.find((node) => node.type === "ClipPoster"); },
    get stage() { return f.tree.find((node) => node.type === "Pressable" && node.props.accessibilityLabel?.includes("clip.")); },
    render() { renderer.render(React.createElement(ClipPage, props)); },
    act(callback) { renderer.act(callback); },
    active(value) { props.active = value; f.render(); },
    foreground(value) { appActive = value; f.render(); },
    fail(player = f.player) { f.act(() => player.emit("statusChange", { status: "error", error: { message: "synthetic decode failure" } })); },
    ready(player = f.player) { f.act(() => player.emit("statusChange", { status: "readyToPlay", error: null })); },
    close() { renderer.render(null); assert.ok(players.every((player) => player.listenerCount() === 0)); },
  };
  f.render();
  return f;
}

for (const platform of ["android", "ios"]) {
  test(`${platform} retry drops the failed player's error before the replacement emits any status`, (t) => {
    const f = fixture(platform); t.after(() => f.close());
    f.fail(); assert.ok(f.retry); assert.equal(f.failures.length, 1);
    const failedPlayer = f.player;
    const queuedOldStatus = failedPlayer.listenersFor("statusChange")[0];
    f.act(() => f.retry.props.onPress({ stopPropagation() {} })); assert.notEqual(f.player, failedPlayer);
    assert.equal(f.player.status, "loading");
    assert.equal(!!f.retry, false, "The fresh player has not failed; retry must show loading, not the retired error.");
    assert.equal(f.failures.length, 1, "Retry must not report a new failure before its player has failed.");
    assert.ok(f.poster);
    f.fail(failedPlayer); assert.equal(!!f.retry, false, "Retired player events cannot change the replacement.");
    f.act(() => queuedOldStatus({ status: "error", error: { message: "queued retired event" } }));
    assert.equal(!!f.retry, false, "An already-queued old callback cannot change the replacement.");
    f.ready(); f.act(() => f.video.props.onFirstFrameRender(frameEvent));
    assert.equal(!!f.poster, false);
    f.fail(); assert.ok(f.retry); assert.equal(f.failures.length, 2, "A real failure from the retry remains visible.");
  });

  test(`${platform} returning to a failed clip starts with a fresh status after background or paging`, (t) => {
    const f = fixture(platform); t.after(() => f.close());
    for (const boundary of [f.foreground, f.active]) {
      f.fail(); assert.ok(f.retry);
      boundary(false); assert.equal(!!f.video, false);
      boundary(true); assert.ok(f.video);
      assert.equal(!!f.retry, false, "The reactivated player must not inherit the retired player's error.");
      f.ready(); f.act(() => f.video.props.onFirstFrameRender(frameEvent)); assert.equal(!!f.poster, false);
    }
  });
}

test("the current player still reports a real load failure and unmount removes every subscription", (t) => {
  const f = fixture(); t.after(() => f.close());
  assert.equal(!!f.retry, false); f.fail(); assert.ok(f.retry);
  assert.equal(f.failures.length, 1); f.render(); assert.equal(f.failures.length, 1);
});

test("returning after a rejected playback start does not report another failure for the fresh player", async (t) => {
  const f = fixture("android", { rejectInitialPlay: true }); t.after(() => f.close());
  await new Promise(setImmediate); f.render();
  assert.ok(f.retry); assert.equal(f.failures.length, 1);
  f.foreground(false); f.foreground(true);
  assert.equal(!!f.retry, false);
  assert.equal(f.player.playing, true);
  assert.equal(f.failures.length, 1, "A rejected start belongs to its old player even during the first return render.");
});

test("native playback failure places its retry panel over the video using the installed StyleSheet API", (t) => {
  const f = fixture(); t.after(() => f.close()); f.fail();
  const panel = f.tree.find((node) => node.type === "View" && node.props?.accessibilityLiveRegion === "assertive");
  assert.ok(panel); assert.ok(f.retry);
  for (const key of ["position", "left", "right", "top", "bottom"]) {
    assert.equal(panel.props.style[key], absoluteFill[key], `The retry panel needs its ${key} bound.`);
  }
});

for (const platform of ["android", "ios"]) {
  test(`${platform} first frame preserves pending autoplay on entry, retry and foreground return`, (t) => {
    const f = fixture(platform, { deferNativePlayback: true }); t.after(() => f.close());
    for (const trigger of ["entry", "retry", "foreground"]) {
      if (trigger === "retry") {
        f.fail(); f.act(() => f.retry.props.onPress({ stopPropagation() {} }));
      } else if (trigger === "foreground") {
        f.foreground(false); f.foreground(true);
      }
      assert.equal(f.player.playRequested, true);
      assert.equal(f.player.playing, false, "Native play queues work; it does not synchronously mean isPlaying.");
      f.act(() => f.video.props.onFirstFrameRender(frameEvent));
      assert.equal(!!f.poster, false);
      assert.equal(f.player.pauseCalls, 0, `${trigger}: painting a frame must not cancel pending playback.`);
      assert.equal(f.player.playRequested, true);
      assert.match(f.stage.props.accessibilityLabel, /^Pause clip\./u);
      f.act(() => f.player.settlePlayback());
      assert.equal(f.player.playing, true);
    }
  });

  test(`${platform} first frame preserves an explicit pause while native pause is still queued`, (t) => {
    const f = fixture(platform, { deferNativePlayback: true }); t.after(() => f.close());
    f.act(() => f.player.settlePlayback());
    assert.equal(f.player.playing, true);
    f.act(() => f.stage.props.onPress());
    assert.equal(f.player.playRequested, false);
    assert.equal(f.player.playing, true, "The native pause command has not completed yet.");
    f.act(() => f.video.props.onFirstFrameRender(frameEvent));
    assert.equal(f.player.playRequested, false, "A painted frame cannot replace the user's pause with another play command.");
    assert.match(f.stage.props.accessibilityLabel, /^Play clip\./u);
    f.act(() => f.player.settlePlayback()); assert.equal(f.player.playing, false);
  });
}

test("a decoded web frame does not hide an autoplay rejection or its retry action", async (t) => {
  const f = fixture("web", {
    videoElement: { readyState: 0, videoWidth: 0, videoHeight: 0, play: () => Promise.reject(new Error("synthetic autoplay rejection")) },
  });
  t.after(() => f.close());
  f.act(() => f.video.props.onFirstFrameRender(frameEvent));
  await new Promise(setImmediate); f.render();
  assert.ok(f.retry); assert.equal(f.failures.length, 1);
  assert.ok(f.poster);
});
