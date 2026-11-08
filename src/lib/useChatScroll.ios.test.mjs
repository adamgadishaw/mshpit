import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const { transformSync } = require("@babel/core");
const compiled = transformSync(readFileSync(new URL("./useChatScroll.ios.js", import.meta.url), "utf8"), {
  babelrc: false, configFile: false,
  plugins: [require("@babel/plugin-transform-modules-commonjs")],
}).code;

// Run the production hook with persistent ref/callback slots across renders.
// Native geometry events and the live preference are controlled by each test.
function fixture(options = { messageCount: 3 }) {
  const slots = [], calls = [];
  let index = 0, reducedMotion = false, current;
  const module = { exports: {} };
  new vm.Script(compiled).runInNewContext({
    module, exports: module.exports,
    require(name) {
      if (name === "../hooks/useReducedMotion") return () => reducedMotion;
      assert.equal(name, "react");
      return {
        useRef(value) { return slots[index++] ??= { current: value }; },
        useCallback(callback, deps) {
          const slot = index++, previous = slots[slot];
          if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
            slots[slot] = { callback, deps };
          }
          return slots[slot].callback;
        },
      };
    },
  });
  function render(nextOptions = options, motion = reducedMotion) {
    options = nextOptions; reducedMotion = motion; index = 0;
    current = module.exports.default(options);
    current.scrollRef.current = { scrollToEnd: ({ animated }) => calls.push(animated) };
    return current;
  }
  render();
  return {
    calls, render,
    grow: () => current.onContentSizeChange(320, 1600),
    scroll(distance) {
      current.onScroll({ nativeEvent: {
        contentSize: { height: 1600 }, layoutMeasurement: { height: 600 },
        contentOffset: { y: 1000 - distance },
      } });
    },
    detach: () => { current.scrollRef.current = null; },
  };
}

test("iOS snaps initial history into place then follows content growth", () => {
  const f = fixture();
  f.grow(); f.grow();
  assert.deepEqual(f.calls, [false, true]);
});

test("empty placeholders do not consume the first history positioning", () => {
  const f = fixture({ messageCount: 0 });
  f.grow(); f.grow();
  f.render({ messageCount: 40 }); f.grow();
  f.render({ messageCount: 41 }); f.grow();
  assert.deepEqual(f.calls, [false, false, false, true]);
});

test("reading older history is not interrupted by growth or live motion changes", () => {
  const f = fixture();
  f.grow(); f.scroll(97); f.grow();
  f.render({ messageCount: 4 }, true); f.grow();
  f.render({ messageCount: 5 }, false); f.grow();
  assert.deepEqual(f.calls, [false]);
  f.scroll(96); f.grow();
  assert.deepEqual(f.calls, [false, true]);
});

test("Reduce Motion updates future scrolls without scrolling on the toggle itself", () => {
  const f = fixture();
  f.grow(); f.grow();
  f.render({ messageCount: 3 }, true);
  assert.deepEqual(f.calls, [false, true]);
  f.grow();
  f.render({ messageCount: 3 }, false); f.grow();
  assert.deepEqual(f.calls, [false, true, false, true]);
});

test("Reduce Motion suppresses animation on initial and subsequent content", () => {
  const f = fixture();
  f.render({ messageCount: 3 }, true); f.grow(); f.grow();
  assert.deepEqual(f.calls, [false, false]);
});

test("queued content handlers read the latest Reduce Motion setting in the same scope", () => {
  const f = fixture({ messageCount: 3, scopeKey: "room" });
  const beforeToggle = f.render();
  f.grow();
  f.render({ messageCount: 4, scopeKey: "room" }, true);
  beforeToggle.onContentSizeChange();
  assert.deepEqual(f.calls, [false, false]);
  const whileReduced = f.render();
  f.render({ messageCount: 5, scopeKey: "room" }, false);
  whileReduced.onContentSizeChange();
  assert.deepEqual(f.calls, [false, false, true]);
});

test("a missing scroll view does not consume initial positioning", () => {
  const f = fixture();
  f.detach(); f.grow();
  f.render(); f.grow();
  assert.deepEqual(f.calls, [false]);
});

test("legacy callers without message count snap only their first content layout", () => {
  const f = fixture({});
  f.grow(); f.grow();
  assert.deepEqual(f.calls, [false, true]);
});

test("falling counts do not pull a reader away from older history", () => {
  const f = fixture({ messageCount: 40, scopeKey: "account:room" });
  f.grow(); f.scroll(300);
  f.render({ messageCount: 20, scopeKey: "account:room" }); f.grow();
  f.render({ messageCount: 0, scopeKey: "account:room" }); f.grow();
  f.render({ messageCount: 30, scopeKey: "account:room" }); f.grow();
  assert.deepEqual(f.calls, [false]);
});

test("account, auth epoch or room changes start fresh and reject old layout handlers", () => {
  const f = fixture({ messageCount: 40, scopeKey: "0:account-a:room-a" });
  f.grow(); f.scroll(300);
  const old = f.render();
  f.render({ messageCount: 0, scopeKey: "1:account-b:room-b" });
  old.onScroll({ nativeEvent: {
    contentSize: { height: 1600 }, layoutMeasurement: { height: 600 }, contentOffset: { y: 0 },
  } });
  old.onContentSizeChange();
  assert.deepEqual(f.calls, [false]);
  f.grow();
  f.render({ messageCount: 40, scopeKey: "1:account-b:room-b" }); f.grow(); f.grow();
  assert.deepEqual(f.calls, [false, false, false, true]);
});

test("A to B to A rejects first-A callbacks even though the scope key matches again", () => {
  const f = fixture({ messageCount: 40, scopeKey: "A" });
  const firstA = f.render();
  f.grow();
  f.render({ messageCount: 40, scopeKey: "B" });
  f.render({ messageCount: 40, scopeKey: "A" });
  firstA.onContentSizeChange();
  assert.deepEqual(f.calls, [false], "old content handler cannot consume new initial positioning");
  firstA.onScroll({ nativeEvent: {
    contentSize: { height: 1600 }, layoutMeasurement: { height: 600 }, contentOffset: { y: 0 },
  } });
  f.grow();
  assert.deepEqual(f.calls, [false, false], "old scroll handler cannot disable new sticky state");
  f.scroll(300);
  firstA.onScroll({ nativeEvent: {
    contentSize: { height: 1600 }, layoutMeasurement: { height: 600 }, contentOffset: { y: 1000 },
  } });
  f.grow();
  assert.deepEqual(f.calls, [false, false], "old scroll handler cannot re-enable following while reading");
});
