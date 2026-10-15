import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";
import * as programme from "./discoverProgramme.mjs";
const require = createRequire(import.meta.url);
const file = new URL("../components/discover/DiscoverProgrammeNav.jsx", import.meta.url);
const code = transformSync(readFileSync(file, "utf8"), {
  filename: "DiscoverProgrammeNav.jsx", babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
const nodes = value => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
function render(platform, width, fontScale, compact = true, selectedKey = "shows") {
  const componentRequire = name => {
    if (name === "react") return { useRef: initial => ({ current: initial }) };
    if (name === "react-native") return { Platform: { OS: platform }, useWindowDimensions: () => ({ width, height: 800, fontScale }),
      View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", StyleSheet: { create: value => value } };
    if (name.endsWith("/theme")) return { colors: {}, radius: {}, space: n => n * 4 };
    if (name.endsWith("/Icon")) return "Icon";
    if (name.endsWith("/discoverProgramme.mjs")) return programme;
    return require(name);
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(componentRequire, module, module.exports);
  const selected = [];
  return { tree: module.exports.default({ selected: selectedKey, onSelect: key => selected.push(key), compact }), selected };
}
test("narrow phones and larger native text retain six whole labels and working section selection", () => {
  for (const [platform, width, fontScale] of [["android", 360, 1.3], ["ios", 375, 1], ["ios", 411, 2]]) {
    const f = render(platform, width, fontScale);
    assert.equal(f.tree.type, "ScrollView");
    assert.equal(f.tree.props.horizontal, true);
    const tabs = nodes(f.tree).filter(n => n.type === "Pressable");
    assert.equal(tabs.length, 6);
    assert.deepEqual(tabs.map(n => n.props.accessibilityLabel), programme.DISCOVER_PROGRAMME_SECTIONS.map(s => s.label));
    assert.ok(nodes(f.tree).filter(n => n.type === "Text").every(n => n.props.numberOfLines === 1));
    assert.ok(tabs.every(n => n.props.style({}).some(style => style?.minWidth >= 70 * fontScale)));
    const scrollCalls = [];
    f.tree.props.ref.current = { scrollTo: value => scrollCalls.push(value) };
    tabs[5].props.onLayout({ nativeEvent: { layout: { x: 450 } } });
    tabs[5].props.onPress();
    assert.ok(scrollCalls.at(-1).x > 0, "selected distant sections stay visible");
    assert.deepEqual(f.selected, ["photos"]);
  }
});
test("normal native sizing and web keyboard relationships retain their existing row", () => {
  assert.equal(render("android", 411, 1).tree.type, "View");
  const f = render("web", 360, 1.3);
  assert.equal(f.tree.type, "View");
  const first = nodes(f.tree).find(n => n.type === "Pressable");
  assert.equal(first.props["aria-controls"], "discover-panel-shows");
  let prevented = false;
  first.props.onKeyDown({ key: "ArrowRight", preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(f.selected, ["festivals"]);
});


test("a restored distant section scrolls into view after native layout", () => {
  const f = render("android", 360, 1.3, true, "photos"), calls = [];
  f.tree.props.ref.current = { scrollTo: value => calls.push(value) };
  const photo = nodes(f.tree).find(n => n.type === "Pressable" && n.props.accessibilityLabel === "Photos");
  photo.props.onLayout({ nativeEvent: { layout: { x: 450 } } });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].x > 0);
  assert.equal(calls[0].animated, false);
});
