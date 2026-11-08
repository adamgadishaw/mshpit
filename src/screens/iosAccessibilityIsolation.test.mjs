import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createIOSAccessibilityPreference } from "../hooks/iosAccessibilityPreference.mjs";
const require = createRequire(import.meta.url);
const { transformSync } = require("@babel/core");
const { parse } = require("@babel/parser");
const { resolve } = require("metro-resolver");
const path = value => fileURLToPath(new URL(value, import.meta.url));
const read = value => readFileSync(value, "utf8");
const nodes = node => !node || typeof node !== "object" ? [] : [node, ...Object.values(node).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
function execute(source, deps) {
  const module = { exports: {} };
  const code = transformSync(source, { babelrc: false, configFile: false, plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")] }).code;
  new Function("require", "module", "exports", code)(name => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; }, module, module.exports);
  return module.exports;
}
const jsx = (type, props) => ({ type, props });
for (const [file, names] of [["./ProfileScreen.jsx", ["unblockBtn", "followBtn", "msgBtn", "sectionLabel", "showRow"]], ["./YouScreen.jsx", ["primary", "sectionTitle"]]]) {
  test(`${file}: all audited controls retain iOS values and omit new props on Android/web`, () => {
    const source = read(path(file));
    const openings = nodes(parse(source, { sourceType: "module", plugins: ["jsx"] })).filter(node => node.type === "JSXOpeningElement" && node.attributes.some(attr => attr.type === "JSXAttribute" && attr.name.name === "style" && names.some(name => new RegExp(`styles\\.${name}\\b`).test(source.slice(attr.start, attr.end)))));
    assert.equal(openings.length, file.includes("Profile") ? 7 : 2);
    const expected = file.includes("Profile") ? [["button", "Unblock Fan"], ["button", "Follow Fan"], ["button", "Message Fan"], ["header", undefined], ["header", undefined], ["button", "Artist, Venue, Day"], ["header", undefined]] : [["button", "Log in or sign up"], ["header", undefined]];
    for (const platform of ["ios", "android", "web"]) for (const following of [false, true]) openings.forEach((opening, index) => {
      const tag = source.slice(opening.start, opening.end).replace(/\/?\s*>$/, " />");
      const render = execute(`export default function render({IS_IOS, following}) { const Pressable="Pressable", Text="Text"; const styles = {}; const user={name:'Fan'}; const p={artist:'Artist',venue:'Venue',date:'Day'}; const formatDate=x=>x; const largeText=false; const onLogin=()=>{}; return (${tag}); }`, { "react/jsx-runtime": { jsx, jsxs: jsx } }).default;
      const props = render({ IS_IOS: platform === "ios", following }).props;
      const [role, originalLabel] = expected[index];
      const label = following && originalLabel === "Follow Fan" ? "Unfollow Fan" : originalLabel;
      if (platform === "ios") { assert.equal(props.accessibilityRole, role); assert.equal(props.accessibilityLabel, label); }
      else { assert.equal(Object.hasOwn(props, "accessibilityRole"), false); assert.equal(Object.hasOwn(props, "accessibilityLabel"), false); }
    });
  });
}
const context = originModulePath => ({
  originModulePath, assetExts: new Set(), sourceExts: ["js", "jsx", "json", "ts", "tsx"], preferNativePlatform: true,
  mainFields: ["react-native", "browser", "main"], getPackageForModule: () => null,
  fileSystemLookup(file) { try { const stat = statSync(file); return { exists: true, type: stat.isDirectory() ? "d" : "f", realPath: realpathSync(file) }; } catch { return { exists: false }; } },
});
for (const platform of ["ios", "android", "web"]) test(`${platform}: actual component consumers resolve to live shared iOS owners or inert defaults`, async () => {
  const queries = [], listeners = [], cleanups = [], cache = new Map();
  let notifications = 0;
  const native = { AccessibilityInfo: {
    isReduceMotionEnabled: () => { queries.push("motion"); return false; },
    isScreenReaderEnabled: () => { queries.push("reader"); return false; },
    addEventListener(name, callback) { const item = { name, callback, active: true }; listeners.push(item); return { remove: () => { item.active = false; } }; },
  } };
  const react = { useSyncExternalStore(subscribe, snapshot) { cleanups.push(subscribe(() => notifications++)); return snapshot(); } };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const source = read(file), dependencies = { react, "react-native": native, "./iosAccessibilityPreference.mjs": { createIOSAccessibilityPreference } };
    for (const node of parse(source, { sourceType: "module" }).program.body) {
      if (node.source?.value.startsWith(".") && !Object.hasOwn(dependencies, node.source.value)) dependencies[node.source.value] = load(resolve(context(file), node.source.value, platform).filePath);
    }
    const exports = execute(source, dependencies); cache.set(file, exports); return exports;
  }
  for (const [component, variable, hook] of [["./ArtistScreen.jsx", "screenReader", "useIOSScreenReaderEnabled"], ["../components/ConcertMemoryModal.jsx", "reducedMotion", "useIOSReducedMotion"]]) {
    const file = path(component), source = read(file), ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
    const imported = ast.program.body.find(node => node.type === "ImportDeclaration" && node.specifiers.some(specifier => specifier.local.name === hook));
    assert.ok(imported);
    const resolved = resolve(context(file), imported.source.value, platform).filePath;
    assert.equal(resolved, path(`../hooks/iosOnlyAccessibility${platform === "ios" ? ".ios" : ""}.js`));
    const facade = load(resolved);
    const declaration = nodes(ast).find(node => node.type === "VariableDeclarator" && node.id.name === variable);
    const consume = execute(`import { ${hook} } from 'facade'; export default () => (${source.slice(declaration.init.start, declaration.init.end)});`, { facade }).default;
    assert.equal(consume(), platform === "ios");
    assert.equal(consume(), platform === "ios");
    if (platform === "ios") {
      const ownerName = hook === "useIOSScreenReaderEnabled" ? "useScreenReaderEnabled" : "useReducedMotion";
      const owner = load(resolve(context(resolved), `./${ownerName}`, platform).filePath);
      assert.equal(facade[hook], owner.default, "facade must reuse the same hook and subscription owner");
      owner.default();
      const listener = listeners.at(-1);
      listener.callback(false);
      assert.equal(consume(), false);
      listener.callback(true);
      assert.equal(consume(), true);
    }
  }
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(queries.length, platform === "ios" ? 2 : 0);
  assert.equal(listeners.length, platform === "ios" ? 2 : 0);
  if (platform === "ios") assert.ok(notifications > 0); else assert.equal(notifications, 0);
  cleanups.forEach(cleanup => cleanup());
  assert.ok(listeners.every(listener => !listener.active));
});
