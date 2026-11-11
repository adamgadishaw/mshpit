import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";
import * as programme from "./discoverProgramme.mjs";
import * as eventWeeks from "./discoverEventWeeks.mjs";

const require = createRequire(import.meta.url);
const nodes = value => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
const style = node => Object.assign({}, ...[typeof node.props.style === "function" ? node.props.style({}) : node.props.style].flat(Infinity).filter(Boolean));

// The repository's Babel component harness, with persistent hooks so selection
// can change after the native layout callbacks have finished.
function fixture(file, { platform = "ios", width = 390, fontScale = 1 } = {}) {
  const code = transformSync(readFileSync(new URL(file, import.meta.url), "utf8"), {
    filename: file, babelrc: false, configFile: false,
    plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
  }).code;
  const slots = [], dependencies = [], pending = [];
  let cursor = 0;
  const hooks = {
    useMemo: fn => fn(),
    useRef: value => { const index = cursor++; return slots[index] ||= { current: value }; },
    useState: value => { const index = cursor++; if (!(index in slots)) slots[index] = value; return [slots[index], next => { slots[index] = next; }]; },
    useEffect: (fn, deps) => {
      const index = cursor++;
      if (!dependencies[index] || deps.some((value, n) => value !== dependencies[index][n])) pending.push(fn);
      dependencies[index] = deps;
    },
  };
  const componentRequire = name => {
    if (name.endsWith("/NativeTabScroll")) return { ScrollView: "ScrollView", TextInput: "TextInput" };
    if (name === "react") return hooks;
    if (name === "react-native") return {
      Platform: { OS: platform, select: options => options[platform] ?? options.default },
      useWindowDimensions: () => ({ width, height: 800, fontScale }),
      View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", ActivityIndicator: "ActivityIndicator", StyleSheet: { create: value => value },
    };
    if (name.endsWith("/theme")) return { colors: {}, radius: {}, shadow: {}, space: n => n * 4 };
    if (name.endsWith("/Icon")) return "Icon";
    if (name.endsWith("/PublicWebLinks")) return { PublicPressableLink: "PublicPressableLink" };
    if (name.endsWith("/discoverProgramme.mjs")) return programme;
    if (name.endsWith("/discoverEventWeeks.mjs")) return eventWeeks;
    if (name.endsWith("/liveDiscovery.mjs")) return { liveEventTitle: event => event.artist, LIVE_EVENT_SCOPE: { LOCAL: "local", WORLDWIDE: "worldwide" } };
    if (name.endsWith("/venueDiscovery.mjs")) return { splitVenuePlace: place => ({ city: place.split(",")[0] }) };
    if (name.endsWith("/urls.mjs")) return { eventPath: event => `/events/${event.id}` };
    return require(name);
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(componentRequire, module, module.exports);
  return {
    render(props, namedExport = "default") {
      cursor = 0;
      const tree = module.exports[namedExport](props);
      pending.splice(0).forEach(fn => fn());
      return tree;
    },
  };
}

test("iOS navigation reveals a programmatically selected tab after layout is already complete", () => {
  const f = fixture("../components/discover/DiscoverProgrammeNav.jsx", { width: 375 });
  const props = { selected: "shows", onSelect() {}, compact: true };
  const tree = f.render(props), calls = [];
  tree.props.ref.current = { scrollTo: value => calls.push(value) };
  nodes(tree).filter(node => node.type === "Pressable").forEach((tab, index) => {
    tab.props.onLayout({ nativeEvent: { layout: { x: index * 80 } } });
  });
  calls.length = 0;
  f.render({ ...props, selected: "photos" });
  assert.deepEqual(calls, [{ x: 392, animated: false }]);
});

test("iOS navigation uses available rail width and also accommodates large text in landscape", () => {
  const f = fixture("../components/discover/DiscoverProgrammeNav.jsx", { width: 411 });
  const props = { selected: "shows", compact: true };
  const first = f.render(props);
  first.props.onLayout({ nativeEvent: { layout: { width: 383 } } });
  assert.equal(f.render(props).type, "ScrollView");
  assert.equal(fixture("../components/discover/DiscoverProgrammeNav.jsx", { width: 844, fontScale: 2 }).render({ ...props, compact: false }).type, "ScrollView");
  for (const platform of ["android", "web"]) {
    assert.equal(fixture("../components/discover/DiscoverProgrammeNav.jsx", { platform, width: 411 }).render(props).type, "View");
  }
});

test("a direct section press keeps its animated reveal without an immediate competing scroll", () => {
  for (const platform of ["ios", "android"]) {
    const f = fixture("../components/discover/DiscoverProgrammeNav.jsx", { platform, width: 375 });
    const props = { selected: "shows", onSelect() {}, compact: true };
    const tree = f.render(props), calls = [];
    tree.props.ref.current = { scrollTo: value => calls.push(value) };
    const photos = nodes(tree).find(node => node.props.accessibilityLabel === "Photos");
    photos.props.onLayout({ nativeEvent: { layout: { x: 400 } } });
    photos.props.onPress();
    f.render({ ...props, selected: "photos" });
    assert.deepEqual(calls, [{ x: 392, animated: true }]);
  }
});

const events = Array.from({ length: 9 }, (_, index) => ({
  id: `layout-${index}`, artist: "A long concert title with a special guest", venue: "A long performing arts centre",
  place: "Richmond Hill, Ontario, Canada", soldOut: true,
  date: new Date(Date.now() + (index * 7 + 3) * 86_400_000).toISOString().slice(0, 10),
}));

test("iOS list paging reveals the newly selected week without requiring a new layout", () => {
  const f = fixture("../components/discover/DiscoverEventList.jsx");
  const weeks = eventWeeks.discoverEventWeeks(events), changes = [], calls = [];
  const props = { events, weekKey: weeks[0].key, onWeekChange: value => changes.push(value) };
  const first = f.render(props);
  const rail = nodes(first).find(node => node.type === "ScrollView");
  rail.props.ref.current = { scrollTo: value => calls.push(value) };
  nodes(rail).filter(node => node.type === "Pressable").forEach((tab, index) => tab.props.onLayout({ nativeEvent: { layout: { x: index * 130 } } }));
  rail.props.onContentSizeChange();
  calls.length = 0;
  nodes(first).find(node => node.props.accessibilityLabel?.startsWith("Next week:")).props.onPress();
  assert.deepEqual(changes, [weeks[1].key]);
  f.render({ ...props, weekKey: changes[0] });
  assert.deepEqual(calls, [{ x: 122, animated: false }]);
  calls.length = 0;
  // Pagination changes rail size without changing the selected week. A user
  // can browse further along the rail without being snapped back.
  rail.props.onContentSizeChange();
  assert.deepEqual(calls, []);
});

test("iOS large-text week navigation keeps full dates and lets both buttons grow vertically", () => {
  const weeks = eventWeeks.discoverEventWeeks(events);
  const props = { events, weekKey: weeks[3].key, onWeekChange() {} };
  const tree = fixture("../components/discover/DiscoverEventList.jsx", { width: 320, fontScale: 2 }).render(props);
  const buttons = nodes(tree).filter(node => /^(Previous|Next) week:/.test(node.props.accessibilityLabel));
  assert.equal(buttons.length, 2);
  for (const button of buttons) {
    assert.equal(style(button).width, "100%");
    assert.equal(style(button).flexShrink, 0);
    assert.ok(nodes(button).filter(node => node.type === "Text").every(node => node.props.numberOfLines == null));
  }
  const row = nodes(tree).find(node => node.type === "PublicPressableLink");
  const copy = row.props.children[0];
  assert.ok(nodes(copy).some(node => node.props.children === "Sold out"), "the badge does not take width away from the event title");
  for (const platform of ["android", "web"]) {
    const baseline = fixture("../components/discover/DiscoverEventList.jsx", { platform, fontScale: 2 }).render(props);
    const next = nodes(baseline).find(node => node.props.accessibilityLabel?.startsWith("Next week:"));
    assert.equal(style(next).flex, 1);
    assert.equal(nodes(next).find(node => node.type === "Text").props.numberOfLines, 1);
  }
});

test("iOS area choices preserve complete labels and working scope actions at large text", () => {
  const selected = [];
  const tree = fixture("../components/LiveDiscoveryCards.jsx", { fontScale: 2 }).render({
    scope: "local", localLabel: "Near Saint-Jean-sur-Richelieu", worldLabel: "United States of America", compact: true, stacked: true,
    onChange: value => selected.push(value),
  }, "EventScopeToggle");
  assert.equal(style(tree).flexDirection, "column");
  const options = nodes(tree).filter(node => node.type === "Pressable");
  assert.ok(options.every(node => style(node).minHeight >= 44 && style(node).flexShrink === 0));
  assert.deepEqual(options.map(node => node.props["aria-selected"]), [true, false]);
  assert.ok(nodes(tree).filter(node => node.type === "Text").every(node => node.props.numberOfLines == null));
  options[1].props.onPress();
  assert.deepEqual(selected, ["worldwide"]);
});

test("the compact iOS show-swipe invitation gives its copy a full row and keeps its action", () => {
  let opens = 0;
  const tree = fixture("../components/discover/CrewBanner.jsx", { width: 320, fontScale: 2 }).render({ compact: true, onPress: () => { opens += 1; } });
  assert.equal(style(tree).flexDirection, "column");
  const copy = tree.props.children[1];
  assert.equal(style(copy).width, "100%");
  assert.equal(style(copy).flexShrink, 0);
  tree.props.onPress();
  assert.equal(opens, 1);
  for (const platform of ["android", "web"]) {
    const unchanged = fixture("../components/discover/CrewBanner.jsx", { platform }).render({ compact: true });
    assert.equal(style(unchanged).flexDirection, "row");
  }
});
