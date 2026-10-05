import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";

const file = new URL("./MshpitVideoPlayer.jsx", import.meta.url);
const require = createRequire(file);
const code = transformSync(readFileSync(file, "utf8"), {
  filename: "MshpitVideoPlayer.jsx", babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
const nodes = (node) => !node || typeof node !== "object" ? [] : Array.isArray(node)
  ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];

// Execute the production component and start helper, replacing only hooks and
// platform rendering. Playback events stand in for the actual platform player.
function fixture() {
  let cursor = 0, tree, retries = 0;
  const slots = [], pending = [], listeners = new Map(), timers = new Map();
  const player = {
    status: "readyToPlay", playing: false, muted: false,
    addListener(name, callback) {
      const callbacks = listeners.get(name) || new Set();
      callbacks.add(callback); listeners.set(name, callbacks);
      return { remove: () => callbacks.delete(callback) };
    },
    pause() { this.playing = false; },
  };
  const status = { status: "readyToPlay", error: null };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(callback) { return callback; },
    useEffect(callback, deps) {
      const index = cursor++, old = slots[index];
      if (old && deps.every((value, offset) => Object.is(value, old.deps[offset]))) return;
      pending.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; });
    },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const componentRequire = (name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
    if (name === "react-native") return { View: "View", Text: "Text", Pressable: "Pressable", Linking: {},
      Platform: { OS: "web" }, StyleSheet: { create: (styles) => styles, absoluteFillObject: {} } };
    if (name === "expo") return { useEvent: () => status };
    if (name === "expo-video") return { VideoView: "VideoView", useVideoPlayer: () => player };
    if (name === "../../theme") return { colors: {}, radius: {} };
    if (name === "../../lib/useAppActive") return { __esModule: true, default: () => true };
    if (name === "../Icon" || name === "../ClipPoster") return name;
    return require(name);
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "setInterval", "clearInterval", code)(
    componentRequire, module, module.exports,
    (callback) => { timers.set(callback, callback); return callback; }, (timer) => timers.delete(timer),
  );
  const render = () => {
    cursor = 0;
    tree = module.exports.default({ uri: "https://media.test/clip.mp4", altText: "Test clip", onRetry: () => retries++ });
    for (const effect of pending.splice(0)) effect();
  };
  const find = (predicate) => nodes(tree).find(predicate);
  render();
  return { render, status, timers, player, find, retries: () => retries,
    video: () => find((node) => node.type === "VideoView"),
    emit(name, value) { for (const listener of listeners.get(name) || []) listener(value); render(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test("one explicit launcher hands off to native inline/fullscreen controls after playback starts", () => {
  const f = fixture();
  assert.equal(f.video().props.nativeControls, false);
  assert.ok(f.find((node) => node.props.accessibilityLabel === "Play video. Test clip"));
  f.video().props.onFirstFrameRender(); f.render();
  assert.equal(f.video().props.nativeControls, false, "a paused decoded frame is not a playback gesture");
  f.emit("playingChange", { isPlaying: true });
  assert.equal(f.video().props.nativeControls, true);
  assert.equal(f.video().props.playsInline, true);
  assert.equal(f.video().props.fullscreenOptions.enable, true);
  assert.equal(f.video().props.contentFit, "contain", "short and tall footage must retain its proportions");
  assert.equal(f.find((node) => node.props.accessibilityLabel?.startsWith("Play video")), undefined);
  assert.equal(f.find((node) => node.props.accessibilityLabel?.startsWith("Playback speed")), undefined);
  f.emit("playingChange", { isPlaying: false });
  assert.equal(f.video().props.nativeControls, true, "pausing must retain native seeking/play controls");
  f.status.status = "error"; f.render();
  assert.equal(f.video().props.nativeControls, false);
  f.find((node) => node.type === "Pressable" && nodes(node).some((child) => child.props.children === "Try again")).props.onPress();
  assert.equal(f.retries(), 1);
  f.unmount();
  assert.equal(f.timers.size, 0);
});

test("a rejected Safari play gesture leaves the launcher available for a successful retry", async () => {
  const f = fixture();
  const element = { play: () => Promise.reject(new Error("gesture rejected")) };
  f.video().props.ref.current = { nativeRef: { current: element } };
  f.find((node) => node.props.accessibilityLabel === "Play video. Test clip").props.onPress();
  await new Promise((done) => setImmediate(done));
  f.render();
  assert.equal(f.video().props.nativeControls, false);
  assert.ok(f.find((node) => node.props.children === "Playback could not start. Try again or reload this video."));
  element.play = () => { f.emit("playingChange", { isPlaying: true }); return Promise.resolve(); };
  f.find((node) => node.props.accessibilityLabel === "Play video. Test clip").props.onPress();
  await new Promise((done) => setImmediate(done));
  f.render();
  assert.equal(f.video().props.nativeControls, true);
  assert.equal(f.find((node) => node.props.children === "Playback could not start. Try again or reload this video."), undefined);
  f.unmount();
  assert.equal(f.timers.size, 0);
});
