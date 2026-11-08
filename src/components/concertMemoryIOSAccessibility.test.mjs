import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import * as dates from "../domain/dates.mjs";
import * as media from "../domain/postMediaDisplay.mjs";
import { selectedConcertMemoryForAccount } from "../domain/concertMemories.mjs";

const require = createRequire(import.meta.url);
const { transformSync } = require("@babel/core");
const source = readFileSync(new URL("./ConcertMemoryModal.jsx", import.meta.url), "utf8");
const compiled = transformSync(source, { babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
const memory = { id: "memory-a", artist: "An artist", venue: "A venue", date: "2020-01-01", detail: "From 2020", log: { id: "post-a", userId: "a", review: "Private memory text", photos: ["https://media.test/one.jpg", "https://media.test/two.jpg"] } };
const nodes = (tree) => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const flatten = (value) => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flatten)) : value || {};
const control = (tree, label) => nodes(tree).find((node) => node.props.accessibilityLabel === label);

function fixture(os = "ios") {
  const settings = { reducedMotion: false, width: 393, fontScale: 1 };
  const states = [], effectDeps = [];
  let stateCursor = 0, effectCursor = 0, effects = [];
  const jsx = (type, props, key) => ({ type, props, key });
  const dependencies = {
    react: {
      useState(initial) { const index = stateCursor++; if (!(index in states)) states[index] = initial; return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value; }]; },
      useEffect(effect, deps) { const index = effectCursor++; if (!effectDeps[index] || deps.some((value, i) => value !== effectDeps[index][i])) effects.push(effect); effectDeps[index] = deps; },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { Modal: "Modal", Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View", Platform: { OS: os }, useWindowDimensions: () => settings, StyleSheet: { create: (value) => value, absoluteFill: { position: "absolute", inset: 0 } } },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "../theme": { colors: {}, radius: {}, shadow: {}, displayFont: "display", mono: "mono" },
    "../domain/dates.mjs": dates,
    "../domain/postMediaDisplay.mjs": media,
    "../hooks/iosOnlyAccessibility": { useIOSReducedMotion: () => settings.reducedMotion },
    "./Icon": "Icon", "./SmartImage": "SmartImage", "./Stars": "Stars", "./RatingBreakdown": "RatingBreakdown", "./RatingSplit": "RatingSplit",
  };
  const module = { exports: {} };
  new vm.Script(compiled).runInNewContext({ module, exports: module.exports, require(name) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
  return { settings, render(props = {}) { stateCursor = 0; effectCursor = 0; effects = []; const tree = module.exports.default({ memory, ...props }); for (const effect of effects) effect(); return tree; } };
}

test("the iOS memory viewer responds live to Reduce Motion without resetting its gallery", () => {
  const f = fixture(), opened = [], props = { onOpenPost: (log) => opened.push(log), onOpenFull: (log) => opened.push(log) };
  let tree = f.render(props);
  assert.equal(tree.props.animationType, "slide");
  control(tree, "Next event photo").props.onPress();
  for (const reducedMotion of [true, false, true]) {
    f.settings.reducedMotion = reducedMotion;
    tree = f.render(props);
    assert.equal(tree.props.animationType, reducedMotion ? "none" : "slide");
    assert.equal(tree.type, "Modal");
    assert.equal(tree.key, undefined, "motion preferences must not remount the native modal");
    assert.equal(nodes(tree).find((node) => node.type === "SmartImage").props.uri, "https://media.test/two.jpg");
  }
  control(tree, "Open your original post and comments").props.onPress();
  control(tree, "Open the full show breakdown for An artist").props.onPress();
  assert.deepEqual(opened, [memory.log, memory.log]);
  control(tree, "Previous event photo").props.onPress();
  assert.equal(nodes(f.render(props)).find((node) => node.type === "SmartImage").props.uri, "https://media.test/one.jpg");
  assert.match(source, /useEffect\(\(\) => setMediaIndex\(0\), \[memory\?\.id\]\)/);
});

test("Android and web keep their existing animations and footer layouts", () => {
  for (const os of ["android", "web"]) {
    const f = fixture(os);
    f.settings.fontScale = 3.1;
    for (const reducedMotion of [false, true]) {
      f.settings.reducedMotion = reducedMotion;
      const tree = f.render({ onOpenFull() {} });
      assert.equal(tree.props.animationType, os === "web" ? "fade" : "slide");
      const action = control(tree, "Open the full show breakdown for An artist");
      const style = flatten(action.props.style({ pressed: false }));
      assert.equal(style.flex, 1);
      assert.equal(style.maxWidth, undefined);
      assert.equal(style.paddingVertical, undefined);
    }
  }
});

test("all memory dismissal paths remain accessible and close without invoking another action", () => {
  const f = fixture(), called = [], tree = f.render({ onClose: () => called.push("close"), onShare: () => called.push("share"), onOpenFull: () => called.push("open") });
  tree.props.onRequestClose();
  const sheet = nodes(tree).find((node) => node.type === "SafeAreaView");
  assert.equal(sheet.props.accessibilityViewIsModal, true);
  sheet.props.onAccessibilityEscape();
  const closes = nodes(tree).filter((node) => node.props.accessibilityLabel === "Close concert memory");
  assert.equal(closes.length, 2, "backdrop and visible close control are retained");
  closes.forEach((node) => node.props.onPress());
  assert.deepEqual(called, ["close", "close", "close", "close"]);
  const visibleClose = closes.find((node) => flatten(node.props.style).width === 44);
  assert.equal(flatten(visibleClose.props.style).height, 44);
});

test("iOS gallery and action controls keep 44-point targets at live text-size changes", () => {
  const f = fixture(), props = { onShare() {}, onOpenFull() {}, onOpenPost() {} };
  f.render(props);
  for (const fontScale of [1, 2, 3.1, 1]) {
    f.settings.fontScale = fontScale;
    const tree = f.render(props);
    for (const label of ["Previous event photo", "Next event photo", "Open your original post and comments", "Share concert memory for An artist", "Open the full show breakdown for An artist"]) {
      const button = control(tree, label);
      const style = flatten(typeof button.props.style === "function" ? button.props.style({ pressed: false }) : button.props.style);
      assert.ok((style.height || style.minHeight) >= 44, label);
      if (label.includes("photo")) assert.ok(style.width >= 44);
    }
    const primary = control(tree, "Open the full show breakdown for An artist");
    assert.equal(flatten(primary.props.style({ pressed: false })).flex, fontScale > 1.25 ? 0 : 1);
    assert.equal(flatten(nodes(primary).find((node) => node.type === "Text").props.style).flexShrink, 1);
    const footer = nodes(tree).find((node) => Array.isArray(node.props.children) && node.props.children.includes(primary));
    assert.equal(flatten(footer.props.style).flexDirection, fontScale > 1.25 ? "column" : "row");
  }
});

test("iOS date and video fallback copy can expand instead of being clipped at larger sizes", () => {
  const f = fixture(); f.settings.fontScale = 3.1;
  const tree = f.render({ gallery: [{ uri: "https://media.test/video", kind: "video" }] });
  const date = nodes(tree).find((node) => node.type === "Text" && node.props.children === dates.formatDate(memory.date, memory.date));
  assert.equal(date.props.numberOfLines, undefined);
  assert.equal(flatten(date.props.style).maxWidth, "100%");
  const video = nodes(tree).find((node) => node.props.accessibilityRole === "image");
  assert.equal(flatten(video.props.style).height, "auto");
  assert.equal(flatten(video.props.style).minHeight, 150);
});

test("motion preference changes cannot reveal a memory after the own-account guard clears it", () => {
  const f = fixture(), selection = { accountId: "a", memory };
  f.render({ memory: selectedConcertMemoryForAccount(selection, "a") });
  for (const accountId of [null, "b"]) for (const reducedMotion of [true, false]) {
    f.settings.reducedMotion = reducedMotion;
    assert.equal(f.render({ memory: selectedConcertMemoryForAccount(selection, accountId) }), null);
  }
  const you = readFileSync(new URL("../screens/YouScreen.jsx", import.meta.url), "utf8");
  assert.match(you, /selectedConcertMemoryForAccount\(memorySelection, session\?\.id\)/);
  assert.match(you, /<ConcertMemoryModal\s+memory=\{selectedMemory\}/);
});
