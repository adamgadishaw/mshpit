import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";
import { parse } from "@babel/parser";
import * as browseReturn from "../../domain/iosBrowseReturn.mjs";
import * as programme from "../../domain/discoverProgramme.mjs";
import * as range from "../../domain/discoverEventRange.mjs";
import * as view from "../../domain/discoverView.mjs";
import * as dates from "../../domain/dataPolicy.mjs";
import * as live from "../../domain/liveDiscovery.mjs";
import * as initials from "../../domain/artistInitials.mjs";
import * as artwork from "../../domain/discoverArtistArtwork.mjs";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("./DiscoverBrowse.ios.jsx", import.meta.url), "utf8");
function fixture({ fontScale = 1, width = 393, preview = false } = {}) {
  const state = [], refs = [], dimensions = { width, fontScale };
  let cursor = 0, refCursor = 0, effects = [];
  const jsx = (type, props) => ({ type, props });
  const react = {
    useLayoutEffect: (fn) => { effects.push(fn); }, useMemo: (fn) => fn(), useEffect: (fn) => { effects.push(fn); }, useRef: (value) => {
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
    "../../domain/discoverArtistArtwork.mjs": artwork, "./DiscoverArtistPhotoCredit": "PhotoCredit",
    "../../hooks/useNativeTabPreview": () => preview,
    "../NativeTabScroll": { ScrollView: "ScrollView", TextInput: "TextInput" },
    "../NativeTabSwipeExclusion": "NativeTabSwipeExclusion",
    "../../domain/iosBrowseReturn.mjs": browseReturn,
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
  return { exports: module.exports, dimensions, preview: value => { preview = value; }, flushEffects: () => { const pending = effects; effects = []; pending.forEach((effect) => effect()); }, render: (fn, props) => { cursor = 0; refCursor = 0; effects = []; return fn(props); } };
}
function nodes(tree) {
  if (!tree) return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
const text = (tree) => nodes(tree).filter((node) => node.type === "Text").flatMap((node) => node.props.children).filter((value) => typeof value === "string").join(" ");
const named = (tree, name) => nodes(tree).find((node) => node.type?.name === name);

test("iOS artist and spotlight rails preserve original-only art, its credit and canonical navigation", () => {
  const c = fixture(), artist = { name: "Drake", key: "drake", publicSlug: "drake", photo: null,
    spotifyPhoto: "https://i.scdn.co/image/fixtureDrake", spotifyArtistUrl: "https://open.spotify.com/artist/3TVXtAsR1Inumwj472S9r4",
    photoSource: "spotify", photoCredit: "Spotify", photoDisplayPolicy: "original" };
  for (const kind of ['rail', 'spotlight']) {
    let selected;
    const tree = kind === 'rail' ? c.render(c.exports.ArtistRail, { rows: [artist], onOpen: row => { selected = row; } })
      : c.render(c.exports.FeaturedRail, { artists: [artist], width: 393, onOpenArtist: row => { selected = row; } });
    const image = named(tree, 'BrowseArtwork');
    assert.equal(image.props.uri, artist.spotifyPhoto); assert.equal(image.props.contain, true); assert.equal(image.props.proxy, false);
    const card = nodes(tree).find(node => node.props.accessibilityRole === 'button');
    card.props.onPress(); assert.equal(selected, artist);
    assert.equal(nodes(card).some(node => node.type === 'PhotoCredit'), false, 'source control is a sibling');
    assert.equal(nodes(tree).find(node => node.type === 'PhotoCredit').props.artist, artist);
    assert.doesNotMatch(text(tree), /ARTIST SPOTLIGHT/, 'no badge over original provider artwork');
    const renderedImage = c.render(c.exports.BrowseArtwork, image.props);
    assert.equal(nodes(renderedImage).find(node => node.type === 'Image').props.source.uri, artist.spotifyPhoto);
    assert.equal(nodes(renderedImage).find(node => node.type === 'Image').props.contentFit, 'contain');
  }
});

test("iOS artist and spotlight rails render the verified profile avatar returned by Discover", () => {
  const c = fixture(), artist = { name: "Drake", key: "drake", publicSlug: "drake", photo: "https://profile-art.fixture.invalid/avatar.jpg" };
  for (const kind of ["rail", "spotlight"]) {
    let selected;
    const tree = kind === "rail" ? c.render(c.exports.ArtistRail, { rows: [artist], onOpen: row => { selected = row; } })
      : c.render(c.exports.FeaturedRail, { artists: [artist], width: 320, onOpenArtist: row => { selected = row; } });
    const image = named(tree, "BrowseArtwork");
    assert.equal(image.props.uri, artist.photo);
    const rendered = c.render(c.exports.BrowseArtwork, image.props);
    assert.equal(nodes(rendered).find(node => node.type === "Image").props.source.uri, `proxy:${artist.photo}`);
    nodes(tree).find(node => node.props.accessibilityRole === "button").props.onPress();
    assert.equal(selected, artist);
  }
});
const props = (overrides = {}) => ({ programme: "shows", region: "Worldwide", countries: [{ country: "Worldwide" }, { country: "Canada" }],
  chart: { rows: [{ name: "Real Artist", genre: "rock", photo: "file://artist" }] }, overviewStatus: "ready", genres: [{ genre: "rock", count: 2 }],
  selectedGenre: "rock", genreRows: [], genreStatus: "ready", query: "", slides: [], events: [], rangeEvents: [],
  eventRecovery: { kind: "empty", message: "No events are listed here.", nextDays: 60, worldwide: false }, eventStatus: "ready",
  rangeHasMore: false, selectedRangeDays: 30, eventView: "cards", listView: false, loungeRows: [], panels: {}, ...overrides });

test("native List keeps fallback shows visible while the scoped request recovers", () => {
  const c = fixture();
  const retained = [{ id: "retained-show", artist: "Fixture", date: "2026-11-12" }];
  for (const eventStatus of ["loading", "error"]) {
    const tree = c.render(c.exports.default, props({ eventRecovery: null, eventStatus, eventView: "list", listView: true,
      events: retained, rangeEvents: [], listEvents: retained }));
    assert.equal(nodes(tree).find(node => node.type === "EventList").props.events, retained);
  }
});

test("native event-area controls stack at enlarged text without changing selection or actions", () => {
  const c = fixture({ width: 320, fontScale: 3.1 }), choices = [];
  const tree = c.render(c.exports.default, props({ homeCity: "Saint-Jean-sur-Richelieu", region: "Canada", local: true, onScope: value => choices.push(value) }));
  const area = nodes(tree).find(node => node.props.accessibilityLabel === "Event area");
  const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flatten)) : value || {};
  assert.equal(flatten(area.props.style).flexDirection, "column");
  assert.equal(flatten(area.props.style).width, "100%");
  const options = nodes(area).filter(node => node.props.accessibilityRole === "radio");
  assert.deepEqual(options.map(node => node.props.accessibilityState.checked), [false, true]);
  for (const option of options) {
    assert.ok(flatten(option.props.style({ pressed: false })).minHeight >= 44);
    assert.equal(flatten(option.props.style({ pressed: false })).flexShrink, 0);
  }
  options[0].props.onPress(); options[1].props.onPress();
  assert.deepEqual(choices, [false, true]);
});

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

test("featured artwork has a stable frame while its separate caption grows at the largest text size", () => {
  const c = fixture({ fontScale: 3.1, width: 320 });
  const artist = { name: "A long artist name that must remain fully available", photo: "https://example.com/artist.jpg", genre: "Alternative rock" };
  const tree = c.render(c.exports.FeaturedRail, { artists: [artist], width: 320 });
  const card = nodes(tree).find((node) => node.props.accessibilityRole === "button");
  const children = card.props.children;
  const [artwork, caption] = children;
  assert.equal(artwork.props.style.aspectRatio, 1.6);
  assert.equal(named(artwork, "BrowseArtwork").props.uri, artist.photo);
  assert.equal(named(caption, "BrowseArtwork"), undefined);
  assert.equal(caption.props.style.height, undefined);
  assert.equal(caption.props.style.maxHeight, undefined);
  assert.equal(caption.props.style.position, undefined, "Caption is not an image overlay");
  assert.ok(text(caption).includes(artist.name));
  for (const node of nodes(caption).filter((node) => node.type === "Text")) {
    assert.equal(node.props.numberOfLines, undefined);
    assert.notEqual(node.props.allowFontScaling, false);
  }
  assert.equal(card.props.style({ pressed: false })[0].height, undefined);
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
  const changes = [], c = fixture(), open = () => {}, change = (value) => changes.push(value), event = { id: "real", artist: "Artist" };
  const tree = c.render(c.exports.default, props({ eventRecovery: null, listView: true, rangeEvents: [event], onOpen: open, onEventWeek: change }));
  const list = nodes(tree).find((node) => node.type === "EventList");
  assert.equal(list.props.events[0], event); assert.equal(list.props.onOpen, open); list.props.onWeekChange("2026-11-16"); assert.deepEqual(changes, ["2026-11-16"]);
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


test("Shows leads with upcoming dates rather than an unrelated artist fallback", () => {
  const c = fixture();
  const tree = c.render(c.exports.default, props({ region: "Canada", local: true, homeCity: "Toronto", selectedRangeDays: 60 }));
  const all = nodes(tree);
  const upcoming = all.findIndex(node => node.type?.name === "SectionHeader" && node.props.title === "Upcoming shows");
  const fallback = all.findIndex(node => node.type?.name === "FeaturedRail");
  assert.ok(upcoming >= 0 && fallback > upcoming);
  assert.equal(all[upcoming].props.detail, "Near Toronto · Next 60 days");
  const radios = all.filter(node => node.props.accessibilityRole === "radio");
  assert.ok(radios.some(node => node.props.accessibilityLabel === "Near Toronto" && node.props.accessibilityState.checked));
  assert.match(text(tree), /Near Toronto/);
});

test("an authentic upcoming hero retains first position and no duplicate artist fallback", () => {
  const c = fixture(), slides = [{ id: "real", title: "Real show", event: { id: "real", artist: "Real artist" } }];
  const all = nodes(c.render(c.exports.default, props({ slides })));
  const hero = all.findIndex(node => node.type?.name === "FeaturedRail");
  const upcoming = all.findIndex(node => node.type?.name === "SectionHeader" && node.props.title === "Upcoming shows");
  assert.ok(hero >= 0 && hero < upcoming);
  assert.equal(all.filter(node => node.type?.name === "FeaturedRail").length, 1);
  assert.equal(all[hero].props.slides, slides);
});


test("every new Discover filter/layout intent cancels an outstanding return scroll through real controls", () => {
  const cases = [
    ["country", { programme: "shows" }, (tree, rerender) => {
      nodes(tree).find((n) => n.props?.accessibilityLabel?.startsWith("Choose an area to explore." )).props.onPress();
      nodes(rerender()).find((n) => n.type === "Pressable" && n.props.accessibilityLabel === "Canada").props.onPress();
    }, "onRegion", "Canada"],
    ["worldwide recovery", {}, (tree) => named(tree, "Recovery").props.onWorldwide(), "onRegion", "Worldwide"],
    ["scope", {}, (tree) => nodes(tree).find((n) => n.type === "Pressable" && n.props.accessibilityLabel === "Near you").props.onPress(), "onScope", true],
    ["date", {}, (tree, rerender) => {
      nodes(tree).find((n) => n.props?.label?.startsWith("Choose event dates.")).props.onPress();
      nodes(rerender()).find((n) => n.type === "Pressable" && n.props.accessibilityLabel === "Next 60 days").props.onPress();
    }, "onRange", 60],
    ["recovery range", {}, (tree) => named(tree, "Recovery").props.onRange(90), "onRange", 90],
    ["query", { programme: "artists" }, (tree) => nodes(tree).find((n) => n.type === "TextInput").props.onChangeText("new query"), "onQuery", "new query"],
    ["clear query", { programme: "artists", query: "old" }, (tree) => nodes(tree).find((n) => n.props?.accessibilityLabel === "Clear artist search").props.onPress(), "onQuery", ""],
    ["empty query clear", { programme: "artists", query: "no-match" }, (tree) => nodes(tree).find((n) => n.props?.children === "Clear search").props.onPress(), "onQuery", ""],
    ["cards", { eventRecovery: null }, (tree) => nodes(tree).find((n) => n.props?.accessibilityLabel === "Show events as cards").props.onPress(), "onEventView", "cards"],
    ["list", { eventRecovery: null }, (tree) => nodes(tree).find((n) => n.props?.accessibilityLabel === "Show events as list").props.onPress(), "onEventList", undefined],
    ["full list", { eventRecovery: null, rangeHasMore: true }, (tree) => nodes(tree).find((n) => n.props?.children === "Browse the full list").props.onPress(), "onEventList", undefined],
    ["week", { eventRecovery: null, listView: true }, (tree) => nodes(tree).find((n) => n.type === "EventList").props.onWeekChange("2026-11-16"), "onEventWeek", "2026-11-16"],
    ["all artists", { programme: "artists" }, (tree) => nodes(tree).find((n) => n.props?.action === "All artists").props.onPress()],
  ];
  for (const [label, overrides, action, callback, expected] of cases) {
    const f = fixture(), scrolled = [], actions = [], saved = [];
    let input = props({ ...overrides, initialBrowse: { scrollY: 900, genreFocused: true },
      overviewStatus: "loading", eventStatus: "loading", genreStatus: "loading",
      browseReturn: { save: (value) => saved.push(value) },
      ...(callback ? { [callback]: (value) => actions.push(value) } : {}) });
    const render = () => f.render(f.exports.default, input);
    let tree = render();
    const root = nodes(tree).find((n) => n.type === "ScrollView" && n.props.onContentSizeChange);
    root.props.ref.current = { scrollTo: (value) => scrolled.push(value) };
    root.props.onLayout({ nativeEvent: { layout: { width: 393, height: 600 } } });
    root.props.onContentSizeChange(393, 700); f.flushEffects();
    action(tree, render);
    assert.ok(saved.some((v) => v.scrollY === 0), `${label} cancels the stored offset`);
    input = { ...input, overviewStatus: "ready", eventStatus: "ready", genreStatus: "ready" };
    tree = render(); f.flushEffects();
    nodes(tree).find((n) => n.type === "ScrollView" && n.props.onContentSizeChange).props.onContentSizeChange(393, 2500);
    assert.deepEqual(scrolled, [], `${label}: late data must not jump to old scroll offset`);
    if (callback) assert.deepEqual(actions, [expected], `${label} forwards its original action`);
  }
});


test("retrying the unchanged Discover range can still restore after results arrive", () => {
  const f = fixture(), scrolled = [], retry = [];
  let input = props({ initialBrowse: { scrollY: 900 }, eventStatus: "loading", onRange: (value) => retry.push(value) });
  let tree = f.render(f.exports.default, input);
  const root = nodes(tree).find((n) => n.type === "ScrollView" && n.props.onContentSizeChange);
  root.props.ref.current = { scrollTo: (value) => scrolled.push(value) };
  root.props.onLayout({ nativeEvent: { layout: { width: 393, height: 600 } } });
  root.props.onContentSizeChange(393, 700); f.flushEffects();
  named(tree, "Recovery").props.onRetry();
  assert.deepEqual(retry, [30]);
  input = { ...input, eventStatus: "ready" }; tree = f.render(f.exports.default, input); f.flushEffects();
  nodes(tree).find((n) => n.type === "ScrollView" && n.props.onContentSizeChange).props.onContentSizeChange(393, 2500);
  assert.deepEqual(scrolled, [{ y: 900, animated: false }]);
});

test("artist empty search never claims no matches before overview is ready", () => {
  for (const overviewStatus of ["idle", "loading", "refreshing", "error"]) {
    for (const rows of [[], [{ name: "Cached artist" }]]) {
      const c = fixture(), retry = () => {};
      const tree = c.render(c.exports.default, props({ programme: "artists", region: "Canada", query: "  missing  ", chart: { rows }, overviewStatus, onRetryOverview: retry }));
      assert.doesNotMatch(text(tree), /No matches/, `${overviewStatus}, cached=${rows.length}`);
      if (overviewStatus === "error") {
        assert.match(text(tree), /Artists couldn’t (load|refresh)/);
        assert.equal(nodes(tree).find(n => n.props.children === "Try again").props.onPress, retry);
      } else {
        assert.match(text(tree), /Finding artists/);
        assert.ok(nodes(tree).some(n => n.type === "ActivityIndicator"));
      }
    }
  }
});

test("cached matching artists stay usable through loading, failure, and aggregate refresh", () => {
  const artist = { name: "Real Artist", country: "Canada" };
  for (const overviewStatus of ["idle", "loading", "refreshing", "error", "ready"]) {
    for (const refreshError of [false, true]) {
      const c = fixture(), refresh = () => {}, open = () => {};
      const tree = c.render(c.exports.default, props({ programme: "artists", query: "real", chart: { rows: [artist] }, overviewStatus,
        refreshing: true, refreshError, onRefresh: refresh, onOpenArtist: open }));
      const rail = named(tree, "ArtistRail");
      assert.equal(rail.props.rows[0], artist); assert.equal(rail.props.onOpen, open);
      assert.doesNotMatch(text(tree), /No matches|Artists couldn’t load|Finding artists/);
      assert.equal(tree.props.onRefresh, refresh); assert.equal(tree.props.refreshing, true);
      if (refreshError || overviewStatus === "error") {
        assert.equal(nodes(tree).find(n => n.props.children === "Retry").props.onPress, refresh);
      }
    }
  }
});

test("empty failure retry retains query, region and pending return; ready no-match offers clear", () => {
  const c = fixture(), calls = [], saved = [];
  const p = props({ programme: "artists", query: "  Missing artist  ", region: "Canada", chart: { rows: [] }, overviewStatus: "error",
    initialBrowse: { scrollY: 900 }, browseReturn: { save: v => saved.push(v) }, onRetryOverview: () => calls.push("overview"),
    onQuery: v => calls.push(["query", v]), onRegion: v => calls.push(["region", v]), onRefresh: () => calls.push("refresh") });
  let tree = c.render(c.exports.default, p);
  nodes(tree).find(n => n.props.children === "Try again").props.onPress();
  assert.deepEqual(calls, ["overview"]); assert.deepEqual(saved, []);
  assert.equal(nodes(tree).find(n => n.type === "TextInput").props.value, p.query);
  assert.match(text(tree), /Canada/);
  tree = c.render(c.exports.default, { ...p, overviewStatus: "ready" });
  assert.match(text(tree), /No matches for “Missing artist”/);
  assert.match(text(tree), /this artist list for Canada/);
  assert.equal(nodes(tree).find(n => n.props.children === "Try again"), undefined);
  nodes(tree).find(n => n.props.children === "Clear search").props.onPress();
  assert.deepEqual(calls, ["overview", ["query", ""]]);
});

test("empty artist lists distinguish pending, failed and ready with no search", () => {
  for (const overviewStatus of ["idle", "loading", "refreshing", "error", "ready"]) {
    const c = fixture(), calls = [];
    const tree = c.render(c.exports.default, props({ programme: "artists", query: "", chart: { rows: [] }, region: "Canada", overviewStatus,
      onRegion: region => calls.push(region) }));
    assert.match(text(tree), overviewStatus === "ready" ? /No artists in Canada yet/ : overviewStatus === "error" ? /Artists couldn’t load/ : /Finding artists/);
    const worldwide = nodes(tree).find(n => n.props.children === "Try Worldwide");
    assert.equal(!!worldwide, overviewStatus === "ready");
    if (worldwide) { worldwide.props.onPress(); assert.deepEqual(calls, ["Worldwide"]); }
  }
});

test("whitespace is browse intent without modifying the controlled query or shared filtering", () => {
  const c = fixture();
  for (const rows of [[], [{ name: "Real Artist" }]]) {
    const tree = c.render(c.exports.default, props({ programme: "artists", query: "  \t ", chart: { rows } }));
    assert.equal(nodes(tree).find(n => n.type === "TextInput").props.value, "  \t ");
    assert.doesNotMatch(text(tree), /No matches/); assert.ok(named(tree, "GenreBrowse"));
    assert.ok(named(tree, "FeaturedRail"));
    if (rows.length) assert.equal(named(tree, "ArtistRail").props.title, "Popular artists");
  }
});

test("recovery copy wraps and actions retain 44 point targets at large text", () => {
  const c = fixture({ fontScale: 3.1, width: 320 });
  const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flatten)) : value || {};
  for (const overviewStatus of ["loading", "refreshing", "error", "ready"]) {
    const tree = c.render(c.exports.default, props({ programme: "artists", query: "A very long artist query that must wrap", chart: { rows: [] }, overviewStatus }));
    for (const node of nodes(tree).filter(n => n.type === "Text")) {
      assert.equal(node.props.numberOfLines, undefined); assert.equal(flatten(node.props.style).height, undefined);
    }
    for (const action of nodes(tree).filter(n => n.type?.name === "TextAction")) {
      const control = c.render(action.type, action.props);
      assert.ok(flatten(control.props.style({ pressed: false })).minHeight >= 44);
      assert.equal(nodes(control).find(n => n.type === "Text").props.numberOfLines, undefined);
    }
  }
});

test("preview browse scroll forwards to latest committed lease only", () => {
  const f = fixture({ preview: true }); const old = [], next = [];
  const p = props({ browseReturn: { save: patch => old.push(patch) } });
  let tree = f.render(f.exports.default, p); f.flushEffects();
  const scroll = nodes(tree).find(n => n.type === "ScrollView" && n.props.onScroll).props;
  scroll.onScrollBeginDrag(); scroll.onScroll({ nativeEvent: { contentOffset: { y: 32 } } });
  assert.equal(old.length, 0);
  f.preview(false); p.browseReturn = { save: patch => next.push(patch) };
  tree = f.render(f.exports.default, p); f.flushEffects();
  scroll.onScroll({ nativeEvent: { contentOffset: { y: 76 } } });
  assert.equal(old.length, 0); assert.ok(next.some(p => p.scrollY === 76));
  f.preview(true); f.render(f.exports.default, p); f.flushEffects(); const count = next.length;
  scroll.onScroll({ nativeEvent: { contentOffset: { y: 88 } } }); assert.equal(next.length, count);
});
test("preview artwork pauses animation until committed", () => {
  const f = fixture({ preview: true });
  const p = { name: "Artist", uri: "https://example.test/photo.gif" };
  let tree = f.render(f.exports.BrowseArtwork, p);
  assert.equal(nodes(tree).find(n => n.type === "Image").props.autoplay, false);
  f.preview(false); tree = f.render(f.exports.BrowseArtwork, p);
  assert.equal(nodes(tree).find(n => n.type === "Image").props.autoplay, true);
});

test("Discover parent effects suppress programme and browse persistence until commit", () => {
  const source = readFileSync(new URL("../../screens/DiscoverScreen.jsx", import.meta.url), "utf8");
  const fn = parse(source, { sourceType: "module", plugins: ["jsx"] }).program.body.find(n => n.type === "ExportDefaultDeclaration").declaration;
  const effects = fn.body.body.filter(n => n.type === "ExpressionStatement" && n.expression.callee?.name === "useEffect");
  const programmeEffect = effects.find(n => source.slice(n.start, n.end).includes("rememberProgramme(programme)"));
  const browseEffect = effects.find(n => source.slice(n.start, n.end).includes("browseReturn?.save"));
  assert.ok(programmeEffect); assert.ok(browseEffect);
  const names = "useEffect,Platform,previewRef,isTabPreview,rememberProgramme,programme,browseReturn,query,selectedGenre,areaChoice,selectedRangeDays,eventView,eventWeek";
  const run = new Function(names, source.slice(programmeEffect.start, programmeEffect.end) + source.slice(browseEffect.start, browseEffect.end));
  for (const platform of ["ios", "android", "web"]) {
    const remembered = [], saved = [], effects = [], previewRef = { current: platform === "ios" };
    const render = () => run(fn => effects.push(fn), { OS: platform }, previewRef, previewRef.current,
      value => remembered.push(value), "shows", { save: value => saved.push(value) }, "", null,
      { region: "Worldwide", scope: "country", touched: false }, 30, "cards", null);
    render(); effects.splice(0).forEach(fn => fn());
    assert.equal(remembered.length, platform === "ios" ? 0 : 1); assert.equal(saved.length, 0);
    previewRef.current = false; render(); effects.splice(0).forEach(fn => fn());
    assert.equal(remembered.length, platform === "ios" ? 1 : 2); assert.equal(saved.length, platform === "ios" ? 1 : 0);
    // A queued effect must consult current preview state rather than its render.
    render(); previewRef.current = true; effects.splice(0).forEach(fn => fn());
    assert.equal(remembered.length, platform === "ios" ? 1 : 2); assert.equal(saved.length, platform === "ios" ? 1 : 0);
  }
});
test("Discover initial browse snapshot ignores preview leases but restores committed entry", () => {
  const source = readFileSync(new URL("../../screens/DiscoverScreen.jsx", import.meta.url), "utf8");
  const fn = parse(source, { sourceType: "module", plugins: ["jsx"] }).program.body.find(n => n.type === "ExportDefaultDeclaration").declaration;
  const declaration = fn.body.body.find(n => n.type === "VariableDeclaration" && n.declarations[0].id.elements?.[0]?.name === "initialBrowse");
  assert.ok(declaration);
  const run = new Function("useState,Platform,isTabPreview,browseReturn", source.slice(declaration.start, declaration.end) + "; return initialBrowse;");
  let reads = 0; const lease = { read: () => { reads++; return { query: "saved", programme: "artists" }; } };
  assert.equal(run(fn => [fn()], { OS: "ios" }, true, lease), null); assert.equal(reads, 0);
  assert.equal(run(fn => [fn()], { OS: "ios" }, false, lease).query, "saved"); assert.equal(reads, 1);
  for (const OS of ["android", "web"]) assert.equal(run(fn => [fn()], { OS }, false, lease), null);
  assert.equal(reads, 1);
});

test("Discover primary readiness follows only current scoped overview content", () => {
  const source = readFileSync(new URL("../../screens/DiscoverScreen.jsx", import.meta.url), "utf8");
  const fn = parse(source, { sourceType: "module", plugins: ["jsx"] }).program.body.find(n => n.type === "ExportDefaultDeclaration").declaration;
  const declaration = name => fn.body.body.find(n => n.type === "VariableDeclaration" && n.declarations[0].id.name === name);
  const signal = fn.body.body.find(n => n.type === "ExpressionStatement" && n.expression.callee?.name === "useNativeTabContentReady");
  assert.ok(signal);
  const parts = [declaration("overviewStatus"), declaration("showOverviewContent"), signal];
  const run = new Function("overviewRequestState,overviewScopeKey,overview,hasDiscoverOverviewContent,useNativeTabContentReady", parts.map(n => source.slice(n.start, n.end)).join("\n"));
  const readiness = (status, { requestScope = "current", content = false } = {}) => {
    let result; run({ scopeKey: requestScope, status }, "current", { content }, o => o.content, value => { result = value; }); return result;
  };
  assert.equal(readiness("loading"), false);
  assert.equal(readiness("ready"), true); assert.equal(readiness("error"), true);
  assert.equal(readiness("refreshing", { content: true }), true);
  assert.equal(readiness("ready", { requestScope: "old" }), false);
  assert.equal(readiness("error", { requestScope: "old" }), false);
  assert.equal(readiness("loading", { requestScope: "old", content: true }), true);
});
