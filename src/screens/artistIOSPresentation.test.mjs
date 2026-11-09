import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { parse } from "@babel/parser";
import { iosArtistLayout } from "../domain/iosArtistPresentation.ios.mjs";
import { artistPageSectionsForMode } from "../domain/artistPageSections.mjs";
import { createIOSArtistReturnStore } from "../domain/iosArtistReturn.mjs";
import { createBrowseScrollReturn } from "../domain/iosBrowseReturn.mjs";
const require = createRequire(import.meta.url);
const { transformSync } = require("@babel/core");
const source = readFileSync(new URL("./ArtistScreen.ios.jsx", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
const nodes = [];
function visit(node) { if (!node || typeof node !== "object") return; if (node.type) nodes.push(node); for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value); }
visit(ast);
const jsx = (type, props) => ({ type, props });
function evaluate(body, context) {
  const module = { exports: {} };
  const code = transformSync(body, { babelrc: false, configFile: false, plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")] }).code;
  new vm.Script(code).runInNewContext({ module, exports: module.exports, require: () => ({ jsx, jsxs: jsx }), ratingSignal: () => undefined, guard: value => value, useIOSDetailPresentation: () => ({ guard: value => value, current: () => true }), ...context });
  return module.exports;
}
function descendants(tree) { if (!tree || typeof tree !== "object") return []; return [tree, ...[tree.props?.children].flat(Infinity).flatMap(descendants)]; }
const styles = new Proxy({}, { get: (_, key) => key });

test("explicit album/listing changes before readiness cancel the old return offset", () => {
  const album = nodes.find(node => node.type === "VariableDeclarator" && node.id.name === "toggleAlbum").init;
  const listing = nodes.filter(node => node.type === "JSXAttribute" && node.name.name === "onPress" && /setShowAll(?:Songs|Releases)/.test(source.slice(node.start, node.end))).map(node => node.value.expression);
  assert.equal(listing.length, 2);
  for (const action of [album, ...listing]) {
    const jumps = []; let changed = 0;
    const controller = createBrowseScrollReturn(900);
    controller.onLayout({ nativeEvent: { layout: { height: 500 } } });
    controller.onContentSizeChange(320, 600);
    const target = { scrollTo: value => jumps.push(value) };
    controller.update(target, false);
    const invoke = evaluate(`module.exports = (${source.slice(action.start, action.end)});`, {
      IS_IOS: true, scrollReturn: { current: controller }, a: { name: "Artist" }, loadRating() {},
      setOpenAlbum: update => { assert.equal(update(42), 43); changed++; },
      setShowAllSongs: update => { assert.equal(update(false), true); changed++; },
      setShowAllReleases: update => { assert.equal(update(false), true); changed++; },
    });
    invoke(43, []);
    controller.onContentSizeChange(320, 2000);
    controller.update(target, true);
    assert.equal(changed, 1);
    assert.deepEqual(jumps, [], "late data cannot override an explicit layout action");
  }
});

test("removed release IDs cannot open a different album at the same list position", () => {
  const selection = nodes.find(node => node.type === "VariableDeclarator" && node.id.name === "open" && source.slice(node.init.start, node.init.end).includes("openAlbum"));
  const isOpen = evaluate(`module.exports = (openAlbum, al) => (${source.slice(selection.init.start, selection.init.end)});`, {});
  assert.equal(isOpen(42, { id: 43, title: "Replacement" }), false);
  assert.equal(isOpen(42, { id: 42, title: "Original" }), true);
});

test("actual Root wiring retains the Artist lease on Back and remounts fresh/account visits", () => {
  const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
  const start = app.indexOf("  const artistReturnRef = useRef(null);");
  const end = app.indexOf("  const [iosMenuOpen", start);
  const ref = { current: null };
  const render = evaluate(`module.exports = (session, chatAuthEpoch, stack, Platform) => { const nav = stack.at(-1); ${app.slice(start, end)} return artistReturn; };`, { useRef: () => ref, createIOSArtistReturnStore });
  const root = {}, artist = { artistName: "A" };
  const lease = render({ id: "a" }, 1, [root, artist], { OS: "ios" });
  lease.save({ section: "community", scrollY: 350 });
  for (const detail of [{ show: 1 }, { artistArchive: "A" }, { artistGallery: { name: "A" } }, { profile: "b" }]) {
    assert.equal(render({ id: "a" }, 1, [root, artist, detail], { OS: "ios" }), null);
    assert.equal(render({ id: "a" }, 1, [root, artist], { OS: "ios" }), lease);
  }
  assert.equal(lease.read().section, "community");
  const fresh = render({ id: "a" }, 1, [root, { artistName: "A" }], { OS: "ios" });
  assert.notEqual(fresh.key, lease.key); assert.equal(fresh.read(), undefined);
  assert.equal(lease.read(), undefined);
  assert.equal(render({ id: "b" }, 1, [root, artist], { OS: "ios" }).read(), undefined);
  for (const os of ["web", "android"]) assert.equal(render({ id: "a" }, 1, [root, artist], { OS: os }), null);
});

test("native album rating and expansion remain independent semantic controls", () => {
  const head = nodes.find(node => node.type === "JSXElement" && source.slice(node.openingElement.start, node.openingElement.end) === '<View style={styles.discHead}>');
  for (const scale of [1, 2, 3.1, 1]) {
    const calls = [];
    const render = evaluate(`module.exports = () => (${source.slice(head.start, head.end)});`, {
      View: "View", Pressable: "Pressable", Text: "Text", Image: "Image", Icon: "Icon", TapStars: "TapStars", styles,
      IS_IOS: true, largeText: iosArtistLayout("ios", scale).largeText,
      a: { name: "Artist" }, al: { id: 42, title: "Album", tracks: [1, 2] }, ar: { mine: 2, count: 0 },
      colors: {}, releaseType: () => "ALBUM", open: true, playerEnabled: false, playable: true, session: { id: "a" },
      toggleAlbum: (...args) => calls.push(["expand", ...args]), rateAlbum: (...args) => calls.push(["rate", ...args]),
    });
    const tree = render(), all = descendants(tree), rating = all.find(node => node.type === "TapStars"), expansion = all.find(node => node.props?.accessibilityRole === "button");
    assert.equal(rating.props.accessibilityLabel, "Your rating for album Album by Artist");
    rating.props.onChange(3.5); assert.deepEqual(calls, [["rate", "Artist", "Album", 3.5]]);
    assert.equal(expansion.props.accessibilityState.expanded, true);
    expansion.props.onPress(); assert.equal(calls.at(-1)[0], "expand");
    assert.equal(descendants(expansion).some(node => node.type === "TapStars"), false);
    assert.equal(all.filter(node => node.type === "Pressable").length, 1);
  }
});

test("Dynamic Type reflow keeps section identities, selected state and actions", () => {
  const nav = nodes.find(node => node.type === "FunctionDeclaration" && node.id.name === "ArtistPageSectionNav");
  let scale = 1, active = "about";
  const render = evaluate(source.slice(nav.start, nav.end) + "\nmodule.exports = ArtistPageSectionNav;", {
    View: "View", Pressable: "Pressable", Text: "Text", Icon: "Icon", styles, colors: {}, focusRing: {}, Platform: { OS: "ios" },
    useWindowDimensions: () => ({ fontScale: scale }), useRef: () => ({ current: [] }), iosArtistLayout, artistPageSectionsForMode,
  });
  for (scale of [1, 2, 3.1, 1]) {
    const all = descendants(render({ active, onChange: value => { active = value; } }));
    const tabs = all.filter(node => node.type === "Pressable");
    assert.equal(tabs.length, 4);
    assert.equal(tabs.find(node => node.props.accessibilityState.selected).props.accessibilityLabel, "About artist page section");
    tabs[1].props.onPress(); assert.equal(active, "shows"); active = "about";
    const style = tabs[0].props.style({});
    assert.equal(style[1]?.flexBasis, scale > 2 ? "100%" : scale > 1.25 ? "45%" : undefined);
  }
});
