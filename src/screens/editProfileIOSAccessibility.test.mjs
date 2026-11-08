import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import * as imagePolicy from "../domain/profileImagePolicy.mjs";
import * as genres from "../domain/genrePreferences.mjs";
import * as validation from "../domain/validation.mjs";
import * as accents from "../domain/profileAccents.mjs";
import * as dates from "../domain/dates.mjs";

const require = createRequire(import.meta.url);
const { transformSync } = require("@babel/core");
const source = readFileSync(new URL("./EditProfileScreen.jsx", import.meta.url), "utf8");
const compiled = transformSync(source, { babelrc: false, configFile: false, plugins: [
  [require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }],
  require("@babel/plugin-transform-modules-commonjs"),
] }).code;
const nodes = (tree) => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const labeled = (tree, label) => nodes(tree).find((node) => node.props.accessibilityLabel === label);
const flatten = (style) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flatten)) : style || {};

function fixture(os, overrides = {}) {
  let cursor = 0, closed = 0;
  const states = [], saves = [];
  const session = { id: "account-a", name: "Fan", handle: "music_fan", bio: "Live music", genres: ["Rock"], favoriteArtists: ["one", "two"], ...overrides };
  const jsx = (type, props, key) => ({ type, props, key });
  const deps = {
    react: { Suspense: "Suspense", useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial; return [states[i], (value) => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; } },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { ...Object.fromEntries(["View", "Text", "ScrollView", "TextInput", "Pressable", "Image"].map((name) => [name, name])), Platform: { OS: os }, StyleSheet: { create: (styles) => styles, absoluteFill: {} } },
    "expo-image-picker": {},
    "../theme": { colors: {}, radius: {} },
    "../store": { useStore: () => ({ session, locationCenter: (place) => place, updateProfile: (profile) => { saves.push(profile); return { ok: true }; } }) },
    "../hooks/useAccountTaskScope": { useAccountTaskScope: () => ({ begin: () => ({ controller: { signal: {} }, accountId: session.id, isCurrent: () => true, finish() {} }) }) },
    "../hooks/useProfileImageUpload": { useProfileImageUpload: () => ({ uploadProfileImage() { throw new Error("Unexpected image upload"); }, imageCropDialog: null }) },
    "../features/profileHistory/useProfileHistory": { useProfileHistory: () => ({ status: "ready", posts: [], nextCursor: null }) },
    "../lib/lazyWithRetry": { lazyWithRetry: () => "PickArtistsScreen" },
    "../lib/mediaUpload": { isDurableMediaUrl: () => false },
    "../domain/profileImagePolicy.mjs": imagePolicy,
    "../domain/genrePreferences.mjs": genres,
    "../domain/validation.mjs": validation,
    "../domain/profileAccents.mjs": accents,
    "../domain/dates.mjs": dates,
    ...Object.fromEntries(["Avatar", "Icon", "LocationPicker", "Button", "SheetHeader"].map((name) => [`../components/${name}`, name])),
  };
  const module = { exports: {} };
  new vm.Script(compiled).runInNewContext({ module, exports: module.exports, require(name) { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; } });
  return { saves, get closed() { return closed; }, render() { cursor = 0; return module.exports.default({ onClose: () => { closed++; } }); } };
}

test("iOS populated form fields have stable spoken names and native keyboard behavior", () => {
  const f = fixture("ios"), tree = f.render();
  for (const [label, value] of [["Name", "Fan"], ["Username", "music_fan"], ["Bio", "Live music"]]) {
    const input = labeled(tree, label);
    assert.equal(input.type, "TextInput");
    assert.equal(input.props.value, value);
    input.props.onChangeText(label === "Username" ? "new_handle" : "Edited");
    assert.equal(labeled(f.render(), label).props.value, label === "Username" ? "new_handle" : "Edited");
  }
  const scroll = nodes(tree).find((node) => node.type === "ScrollView");
  assert.equal(scroll.props.automaticallyAdjustKeyboardInsets, true);
  assert.equal(scroll.props.keyboardDismissMode, "interactive");
  assert.equal(scroll.props.keyboardShouldPersistTaps, "handled");
  assert.equal(labeled(tree, "Bio").props.multiline, true);
  assert.equal(labeled(tree, "Bio").props.maxLength, 240);
});

test("iOS pickers announce purpose and selection, and repeated dismissal preserves form edits", () => {
  const f = fixture("ios");
  labeled(f.render(), "Name").props.onChangeText("Edited name");
  for (let i = 0; i < 2; i++) {
    const city = labeled(f.render(), "Home city");
    assert.equal(city.props.accessibilityRole, "button");
    assert.equal(city.props.accessibilityValue.text, "Not selected");
    city.props.onPress();
    assert.equal(f.render().type, "LocationPicker");
    f.render().props.onClose();
    assert.equal(labeled(f.render(), "Name").props.value, "Edited name");
    const artists = labeled(f.render(), "Favorite artists");
    assert.equal(artists.props.accessibilityRole, "button");
    assert.equal(artists.props.accessibilityValue.text, "2 selected");
    artists.props.onPress();
    nodes(f.render()).find((node) => node.type === "PickArtistsScreen").props.onSkip();
    assert.equal(labeled(f.render(), "Name").props.value, "Edited name");
  }
  labeled(f.render(), "Home city").props.onPress();
  f.render().props.onSelect({ city: "Portland" });
  assert.equal(labeled(f.render(), "Home city").props.accessibilityValue.text, "Portland");
});

test("iOS accent buttons have actual 44-point targets and retain selection and save owners", async () => {
  const f = fixture("ios");
  const radios = nodes(f.render()).filter((node) => node.props.accessibilityRole === "radio");
  assert.equal(radios.length, accents.PROFILE_ACCENT_OPTIONS.length + 1);
  for (const radio of radios) {
    const style = flatten(radio.props.style);
    assert.equal(style.width, 44);
    assert.equal(style.height, 44);
  }
  radios[1].props.onPress();
  assert.equal(labeled(f.render(), radios[1].props.accessibilityLabel).props.accessibilityState.checked, true);
  assert.equal(labeled(f.render(), "No accent color").props.accessibilityState.checked, false);
  await nodes(f.render()).find((node) => node.type === "Button").props.onPress();
  assert.equal(f.saves.length, 1);
  assert.equal(f.saves[0].accent, accents.PROFILE_ACCENT_OPTIONS[0].id);
  assert.equal(f.closed, 1);
});

for (const os of ["android", "web"]) test(`${os} retains existing input semantics, keyboard defaults, and 38-point swatches`, () => {
  const tree = fixture(os).render();
  for (const label of ["Name", "Username", "Bio", "Home city", "Favorite artists"]) assert.equal(labeled(tree, label), undefined);
  const scroll = nodes(tree).find((node) => node.type === "ScrollView");
  assert.equal(Object.hasOwn(scroll.props, "automaticallyAdjustKeyboardInsets"), false);
  assert.equal(Object.hasOwn(scroll.props, "keyboardDismissMode"), false);
  assert.equal(scroll.props.keyboardShouldPersistTaps, "handled");
  for (const radio of nodes(tree).filter((node) => node.props.accessibilityRole === "radio")) {
    assert.equal(flatten(radio.props.style).width, 38);
    assert.equal(flatten(radio.props.style).height, 38);
  }
});
