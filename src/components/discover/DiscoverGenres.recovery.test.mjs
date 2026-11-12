import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";
import { parse } from "@babel/parser";
import * as discoverView from "../../domain/discoverView.mjs";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("./DiscoverGenres.jsx", import.meta.url), "utf8");
const screen = readFileSync(new URL("../../screens/DiscoverScreen.jsx", import.meta.url), "utf8");
let requestNode;
function visit(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "VariableDeclarator" && node.id?.name === "requestGenre") requestNode = node.init.arguments[0];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value?.type) visit(value);
  }
}
visit(parse(screen, { sourceType: "module", plugins: ["jsx"] }));

const jsx = (type, props) => typeof type === "function" ? type(props) : { type, props };
const theme = { colors: new Proxy({}, { get: () => "#111111" }), radius: {}, shadow: { card: {} } };
const dependencies = {
  "../NativeTabScroll": { ScrollView: "ScrollView" },
  react: { memo: value => value, useMemo: fn => fn() },
  "react/jsx-runtime": { jsx, jsxs: jsx },
  "react-native": { ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View", StyleSheet: { create: value => value }, Platform: { OS: "ios", select: value => value.ios ?? value.default } },
  "../../theme": theme, "../Icon": "Icon", "./DiscoverPrimitives": { SectionHeading: "SectionHeading" },
  "./DiscoverArtistCard": { DiscoverArtistGrid: "ArtistGrid" }, "../../domain/discoverView.mjs": discoverView,
};
const code = transformSync(source, { filename: "DiscoverGenres.jsx", babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")] }).code;
const module = { exports: {} };
new Function("require", "module", "exports", code)(name => {
  assert.ok(name in dependencies, `mock for ${name}`); return dependencies[name];
}, module, module.exports);
const DiscoverGenres = module.exports.default;
const nodes = tree => !tree ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : typeof tree === "object" ? [tree, ...nodes(tree.props?.children)] : [];
const names = tree => nodes(tree).filter(node => node.type === "ArtistGrid").flatMap(node => node.props.rows.map(row => row.name));
const text = tree => nodes(tree).filter(node => node.type === "Text").flatMap(node => node.props.children).filter(value => typeof value === "string").join(" ");

function fixture(ranked) {
  const genreScopeKey = "canada|rock", calls = [];
  const rows = { current: {} }, request = { current: { sequence: 0, controller: null } };
  let state = { status: "idle" };
  const bindings = {
    ...discoverView, genreRequestRef: request, selectedGenre: "rock", genreScopeKey, region: "Canada",
    genreResultsRef: rows, setGenreRequestState: value => { state = value; },
    setGenreResults: update => { rows.current = update(rows.current); },
    genreLoaderRef: { current: options => new Promise((resolve, reject) => calls.push({ ...options, resolve, reject })) },
  };
  const load = new Function(...Object.keys(bindings), `return (${screen.slice(requestNode.start, requestNode.end)});`)(...Object.values(bindings));
  return { calls, load, row: name => ({ name, genre: "rock", ...(ranked ? { rankingGroup: "popular" } : {}) }), render: () => DiscoverGenres({
    genres: [{ genre: "rock", count: 2 }], selected: "rock", total: 2, rows: rows.current[genreScopeKey] || [], fallbackRows: [], attendanceRows: [],
    status: state.status, region: "Canada", onRetry: () => load({ force: true }),
  }) };
}

for (const ranked of [true, false]) test(`genre ${ranked ? "ranked" : "spotlight"} cards remain visible after refresh failure and recover through their retry button`, async () => {
  const f = fixture(ranked), first = f.load(); f.calls[0].resolve({ rows: [f.row("First artist")] }); await first;
  assert.deepEqual(names(f.render()), ["First artist"]);
  const failed = f.load({ force: true }); f.calls[1].reject(new Error("fixture offline")); assert.equal(await failed, false);
  let tree = f.render(); assert.deepEqual(names(tree), ["First artist"]); assert.match(text(tree), /Showing the last artists/);
  const retry = nodes(tree).find(node => node.props.accessibilityLabel === "Retry loading Rock").props.onPress();
  assert.equal(f.calls[2].force, true); assert.deepEqual(names(f.render()), ["First artist"]);
  f.calls[2].resolve({ rows: [f.row("Fresh artist")] }); assert.equal(await retry, true);
  tree = f.render(); assert.deepEqual(names(tree), ["Fresh artist"]); assert.doesNotMatch(text(tree), /Could not/);
});

test("an initial genre failure shows retry without an unrelated empty-state message", async () => {
  const f = fixture(false), failed = f.load(); f.calls[0].reject(new Error("fixture offline")); await failed;
  const tree = f.render(); assert.deepEqual(names(tree), []); assert.match(text(tree), /Could not load this genre/);
  assert.doesNotMatch(text(tree), /More artist suggestions/);
});
