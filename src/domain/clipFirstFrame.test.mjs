import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "@babel/core";

const require = createRequire(import.meta.url);
const componentFile = new URL("../screens/ClipsScreen.jsx", import.meta.url);
const componentRequire = createRequire(componentFile);
const code = transformSync(readFileSync(componentFile, "utf8") + "\nexport { ClipPage };", {
  filename: "ClipsScreen.jsx", configFile: false, babelrc: false,
  plugins: [
    [require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }],
    require("@babel/plugin-transform-modules-commonjs"),
  ],
}).code;

const nodes = (node) => !node || typeof node !== "object" ? []
  : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const posterCount = (tree) => nodes(tree).filter((node) => node.type === "ClipPoster").length;
const frameCallback = (tree) => nodes(tree).find((node) => node.type === "VideoView").props.onFirstFrameRender;

function fixture(platform = "android") {
  const slots = [], tracked = [];
  let cursor = 0, pending = [], selected = true, dirty = false, currentPlayer;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useState(value) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof value === "function" ? value() : value;
      return [slots[index], (next) => {
        const resolved = typeof next === "function" ? next(slots[index]) : next;
        if (!Object.is(slots[index], resolved)) { slots[index] = resolved; dirty = true; }
      }];
    },
    useMemo(fn, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { value: fn(), deps };
      return slots[index].value;
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) pending.push(() => {
        slots[index]?.cleanup?.();
        slots[index] = { deps, cleanup: fn() };
      });
    },
  };
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": {
      Platform: { OS: platform },
      StyleSheet: { create: (value) => value, absoluteFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } },
      View: "View", Text: "Text", Pressable: "Pressable",
    },
    expo: { useEvent: (player) => ({ status: player.status, error: null }) },
    "expo-video": {
      VideoView: "VideoView",
      useVideoPlayer(source, setup) {
        currentPlayer = react.useMemo(() => {
          const listeners = new Map();
          const emit = (name, payload) => { for (const listener of listeners.get(name) || []) listener(payload); };
          const player = {
            emit, status: "readyToPlay", playing: false, currentTime: 0, duration: 30, playbackRate: 1,
            play() { this.playing = true; emit("playingChange", { isPlaying: true }); },
            pause() { this.playing = false; emit("playingChange", { isPlaying: false }); },
            addListener(name, listener) {
              const rows = listeners.get(name) || new Set(); rows.add(listener); listeners.set(name, rows);
              return { remove: () => rows.delete(listener) };
            },
          };
          setup?.(player);
          return player;
        }, [JSON.stringify(source)]);
        return currentPlayer;
      },
    },
    "../theme": { colors: {}, radius: {}, shadow: {}, mono: "mono" },
    "../components/Icon": "Icon",
    "../components/Avatar": "Avatar",
    "../components/ClipPoster": "ClipPoster",
    "../components/VinylRefreshBoundary": "Refresh",
    "../hooks/useScopedRefresh": () => ({}),
    "../lib/useAppActive": () => true,
    "../features/feedImpressions/feedImpressionService": {},
    "../store": {},
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(
    (name) => name in dependencies ? dependencies[name] : componentRequire(name), module, module.exports,
  );
  return {
    get player() { return currentPlayer; },
    get metrics() { return tracked.filter(([name, value]) => name === "performance" && value.metric === "video_first_frame"); },
    active(value) { selected = value; },
    render() {
      let tree, renders = 0;
      do {
        cursor = 0; pending = []; dirty = false;
        tree = module.exports.ClipPage({
          post: { id: "synthetic-post", user: {} }, uri: "https://media.example.invalid/clip.mp4",
          height: 600, active: selected, posterEnabled: true,
          onTrack: (...args) => tracked.push(args),
        });
        pending.forEach((fn) => fn());
        assert.ok(++renders < 10, "The component must settle without a render loop.");
      } while (dirty);
      return tree;
    },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

// Expo's native view dispatcher supplies a React Native event object even for
// its empty first-frame event. It is not the clip's playback-session identity.
const nativeFrameEvent = () => ({ nativeEvent: {}, type: "topFirstFrameRender" });

for (const platform of ["android", "ios"]) {
  test(`${platform} first-frame events reveal a playing clip and record one metric`, (t) => {
    const f = fixture(platform); t.after(() => f.unmount());
    const tree = f.render(); assert.equal(posterCount(tree), 1); assert.equal(f.player.playing, true);
    frameCallback(tree)(nativeFrameEvent());
    assert.equal(posterCount(f.render()), 0);
    assert.equal(f.player.playing, true);
    frameCallback(tree)(nativeFrameEvent());
    assert.equal(f.metrics.length, 1);
  });
}

test("first-frame callbacks with no event argument still reveal the clip", (t) => {
  const f = fixture(); t.after(() => f.unmount());
  frameCallback(f.render())();
  assert.equal(posterCount(f.render()), 0);
  assert.equal(f.metrics.length, 1);
});

test("inactive and previous-activation callbacks cannot reveal or measure a new clip session", (t) => {
  const f = fixture(); t.after(() => f.unmount());
  const oldFrame = frameCallback(f.render());
  f.active(false); f.render(); oldFrame(nativeFrameEvent());
  assert.equal(f.metrics.length, 0);
  f.active(true); const tree = f.render();
  oldFrame(nativeFrameEvent());
  assert.equal(posterCount(f.render()), 1); assert.equal(f.metrics.length, 0);
  frameCallback(tree)(nativeFrameEvent());
  assert.equal(posterCount(f.render()), 0); assert.equal(f.metrics.length, 1);
});

test("retry keeps the new poster until the replacement player's own first-frame event", (t) => {
  const f = fixture(); t.after(() => f.unmount());
  const oldFrame = frameCallback(f.render());
  f.player.status = "error";
  f.player.emit("statusChange", { status: "error", error: null });
  const errorTree = f.render();
  const retry = nodes(errorTree).find((node) => node.props?.accessibilityLabel === "Try loading this clip again");
  assert.ok(retry); retry.props.onPress({ stopPropagation() {} });
  const tree = f.render(); oldFrame(nativeFrameEvent());
  assert.equal(posterCount(f.render()), 1); assert.equal(f.metrics.length, 0);
  frameCallback(tree)(nativeFrameEvent());
  assert.equal(posterCount(f.render()), 0); assert.equal(f.metrics.length, 1);
});
