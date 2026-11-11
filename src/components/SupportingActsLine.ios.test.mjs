import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { transformSync } from "@babel/core";
import * as lineup from "../domain/lineup.mjs";
import * as dates from "../domain/dates.mjs";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("./SupportingActsLine.ios.jsx", import.meta.url), "utf8");
const code = transformSync(source, { babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
function fixture({ fontScale = 1, openReview = true } = {}) {
  const state = [], opened = [], dimensions = { fontScale, width: 320 };
  let cursor = 0;
  const jsx = (type, props, key) => ({ type, props, key });
  const modules = {
    react: { useContext: () => openReview ? (id) => opened.push(id) : null,
      useState: (initial) => { const i = cursor++; if (!(i in state)) state[i] = initial;
        return [state[i], (next) => { state[i] = next; }]; } },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { Pressable: "Pressable", Text: "Text", View: "View", useWindowDimensions: () => dimensions,
      StyleSheet: { create: (styles) => styles, hairlineWidth: 0.5 } },
    "../theme": { colors: new Proxy({}, { get: (_, key) => String(key) }) }, "./Icon": "Icon",
    "../domain/lineup.mjs": lineup, "../domain/dates.mjs": dates,
    "./PostNavigationContext": { PostNavigationContext: {} },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => { assert.ok(name in modules, name); return modules[name]; }, module, module.exports);
  return { opened, dimensions, render: (props) => { cursor = 0; return module.exports.default(props); } };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree && typeof tree === "object" ? [tree, ...nodes(tree.props?.children)] : [];
}
const text = (tree) => {
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  return typeof tree === "string" || typeof tree === "number" ? String(tree) : tree && typeof tree === "object" ? text(tree.props?.children) : "";
};
const styles = (value) => Object.assign({}, ...[typeof value === "function" ? value({ pressed: false }) : value].flat(Infinity).filter(Boolean));
const button = (tree) => nodes(tree).find((node) => node.props?.accessibilityRole === "button");
const post = { id: "p_one", artist: "Main act", showFormat: "co_headline", lineup: [
  { name: "Co-headliner", role: "co_headliner", rating: 4.5, review: "Saved co-headliner note", reviewPostId: "p_co" },
  ...Array.from({ length: 6 }, (_, i) => ({ name: `Opener ${i + 1}`, role: "opener", rating: i === 0 ? null : 4, reviewPostId: `p_opener${i + 1}` })),
] };

test("compact iOS lineup discloses groups, every act, exact ratings and independent artist/review links", () => {
  const f = fixture(), artists = [], input = { post, compact: true, onOpenArtist: (name) => artists.push(name) };
  let tree = f.render(input);
  assert.match(text(tree), /7 acts · 6 rated/);
  assert.equal(nodes(tree).some((node) => node.props.accessibilityRole === "link"), false);
  assert.equal(button(tree).props.accessibilityState.expanded, false);
  button(tree).props.onPress(); tree = f.render(input);
  assert.equal(button(tree).props.accessibilityState.expanded, true);
  assert.match(text(tree), /Co-headliner/); assert.match(text(tree), /Openers/);
  assert.match(text(tree), /Saved co-headliner note/); assert.match(text(tree), /Opener 6/);
  const links = nodes(tree).filter((node) => node.props.accessibilityRole === "link");
  assert.equal(links.length, 14);
  links.forEach((node) => node.props.onPress());
  assert.deepEqual(artists, post.lineup.map((act) => act.name));
  assert.deepEqual(f.opened, post.lineup.map((act) => act.reviewPostId));
  const ratings = nodes(tree).filter((node) => node.props.accessibilityLabel?.includes("out of 5"));
  assert.equal(ratings.length, 6);
  assert.equal(ratings[0].props.accessibilityLabel, "Co-headliner: 4.5 out of 5");
  assert.equal(ratings.some((node) => node.props.accessibilityLabel.startsWith("Opener 1:")), false);
  button(tree).props.onPress(); tree = f.render(input);
  assert.equal(nodes(tree).some((node) => node.props.accessibilityRole === "link"), false);
});

test("detail posts start fully open; festival dates/stages retain chronological grouping", () => {
  const f = fixture(), festival = { id: "p_festival", showFormat: "festival", lineup: [
    { name: "Late set", day: "2026-11-12", stage: "Main stage", rating: 5 },
    { name: "Early set", day: "2026-11-11", stage: "Second stage", review: "The saved note" },
  ] };
  const tree = f.render({ post: festival, compact: false });
  assert.equal(button(tree), undefined);
  assert.ok(text(tree).indexOf("Early set") < text(tree).indexOf("Late set"));
  assert.match(text(tree), /Second stage/); assert.match(text(tree), /The saved note/);
  assert.match(text(tree), new RegExp(dates.formatDate("2026-11-11")));
});

test("legacy name-only lineups stay honest, missing navigation stays noninteractive", () => {
  const f = fixture({ openReview: false });
  assert.equal(f.render({ post: {} }), null);
  const tree = f.render({ post: { supportingActs: ["Name only"] } });
  assert.match(text(tree), /Name only/);
  assert.equal(nodes(tree).some((node) => node.props.accessibilityLabel?.includes("out of 5")), false);
  assert.equal(nodes(tree).some((node) => node.props.accessibilityRole === "link"), false);
});

test("post replacement and compact/detail changes cannot leak another post's expanded state", () => {
  const f = fixture();
  let tree = f.render({ post, compact: true }); button(tree).props.onPress();
  assert.equal(button(f.render({ post, compact: true })).props.accessibilityState.expanded, true);
  assert.equal(button(f.render({ post: { ...post, id: "p_other" }, compact: true })).props.accessibilityState.expanded, false);
  assert.equal(button(f.render({ post, compact: false })), undefined);
});

test("live largest text stacks rows while retaining expansion and all reachable controls", () => {
  const f = fixture(), input = { post, compact: true, onOpenArtist: () => {} };
  button(f.render(input)).props.onPress();
  for (const scale of [1, 2, 3.1, 1]) {
    f.dimensions.fontScale = scale;
    const tree = f.render(input);
    assert.equal(button(tree).props.accessibilityState.expanded, true);
    const controls = nodes(tree).filter((node) => ["button", "link"].includes(node.props.accessibilityRole));
    assert.equal(controls.length, 15);
    for (const node of controls) {
      const style = styles(node.props.style);
      assert.ok(style.minHeight >= 44); assert.equal(style.height, undefined);
      assert.equal(style.maxHeight, undefined); assert.equal(node.props.disabled, undefined);
    }
    for (const node of nodes(tree).filter((node) => node.type === "Text")) {
      assert.equal(node.props.numberOfLines, undefined); assert.notEqual(node.props.allowFontScaling, false);
    }
    const firstLink = controls.find((node) => node.props.accessibilityRole === "link");
    assert.equal(styles(firstLink.props.style).flex, scale > 1.25 ? 0 : 1);
  }
});
