import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";
import { parse } from "@babel/parser";
import * as programme from "../../domain/discoverProgramme.mjs";
import * as range from "../../domain/discoverEventRange.mjs";
import * as view from "../../domain/discoverView.mjs";
import * as dates from "../../domain/dataPolicy.mjs";
import * as live from "../../domain/liveDiscovery.mjs";
import * as initials from "../../domain/artistInitials.mjs";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("./DiscoverBrowse.ios.jsx", import.meta.url), "utf8");
function fixture({ fontScale = 1, width = 393 } = {}) {
  const state = [], refs = [], dimensions = { width, fontScale };
  let cursor = 0, refCursor = 0;
  const jsx = (type, props) => ({ type, props });
  const react = {
    useMemo: (fn) => fn(), useEffect: () => {}, useRef: (value) => {
      const i = refCursor++; return refs[i] ||= { current: value };
    },
    useState: (initial) => {
      const i = cursor++;
      if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial;
      return [state[i], (next) => { state[i] = typeof next === "function" ? next(state[i]) : next; }];
    },
  };
  const fill = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 };
  const modules = {
    react, "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": {
      ActivityIndicator: "ActivityIndicator", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View",
      StyleSheet: { create: (value) => value, absoluteFill: fill, absoluteFillObject: fill, hairlineWidth: 1 }, useWindowDimensions: () => dimensions,
    },
    "expo-image": { Image: "Image" }, "../../theme": { colors: new Proxy({}, { get: () => "#F2A65A" }) },
    "../Icon": "Icon", "../VinylRefreshBoundary": "RefreshBoundary", "./DiscoverEventList": "EventList",
    "../LiveDiscoveryCards": { PopularLoungeCard: "Lounge" },
    "../../domain/discoverProgramme.mjs": programme, "../../domain/discoverEventRange.mjs": range,
    "../../domain/discoverView.mjs": view, "../../domain/dataPolicy.mjs": dates,
    "../../domain/liveDiscovery.mjs": live, "../../domain/artistInitials.mjs": initials,
    "../../lib/img": { isHttp: (uri) => /^http/.test(uri), proxied: (uri) => `proxy:${uri}` },
  };
  const code = transformSync(source, { filename: "DiscoverBrowse.ios.jsx", babelrc: false, configFile: false,
    plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")] }).code;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name];
  }, module, module.exports);
  return { exports: module.exports, dimensions, render: (fn, props) => { cursor = 0; refCursor = 0; return fn(props); } };
}
function nodes(tree) {
  if (!tree) return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
const text = (tree) => nodes(tree).filter((node) => node.type === "Text").flatMap((node) => node.props.children).filter((value) => typeof value === "string").join(" ");
const named = (tree, name) => nodes(tree).find((node) => node.type?.name === name);
const props = (overrides = {}) => ({ programme: "shows", region: "Worldwide", countries: [{ country: "Worldwide" }, { country: "Canada" }],
  chart: { rows: [{ name: "Real Artist", genre: "rock", photo: "file://artist" }] }, overviewStatus: "ready", genres: [{ genre: "rock", count: 2 }],
  selectedGenre: "rock", genreRows: [], genreStatus: "ready", query: "", slides: [], events: [], rangeEvents: [],
  eventRecovery: { kind: "empty", message: "No events are listed here.", nextDays: 60, worldwide: false }, eventStatus: "ready",
  rangeHasMore: false, selectedRangeDays: 30, eventView: "cards", listView: false, loungeRows: [], panels: {}, ...overrides });

test("iOS presentation is gated and the alternate entry is inert", () => {
  const screen = readFileSync(new URL("../../screens/DiscoverScreen.jsx", import.meta.url), "utf8");
  const ast = parse(screen, { sourceType: "module", plugins: ["jsx"] });
  const fn = ast.program.body.find((node) => node.type === "ExportDefaultDeclaration").declaration;
  const branch = fn.body.body.find((node) => node.type === "IfStatement" && node.consequent.type === "ReturnStatement");
  assert.equal(screen.slice(branch.test.start, branch.test.end), 'Platform.OS === "ios"');
  assert.equal(branch.consequent.argument.openingElement.name.name, "DiscoverBrowse");
  assert.equal(fn.body.body.at(-1).type, "ReturnStatement");
  const fallback = readFileSync(new URL("./DiscoverBrowse.jsx", import.meta.url), "utf8");
  assert.match(fallback, /return null/); assert.doesNotMatch(fallback, /from |fetch|useEffect/);
});

test("all six category destinations keep exact route keys and selected state", () => {
  const c = fixture(), choices = [];
  const tree = c.render(c.exports.BrowseCategories, { selected: "artists", onSelect: (key) => choices.push(key) });
  const tabs = nodes(tree).filter((node) => node.props.accessibilityRole === "tab");
  assert.equal(tabs.length, 6);
  tabs.forEach((node) => node.props.onPress());
  assert.deepEqual(choices, programme.DISCOVER_PROGRAMME_SECTIONS.map((section) => section.key));
  assert.equal(tabs.find((node) => node.props.nativeID === "discover-tab-artists").props.accessibilityState.selected, true);
});

test("horizontal browses use native directional scrolling and no auto advancing timer", () => {
  const c = fixture(), tree = c.render(c.exports.BrowseRail, { label: "Artists", cardWidth: 154 });
  assert.equal(tree.props.horizontal, true); assert.equal(tree.props.directionalLockEnabled, true);
  assert.equal(tree.props.snapToInterval, 166); assert.equal(tree.props.decelerationRate, "fast");
  assert.doesNotMatch(source, /setInterval|PanResponder|setTimeout|onStartShouldSetResponderCapture/);
});

test("real artist hero fallback never invents a show and opens the original artist", () => {
  const c = fixture(), artist = { name: "Actual artist", genre: "pop", photo: "file://one" }; let chosen;
  const tree = c.render(c.exports.FeaturedRail, { slides: [], artists: [artist], width: 393, onOpenArtist: (row) => { chosen = row; } });
  const card = nodes(tree).find((node) => node.props.accessibilityLabel?.startsWith("Open Actual artist"));
  card.props.onPress(); assert.equal(chosen, artist); assert.match(text(tree), /ARTIST SPOTLIGHT/); assert.doesNotMatch(text(tree), /LIVE MUSIC/);
});

test("event hero retains the actual event, date, creator and exact source/license metadata", () => {
  const c = fixture(); let chosen;
  const media = { uri: "https://example.com/photo.jpg", by: "Actual photographer", sourcePage: "https://example.com/photo", license: "CC BY 4.0", licenseUrl: "https://example.com/license" };
  const event = { id: "real-show", artist: "Actual artist", date: "2026-11-11" };
  const tree = c.render(c.exports.FeaturedRail, { slides: [{ id: "slide", title: "Actual artist", date: event.date, event, media }], width: 393, onOpen: (row) => { chosen = row; } });
  nodes(tree).find((node) => node.props.accessibilityRole === "button").props.onPress();
  assert.equal(chosen.id, event.id); assert.equal(chosen.date, event.date);
  assert.deepEqual(chosen.discoverPhotoCredit, { creator: media.by, sourcePage: media.sourcePage, license: media.license, licenseUrl: media.licenseUrl });
  assert.equal(c.exports.browseDate("2026-11-11"), "Nov 11");
  assert.equal(c.exports.browseDate("not a date"), "Date to be announced");
});

test("artwork uses neutral initials while loading, handles errors by URI and does not proxy event photos", () => {
  const c = fixture(), fn = c.exports.BrowseArtwork;
  let tree = c.render(fn, { uri: "https://example.com/one", name: "Actual Artist" });
  assert.match(text(tree), /AA/);
  const previous = nodes(tree).find((node) => node.type === "Image");
  assert.equal(previous.props.source.uri, "https://example.com/one"); previous.props.onError();
  tree = c.render(fn, { uri: "https://example.com/one", name: "Actual Artist" }); assert.equal(nodes(tree).some((node) => node.type === "Image"), false);
  tree = c.render(fn, { uri: "https://example.com/two", name: "Next Artist" }); previous.props.onError();
  tree = c.render(fn, { uri: "https://example.com/two", name: "Next Artist" }); assert.equal(nodes(tree).find((node) => node.type === "Image").props.source.uri, "https://example.com/two");
});

test("artist and hero names remain untruncated at accessibility text sizes", () => {
  const c = fixture({ fontScale: 2, width: 320 }), artist = { name: "An extraordinarily long real artist title with lots of words", genre: "Alternative rock" };
  for (const [fn, input] of [[c.exports.ArtistRail, { rows: [artist] }], [c.exports.FeaturedRail, { artists: [artist], width: 320 }]]) {
    const tree = c.render(fn, input), title = nodes(tree).find((node) => node.type === "Text" && node.props.children === artist.name);
    assert.ok(title); assert.equal(title.props.numberOfLines, undefined);
  }
  const normal = fixture(), normalTree = normal.render(normal.exports.default, props());
  const largeTree = c.render(c.exports.default, props());
  assert.ok(named(largeTree, "ArtistRail").props.cardWidth >= named(normalTree, "ArtistRail").props.cardWidth);
});

test("region selection, range recovery, and genre selection call the existing owners", () => {
  const c = fixture(), selected = [];
  const p = props({ onRegion: (value) => selected.push(["region", value]), onGenre: (value) => selected.push(["genre", value]),
    onProgramme: (value) => selected.push(["programme", value]), onQuery: (value) => selected.push(["query", value]) });
  let tree = c.render(c.exports.default, p);
  nodes(tree).find((node) => node.props.accessibilityLabel?.startsWith("Choose an area to explore.")).props.onPress();
  tree = c.render(c.exports.default, p);
  nodes(tree).find((node) => node.props.accessibilityRole === "radio" && node.props.accessibilityLabel === "Canada").props.onPress();
  named(tree, "GenreBrowse").props.onSelect("rock");
  assert.deepEqual(selected, [["region", "Canada"], ["genre", "rock"], ["query", ""], ["programme", "artists"]]);
  const calls = [];
  const recovery = c.render(c.exports.Recovery, { recovery: { kind: "error", message: "Could not load", nextDays: 60, worldwide: true }, onRetry: () => calls.push("retry"), onRange: (days) => calls.push(days), onWorldwide: () => calls.push("world") });
  nodes(recovery).filter((node) => node.type?.name === "TextAction").forEach((node) => node.props.onPress());
  assert.deepEqual(calls, ["retry", 60, "world"]);
});

test("weekly list and every secondary destination preserve original components and callbacks", () => {
  const c = fixture(), open = () => {}, change = () => {}, event = { id: "real", artist: "Artist" };
  const tree = c.render(c.exports.default, props({ eventRecovery: null, listView: true, rangeEvents: [event], onOpen: open, onEventWeek: change }));
  const list = nodes(tree).find((node) => node.type === "EventList");
  assert.equal(list.props.events[0], event); assert.equal(list.props.onOpen, open); assert.equal(list.props.onWeekChange, change);
  for (const destination of ["cities", "venues", "festivals", "photos"]) {
    const panel = { type: "OriginalPanel", props: { destination } };
    const rendered = c.render(c.exports.default, props({ programme: destination, panels: { [destination]: panel } }));
    assert.ok(nodes(rendered).includes(panel)); assert.equal(named(rendered, "FeaturedRail"), undefined);
  }
});

test("search uses existing filters and exposes clear-search recovery", () => {
  const c = fixture(), changes = [];
  const tree = c.render(c.exports.default, props({ programme: "artists", query: "zzzz", onQuery: (value) => changes.push(value) }));
  assert.match(text(tree), /No matches/);
  nodes(tree).find((node) => node.props.accessibilityLabel === "Clear artist search").props.onPress(); assert.deepEqual(changes, [""]);
  assert.equal(named(tree, "GenreBrowse"), undefined);
});

test("pull refresh and stale-result retry retain the existing aggregate refresh", () => {
  const c = fixture(), refresh = () => {}, tree = c.render(c.exports.default, props({ onRefresh: refresh, refreshing: true, refreshError: true }));
  assert.equal(tree.type, "RefreshBoundary"); assert.equal(tree.props.onRefresh, refresh); assert.equal(tree.props.refreshing, true);
  assert.match(text(tree), /current results are still here/);
  assert.equal(nodes(tree).find((node) => node.type?.name === "TextAction" && node.props.children === "Retry").props.onPress, refresh);
});

test("choosing a genre foregrounds its results instead of placing them below the editorial hero", () => {
  const c = fixture(), onGenre = () => {}, onProgramme = () => {}, onQuery = () => {};
  let tree = c.render(c.exports.default, props({ onGenre, onProgramme, onQuery }));
  named(tree, "GenreBrowse").props.onSelect("rock");
  const row = { name: "Real rock artist", genre: "rock" };
  tree = c.render(c.exports.default, props({ programme: "artists", genreRows: [row], onGenre, onProgramme, onQuery }));
  assert.equal(named(tree, "FeaturedRail"), undefined);
  assert.equal(named(tree, "ArtistRail").props.rows[0], row);
  const all = nodes(tree).find((node) => node.type?.name === "SectionHeader" && node.props.action === "All artists");
  assert.ok(all); all.props.onPress();
  tree = c.render(c.exports.default, props({ programme: "artists", genreRows: [row], onGenre, onProgramme, onQuery }));
  assert.ok(named(tree, "FeaturedRail"));
});

test("recent attendance still reaches canonical artists without fabricating recommendations", () => {
  const c = fixture(), artist = { name: "Real Artist", artistKey: "canonical", publicSlug: "real-artist", photo: "file://artist" };
  const tree = c.render(c.exports.default, props({ programme: "artists", chart: { rows: [artist] },
    attendanceRows: [{ artist: "Real Artist", artistKey: "canonical", state: "went", date: "2026-11-01" }] }));
  const rail = nodes(tree).find((node) => node.type?.name === "ArtistRail" && node.props.title === "From shows you attended");
  assert.equal(rail.props.rows.length, 1); assert.equal(rail.props.rows[0].publicSlug, "real-artist");
  assert.equal(rail.props.rows[0].discoveryReason, "Recently attended");
});

test("Discover headings reflow live at larger text sizes without replacing browse state", () => {
  const c = fixture(), select = () => {};
  const artistTree = c.render(c.exports.ArtistRail, { rows: [{ name: "A long artist name" }], title: "Your favorite artists", action: "See all", onAction: select });
  const heading = named(artistTree, "SectionHeader");
  const flatten = (value) => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flatten)) : value || {};
  for (const fontScale of [1, 2, 3.1, 1]) {
    c.dimensions.fontScale = fontScale;
    const tree = c.render(heading.type, heading.props);
    assert.equal(flatten(tree.props.style).flexDirection, fontScale > 1.25 ? "column" : "row");
    assert.equal(flatten(tree.props.children[0].props.style).flex, fontScale > 1.25 ? 0 : 1, "stacked heading keeps its intrinsic text height");
    const action = named(tree, "TextAction");
    assert.equal(action.props.onPress, select);
    assert.equal(heading.type, named(artistTree, "SectionHeader").type);
  }
  assert.doesNotMatch(source, /key=\{[^}]*fontScale/);
});
