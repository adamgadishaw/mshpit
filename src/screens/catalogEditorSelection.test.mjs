import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { parse } from "@babel/parser";
import { addCatalogBatchDraft, catalogDraftFromText, catalogExactSelection } from "../features/catalogEditor/catalogEditorApi.mjs";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("./CatalogEditorScreen.jsx", import.meta.url), "utf8");
const component = parse(source, { sourceType: "module", plugins: ["jsx"] }).program.body.find(node => node.type === "ExportDefaultDeclaration").declaration;
const compiled = require("@babel/core").transformSync(`${source.slice(component.start, component.end)}\nmodule.exports = CatalogEditorScreen;`, {
  babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
const key = "ticketmaster:rZ7HnEZaeot";
const row = (value = key) => ({ type: "venue", key: value, identity: { name: "Fixture Toronto Venue" }, protectedFacts: { address: "529 Bloor Street West" },
  content: null, identityCurrent: true, revision: 0, expectedHash: "b".repeat(64) });
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function fixture(session = { id: "admin-a", role: "admin", emailVerified: true }, allowQueue = false) {
  const states = [], refs = [], calls = [], module = { exports: {} };
  let stateIndex = 0, refIndex = 0, effect, cleanup;
  const jsx = (type, props) => ({ type, props });
  new vm.Script(compiled).runInNewContext({
    module, exports: module.exports, require: () => ({ jsx, jsxs: jsx }), AbortController,
    useStore: () => ({ session }), useMemo: fn => fn(),
    useState(initial) { const index = stateIndex++; if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }]; },
    useRef: initial => refs[refIndex++] ||= { current: initial },
    useEffect: setup => { effect = setup; },
    catalogEditorForAccount: accountId => ({
      read: options => new Promise((resolve, reject) => calls.push({ accountId, ...options, resolve, reject })),
      list: options => {
        assert.ok(allowQueue, "Exact selection must not list or paginate");
        return new Promise((resolve, reject) => calls.push({ accountId, ...options, resolve, reject }));
      },
      prepare: () => assert.fail("Opening a key must not prepare a write"),
      save: () => assert.fail("Opening a key must not publish"),
    }),
    addCatalogBatchDraft, catalogDraftFromText, catalogExactSelection,
    View: "View", Text: "Text", TextInput: "TextInput", ScrollView: "ScrollView", SheetHeader: "SheetHeader", Button: "Button", styles: {}, colors: {},
  });
  const render = () => { stateIndex = 0; refIndex = 0; return module.exports({ onClose() {} }); };
  const find = (type, prop, value) => nodes(render()).find(node => node.type === type && node.props[prop] === value);
  render(); cleanup = effect();
  return { calls, render, unmount: () => cleanup(),
    button: title => find("Button", "title", title), input: label => find("TextInput", "accessibilityLabel", label),
    alert: () => nodes(render()).find(node => node.props?.accessibilityRole === "alert")?.props.children,
    open(value = key, type = "Venues") {
      find("Button", "title", type).props.onPress();
      find("TextInput", "accessibilityLabel", "Exact catalog key").props.onChangeText(value);
      return find("Button", "title", "Open by catalog key").props.onPress();
    },
  };
}

test("real editor opens a provider key directly, serializes repeat clicks, and preserves key case", async () => {
  const f = fixture(), pending = f.open();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].accountId, "admin-a"); assert.equal(f.calls[0].type, "venue"); assert.equal(f.calls[0].key, key);
  assert.equal(f.button("Open by catalog key").props.disabled, true);
  f.button("Open by catalog key").props.onPress(); assert.equal(f.calls.length, 1);
  f.calls[0].resolve(row()); await pending;
  assert.equal(f.alert(), undefined);
  assert.ok(nodes(f.render()).some(node => node.type === "Text" && node.props.children === "Fixture Toronto Venue"));
  assert.equal(f.button("Open by catalog key").props.disabled, false);
});

test("invalid, wrong-type and unavailable exact keys report actionable errors without falling back to name search", async () => {
  const f = fixture(); f.open("rZ7HnEZaeot");
  assert.match(f.alert(), /source and exact provider ID/); assert.equal(f.calls.length, 0);
  for (const [type, label] of [["artist", "Artists"], ["venue", "Venues"]]) {
    const pending = f.open(key, label), request = f.calls.at(-1);
    assert.equal(request.type, type);
    request.reject(Object.assign(new Error("Unavailable"), { status: 404 })); await pending;
    assert.equal(f.alert(), `No eligible ${type} matches this exact key. Check the page type, source and letter case.`);
    assert.equal(f.input("Sourced page text"), undefined);
  }
  assert.equal(f.calls.length, 2);
});

test("exact selection preserves an unstaged draft until explicit discard and captures the chosen type/key", async () => {
  const f = fixture(), initial = f.open(); f.calls[0].resolve(row()); await initial;
  f.input("Sourced page text").props.onChangeText("Unstaged context");
  f.open("ticketmaster:other"); assert.equal(f.calls.length, 1);
  f.button("Keep editing").props.onPress();
  assert.equal(f.input("Sourced page text").props.value, "Unstaged context");
  f.open("ticketmaster:other"); f.button("Events").props.onPress();
  const pending = f.button("Discard and open page").props.onPress();
  assert.equal(f.calls[1].type, "venue"); assert.equal(f.calls[1].key, "ticketmaster:other");
  f.calls[1].resolve(row("ticketmaster:other")); await pending;
  assert.equal(f.input("Sourced page text").props.value, "");
  assert.equal(f.button("Keep editing"), undefined);
});

test("an identity-mismatched read cannot replace the selected page or its draft", async () => {
  const f = fixture(), initial = f.open(); f.calls[0].resolve(row()); await initial;
  f.input("Sourced page text").props.onChangeText("Keep this context"); f.open("ticketmaster:other");
  const pending = f.button("Discard and open page").props.onPress();
  f.calls[1].resolve({ ...row("ticketmaster:other"), type: "artist" }); await pending;
  assert.match(f.alert(), /identity did not match/);
  assert.equal(f.input("Sourced page text").props.value, "Keep this context");
});

test("account-keyed editor remounts isolate A to B to guest and ignore late reads and errors", async () => {
  const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  function all(value) { return !value || typeof value !== "object" ? [] : [value, ...Object.values(value).flatMap(item => Array.isArray(item) ? item.flatMap(all) : all(item))]; }
  const opening = all(parse(app, { sourceType: "module", plugins: ["jsx"] })).find(node => node.type === "JSXOpeningElement" && node.name?.name === "CatalogEditorScreen");
  const expression = opening.attributes.find(attribute => attribute.name?.name === "key").value.expression;
  const keyFor = session => vm.runInNewContext(app.slice(expression.start, expression.end), { session });
  assert.equal(new Set([{ id: "a", role: "admin" }, { id: "b", role: "admin" }, { id: "b", role: "fan" }, null].map(keyFor)).size, 4);
  const a = fixture(), pendingA = a.open(); a.unmount(); assert.equal(a.calls[0].signal.aborted, true);
  const b = fixture({ id: "admin-b", role: "admin", emailVerified: true });
  a.calls[0].resolve(row()); await pendingA;
  assert.equal(b.input("Exact catalog key").props.value, ""); assert.equal(b.input("Sourced page text"), undefined);
  const pendingB = b.open(); assert.equal(b.calls[0].accountId, "admin-b"); b.unmount();
  const guest = fixture(null); b.calls[0].reject(new Error("Old account failure")); await pendingB;
  assert.equal(guest.input("Exact catalog key"), undefined); assert.equal(guest.alert(), undefined);
  assert.equal(b.calls[0].signal.aborted, true);
});

test("queue continuation keeps the filter, clears obsolete cursors, retains failed-page data and cancels late reads", async () => {
  const f = fixture(undefined, true);
  f.input("Find catalog pages by name").props.onChangeText("first");
  const initial = f.button("Find pages").props.onPress();
  assert.equal(f.calls[0].cursor, ""); assert.equal(f.calls[0].query, "first");
  assert.equal(f.calls[0].accountId, "admin-a"); assert.equal(f.calls[0].missingOnly, true);
  f.calls[0].resolve({ items: [], nextCursor: "artist-149", scanLimitReached: true }); await initial;
  assert.ok(f.button("Continue search"));
  const failed = f.button("Continue search").props.onPress();
  assert.equal(f.calls[1].cursor, "artist-149"); assert.equal(f.calls[1].query, "first");
  f.calls[1].reject(new Error("Temporary fixture failure")); await failed;
  assert.match(f.alert(), /Temporary fixture failure/); assert.ok(f.button("Continue search"));
  f.input("Find catalog pages by name").props.onChangeText("second");
  assert.equal(f.button("Continue search"), undefined);
  const changed = f.button("Find pages").props.onPress();
  assert.equal(f.calls[2].cursor, ""); assert.equal(f.calls[2].query, "second");
  f.calls[2].resolve({ items: [], nextCursor: null, scanLimitReached: false }); await changed;
  assert.equal(f.button("Next page"), undefined);
  assert.ok(nodes(f.render()).some(node => node.props?.children === "No more matching pages for these filters."));
  const pending = f.button("Find pages").props.onPress();
  f.unmount(); assert.equal(f.calls[3].signal.aborted, true);
  f.calls[3].resolve({ items: [], nextCursor: "stale", scanLimitReached: true }); await pending;
  assert.equal(f.button("Continue search"), undefined);
});
