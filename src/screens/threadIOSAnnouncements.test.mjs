import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const { parseSync } = require("@babel/core");
const source = readFileSync(new URL("./ThreadScreen.jsx", import.meta.url), "utf8");
const ast = parseSync(source, { babelrc: false, configFile: false, parserOpts: { plugins: ["jsx"] } });
const hook = ast.program.body.find(node => node.type === "FunctionDeclaration" && node.id.name === "useThreadFailureAnnouncement");

// Execute the production hook with deterministic React effect lifetimes and timers.
function fixture({ os = "ios", state = "active", reader = true } = {}) {
  const refs = [], effects = [], pending = [], timers = new Map(), speech = [];
  const appListeners = new Set(), readerListeners = new Set();
  let refIndex = 0, effectIndex = 0, timerID = 0, owner = { alive: true };
  const AppState = { currentState: state, addEventListener(_event, listener) {
    appListeners.add(listener); return { remove: () => appListeners.delete(listener) };
  } };
  const context = {
    Platform: { OS: os }, AppState, THREAD_READ_ERROR: "Messages could not update.",
    AccessibilityInfo: {
      announceForAccessibilityWithOptions: (message, options) => speech.push({ message, queue: options.queue }),
      addEventListener(_event, listener) { readerListeners.add(listener); return { remove: () => readerListeners.delete(listener) }; },
    },
    useRef(value) { return refs[refIndex++] ||= { current: value }; },
    useEffect(effect, deps) {
      const i = effectIndex++, previous = effects[i];
      if (!previous || deps.some((dep, j) => dep !== previous.deps[j])) {
        pending.push(() => { previous?.cleanup?.(); effects[i] = { deps, cleanup: effect() }; });
      }
    },
    setTimeout(callback, delay) { assert.equal(delay, 120); const id = ++timerID; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
  };
  const useAnnouncement = vm.runInNewContext(`(${source.slice(hook.start, hook.end)})`, context);
  const f = {
    speech, timers, appListeners, readerListeners,
    render({ nextOwner = owner, nextReader = reader, flush = true } = {}) {
      owner = nextOwner; reader = nextReader; refIndex = effectIndex = 0;
      f.announce = useAnnouncement(owner, reader);
      if (flush) f.effects();
      return f.announce;
    },
    effects() { while (pending.length) pending.shift()(); },
    tick() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } },
    app(state) { AppState.currentState = state; for (const listener of appListeners) listener(state); },
    reader(enabled) { for (const listener of readerListeners) listener(enabled); f.render({ nextReader: enabled }); },
    unmount() { for (const effect of effects) effect?.cleanup?.(); },
    get owner() { return owner; },
  };
  f.render(); return f;
}

test("foreground manual failures queue one polite announcement after the delay", () => {
  const f = fixture();
  assert.equal(f.timers.size, 0);
  f.announce();
  assert.equal(f.speech.length, 0);
  f.tick();
  assert.deepEqual(f.speech, [{ message: "Messages could not update.", queue: true }]);
});

for (const state of ["inactive", "background", null]) {
  test(`${state} suppresses failures and foreground does not replay them`, () => {
    const f = fixture({ state });
    f.announce(); f.tick(); f.app("active"); f.tick();
    assert.equal(f.speech.length, 0);
    f.announce(); f.tick(); assert.equal(f.speech.length, 1);
  });
  test(`${state} before delay cancels owned timer without replay`, () => {
    const f = fixture(); f.announce(); f.app(state);
    assert.equal(f.timers.size, 0);
    f.app("active"); f.tick(); assert.equal(f.speech.length, 0);
  });
}

test("owner change cancels pending speech and stale callbacks cannot announce", () => {
  const f = fixture(), old = f.announce;
  f.announce(); f.render({ nextOwner: { alive: true } });
  assert.equal(f.timers.size, 0);
  old(); f.tick(); assert.equal(f.speech.length, 0);
  f.announce(); f.tick(); assert.equal(f.speech.length, 1);
});

test("render-before-effect owner changes suppress the old timer", () => {
  const f = fixture(); f.announce();
  f.render({ nextOwner: { alive: true }, flush: false });
  f.tick(); assert.equal(f.speech.length, 0); f.effects();
});

test("unmount cancels owned speech and subscriptions", () => {
  const f = fixture(), old = f.announce; f.announce(); f.unmount(); old(); f.tick();
  assert.equal(f.timers.size, 0); assert.equal(f.speech.length, 0);
  assert.equal(f.appListeners.size, 0); assert.equal(f.readerListeners.size, 0);
});

test("rapid failures coalesce, but a later deliberate failure may announce", () => {
  const f = fixture(); f.announce(); f.announce(); f.announce();
  assert.equal(f.timers.size, 1); f.tick(); assert.equal(f.speech.length, 1);
  f.announce(); f.tick(); assert.equal(f.speech.length, 2);
});

test("enabling VoiceOver never replays a failure or cancelled timer", () => {
  const f = fixture({ reader: false }); f.announce(); f.reader(true); f.tick();
  assert.equal(f.speech.length, 0);
  f.announce(); f.reader(false); assert.equal(f.timers.size, 0);
  f.reader(true); f.tick(); assert.equal(f.speech.length, 0);
  f.announce(); f.tick(); assert.equal(f.speech.length, 1);
});

test("reader disable event suppresses callbacks even before the preference render", () => {
  const f = fixture(); f.announce();
  for (const listener of f.readerListeners) listener(false);
  f.announce(); f.tick(); assert.equal(f.speech.length, 0);
});

for (const os of ["android", "web"]) test(`${os} has no new listeners, timers or announcements`, () => {
  const f = fixture({ os }); f.announce(); f.tick();
  assert.equal(f.appListeners.size, 0); assert.equal(f.readerListeners.size, 0);
  assert.equal(f.timers.size, 0); assert.equal(f.speech.length, 0);
});

for (const transition of ["background", "inactive", "reader"]) test(`captured callback stays revoked after ${transition} round trip`, () => {
  const f = fixture(); f.announce();
  const oldCallback = [...f.timers.values()][0];
  if (transition === "reader") { f.reader(false); f.reader(true); }
  else { f.app(transition); f.app("active"); }
  oldCallback(); f.tick();
  assert.equal(f.speech.length, 0);
  f.announce(); f.tick(); assert.equal(f.speech.length, 1);
});

test("replaced captured callback cannot speak or clear a newer timer", () => {
  const f = fixture(); f.announce();
  const oldCallback = [...f.timers.values()][0];
  f.announce(); oldCallback();
  assert.equal(f.speech.length, 0);
  assert.equal(f.timers.size, 1);
  // Cancellation must still reach the newer timer after the old callback runs.
  f.app("background"); assert.equal(f.timers.size, 0);
  f.app("active"); f.tick(); assert.equal(f.speech.length, 0);
  f.announce(); oldCallback(); f.tick(); assert.equal(f.speech.length, 1);
});

test("completed callback cannot announce twice", () => {
  const f = fixture(); f.announce();
  const callback = [...f.timers.values()][0];
  f.tick(); callback(); assert.equal(f.speech.length, 1);
});
