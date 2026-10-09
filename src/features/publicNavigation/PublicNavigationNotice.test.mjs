import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";

const require = createRequire(import.meta.url);
const implementation = transformSync(readFileSync(new URL("./PublicNavigationNotice.jsx", import.meta.url), "utf8"), {
  filename: "PublicNavigationNotice.jsx", configFile: false, babelrc: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;

function fixture() {
  let now = 1_000, retries = 0, cancels = 0, timerId = 0, previous, cleanup, effect;
  const timers = new Map(), mod = { exports: {} };
  const hooks = {
    useState: () => [0, () => {}],
    useEffect(fn, deps) {
      if (previous && deps.every((value, index) => Object.is(value, previous[index]))) return;
      previous = deps; effect = () => { cleanup?.(); cleanup = fn(); };
    },
  };
  const imports = name => name === "react" ? hooks : name === "react-native"
    ? { View: "View", Text: "Text", Pressable: "Pressable" }
    : name === "../../theme" ? { colors: {} } : require(name);
  new Function("require", "module", "exports", "Date", "setTimeout", "clearTimeout", implementation)(
    imports, mod, mod.exports, { now: () => now },
    (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
    id => timers.delete(id),
  );
  const walk = node => !node || typeof node !== "object" ? [] : Array.isArray(node)
    ? node.flatMap(walk) : [node, ...walk(node.props?.children)];
  return {
    timers, counts: () => ({ retries, cancels }), dispose: () => cleanup?.(),
    render(notice = { directoryUnavailable: true }, retryAt = 7_201_000) {
      const tree = mod.exports.default({ notice, retryAt, onRetry: () => retries++, onCancel: () => cancels++ });
      effect?.(); effect = null;
      return walk(tree).filter(node => node.type === "Pressable").map(node => node.props);
    },
    advance(ms) { now += ms; for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); } },
  };
}

test("notice enables manual retry at the original deadline without dispatching an automatic retry", () => {
  const f = fixture();
  try {
    assert.equal(f.render()[0].disabled, true);
    assert.equal([...f.timers.values()][0].at, 7_201_000);
    f.advance(7_199_999); assert.equal(f.render()[0].disabled, true);
    f.advance(1); const buttons = f.render();
    assert.equal(buttons[0].disabled, false);
    assert.equal(buttons[0].accessibilityState.disabled, false);
    assert.deepEqual(f.counts(), { retries: 0, cancels: 0 });
    buttons[0].onPress(); assert.equal(f.counts().retries, 1);
    assert.equal(f.timers.size, 0);
  } finally { f.dispose(); }
});

test("profile errors ignore artist cooldown and leaving the notice cancels its timer", () => {
  const f = fixture();
  f.render(); assert.equal(f.timers.size, 1);
  const buttons = f.render({ message: "Profile unavailable" });
  assert.equal(buttons[0].disabled, false);
  assert.equal(f.timers.size, 0);
  f.render(); assert.equal(f.timers.size, 1);
  f.dispose(); assert.equal(f.timers.size, 0);
  assert.deepEqual(f.counts(), { retries: 0, cancels: 0 });
});
