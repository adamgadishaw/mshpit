import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";
import * as domain from "../../domain/concertLookup.mjs";
const require = createRequire(import.meta.url);
const implementation = transformSync(readFileSync(new URL("./ConcertLookup.jsx", import.meta.url), "utf8"), {
  filename: "ConcertLookup.jsx", configFile: false, babelrc: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
function fixture(initial = {}) {
  const slots = [], effects = [], calls = [], selections = [], timers = new Map();
  let cursor = 0, serial = 0, tree;
  const hooks = {
    useState(value) { const index = cursor++; slots[index] ??= { value: typeof value === "function" ? value() : value };
      return [slots[index].value, next => { slots[index].value = typeof next === "function" ? next(slots[index].value) : next; }]; },
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useEffect(create, dependencies) { const index = cursor++; if (same(slots[index]?.dependencies, dependencies)) return;
      const old = slots[index]; slots[index] = { dependencies }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = create(); }); },
  };
  const mod = { exports: {} };
  const imports = name => {
    if (name === "react") return hooks;
    if (name === "react-native") return { View: "View", Text: "Text", Pressable: "Pressable", StyleSheet: { create: value => value } };
    if (name === "../../theme") return { colors: {}, radius: {} };
    if (name === "../../domain/concertLookup.mjs") return domain;
    if (name === "./concertLookupApi") return { readConcertMatches: () => { throw new Error("Unexpected live transport"); } };
    return require(name);
  };
  new Function("require", "module", "exports", "setTimeout", "clearTimeout", implementation)(imports, mod, mod.exports,
    callback => { const id = ++serial; timers.set(id, callback); return id; }, id => timers.delete(id));
  let props = { artist: "Real Artist", artistKey: "real artist", city: "Toronto", date: "2018-04-20", accountId: "member-one", venue: "",
    readMatches: (query, options) => { const call = deferred(); calls.push({ query, options, ...call }); return call.promise; },
    onSelect: row => selections.push(row), ...initial };
  const render = (changes = {}) => { props = { ...props, ...changes }; cursor = 0; tree = mod.exports.default(props); for (const effect of effects.splice(0)) effect(); };
  const walk = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)];
  const buttons = () => walk(tree).filter(node => node.type === "Pressable").map(node => node.props);
  const text = () => JSON.stringify(walk(tree).filter(node => node.type === "Text").map(node => node.props.children));
  const start = async () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } await tick(); render(); };
  const unmount = () => { for (const slot of slots) slot?.cleanup?.(); };
  render(); return { render, start, calls, buttons, text, selections, unmount };
}
const row = { id: "tm_first", eventId: "tm_first", artist: "Real Artist", artistKey: "real artist", venue: "Real Room", city: "Toronto", date: "2018-04-20", source: "catalog" };
test("catalog matches arrive independently and survive a provider failure, with manual fallback copy", async () => {
  const f = fixture(); await f.start(); assert.equal(f.calls.length, 2);
  f.calls[0].resolve({ matches: [row], complete: true }); await tick(); f.render();
  assert.match(f.text(), /Real Room/); assert.match(f.text(), /Finding matching/);
  f.calls[1].reject(new Error("offline")); await tick(); f.render();
  assert.match(f.text(), /could not refresh/); assert.match(f.text(), /enter it below/);
  f.buttons().find(button => button.accessibilityLabel.startsWith("Use concert:")).onPress();
  assert.deepEqual(f.selections, [row]); f.unmount();
});
test("in-flight artist, city, date and account changes reject late results and captured old selections", async () => {
  for (const change of [{ artist: "Other Artist", artistKey: "other artist" }, { city: "London" }, { date: "2018-04-21" }, { accountId: "member-two" }]) {
    const f = fixture(); await f.start();
    f.calls[0].resolve({ matches: [row] }); await tick(); f.render();
    const captured = f.buttons()[0];
    f.render(change); captured.onPress(); assert.equal(f.selections.length, 0);
    assert.equal(f.calls[0].options.signal.aborted, true);
    f.calls[1].resolve({ matches: [{ ...row, venue: "Stale Room" }] }); await tick(); f.render();
    assert.doesNotMatch(f.text(), /Stale Room|Real Room/);
    await f.start(); assert.equal(f.calls.length, 4);
    f.calls[2].resolve({ matches: [] }); f.calls[3].resolve({ matches: [] }); await tick(); f.render();
    assert.match(f.text(), /No matching concerts/); f.unmount();
  }
});
test("unmounted and busy composers cannot apply a captured selection", async () => {
  for (const retire of [f => f.render({ disabled: true }), f => f.unmount()]) {
    const f = fixture(); await f.start(); f.calls[0].resolve({ matches: [row] }); await tick(); f.render();
    const captured = f.buttons()[0]; retire(f); captured.onPress(); assert.equal(f.selections.length, 0); f.unmount();
  }
});
test("unknown dates and guests do not issue lookup, and clearing a date cancels both sources", async () => {
  for (const initial of [{ date: "" }, { accountId: null }, { city: "" }, { artist: "" }]) {
    const f = fixture(initial); await f.start(); assert.equal(f.calls.length, 0); f.unmount();
  }
  const f = fixture(); await f.start(); f.render({ date: "" });
  assert.ok(f.calls.every(call => call.options.signal.aborted)); f.unmount();
});
test("same provider match is shown once and exact local date/account reach transport", async () => {
  const f = fixture(); await f.start();
  for (const call of f.calls) { assert.equal(call.query.date, "2018-04-20"); assert.equal(call.options.accountId, "member-one"); call.resolve({ matches: [row] }); }
  await tick(); f.render(); assert.equal(f.buttons().filter(button => button.accessibilityLabel?.startsWith("Use concert:")).length, 1); f.unmount();
});
test("typing several query revisions before debounce sends only the final selection", async () => {
  const f = fixture({ city: "T" }); f.render({ city: "To" }); f.render({ city: "Tor" }); f.render({ city: "Toronto" });
  await f.start(); assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(call => call.query.city === "Toronto")); f.unmount();
});
