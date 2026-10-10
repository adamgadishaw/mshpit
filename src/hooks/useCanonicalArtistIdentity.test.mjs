import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import { canonicalArtistIdentity, canonicalArtistIdentityScope } from "../domain/canonicalArtistIdentity.mjs";
import { createArtistLookupController } from "../features/artistSearch/artistLookupController.mjs";

const source = readFileSync(new URL("./useCanonicalArtistIdentity.js", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module" });
const body = ast.program.body.flatMap((node) => {
  if (node.type === "ImportDeclaration") return [];
  const declaration = node.type === "ExportDefaultDeclaration" ? node.declaration : node;
  return source.slice(declaration.start, declaration.end);
}).join("\n");
const settle = () => new Promise((resolve) => setImmediate(resolve));

// Execute the real hook with ordered renders/effects and a mocked resolver.
// Network, React Native and wall-clock timers are not part of this fixture.
function fixture() {
  let cursor = 0, effects = [], now = 1_000, props = { artistName: "Requested" };
  const slots = [], calls = [], timers = new Map();
  let timerId = 0;
  const same = (a, b) => a && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const useMemo = (make, deps) => {
    const index = cursor++;
    if (!same(slots[index]?.deps, deps)) slots[index] = { value: make(), deps };
    return slots[index].value;
  };
  const store = {
    session: { id: "a" }, remoteArtistMeta: () => null,
    resolveArtist: (name, options) => new Promise((resolve, reject) => calls.push({ name, options, resolve, reject })),
  };
  const bindings = {
    useMemo, useCallback: (fn, deps) => useMemo(() => fn, deps),
    useRef: (initial) => { const index = cursor++; return slots[index] ||= { current: initial }; },
    useState: (initial) => {
      const index = cursor++;
      slots[index] ||= { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, (value) => { slots[index].value = typeof value === "function" ? value(slots[index].value) : value; }];
    },
    useEffect: (effect, deps) => {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) {
        const previous = slots[index];
        slots[index] = { deps, cleanup: previous?.cleanup };
        effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); });
      }
    },
    useStore: () => store, canonicalArtistIdentity, canonicalArtistIdentityScope,
    createArtistLookupController: () => createArtistLookupController({ clock: () => now }),
    Date: { now: () => now },
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { at: now + delay, fn }); return id; },
    clearTimeout: (id) => timers.delete(id),
  };
  const hook = new Function(...Object.keys(bindings), `${body}\nreturn useCanonicalArtistIdentity;`)(...Object.values(bindings));
  return {
    calls, store,
    render(next = props) {
      props = next; cursor = 0; effects = [];
      const result = hook(props);
      for (const effect of effects) effect();
      return result;
    },
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test("canonical lookup keeps typed failure, enforces exact deadline and only retries manually", async () => {
  const f = fixture();
  try {
    f.render(); await settle();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].options.throwOnError, true);
    assert.ok(f.calls[0].options.signal instanceof AbortSignal);
    const error = Object.assign(new Error("Provider down"), { serverCode: "PROVIDER_UNAVAILABLE", status: 502, retryAt: 7_201_000, retryAfterMs: 7_200_000 });
    f.calls[0].reject(error); await settle();
    let state = f.render();
    assert.equal(state.error, error);
    assert.equal(state.missing, false);
    assert.equal(state.retryAt, 7_201_000);
    state.retry(); state.retry(); f.render(); await settle();
    assert.equal(f.calls.length, 1);
    f.advance(7_199_999); state = f.render(); assert.equal(state.retryDisabled, true);
    f.advance(1); state = f.render(); assert.equal(state.retryDisabled, false);
    await settle(); assert.equal(f.calls.length, 1, "deadline expiration only enables the control");
    state.retry(); state.retry(); f.render(); await settle();
    assert.equal(f.calls.length, 2, "rapid retry taps start once before busy renders");
    f.calls[1].resolve({ name: "Requested", key: "exact-stored", transient: false }); await settle();
    state = f.render();
    assert.equal(state.status, "ready"); assert.equal(state.artistKey, "exact-stored");
  } finally { f.dispose(); }
});

test("canonical no-match and preview remain distinct from typed unavailable and never invent keys", async () => {
  for (const result of [null, { name: "Requested", key: "preview", transient: true }, { name: "Other", key: "other" }]) {
    const f = fixture();
    try {
      f.render(); await settle(); f.calls[0].resolve(result); await settle();
      const state = f.render();
      assert.equal(state.status, "unavailable"); assert.equal(state.artistKey, null);
      assert.equal(state.error, null); assert.equal(state.missing, true);
    } finally { f.dispose(); }
  }
});

test("canonical requests abort and cannot publish across route, account roundtrip or unmount", async () => {
  for (const change of ["route", "account", "roundtrip", "unmount"]) {
    const f = fixture();
    try {
      f.render(); await settle();
      const old = f.calls[0];
      if (change === "route") f.render({ artistName: "Other" });
      else if (change === "unmount") f.dispose();
      else {
        f.store.session = { id: "b" }; f.render();
        if (change === "roundtrip") { f.store.session = { id: "a" }; f.render(); }
      }
      assert.equal(old.options.signal.aborted, true, change);
      old.resolve({ name: "Requested", key: "obsolete" }); await settle();
      if (change !== "unmount") assert.notEqual(f.render().artistKey, "obsolete", change);
    } finally { f.dispose(); }
  }
});

test("an explicit stored key never starts a remote identity lookup", async () => {
  const f = fixture();
  try {
    f.render({ artistName: "Requested", artistKey: "stored" }); await settle();
    assert.equal(f.render().artistKey, "stored"); assert.equal(f.calls.length, 0);
  } finally { f.dispose(); }
});
