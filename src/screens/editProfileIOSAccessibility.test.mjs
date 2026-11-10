import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import * as formErrors from "../domain/accountFormError.mjs";
import * as profileDraft from "../domain/profileEditDraft.mjs";
import * as imagePolicy from "../domain/profileImagePolicy.mjs";
import * as genres from "../domain/genrePreferences.mjs";
import * as validation from "../domain/validation.mjs";
import * as accents from "../domain/profileAccents.mjs";
import * as dates from "../domain/dates.mjs";
import * as closeGuard from "./editProfileCloseGuard.mjs";

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

function fixture(os, overrides = {}, options = {}) {
  let cursor = 0, closed = 0;
  let refCursor = 0, effectCursor = 0;
  const states = [], saves = [], refs = [], effects = [], alerts = [], layouts = [];
  let layoutCursor = 0, queuedLayouts = [];
  const guardRef = { current: null };
  const session = { id: "account-a", name: "Fan", handle: "music_fan", bio: "Live music", genres: ["Rock"], favoriteArtists: ["one", "two"], ...overrides };
  const jsx = (type, props, key) => ({ type, props, key });
  const deps = {
    react: { createElement: (type, props, ...children) => jsx(type, { ...props, children }), Suspense: "Suspense", useLayoutEffect(effect, dependencies) { const i = layoutCursor++; const previous = layouts[i]; if (!previous || !dependencies || dependencies.some((value, index) => value !== previous.dependencies[index])) queuedLayouts.push(() => { previous?.cleanup?.(); layouts[i] = { dependencies, cleanup: effect() }; }); }, useRef(initial) { return refs[refCursor++] ||= { current: initial }; }, useEffect(effect) { const i = effectCursor++; if (!(i in effects)) effects[i] = effect(); }, useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial; return [states[i], (value) => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; } },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { ...Object.fromEntries(["View", "Text", "ScrollView", "TextInput", "Pressable", "Image"].map((name) => [name, name])), Alert: { alert: (...args) => alerts.push(args) }, Platform: { OS: os }, StyleSheet: { create: (styles) => styles, absoluteFill: {} } },
    "expo-image-picker": { launchImageLibraryAsync: options.pickImage || (async () => ({ canceled: true })) },
    "../theme": { colors: {}, radius: {} },
    "../store": { useStore: () => ({ session, locationCenter: (place) => place, updateProfile: (profile) => { saves.push(profile); return options.save ? options.save(profile) : { ok: true }; } }) },
    "../hooks/useAccountTaskScope": { useAccountTaskScope: () => ({ begin: () => ({ controller: { signal: {} }, accountId: session.id, isCurrent: () => true, finish() {} }) }) },
    "../hooks/useProfileImageUpload": { useProfileImageUpload: () => ({ uploadProfileImage() { throw new Error("Unexpected image upload"); }, imageCropDialog: null }) },
    "../features/profileHistory/useProfileHistory": { useProfileHistory: () => ({ status: "ready", posts: [], nextCursor: null }) },
    "../lib/lazyWithRetry": { lazyWithRetry: () => "PickArtistsScreen" },
    "../lib/mediaUpload": { isDurableMediaUrl: () => false },
    "../domain/profileImagePolicy.mjs": imagePolicy,
    "../domain/profileEditDraft.mjs": profileDraft,
    "../domain/accountFormError.mjs": formErrors,
    "../domain/genrePreferences.mjs": genres,
    "../domain/validation.mjs": validation,
    "../domain/profileAccents.mjs": accents,
    "../domain/dates.mjs": dates,
    "./editProfileCloseGuard.mjs": closeGuard,
    ...Object.fromEntries(["Avatar", "Icon", "LocationPicker", "Button", "SheetHeader"].map((name) => [`../components/${name}`, name])),
  };
  const hookCode = transformSync(readFileSync(new URL(`../hooks/useIOSProfileEditor${os === "ios" ? ".ios" : ""}.js`, import.meta.url), "utf8"), {
    babelrc: false, configFile: false, plugins: [require("@babel/plugin-transform-modules-commonjs")],
  }).code;
  const hookModule = { exports: {} };
  new vm.Script(hookCode).runInNewContext({ module: hookModule, exports: hookModule.exports, require: name => deps[name] });
  deps["../hooks/useIOSProfileEditor"] = hookModule.exports;
  const module = { exports: {} };
  new vm.Script(compiled).runInNewContext({ module, exports: module.exports, require(name) { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; } });
  const back = () => guardRef.current ? guardRef.current({ proceed: () => { closed++; } }) : closed++;
  return { saves, alerts, session, guardRef, back, dispose() { layouts.forEach(layout => layout.cleanup?.()); effects.forEach((cleanup) => cleanup?.()); }, get closed() { return closed; }, render() { cursor = refCursor = effectCursor = layoutCursor = 0; queuedLayouts = []; const result = module.exports.default({ onClose: back, closeGuardRef: guardRef }); queuedLayouts.forEach(effect => effect()); return result; } };
}

test("iOS populated form fields have stable spoken names and native keyboard behavior", () => {
  const f = fixture("ios"), tree = f.render();
  for (const [label, value] of [["Name", "Fan"], ["Username", "music_fan"], ["Bio", "Live music"]]) {
    const input = labeled(f.render(), label);
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

const header = (tree) => nodes(tree).find((node) => node.type === "SheetHeader");
const choice = (f, text) => f.alerts.at(-1)[2].find((button) => button.text === text).onPress;

test("every editor-owned draft field participates in discard protection", () => {
  const baseline = { name: "Fan", handle: "fan", bio: "", avatarUri: null, banner: null, genres: ["Rock"], home: null, pronouns: "", accent: null, favoriteShows: [] };
  const changes = { name: "New", handle: "new_fan", bio: "New bio", avatarUri: "https://media.test/avatar", banner: "https://media.test/banner", genres: ["Pop"], home: { city: "Portland" }, pronouns: "they/them", accent: "blue", favoriteShows: ["show-a"] };
  for (const [field, value] of Object.entries(changes)) {
    const alerts = [];
    const guard = closeGuard.createEditProfileCloseGuard({ accountId: "a", draft: baseline, alert: (...args) => alerts.push(args) });
    guard.update({ accountId: "a", draft: { ...baseline, [field]: value }, busy: false });
    guard.guard({ proceed: () => assert.fail(`Unconfirmed ${field} discard`) });
    assert.equal(alerts[0][0], "Discard profile changes?", field);
  }
});

test("thrown save failures release busy protection and preserve unsaved input", async () => {
  const f = fixture("ios", {}, { save: () => { throw new Error("Offline"); } });
  labeled(f.render(), "Bio").props.onChangeText("Unsaved bio");
  await header(f.render()).props.action.onPress();
  assert.equal(labeled(f.render(), "Bio").props.value, "Unsaved bio");
  f.back();
  assert.equal(f.closed, 0);
  assert.equal(f.alerts.at(-1)[0], "Discard profile changes?");
});

test("discard retries after no-op navigation without reusing old choices", () => {
  const f = fixture("ios");
  labeled(f.render(), "Name").props.onChangeText("Draft");
  f.render();
  let attempts = 0;
  const navigate = () => f.guardRef.current({ proceed: () => { attempts++; } });
  navigate();
  const oldDiscard = choice(f, "Discard");
  oldDiscard();
  assert.equal(attempts, 1);
  navigate();
  assert.equal(f.alerts.length, 2);
  oldDiscard();
  assert.equal(attempts, 1);
  choice(f, "Discard")();
  assert.equal(attempts, 2);
});

test("successful-save bypass clears even if close never invokes Root", () => {
  const alerts = [];
  const guard = closeGuard.createEditProfileCloseGuard({ accountId: "a", draft: { name: "Original" }, alert: (...args) => alerts.push(args) });
  guard.update({ accountId: "a", draft: { name: "Draft" }, busy: false });
  guard.saved(() => {});
  let proceeded = 0;
  guard.guard({ proceed: () => proceeded++ });
  assert.equal(proceeded, 0);
  assert.equal(alerts[0][0], "Discard profile changes?");
});

test("clean iOS close retries if Root leaves the editor mounted", () => {
  const f = fixture("ios");
  header(f.render()).props.onClose();
  assert.equal(f.closed, 1);
  f.back();
  assert.equal(f.closed, 2);
  assert.equal(f.alerts.length, 0);
});

test("dirty header and Root close share one keep/discard prompt without autosaving", () => {
  const f = fixture("ios");
  labeled(f.render(), "Bio").props.onChangeText("Draft bio");
  header(f.render()).props.onClose();
  f.back();
  assert.equal(f.alerts.length, 1);
  choice(f, "Keep editing")();
  assert.equal(f.closed, 0);
  assert.equal(labeled(f.render(), "Bio").props.value, "Draft bio");
  f.back();
  const discard = choice(f, "Discard");
  discard(); discard();
  assert.equal(f.closed, 1);
  assert.equal(f.saves.length, 0);
});

test("initial draft baseline ignores later session updates and picker-owned artist writes", () => {
  const f = fixture("ios");
  f.render();
  f.session.name = "Remote name";
  f.session.favoriteArtists.push("three");
  header(f.render()).props.onClose();
  assert.equal(f.alerts.length, 0);
  assert.equal(f.closed, 1);
});

test("Root back dismisses local picker without abandoning editor draft", () => {
  const f = fixture("ios");
  labeled(f.render(), "Name").props.onChangeText("Unsaved name");
  for (const label of ["Home city", "Favorite artists"]) {
    labeled(f.render(), label).props.onPress();
    f.render();
    f.back();
    assert.equal(f.closed, 0);
    assert.equal(f.alerts.length, 0);
    assert.equal(labeled(f.render(), "Name").props.value, "Unsaved name");
  }
  f.back();
  assert.equal(f.alerts.at(-1)[0], "Discard profile changes?");
});

test("busy save blocks close synchronously, then success consumes bypass exactly once", async () => {
  let resolve;
  const f = fixture("ios", {}, { save: () => new Promise((done) => { resolve = done; }) });
  labeled(f.render(), "Name").props.onChangeText("New name");
  const saving = header(f.render()).props.action.onPress();
  f.back(); // deliberately no render between save and close
  assert.equal(f.closed, 0);
  assert.equal(f.alerts.at(-1)[0], "Profile update in progress");
  resolve({ ok: true });
  await saving;
  assert.equal(f.closed, 1);
  f.render();
  f.back();
  assert.equal(f.closed, 1);
  assert.equal(f.alerts.at(-1)[0], "Discard profile changes?");
  assert.equal(f.saves.length, 1);
});

test("failed save retains draft and requires discard before leaving", async () => {
  const f = fixture("ios", {}, { save: () => ({ ok: false, error: "Try again" }) });
  labeled(f.render(), "Name").props.onChangeText("New name");
  await header(f.render()).props.action.onPress();
  assert.equal(f.closed, 0);
  assert.equal(labeled(f.render(), "Name").props.value, "New name");
  f.back();
  assert.equal(f.alerts.at(-1)[0], "Discard profile changes?");
});

test("photo picker work blocks leaving before upload state can render", async () => {
  let resolve;
  const f = fixture("ios", {}, { pickImage: () => new Promise((done) => { resolve = done; }) });
  const picking = labeled(f.render(), "Change profile photo").props.onPress();
  f.back();
  assert.equal(f.closed, 0);
  assert.equal(f.alerts.at(-1)[0], "Profile update in progress");
  resolve({ canceled: true });
  await picking;
  choice(f, "OK")();
  f.back();
  assert.equal(f.closed, 1);
});

test("stale alert callbacks are inert after account switch and editor disposal", () => {
  for (const reason of ["account", "dispose"]) {
    const f = fixture("ios");
    labeled(f.render(), "Name").props.onChangeText("Draft");
    header(f.render()).props.onClose();
    const discard = choice(f, "Discard");
    if (reason === "account") { f.session.id = "account-b"; f.render(); }
    else f.dispose();
    discard();
    assert.equal(f.closed, 0, reason);
  }
});

test("editor cleanup does not clobber a replacement guard", () => {
  const f = fixture("ios");
  f.render();
  const replacement = () => {};
  f.guardRef.current = replacement;
  f.dispose();
  assert.equal(f.guardRef.current, replacement);
});

test("a pending discard cannot bypass newly started save work", async () => {
  let resolve;
  const f = fixture("ios", {}, { save: () => new Promise((done) => { resolve = done; }) });
  labeled(f.render(), "Name").props.onChangeText("Draft");
  header(f.render()).props.onClose();
  const discard = choice(f, "Discard");
  const saving = header(f.render()).props.action.onPress();
  discard();
  assert.equal(f.closed, 0);
  assert.equal(f.alerts.at(-1)[0], "Profile update in progress");
  resolve({ ok: false });
  await saving;
  choice(f, "OK")();
  f.render();
  f.back();
  assert.equal(f.alerts.at(-1)[0], "Discard profile changes?");
});

for (const os of ["android", "web"]) test(`${os} profile close remains unguarded`, () => {
  const f = fixture(os);
  nodes(f.render()).find((node) => node.type === "TextInput").props.onChangeText("Draft");
  header(f.render()).props.onClose();
  assert.equal(f.guardRef.current, null);
  assert.equal(f.closed, 1);
  assert.equal(f.alerts.length, 0);
});

test("repeated busy closes own one notice and stale notice dismissal cannot clear its replacement", async () => {
  let resolve;
  const f = fixture("ios", {}, { pickImage: () => new Promise((done) => { resolve = done; }) });
  const picking = labeled(f.render(), "Change profile photo").props.onPress();
  f.back(); f.back(); f.back();
  assert.equal(f.alerts.length, 1);
  const staleOK = choice(f, "OK");
  staleOK();
  f.back();
  assert.equal(f.alerts.length, 2);
  staleOK();
  f.back();
  assert.equal(f.alerts.length, 2);
  resolve({ canceled: true });
  await picking;
  choice(f, "OK")();
  f.back();
  assert.equal(f.closed, 1);
});

for (const os of ["ios", "android", "web"]) test(`${os} personal banner preview keeps its platform size contract`, () => {
  const f = fixture(os);
  const banner = labeled(f.render(), "Add a profile banner");
  const style = flatten(banner.props.style);
  assert.equal(style.aspectRatio, os === "ios" ? 3 : undefined);
  assert.equal(style.height, os === "ios" ? undefined : 96);
  assert.equal(banner.props.accessibilityRole, "button");
  f.dispose();
});
