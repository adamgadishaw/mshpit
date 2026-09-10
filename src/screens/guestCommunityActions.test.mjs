import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import { accountTargetScope, scopedScreenValue } from "../domain/screenScope.mjs";
import { refreshScope } from "../domain/scopedRefresh.mjs";

const require = createRequire(import.meta.url);
const { transformSync, parseSync } = require("@babel/core");
const jsxPlugin = require("@babel/plugin-transform-react-jsx");
const modulePlugin = require("@babel/plugin-transform-modules-commonjs");
const sourceOf = (name) => readFileSync(new URL(`./${name}.jsx`, import.meta.url), "utf8");

function screenFixture(name, session = null, { loungeStatus = "open", provideAuth = true } = {}) {
  const calls = { auth: [], join: [], enter: [], poll: [], publicClub: [] };
  let stateIndex = 0;
  const jsx = (type, props) => ({ type, props });
  const store = {
    session, chatAuthEpoch: 0, concertKey: () => "night", loungeFor: () => [], attendeesFor: () => [],
    fanClubFor: () => [], fanClubCount: () => 3, isFanClubMember: () => false,
    fanClubsDirectory: () => [{ artist: "Example", members: 3, messages: 0 }],
    fanClubDirectoryStatus: "ready", artistsAlphabetical: () => [],
    enterLounge: async (...args) => { calls.enter.push(args); return { ok: true }; },
    joinFanClub: async (...args) => { calls.join.push(args); return { ok: true, joined: true }; },
  };
  const noop = () => {};
  const dependencies = {
    react: {
      useEffect: noop, useRef: (current) => ({ current }),
      useState(initial) {
        const index = stateIndex++;
        let value = name === "LoungeScreen" && index === 1
          ? { key: "night", status: loungeStatus }
          : typeof initial === "function" ? initial() : initial;
        return [value, (next) => { value = typeof next === "function" ? next(value) : next; }];
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": {
      View: "View", Text: "Text", ScrollView: "ScrollView", TextInput: "TextInput", Pressable: "Pressable",
      KeyboardAvoidingView: "KeyboardAvoidingView", Platform: { OS: "web" },
      StyleSheet: { create: (styles) => styles, absoluteFill: {} },
    },
    "../theme": { colors: {}, radius: {}, mono: "mono", space: (n) => n * 4 },
    "../store": { useStore: () => store, isStaff: () => false },
    "../seed/ingested": { artistMeta: () => null },
    "../lib/api": { api: () => assert.fail("A guest action must not make a protected request") },
    "../lib/useLiveChat": (_read, options) => calls.poll.push(options),
    "../lib/useChatScroll": () => ({ scrollRef: { current: null }, onScroll: noop, onContentSizeChange: noop }),
    "../hooks/useScopedRefresh": () => ({ refresh: noop, refreshing: false }),
    "../domain/screenScope.mjs": { accountTargetScope, scopedScreenValue },
    "../domain/scopedRefresh.mjs": { refreshScope },
    "../domain/showSocial.mjs": { normalizeLoungeMeta: (value) => value },
    "../domain/postAuthor.mjs": { resolvePostAuthor: (value) => value },
    "../domain/artistLegacy.mjs": { isLegacyArtistMemorial: () => false },
    "../domain/fanClubDirectory.mjs": { fanClubSearchResults: () => [] },
    "../features/artistMemorials/useArtistMemorial": {
      useArtistMemorial: () => ({ resource: { data: null }, availability: "living", reload: noop }),
    },
    "../hooks/useCanonicalArtistIdentity": () => ({ artistName: "Example", artistKey: "example", status: "ready", retry: noop }),
  };
  const compiled = transformSync(sourceOf(name), {
    filename: `${name}.jsx`, babelrc: false, configFile: false,
    plugins: [[jsxPlugin, { runtime: "automatic" }], modulePlugin],
  }).code;
  const module = { exports: {} };
  new vm.Script(compiled).runInNewContext({
    module, exports: module.exports, AbortController, setTimeout, clearTimeout,
    require(path) {
      if (Object.hasOwn(dependencies, path)) return dependencies[path];
      if (path.startsWith("../components/")) return path.slice("../components/".length);
      throw new Error(`Unexpected screen dependency: ${path}`);
    },
  });
  const tree = module.exports.default({
    artist: "Example", log: { artist: "Example", venue: "Example Hall" },
    onRequireAuth: provideAuth ? (...args) => calls.auth.push(args) : undefined,
    onOpenFanClub: (...args) => calls.publicClub.push(args),
  });
  return { calls, tree };
}

test("Lounge login does not wait for public room metadata to finish checking", async () => {
  const { calls, tree } = screenFixture("LoungeScreen", null, { loungeStatus: "loading" });
  const button = nodes(tree).find((node) => node.type === "Pressable" && /Log in to/.test(text(node)));
  assert.ok(button);
  assert.equal(button.props.disabled, false);
  await button.props.onPress();
  assert.deepEqual(calls.auth, [[]]);
  assert.deepEqual(calls.enter, []);
});

test("community screens remain safe when an optional login callback is absent", () => {
  for (const name of ["LoungeScreen", "FanClubScreen"]) {
    const { tree } = screenFixture(name, null, { provideAuth: false });
    const button = nodes(tree).find((node) => node.type === "Pressable" && /Log in to/.test(text(node)));
    assert.ok(button);
    assert.equal(button.props.disabled, true);
  }
});

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  if (typeof tree.type === "function") return nodes(tree.type(tree.props));
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  if (tree == null || typeof tree === "boolean") return "";
  return typeof tree === "object" ? text(tree.props?.children) : String(tree);
}

for (const name of ["LoungeScreen", "FanClubScreen"]) {
  test(`${name} guest login control opens auth once without joining, entering, or reading messages`, async () => {
    const { calls, tree } = screenFixture(name);
    const button = nodes(tree).find((node) => node.type === "Pressable" && /Log in to/.test(text(node)));
    assert.ok(button, "the login instruction must be an actionable button");
    assert.ok(!button.props.disabled, "guests can activate login");
    await button.props.onPress({ nativeEvent: { sample: true } });
    assert.deepEqual(calls.auth, [[]], "auth receives no press event and no deferred mutation");
    assert.deepEqual(calls.join, []);
    assert.deepEqual(calls.enter, []);
    assert.ok(calls.poll.every((poll) => poll.enabled === false));
  });
  test(`${name} signed-in entry still performs only its existing member action`, async () => {
    const { calls, tree } = screenFixture(name, { id: "member" });
    const pattern = name === "LoungeScreen" ? /I'm going.*enter/ : /Join the fan club/;
    const button = nodes(tree).find((node) => node.type === "Pressable" && pattern.test(text(node)));
    assert.ok(button);
    assert.ok(!button.props.disabled);
    await button.props.onPress();
    assert.deepEqual(calls.auth, []);
    assert.equal(name === "LoungeScreen" ? calls.enter.length : calls.join.length, 1);
  });
}

test("fan-club directory rows remain public navigation rather than forced login", () => {
  const { calls, tree } = screenFixture("FanClubsScreen");
  const row = nodes(tree).find((node) => node.type === "Pressable" && /Example/.test(text(node)));
  assert.ok(row);
  row.props.onPress();
  assert.deepEqual(calls.publicClub, [["Example"]]);
  assert.deepEqual(calls.auth, []);
});

test("every artist album/song rating handler requests login for guests and writes only for members", () => {
  const source = sourceOf("ArtistScreen");
  const ast = parseSync(source, { filename: "ArtistScreen.jsx", babelrc: false, configFile: false, parserOpts: { plugins: ["jsx"] } });
  const screen = ast.program.body.find((node) => node.type === "ExportDefaultDeclaration").declaration;
  assert.ok(screen.params[0].properties.some((property) => property.key?.name === "onRequireAuth"),
    "the real screen receives the callback used by its rating handlers");
  const handlers = [];
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "JSXOpeningElement" && node.name?.name === "TapStars") {
      const attribute = node.attributes.find((entry) => entry.name?.name === "onChange");
      if (attribute?.value?.expression) handlers.push(attribute.value.expression);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(ast);
  assert.equal(handlers.length, 4, "every visible artist rating surface is covered");
  for (const handler of handlers) {
    for (const session of [null, undefined, { id: "member" }]) {
      const calls = { auth: [], rating: [] };
      const action = vm.runInNewContext(`(${source.slice(handler.start, handler.end)})`, {
        session, a: { name: "Example" }, al: { title: "Album" }, t: { title: "Track" }, s: { title: "Song" },
        onRequireAuth: (...args) => calls.auth.push(args),
        rateAlbum: (...args) => calls.rating.push(args), rateSong: (...args) => calls.rating.push(args),
      });
      action(4.5);
      assert.deepEqual(calls.auth, session ? [] : [[]]);
      assert.equal(calls.rating.length, session ? 1 : 0);
      if (session) assert.equal(calls.rating[0][2], 4.5);
    }
  }
});
