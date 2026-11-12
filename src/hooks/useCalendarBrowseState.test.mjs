import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import * as domain from "../domain/calendarBrowseMemory.mjs";

const require = createRequire(import.meta.url);
const compiled = require("@babel/core").transformSync(readFileSync(new URL("./useCalendarBrowseState.js", import.meta.url), "utf8"), {
  babelrc: false, configFile: false, plugins: [require("@babel/plugin-transform-modules-commonjs")],
}).code;

// Execute the actual hook with controlled React lifetimes and native geometry.
function mount(options) {
  const slots = [], calls = [];
  let index = 0, effects = [], updates = 0, hook, dirty = false;
  const module = { exports: {} };
  new vm.Script(compiled).runInNewContext({ module, exports: module.exports, require(name) {
    if (name === "../domain/calendarBrowseMemory.mjs") return domain;
    assert.equal(name, "react");
    return {
      useRef(value) { return slots[index++] ??= { current: value }; },
      useState(value) {
        const slot = index++;
        slots[slot] ??= { value };
        return [slots[slot].value, next => { updates += 1; dirty = true; slots[slot].value = typeof next === "function" ? next(slots[slot].value) : next; }];
      },
      useLayoutEffect(effect, deps) {
        const slot = index++, previous = slots[slot];
        if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) {
          effects.push(() => { previous?.cleanup?.(); slots[slot] = { deps, cleanup: effect() }; });
        }
      },
    };
  } });
  const render = next => {
    options = next || options;
    do {
      dirty = false; index = 0; effects = [];
      hook = module.exports.default(options);
      hook.scrollRef.current = { scrollTo: value => calls.push({ ...value }) };
      effects.forEach(effect => effect());
    } while (dirty);
    return hook;
  };
  render();
  return { render, read: () => hook, calls, updates: () => updates,
    unmount: () => slots.forEach(slot => slot?.cleanup?.()) };
}

const initialState = { cursor: { y: 2026, m: 10 }, selected: "2026-11-10", view: "upcoming" };
const geometry = hook => { hook.onLayout({ nativeEvent: { layout: { height: 500 } } }); hook.onContentSizeChange(320, 2000); };
const scroll = y => ({ nativeEvent: { contentOffset: { y } } });

test("calendar remount restores browsing and scroll without rerendering for native scroll events", () => {
  const memory = domain.createCalendarBrowseMemory(); memory.account("a", 1);
  const options = { memory, occurrence: {}, accountId: "a", authEpoch: 1, initialState };
  const first = mount(options); geometry(first.read());
  first.read().update({ scope: "plans", presentation: "agenda", agendaLimit: 120 });
  const beforeScrollUpdates = first.updates();
  first.read().onScroll(scroll(750));
  assert.equal(first.updates(), beforeScrollUpdates);
  const stale = first.read(), captured = stale.capture();
  first.unmount();
  assert.equal(captured(), false);
  const returned = mount(options); geometry(returned.read());
  assert.equal(returned.read().state.scope, "plans");
  assert.equal(returned.read().state.agendaLimit, 120);
  assert.deepEqual(returned.calls, [{ y: 750, animated: false }]);
  assert.equal(stale.update({ selected: "2020-01-01" }), false);
  stale.onScroll(scroll(20));
  assert.equal(returned.render().state.scrollY, 750);
});

test("captured async work cannot act after route loss, account change, or same-account epoch change", () => {
  const memory = domain.createCalendarBrowseMemory(); memory.account("a", 1);
  let visible = true;
  const options = { memory, occurrence: {}, accountId: "a", authEpoch: 1, initialState, isCurrentRoute: () => visible };
  const f = mount(options), old = f.read(), captured = old.capture();
  assert.equal(captured(), true);
  visible = false;
  assert.equal(captured(), false); assert.equal(old.update({ scope: "plans" }), false);
  visible = true; memory.account("a", 2);
  assert.equal(captured(), false);
  f.render({ ...options, authEpoch: 2 });
  assert.equal(old.update({ scope: "plans" }), false);
  assert.equal(f.read().state.scope, "all");
  memory.account("b", 3);
  assert.equal(f.read().capture()(), false);
});

test("return readiness does not undo a new drag or a newly chosen date", () => {
  const memory = domain.createCalendarBrowseMemory(); memory.account("a", 1);
  const occurrence = {}, identity = { accountId: "a", authEpoch: 1 };
  memory.claim(occurrence, identity, initialState).save({ scrollY: 750 });
  const options = { memory, occurrence, ...identity, initialState, restoreReady: false };
  const f = mount(options); geometry(f.read());
  f.read().onScrollBeginDrag(scroll(120));
  f.render({ ...options, restoreReady: true });
  assert.deepEqual(f.calls, []); assert.equal(f.read().state.scrollY, 120);
  f.unmount();
  const second = mount(options); geometry(second.read());
  second.read().update({ selected: "2026-12-20" });
  second.render({ ...options, restoreReady: true });
  assert.deepEqual(second.calls, []); assert.equal(second.read().state.selected, "2026-12-20");
});

test("without a shared owner the hook remains isolated and resets on account changes", () => {
  const f = mount({ accountId: "a", authEpoch: 1, initialState });
  f.read().update({ view: "past" });
  assert.equal(f.render().state.view, "past");
  f.render({ accountId: "b", authEpoch: 2, initialState });
  assert.equal(f.read().state.view, "upcoming");
});
