import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parse } from "@babel/parser";
import { transformSync } from "@babel/core";
import { pendingVideoMilestones } from "./mediaAnalytics.mjs";

const require = createRequire(import.meta.url);
const sdkSource = readFileSync(new URL("../../node_modules/expo-video/src/VideoPlayer.web.tsx", import.meta.url), "utf8");
const sdkCode = transformSync(sdkSource, {
  filename: "VideoPlayer.web.tsx", configFile: false, babelrc: false,
  plugins: [[require("@babel/plugin-transform-typescript"), { isTSX: true }], require("@babel/plugin-transform-modules-commonjs")],
}).code;

function sdkFixture() {
  const timers = new Map(); let serial = 0;
  class SharedObject {
    listeners = new Map();
    addListener(name, listener) {
      const rows = this.listeners.get(name) || new Set(); rows.add(listener); this.listeners.set(name, rows);
      return { remove: () => rows.delete(listener) };
    }
    emit(name, data) { for (const listener of this.listeners.get(name) || []) listener(data); }
  }
  const module = { exports: {} };
  new Function("require", "module", "exports", "globalThis", "setInterval", "clearInterval", sdkCode)(
    name => name === "react" ? {} : { __esModule: true, default: () => null },
    module, module.exports, { expo: { SharedObject } },
    callback => { timers.set(++serial, callback); return serial; }, id => timers.delete(id),
  );
  return { timers, Player: module.exports.default };
}
function measurementEffect(file, bindings) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
  let effect;
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "CallExpression" && node.callee.name === "useEffect") {
      const callback = node.arguments[0];
      if (source.slice(callback.start, callback.end).includes("player.timeUpdateEventInterval = 1")) effect = callback;
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  }
  visit(ast); assert.ok(effect, "The real component measurement effect must remain covered.");
  return new Function(...Object.keys(bindings), "return (" + source.slice(effect.start, effect.end) + ");")(...Object.values(bindings))();
}
const components = [
  ["viewer", "../components/PhotoViewer.jsx"],
  ["clips", "../screens/ClipsScreen.jsx"],
];
for (const [label, file] of components) {
  test(label + " releases the exact Expo 57 web time-update timer on close, retry and replacement", () => {
    const { timers, Player } = sdkFixture();
    for (let index = 0; index < 20; index++) {
      const player = new Player({ uri: "https://media.example.invalid/clip-" + index + ".mp4" });
      const tracked = [];
      const cleanup = measurementEffect(file, { player, active: true, post: { id: "p_test" }, postId: "p_test",
        activeRef: { current: true }, trackRef: { current: (...args) => tracked.push(args) }, pendingVideoMilestones });
      assert.equal(timers.size, 1);
      // The SDK's view teardown alone does not cancel this timer.
      player.unmountVideoView({});
      assert.equal(timers.size, 1);
      cleanup();
      assert.equal(timers.size, 0, "No player timer may survive its measurement owner.");
      assert.ok([...player.listeners.values()].every(rows => rows.size === 0));
      assert.deepEqual(tracked, [], "Cleanup never fabricates a playback event.");
    }
  });
  test(label + " cleanup tolerates an already released native player and removes every listener", () => {
    let released = false, removed = 0, interval = 0;
    const player = { playing: false, addListener: () => ({ remove: () => removed++ }),
      set timeUpdateEventInterval(value) { if (released) throw new Error("Shared object already released"); interval = value; } };
    const cleanup = measurementEffect(file, { player, active: true, post: { id: "p_test" }, postId: "p_test",
      activeRef: { current: false }, trackRef: { current: () => assert.fail("Hidden playback cannot be tracked") }, pendingVideoMilestones });
    assert.equal(interval, 1); released = true;
    assert.doesNotThrow(cleanup);
    assert.equal(removed, 3);
  });
}


