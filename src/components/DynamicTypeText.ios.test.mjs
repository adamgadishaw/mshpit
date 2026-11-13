import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const React = require("react");
const { transformSync } = require("@babel/core");
const cache = new Map();
function execute(file, imports) {
  if (!cache.has(file)) cache.set(file, transformSync(readFileSync(file, "utf8"), {
    filename: file, babelrc: false, configFile: false,
    presets: [require.resolve("babel-preset-expo")],
    caller: { name: "metro", platform: "ios", isDev: true, supportsStaticESM: false },
  }).code);
  const module = { exports: {} };
  new Function("require", "module", "exports", "__DEV__", cache.get(file))(imports, module, module.exports, true);
  return module.exports;
}
const plainProps = props => Object.fromEntries(Object.entries(props).filter(([key]) => key !== "children" && key !== "ref"));

function fixture() {
  const calls = [], refs = [], errors = [];
  let committed = [], dimensions = { width: 402, height: 874, scale: 3, fontScale: 1 };
  const listeners = new Set();
  const Dimensions = { get: () => dimensions, addEventListener: (_event, callback) => { listeners.add(callback); return { remove: () => listeners.delete(callback) }; } };
  const useWindowDimensions = execute(require.resolve("react-native/Libraries/Utilities/useWindowDimensions"), name => name === "./Dimensions" ? Dimensions : require(name)).default;
  const Ancestor = React.createContext(false);
  const Text = execute(require.resolve("react-native/Libraries/Text/Text.js"), name => {
    if (name.includes("ReactNativeFeatureFlags")) return { defaultTextToOverflowHidden: () => true };
    if (name.endsWith("PressabilityDebug")) return { isEnabled: () => false };
    if (name.endsWith("usePressability")) return config => ({ onClick: config.onPress });
    if (name.endsWith("flattenStyle")) return style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
    if (name.endsWith("processColor")) return value => value;
    if (name.endsWith("StyleSheet")) return { create: value => value };
    if (name.endsWith("Platform")) return { OS: "ios", select: values => values.ios ?? values.default };
    if (name.endsWith("TextAncestorContext")) return Ancestor;
    if (name.endsWith("TextNativeComponent")) return { NativeText: "RCTText", NativeSelectableText: "RCTSelectableText", NativeVirtualText: "RCTVirtualText" };
    return require(name);
  }).default;
  const DynamicTypeText = execute(fileURLToPath(new URL("./DynamicTypeText.ios.jsx", import.meta.url)), name => name === "react-native" ? { Text, useWindowDimensions } : require(name)).default;
  const privateInterface = {
    ReactNativeViewConfigRegistry: { get: name => ({ uiViewClassName: name, validAttributes: {}, directEventTypes: {}, bubblingEventTypes: {} }), customBubblingEventTypes: {}, customDirectEventTypes: {} },
    ReactFiberErrorDialog: { showErrorDialog: () => false },
    createPublicRootInstance: tag => ({ tag }), createPublicInstance: (tag, config, handle) => ({ tag, handle }), createPublicTextInstance: handle => ({ handle }),
    createAttributePayload: plainProps,
    diffAttributePayloads: (before, after) => JSON.stringify(plainProps(before)) === JSON.stringify(plainProps(after)) ? null : plainProps(after),
    deepFreezeAndThrowOnMutationInDev: () => {},
  };
  const native = {
    createNode: (tag, type, root, props, handle) => { calls.push({ kind: "create", type, tag }); return { tag, type, props, children: [], handle }; },
    cloneNode: node => ({ ...node }),
    cloneNodeWithNewChildren: node => { calls.push({ kind: "children", type: node.type, tag: node.tag }); return { ...node, children: [] }; },
    cloneNodeWithNewProps: (node, props) => { calls.push({ kind: "props", type: node.type, tag: node.tag }); return { ...node, props: { ...node.props, ...props } }; },
    cloneNodeWithNewChildrenAndProps: (node, props) => { calls.push({ kind: "both", type: node.type, tag: node.tag }); return { ...node, props: { ...node.props, ...props }, children: [] }; },
    appendChild: (node, child) => node.children.push(child),
    createChildSet: () => [], appendChildToSet: (set, node) => set.push(node), completeRoot: (_root, set) => { committed = set; }, registerEventHandler: () => {},
  };
  // Real installed Fabric reconciler, RN Text (including virtual spans), and
  // useWindowDimensions. Only the OS UIManager, platform services and transport
  // are replaced. This records actual native child-clone operations, not merely
  // React styles or a replica reconciler's interpretation of a changing key.
  const module = { exports: {} };
  new Function("require", "module", "exports", "__DEV__", "nativeFabricUIManager", readFileSync(require.resolve("react-native/Libraries/Renderer/implementations/ReactFabric-dev.js"), "utf8"))(
    name => name.includes("ReactNativePrivateInitializeCore") ? {} : name.includes("ReactNativePrivateInterface") ? privateInterface : require(name), module, module.exports, true, native);
  const renderer = module.exports;
  const loadOwner = relative => execute(fileURLToPath(new URL(relative, import.meta.url)), name => {
    if (name.endsWith("/DynamicTypeText")) return DynamicTypeText;
    if (name === "react-native") return { Text, View: "RCTView", Pressable: "RCTView", useWindowDimensions,
      StyleSheet: { create: value => value, hairlineWidth: 1 } };
    if (name.endsWith("/theme")) return { colors: {}, radius: {}, space: value => value * 4, font: "System", mono: "monospace" };
    if (name.endsWith("/Icon")) return () => null;
    if (name.endsWith("/PageReturnContext")) return { PageTitle: ({ children }) => children };
    if (name.endsWith("/useIOSDetailPresentation")) return () => ({ current: () => true, canAct: () => true, guard: fn => fn, active: true, token: 1 });
    if (name.endsWith("/catalogTextApi")) return { readCatalogPageText: async () => ({ text: { summary: "Sourced context 🎵", sources: [] } }) };
    if (name.endsWith("/PublicWebLinks")) return { PublicPressableLink: "RCTView" };
    if (name.endsWith("/data")) return { RATING_DIMS: [{ key: "performance", label: "Performance", group: "THE BAND" }, { key: "sound", label: "Sound", group: "THE ROOM" }] };
    return require(name);
  }).default;
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
  const all = () => committed.flatMap(function walk(node) { return [node, ...node.children.flatMap(walk)]; });
  return { Text, DynamicTypeText, useWindowDimensions, calls, refs, all, flush, loadOwner,
    async render(element) { renderer.render(element, 1, null, true, { onUncaughtError: error => errors.push(error) }); await flush(); assert.equal(errors.length, 0, errors[0]?.stack); },
    async resize(fontScale, width = dimensions.width) { dimensions = { ...dimensions, fontScale, width }; for (const listener of [...listeners]) listener({ window: dimensions }); await flush(); },
    async close() { renderer.stopSurface(1); await flush(); assert.equal(listeners.size, 0); },
  };
}

const content = node => node.type === "RCTRawText" ? node.props.text : node.children.map(content).join("");
test("real Fabric leaves an ordinary mounted paragraph unmeasured after a font-scale-only change", async t => {
  const f = fixture(); t.after(f.close);
  function RetainedScreen() {
    f.useWindowDimensions();
    return React.createElement(f.Text, { style: { fontSize: 32 } }, "Fixture artist");
  }
  await f.render(React.createElement(RetainedScreen));
  const paragraph = f.all().find(node => node.type === "RCTText");
  f.calls.length = 0; await f.resize(1.786);
  assert.equal(f.calls.length, 0, "negative control: no paragraph revision reaches the native measurement cache");
  assert.equal(f.all().find(node => node.type === "RCTText").tag, paragraph.tag);
});

for (const selectable of [false, true]) test(`real Fabric refreshes paragraph children while preserving text/ref/inline state (selectable ${selectable})`, async t => {
  const f = fixture(); t.after(f.close);
  let mounted = 0, unmounted = 0, changeInline;
  const ref = value => f.refs.push(value);
  function Inline() {
    const [count, setCount] = React.useState(1); changeInline = () => setCount(value => value + 1);
    React.useEffect(() => { mounted++; return () => { unmounted++; }; }, []);
    return React.createElement(f.Text, { style: { fontWeight: "700" } }, ` section ${count}`);
  }
  const props = { ref, selectable, accessibilityRole: "header", accessibilityLabel: "Full review title", nativeID: "stable-title", testID: "title", style: { fontSize: 32, lineHeight: 39 } };
  await f.render(React.createElement(f.DynamicTypeText, props, "Portrait 🎵 ", React.createElement(Inline)));
  const type = selectable ? "RCTSelectableText" : "RCTText";
  const original = f.all().find(node => node.type === type), rawTags = f.all().filter(node => node.type === "RCTRawText").map(node => node.tag);
  const initialRef = f.refs[0]; assert.ok(initialRef);
  for (const scale of [1.4, 1.786, 3.1, 1, 1.786, 1]) {
    f.calls.length = 0; await f.resize(scale);
    const current = f.all().find(node => node.type === type);
    assert.equal(current.tag, original.tag, "outer native paragraph is retained");
    assert.ok(f.calls.some(call => call.kind === "children" && call.tag === original.tag), "Fabric must invalidate the paragraph's measured content");
    assert.equal(f.calls.filter(call => call.kind === "create").length, 1, "only the empty inline span changes");
    assert.equal(content(current), "Portrait 🎵  section 1");
    assert.deepEqual(f.all().filter(node => node.type === "RCTRawText").map(node => node.tag), rawTags);
    assert.equal(current.props.allowFontScaling, true); assert.equal(current.props.maxFontSizeMultiplier, undefined);
    assert.equal(current.props.numberOfLines, undefined); assert.equal(current.props.nativeID, "stable-title");
    assert.equal(current.props.accessibilityLabel, "Full review title");
    assert.equal(current.props.accessibilityRole, "header");
    assert.equal(f.refs.length, 1); assert.equal(f.refs[0], initialRef);
    assert.equal(mounted, 1); assert.equal(unmounted, 0);
  }
  f.calls.length = 0; await f.resize(1, 744);
  assert.equal(f.calls.length, 0, "unchanged font scale does not churn native text children");
  changeInline(); await f.flush();
  assert.equal(content(f.all().find(node => node.type === type)), "Portrait 🎵  section 2");
});

test("non-iOS DynamicTypeText is the original native/web Text export", () => {
  const Text = Symbol("original Text");
  const result = execute(fileURLToPath(new URL("./DynamicTypeText.jsx", import.meta.url)), name => {
    assert.equal(name, "react-native"); return { Text };
  });
  assert.equal(result.default, Text);
});

for (const [file, props] of [
  ["./ScreenHeader.ios.jsx", { title: "Concert details", kicker: "Fixture", onBack: () => {} }],
  ["./RatingSplit.jsx", { band: 4.2, room: 3.5 }],
  ["./RatingBreakdown.jsx", { dims: { performance: 4.2, sound: 3.5 } }],
  ["../features/showDetails/ShowSection.jsx", { title: "Event details", summary: "Long event information", initiallyOpen: true }],
  ["../features/catalogEditor/CatalogText.ios.jsx", { type: "artist", entityKey: "fixture" }],
]) test(`shared owner reaches the native paragraph invalidation boundary: ${file}`, async t => {
  const f = fixture(); t.after(f.close);
  await f.render(React.createElement(f.loadOwner(file), props)); await f.flush();
  const before = f.all().filter(node => node.type === "RCTText" || node.type === "RCTSelectableText");
  assert.ok(before.length > 0);
  const expected = before.map(content);
  for (const scale of [1.786, 1, 3.1]) {
    f.calls.length = 0; await f.resize(scale);
    before.forEach((node, index) => {
      const after = f.all().find(item => item.tag === node.tag);
      assert.ok(after); assert.equal(content(after), expected[index]);
      assert.ok(f.calls.some(call => call.tag === node.tag && call.kind === "children"), `remeasure ${expected[index]}`);
    });
  }
});
