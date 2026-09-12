import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";
import * as model from "./concertHistoryModel.mjs";
import * as dates from "../../domain/dates.mjs";

const require = createRequire(import.meta.url);
const production = (name) => transformSync(readFileSync(new URL(name, import.meta.url), "utf8"), {
  filename: name, configFile: false, babelrc: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
const compiledHistory = production("./ConcertHistory.jsx"), compiledMap = production("./ProfileConcertMap.jsx");
const geography = JSON.parse(readFileSync(new URL("./worldGeography.json", import.meta.url), "utf8"));
const rows = (count) => Array.from({ length: count }, (_, index) => ({ id: `post-${index}`, postId: `post-${index}`, artist: `Artist ${index}`, venue: `Venue ${index % 2}`, venueKey: `venue-${index % 2}`, city: "Toronto", date: `2026-06-${String(28 - index % 25).padStart(2, "0")}`, rating: 4, lat: 43.65 + index / 100, lng: -79.38, countryCode: "CA", country: "Canada" }));

function fixture({ component = "history", ...initial } = {}) {
  const slots = [], calls = { open: [], load: 0, retry: 0, selected: [], preview: [] };
  let cursor = 0;
  const props = { concerts: rows(8), complete: true, status: "ready", onOpenConcert: (row) => calls.open.push(row), onLoadMore: () => { calls.load += 1; }, onRetry: () => { calls.retry += 1; }, onSelectVenue: (key) => calls.selected.push(key), onPreviewVenue: (key) => calls.preview.push(key), ...initial };
  const seams = (name) => {
    if (name === "react") return {
      Component: class { constructor(value) { this.props = value; } }, Suspense: "Suspense", lazy: () => "ProfileConcertMap", memo: (value) => value,
      useMemo: (create) => create(), useEffect: () => {},
      useState(initialValue) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initialValue === "function" ? initialValue() : initialValue; return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
    };
    if (name === "react-native") return { View: "View", Text: "Text", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator", Platform: { OS: "web" }, StyleSheet: { create: (styles) => styles, absoluteFill: { position: "absolute" } } };
    if (name === "react-native-svg") return { __esModule: true, default: "Svg", G: "G", Line: "Line", Path: "Path" };
    if (name === "../../theme") return { colors: new Proxy({}, { get: (_, key) => key }), focusRing: { outlineWidth: 3 }, mono: "mono", radius: { sm: 12, md: 18, pill: 999 }, shadow: { card: {} }, space: (n) => n * 4 };
    if (name === "../../components/Icon") return { __esModule: true, default: "Icon" };
    if (name === "../../components/SmartImage") return { __esModule: true, default: "SmartImage" };
    if (name === "../../domain/dates.mjs") return dates;
    if (name === "./concertHistoryModel.mjs") return model;
    if (name === "./worldGeography.json") return geography;
    return require(name);
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", component === "map" ? compiledMap : compiledHistory)(seams, module, module.exports);
  const flatten = (node) => {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(flatten);
    const nested = typeof node.type === "function" && !node.type.prototype?.render ? node.type(node.props) : node.props?.children;
    return [node, ...flatten(nested)];
  };
  const render = (next = {}) => { Object.assign(props, next); cursor = 0; const tree = module.exports.default(props); return { tree, nodes: flatten(tree) }; };
  return { calls, props, render };
}
const label = (view, name) => view.nodes.find((node) => node.props?.accessibilityLabel === name);
const historyRows = (view) => view.nodes.filter((node) => node.props?.testID?.startsWith("concert-history-row-"));
const mapNode = (view) => view.nodes.find((node) => node.type === "ProfileConcertMap");
const textContent = (view) => view.nodes.filter((node) => node.type === "Text").map((node) => node.props.children).flat().filter((value) => typeof value === "string").join(" ");

test("one ticket section shows mobile map and three rows, with local expansion and collapse", () => {
  const f = fixture(), initial = f.render();
  assert.equal(initial.nodes.filter((node) => node.props?.testID === "profile-concert-history").length, 1);
  assert.ok(mapNode(initial));
  assert.equal(historyRows(initial).length, 3);
  assert.equal(label(initial, "See all concerts").props["aria-expanded"], false);
  label(initial, "See all concerts").props.onPress();
  const expanded = f.render();
  assert.equal(historyRows(expanded).length, 8);
  assert.equal(label(expanded, "See less").props["aria-expanded"], true);
  assert.equal(f.calls.load, 0);
  label(expanded, "See less").props.onPress();
  assert.equal(historyRows(f.render()).length, 3);
});

test("desktop layout is measured from section width and uses the same connected content", () => {
  const f = fixture(), initial = f.render();
  initial.tree.props.onLayout({ nativeEvent: { layout: { width: 820 } } });
  const desktop = f.render();
  assert.equal(historyRows(desktop).length, 5);
  assert.equal(mapNode(desktop).props.compact, false);
  assert.ok(desktop.nodes.some((node) => Array.isArray(node.props?.style) && node.props.style.some((style) => style?.flexDirection === "row" && style?.alignItems === "flex-start")));
});

test("row selection and hover highlight its pin without navigation; Open review uses the original row", () => {
  const f = fixture(), initial = f.render();
  const select = initial.nodes.find((node) => node.type === "Pressable" && /Select concert on map/.test(node.props.accessibilityLabel || ""));
  select.props.onPress();
  const selected = f.render();
  assert.equal(f.calls.open.length, 0);
  assert.equal(mapNode(selected).props.selectedVenueKey, model.concertVenueKey(rows(8)[0]));
  assert.equal(selected.nodes.find((node) => node.type === "Pressable" && /Artist 0.*Select concert on map/.test(node.props.accessibilityLabel || "")).props["aria-pressed"], true);
  assert.match(textContent(selected), /logged\s+concerts/);
  const open = selected.nodes.find((node) => node.type === "Pressable" && /^Open review for/.test(node.props.accessibilityLabel || ""));
  open.props.onPress();
  assert.equal(f.calls.open[0].postId, "post-0");
  select.props.onHoverIn(); select.props.onFocus();
  assert.equal(f.calls.open.length, 1);
});

test("pin selection filters to that venue and All concerts restores the full list", () => {
  const f = fixture(), initial = f.render(), key = model.concertVenueKey(rows(8)[1]);
  mapNode(initial).props.onSelectVenue(key);
  const venue = f.render();
  assert.ok(historyRows(venue).every((node) => ["post-1", "post-3", "post-5"].includes(node.props.testID.replace("concert-history-row-", ""))));
  label(venue, "All concerts").props.onPress();
  assert.equal(historyRows(f.render())[0].props.testID, "concert-history-row-post-0");
});

test("hovering or focusing an older venue pin reveals its concerts outside the recent preview", () => {
  const concerts = rows(8).map((row, index) => ({ ...row, venueKey: `unique-${index}`, venue: `Unique venue ${index}` }));
  const f = fixture({ concerts }), initial = f.render();
  assert.equal(historyRows(initial).some((node) => node.props.testID === "concert-history-row-post-7"), false);
  mapNode(initial).props.onPreviewVenue(model.concertVenueKey(concerts[7]));
  assert.deepEqual(historyRows(f.render()).map((node) => node.props.testID), ["concert-history-row-post-7"]);
});

test("attendance-only rows open a show rather than claiming an attached review", () => {
  const concert = { ...rows(1)[0], id: "attendance:1", postId: null };
  const f = fixture({ concerts: [concert] }), view = f.render();
  const action = label(view, "Open show for Artist 0 at Venue 0");
  assert.ok(action);
  action.props.onPress();
  assert.equal(f.calls.open[0].id, "attendance:1");
  assert.equal(view.nodes.some((node) => /^Open review for/.test(node.props?.accessibilityLabel || "")), false);
});

test("expanded history is bounded and advances loaded rows before asking the server for more", () => {
  const f = fixture({ concerts: rows(43), complete: false }), initial = f.render();
  assert.match(textContent(initial), /partial history/);
  label(initial, "See all concerts").props.onPress();
  assert.equal(historyRows(f.render()).length, 20);
  label(f.render(), "Load more concerts").props.onPress();
  assert.equal(historyRows(f.render()).length, 40);
  assert.equal(f.calls.load, 0);
  label(f.render(), "Load more concerts").props.onPress();
  assert.equal(historyRows(f.render()).length, 43);
  assert.equal(f.calls.load, 0);
  label(f.render(), "Load more concerts").props.onPress();
  assert.equal(f.calls.load, 1);
  assert.equal(label(f.render({ loadingMore: true }), "Loading more concerts…").props.disabled, true);
});

test("map-hidden history still has every list action without creating a lazy map element", () => {
  const f = fixture({ mapVisible: false }), view = f.render();
  assert.equal(mapNode(view), undefined);
  assert.equal(historyRows(view).length, 3);
  assert.ok(label(view, "See all concerts"));
  assert.ok(view.nodes.some((node) => /^Open review for/.test(node.props?.accessibilityLabel || "")));
});

test("loading, error, empty and partial-empty states do not claim a complete empty history", () => {
  const f = fixture({ concerts: [], status: "loading", complete: false });
  assert.match(textContent(f.render()), /Loading concert history/);
  const failed = f.render({ status: "error", error: "Please retry" });
  assert.ok(label(failed, "Retry concert history"));
  assert.doesNotMatch(textContent(failed), /No concerts logged yet/);
  label(failed, "Retry concert history").props.onPress();
  assert.equal(f.calls.retry, 1);
  assert.match(textContent(f.render({ status: "ready", complete: false })), /No concerts in this part/);
  assert.match(textContent(f.render({ complete: true })), /No concerts logged yet/);
});

test("review-opening feedback stays inside the list and disables the pending action", () => {
  const f = fixture({ openingId: "post-0", openingError: "Could not open this review" }), view = f.render();
  const opening = view.nodes.find((node) => node.type === "Pressable" && /^Opening Artist 0/.test(node.props.accessibilityLabel || ""));
  assert.equal(opening.props.disabled, true);
  assert.equal(opening.props.accessibilityState.busy, true);
  assert.ok(view.nodes.find((node) => node.props?.accessibilityRole === "alert" && node.props.children === "Could not open this review"));
});

test("all row and button targets provide keyboard roles and at least 44-pixel touch dimensions", () => {
  const view = fixture().render();
  for (const node of view.nodes.filter((node) => node.type === "Pressable")) {
    assert.equal(node.props.accessibilityRole, "button");
    assert.ok(node.props.accessibilityLabel);
    const resolved = Object.assign({}, ...node.props.style({ pressed: false, focused: true }).filter(Boolean));
    assert.ok((resolved.minHeight || resolved.height) >= 44);
    assert.equal(resolved.outlineWidth, 3);
  }
});

test("nearby map pins expose every venue, use exact projection, and offer manual zoom", () => {
  const history = model.concertHistoryModel(rows(4)), f = fixture({ component: "map", model: history, selectedVenueKey: null });
  let view = f.render();
  const pin = view.nodes.find((node) => node.type === "Pressable" && /nearby venues/.test(node.props.accessibilityLabel || ""));
  assert.ok(pin);
  const pinStyle = Object.assign({}, ...pin.props.style({}).filter(Boolean));
  assert.equal(pin.props["aria-pressed"], false);
  assert.equal(pinStyle.width, 44);
  assert.equal(pinStyle.height, 44);
  pin.props.onPress();
  view = f.render();
  const choice = view.nodes.find((node) => node.type === "Pressable" && /^Show 2 logged concerts at Venue 1/.test(node.props.accessibilityLabel || ""));
  choice.props.onPress();
  assert.equal(f.calls.selected[0], history.venues[1].key);
  assert.equal(f.render({ selectedVenueKey: history.venues[1].key }).nodes.find((node) => node.type === "Pressable" && /nearby venues/.test(node.props.accessibilityLabel || "")).props["aria-pressed"], true);
  const svgBefore = view.nodes.find((node) => node.type === "Svg").props.viewBox;
  label(view, "Zoom in concert map").props.onPress();
  view = f.render();
  assert.notEqual(view.nodes.find((node) => node.type === "Svg").props.viewBox, svgBefore);
  label(view, "Reset concert map view").props.onPress();
  assert.equal(f.render().nodes.find((node) => node.type === "Svg").props.viewBox, svgBefore);
});
