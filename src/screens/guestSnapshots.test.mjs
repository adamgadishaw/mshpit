import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import { artistPageSectionModel } from "../domain/artistPageSections.mjs";
import { venuePageSectionModel } from "../domain/venuePageSections.mjs";

const require = createRequire(import.meta.url);
const { parseSync, transformSync } = require("@babel/core");
const jsxPlugin = require("@babel/plugin-transform-react-jsx");
const modulePlugin = require("@babel/plugin-transform-modules-commonjs");
const read = (name) => readFileSync(new URL(`./${name}.jsx`, import.meta.url), "utf8");
const parse = (source) => parseSync(source, { babelrc: false, configFile: false, parserOpts: { plugins: ["jsx"] } });
function all(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...Object.values(node).flatMap((value) => Array.isArray(value) ? value.flatMap(all) : all(value))];
}
function evaluate(source, node, context) {
  return vm.runInNewContext(`(${source.slice(node.start, node.end)})`, context);
}

test("artist guest snapshot keeps biography and dates but never mounts social or music surfaces", () => {
  for (const section of ["overview", "shows", "about", "community", "music"]) {
    const model = artistPageSectionModel(section, { signedIn: false });
    assert.equal(model.showCommunity, false);
    assert.equal(model.showMusic, false);
    assert.equal(model.loadDiscography, false);
  }
  assert.equal(artistPageSectionModel("shows", { signedIn: false }).showLive, true);
  assert.equal(artistPageSectionModel("about", { signedIn: false }).showAbout, true);
  assert.equal(artistPageSectionModel("community", { signedIn: false }).active, "overview");
  assert.equal(artistPageSectionModel("community", { signedIn: true }).showCommunity, true);
});

test("venue guest snapshot keeps directions and show browsing without full review or media lists", () => {
  const overview = venuePageSectionModel("overview", { signedIn: false });
  assert.equal(overview.showGuide, true);
  assert.equal(overview.showUpcoming, true);
  assert.equal(overview.showReviews, false);
  assert.equal(overview.showPhotos, false);
  assert.equal(overview.showReputation, false, "unfetched community scores are not displayed as zero");
  assert.equal(venuePageSectionModel("shows", { signedIn: false }).showHistory, true);
  assert.equal(venuePageSectionModel("reviews", { signedIn: false }).active, "overview");
  assert.equal(venuePageSectionModel("reviews", { signedIn: true }).showReviews, true);
});

for (const [name, privateSection] of [["ArtistScreen", "community"], ["VenueScreen", "reviews"]]) {
  test(`${name} private tab opens sign-in once without changing the public section`, () => {
    const source = read(name);
    const node = all(parse(source)).find((entry) => entry.type === "VariableDeclarator" && entry.id?.name === "setActiveSection").init;
    for (const session of [null, { id: "member" }]) {
      const calls = { auth: [], select: [], scroll: [] };
      const action = evaluate(source, node, {
        session, a: { profileKey: "artist" }, venue: { name: "Room" },
        onRequireAuth: (...args) => calls.auth.push(args),
        setSectionSelection: (...args) => calls.select.push(args),
        pageScroll: { current: { scrollTo: (...args) => calls.scroll.push(args) } },
      });
      action(privateSection);
      assert.equal(calls.auth.length, session ? 0 : 1);
      assert.equal(calls.select.length, session ? 1 : 0);
      if (!session) assert.deepEqual(calls.auth, [[]]);
      calls.auth.length = 0;
      calls.select.length = 0;
      action("shows");
      assert.equal(calls.auth.length, 0);
      assert.equal(calls.select.length, 1);
    }
  });
}

test("public profile neither starts its member history requests nor renders a cached feed", () => {
  const source = read("ProfileScreen");
  const nodes = all(parse(source));
  for (const session of [null, { id: "member" }]) {
    const context = { session, authReady: true, userId: "target", user: { id: "target" }, profileView: { status: "ready" } };
    for (const hook of ["useProfileHistory", "useConcertHistory"]) {
      const call = nodes.find((entry) => entry.type === "CallExpression" && entry.callee?.name === hook);
      const enabled = call.arguments[0].properties.find((property) => property.key?.name === "enabled").value;
      assert.equal(evaluate(source, enabled, context), !!session);
    }
    const logs = nodes.find((entry) => entry.type === "VariableDeclarator" && entry.id?.name === "logs").init;
    const value = evaluate(source, logs, { ...context, historyOwnsLogs: true, history: { posts: ["cached-private-post"] }, EMPTY_LIST: [], cachedLogs: [] });
    assert.equal(value.length, session ? 1 : 0);
  }
  const boundary = nodes.find((entry) => entry.type === "ConditionalExpression"
    && entry.test?.type === "UnaryExpression" && entry.test.argument?.name === "session"
    && entry.consequent?.openingElement?.name?.name === "AccountSnapshotPrompt");
  assert.ok(boundary, "profile identity is followed by a member-content boundary");
  assert.ok(all(boundary.alternate).some((entry) => entry.type === "JSXOpeningElement" && entry.name?.name === "ConcertHistory"));
  assert.ok(all(boundary.alternate).some((entry) => entry.type === "JSXOpeningElement" && entry.name?.name === "ProfileTicketRow"));
});

test("artist snapshot does not resolve top-review requests for anonymous viewers", () => {
  const source = read("ArtistScreen");
  const call = all(parse(source)).find((entry) => entry.type === "CallExpression" && entry.callee?.name === "useArtistTopReviews");
  for (const field of ["name", "artistKey"]) {
    const value = call.arguments[0].properties.find((property) => property.key?.name === field).value;
    assert.equal(evaluate(source, value, { session: null, a: { name: "Example", profileKey: "example" } }), null);
  }
});

test("concert-map deep link waits for the correct member profile layout and scrolls only once", () => {
  const source = read("ProfileScreen");
  const effect = all(parse(source)).find((entry) => entry.type === "CallExpression" && entry.callee?.name === "useEffect"
    && source.slice(entry.start, entry.end).includes('initialSection !== "concert-history"')).arguments[0];
  const scrolls = [];
  const frames = new Map();
  let frameId = 0;
  const flushFrames = () => {
    while (frames.size) {
      const current = [...frames.entries()];
      for (const [id, callback] of current) { frames.delete(id); callback(); }
    }
  };
  const context = {
    initialSection: "concert-history", session: { id: "member" }, user: { id: "target" },
    profileScope: "member:target", concertLayout: { scope: "member:other", y: 150 },
    concertFocusRef: { current: null }, profileScrollRef: { current: { scrollTo: (options) => scrolls.push(options) } },
    history: { status: "loading" }, profileScopeRef: { current: "member:target" },
    concertLayoutRef: { current: { scope: "member:target", y: 150 } },
    requestAnimationFrame: (callback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id) => frames.delete(id),
  };
  evaluate(source, effect, context)();
  assert.equal(scrolls.length, 0);
  context.concertLayout = { scope: context.profileScope, y: 150 };
  evaluate(source, effect, context)();
  flushFrames();
  assert.equal(scrolls.length, 0, "pending history may still insert gallery content above the map");
  context.history.status = "ready";
  evaluate(source, effect, context)();
  context.concertLayoutRef.current.y = 350;
  flushFrames();
  evaluate(source, effect, context)();
  assert.equal(scrolls.length, 1);
  assert.equal(scrolls[0].y, 338, "scroll uses the latest settled layout rather than the loading-state anchor");
  context.session = null;
  context.concertFocusRef.current = null;
  evaluate(source, effect, context)();
  flushFrames();
  assert.equal(scrolls.length, 1);
});

test("snapshot prompt is accessible, optional-callback safe, and never forwards click data to authentication", () => {
  const source = readFileSync(new URL("../components/AccountSnapshotPrompt.jsx", import.meta.url), "utf8");
  const jsx = (type, props) => ({ type, props });
  const module = { exports: {} };
  const code = transformSync(source, { babelrc: false, configFile: false, plugins: [[jsxPlugin, { runtime: "automatic" }], modulePlugin] }).code;
  new vm.Script(code).runInNewContext({ module, exports: module.exports, require: (name) => {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "react-native") return { View: "View", Text: "Text", StyleSheet: { create: (styles) => styles } };
    if (name === "../theme") return { colors: {}, radius: {} };
    if (name === "./Button") return "Button";
    throw new Error(`Unexpected dependency ${name}`);
  } });
  const calls = [];
  for (const onRequireAuth of [undefined, (...args) => calls.push(args)]) {
    const tree = module.exports.default({ title: "Public snapshot", body: "Browse shows", onRequireAuth });
    const button = tree.props.children.find((child) => child.type === "Button");
    assert.equal(button.props.disabled, !onRequireAuth);
    button.props.onPress({ nativeEvent: { target: "photo" } });
  }
  assert.deepEqual(calls, [[]]);
});
