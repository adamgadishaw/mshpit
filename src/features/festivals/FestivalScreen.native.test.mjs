import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { transformSync } = require("@babel/core");
const { parse } = require("@babel/parser");
const file = new URL("./FestivalScreen.jsx", import.meta.url);
const themeFile = new URL("../../theme.js", import.meta.url);
const local = createRequire(file);
const source = readFileSync(file, "utf8");
const code = transformSync(source, {
  filename: "FestivalScreen.jsx", babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;
const themeSource = readFileSync(themeFile, "utf8");
const themeAst = parse(themeSource, { sourceType: "module", plugins: ["jsx"] });
function palette(name) {
  const declaration = themeAst.program.body.filter(node => node.type === "VariableDeclaration")
    .flatMap(node => node.declarations).find(node => node.id.name === name);
  return new Function(`return (${themeSource.slice(declaration.init.start, declaration.init.end)})`)();
}
const flatten = style => Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean));
function descendants(node, ancestors = []) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(child => descendants(child, ancestors));
  return [{ node, ancestors }, ...descendants(node.props?.children, [...ancestors, node])];
}
const rgba = value => value.startsWith("#")
  ? [...value.slice(1).match(/../g).map(part => parseInt(part, 16)), 1]
  : value.match(/[\d.]+/g).map(Number);
function contrast(foreground, background) {
  const [red, green, blue, alpha = 1] = rgba(foreground), back = rgba(background);
  const front = [red, green, blue].map((channel, index) => channel * alpha + back[index] * (1 - alpha));
  const luminance = channels => channels.slice(0, 3).map(channel => channel / 255)
    .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  const values = [luminance(front), luminance(back)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}
function render(colors, platform) {
  const edition = { id: "fixture-edition", name: "Fixture festival", city: "Toronto", startDate: "2027-07-01", endDate: "2027-07-02", imageUrl: "https://example.test/poster.jpg", imageAttribution: "Fixture photographer", days: [], lineup: [], headliners: [] };
  const page = { festival: { slug: "fixture", name: "Fixture" }, upcoming: [edition], past: [], reviews: [], reviewStats: {} };
  const jsx = (type, props) => ({ type, props });
  const deps = {
    react: { useState: initial => [initial, () => {}], useMemo: fn => fn(), useCallback: fn => fn, useContext: () => null },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { View: "View", Text: "Text", ScrollView: "ScrollView", Pressable: "Pressable", TextInput: "TextInput", ActivityIndicator: "ActivityIndicator", Platform: { OS: platform }, Linking: {}, StyleSheet: { create: styles => styles, absoluteFill: {}, hairlineWidth: 1 }, useWindowDimensions: () => ({ width: 390 }) },
    "expo-image": { Image: "Image" },
    "../../theme": { colors, radius: { md: 12, lg: 16, pill: 999 }, space: n => n * 4, font: "font", displayFont: "display", mono: "mono" },
    "../../components/Icon": "Icon", "../../components/Button": "Button", "../../components/Stars": "Stars", "../../components/PostNavigationContext": { PostNavigationContext: {} }, "../../components/SocialShareStudio": "ShareStudio", "./FestivalBackdrop": "FestivalBackdrop", "./Rise": "Rise",
    "./festivalShare.mjs": {}, "./festivalApi.mjs": {}, "./useFestivalResource": () => ({ data: page }),
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(name => Object.hasOwn(deps, name) ? deps[name] : local(name), module, module.exports);
  return { tree: module.exports.default({ slug: "fixture" }), edition };
}

for (const theme of ["DAYLIGHT", "EMBER"]) {
  for (const platform of ["android", "ios"]) {
    test(`actual ${platform} festival hero keeps title, dates, location and credit readable in ${theme}`, () => {
      const { tree, edition } = render(palette(theme), platform);
      const entries = descendants(tree);
      const title = entries.find(({ node }) => node.type === "Text" && node.props.children === edition.name);
      const hero = [...title.ancestors].reverse().find(node => flatten(node.props.style).backgroundColor);
      const background = flatten(hero.props.style).backgroundColor;
      const copy = entries.filter(({ node, ancestors }) => node.type === "Text" && ancestors.includes(hero));
      for (const { node } of copy) {
        const color = flatten(node.props.style).color;
        if (!color) continue;
        const entry = entries.find(candidate => candidate.node === node);
        const ownBackground = [...entry.ancestors].reverse().map(ancestor => flatten(ancestor.props.style).backgroundColor).find(Boolean) || background;
        assert.ok(contrast(color, ownBackground) >= 4.5, `${String(node.props.children)}: ${color} on ${ownBackground}`);
      }
      assert.ok(copy.some(({ node }) => node.props.children === "Image: Fixture photographer"));
      const poster = entries.find(({ node }) => node.type === "Image").node;
      assert.equal(poster.props.contentFit, "contain");
      assert.equal(flatten(poster.props.style).position, undefined);
    });
  }
}
