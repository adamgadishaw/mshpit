import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import { parse } from "@babel/parser";
import * as concertMemories from "../domain/concertMemories.mjs";
import * as concertMemoryGallery from "../domain/concertMemoryGallery.mjs";
import * as dates from "../domain/dates.mjs";

const require = createRequire(import.meta.url);
const { transformSync } = require("@babel/core");
const profile = readFileSync(new URL("./ProfileScreen.jsx", import.meta.url), "utf8");
const you = readFileSync(new URL("./YouScreen.jsx", import.meta.url), "utf8");
const profileAST = parse(profile, { sourceType: "module", plugins: ["jsx"] });
const menuNode = profileAST.program.body.find((node) => node.type === "FunctionDeclaration" && node.id.name === "ProfileActionMenu");
const compiledMenu = transformSync(profile.slice(menuNode.start, menuNode.end) + "\nmodule.exports = ProfileActionMenu;", {
  babelrc: false, configFile: false,
  plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
}).code;

function menuFixture() {
  const refs = [], cleanups = [], sheets = [];
  let refIndex = 0, mounted = false;
  const module = { exports: {} };
  const jsx = (type, props) => ({ type, props });
  new vm.Script(compiledMenu).runInNewContext({
    module, exports: module.exports,
    require: () => ({ jsx, jsxs: jsx }),
    useRef(initial) { const index = refIndex++; return refs[index] ||= { current: initial }; },
    useEffect(effect) { if (!mounted) cleanups.push(effect()); },
    ActionSheetIOS: { showActionSheetWithOptions(options, choose) { sheets.push({ options, choose }); } },
    styles: {}, Pressable: "Pressable", View: "View",
  });
  return {
    sheets,
    render(props) { refIndex = 0; const tree = module.exports(props); mounted = true; return tree; },
    unmount() { cleanups.forEach((cleanup) => cleanup?.()); },
  };
}

function stylesFor(source, os) {
  const index = source.indexOf("const baseStyles = StyleSheet.create(");
  return new vm.Script(source.slice(index) + "\n({ baseStyles, styles });").runInNewContext({
    IS_IOS: os === "ios",
    Platform: { OS: os, select: (options) => options[os] || options.default },
    StyleSheet: { create: (value) => value, hairlineWidth: 0.5, absoluteFillObject: {} },
    colors: new Proxy({}, { get: (_, name) => String(name) }),
    radius: {}, space: (value) => value * 4, shadow: {}, mono: "mono", displayFont: "display", CONTENT_COLUMN_MAX_WIDTH: 900,
  });
}

test("iOS owner actions retain every route, unread labels, and a real cancel option", () => {
  const f = menuFixture(), opened = [];
  const actions = ["Inbox (2 new)", "Activity (1 new)", "Calendar", "Settings"].map((label, key) => ({ key, label, onPress: () => opened.push(key) }));
  const button = f.render({ actions, scope: "a:profile:a", label: "Your account", unread: 3 });
  assert.match(button.props.accessibilityLabel, /3 unread updates/);
  button.props.onPress();
  button.props.onPress();
  assert.equal(f.sheets.length, 1, "repeated taps cannot stack native sheets");
  assert.deepEqual(Array.from(f.sheets[0].options.options), [...actions.map((action) => action.label), "Cancel"]);
  f.sheets[0].choose(4);
  assert.deepEqual(opened, []);
  for (let index = 0; index < actions.length; index += 1) {
    button.props.onPress();
    f.sheets.at(-1).choose(index);
  }
  assert.deepEqual(opened, [0, 1, 2, 3]);
});

test("native public actions mark block/report destructive and omit unavailable callbacks", () => {
  const f = menuFixture();
  f.render({ scope: "a:profile:b", label: "Profile actions", actions: [
    { key: "mute", label: "Mute", onPress() {} },
    { key: "block", label: "Block", destructive: true, onPress() {} },
    { key: "report", label: "Report profile", destructive: true, onPress() {} },
    { key: "missing", label: "Unavailable" },
  ] }).props.onPress();
  assert.deepEqual(Array.from(f.sheets[0].options.destructiveButtonIndex), [1, 2]);
  assert.equal(f.sheets[0].options.cancelButtonIndex, 3);
});

test("native sheet selections cannot act after account/target changes or unmount", () => {
  for (const change of ["account", "profile", "unmount"]) {
    const f = menuFixture(), opened = [];
    const props = { scope: "a:profile:b", label: "Actions", actions: [{ key: "block", label: "Block", onPress: () => opened.push("old") }] };
    f.render(props).props.onPress();
    if (change === "unmount") f.unmount();
    else f.render({ ...props, scope: change === "account" ? "c:profile:b" : "a:profile:c" });
    f.sheets[0].choose(0);
    assert.deepEqual(opened, [], change);
  }
});

test("an open same-scope sheet uses current callbacks for the same available action", () => {
  const f = menuFixture(), opened = [];
  const props = { scope: "a:profile:b", label: "Actions", actions: [{ key: "mute", label: "Mute", onPress: () => opened.push("old") }] };
  f.render(props).props.onPress();
  f.render({ ...props, actions: [{ key: "mute", label: "Mute", onPress: () => opened.push("current") }] });
  f.sheets[0].choose(0);
  assert.deepEqual(opened, ["current"]);
});

test("Android and web keep their original presentation styles", () => {
  for (const source of [profile, you]) for (const os of ["android", "web"]) {
    const { styles, baseStyles } = stylesFor(source, os);
    assert.deepEqual(styles, baseStyles);
  }
  assert.match(profile, /!IS_IOS && asTab && isSelf && ownerTools\?\.length/);
});

test("iOS typography can grow and primary controls meet the 44-point target", () => {
  const { styles: p } = stylesFor(profile, "ios");
  const { styles: y } = stylesFor(you, "ios");
  for (const key of ["backBtn", "nativeMenu", "stat", "editBtn", "followBtn", "msgBtn", "unblockBtn"]) assert.ok((p[key].minHeight || p[key].height) >= 44, key);
  for (const key of ["primary", "memoryAction"]) assert.ok(y[key].minHeight >= 44, key);
  assert.equal(p.head.borderWidth, 0);
  assert.equal(p.head.alignItems, "flex-start");
  assert.equal(p.favoriteArtist.fontSize, 16);
  assert.equal(y.memoryArtist.fontSize, 20);
  assert.equal(y.memoryCard.height, undefined);
  assert.match(profile, /styles\.favoriteArtist\} numberOfLines=\{IS_IOS \? undefined : 1\}/);
  assert.match(you, /styles\.memoryArtist\} numberOfLines=\{IS_IOS \? undefined : 1\}/);
});

test("private memories and all existing profile data remain behind the original guards", () => {
  assert.match(profile, /\{isSelf \? children : null\}/);
  assert.match(profile, /profileMediaItems\(logs, \{ isSelf \}\)/);
  assert.match(profile, /const going = user && isSelf \? goingFor\(user\.id\) : EMPTY_LIST/);
  assert.match(profile, /text=\{user\.bio\}/);
  assert.match(profile, /user\.concertMapVisible !== false && concertHistory\.mapVisible/);
  assert.match(you, /selectedConcertMemoryForAccount\(memorySelection, session\?\.id\)/);
  assert.match(you, /lazyWithRetry\(\(\) => import\("\.\/ProfileScreen"\)/);
});


function iosYouFixture() {
  const states = [], requests = [];
  let stateIndex = 0, session = null;
  const dimensions = { width: 393, fontScale: 1 };
  const log = { id: "review-a", userId: "a", artist: "Private artist", venue: "Memory Hall", date: "2020-01-01", archiveShowKey: "show-a", media: [{ kind: "image", uri: "https://media.test/private.jpg" }] };
  const rows = (id) => id === "a" ? [log] : [];
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    "../components/NativeTabScroll": { ScrollView: "ScrollView", FlatList: "FlatList" },
    react: { useMemo: (fn) => fn(), useState(initial) { const index = stateIndex++; if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial; return [states[index], (value) => { states[index] = value; }]; } },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    "react-native": { View: "View", Text: "Text", ScrollView: "ScrollView", Pressable: "Pressable", Platform: { OS: "ios" }, useWindowDimensions: () => dimensions, Share: {}, StyleSheet: { create: (s) => s, absoluteFill: {} } },
    "../theme": { colors: {}, radius: {}, shadow: {}, displayFont: "display" },
    "../components/Icon": "Icon",
    "../components/SmartImage": "SmartImage",
    "../components/ConcertMemoryModal": "ConcertMemoryModal",
    "../lib/lazyWithRetry": { lazyWithRetry: () => "ProfileScreen" },
    "../store": { useStore: () => ({ session, logsByUser: rows, unreadNotifications: () => 2, inboxUnread: () => 1 }) },
    "../domain/dates.mjs": dates,
    "../domain/concertMemories.mjs": concertMemories,
    "../domain/concertMemoryGallery.mjs": concertMemoryGallery,
    "../features/profileHistory/useProfileHistory": { useProfileHistory: ({ accountId }) => ({ posts: rows(accountId), status: "ready" }) },
    "../features/artistEvents/useArtistEventArchive": { useArtistEventReviews: (options) => { requests.push(options); return { resource: { status: "ready", data: {} } }; } },
  };
  const code = transformSync(you, { babelrc: false, configFile: false, plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")] }).code;
  const module = { exports: {} };
  new vm.Script(code).runInNewContext({ module, exports: module.exports, require(name) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
  return { dimensions, render(account) { session = account; stateIndex = 0; requests.length = 0; return { tree: module.exports.default({}), request: requests.at(-1) }; } };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}

test("iOS You keeps real memory art, native horizontal browsing, and account privacy", () => {
  const f = iosYouFixture();
  const initial = f.render({ id: "a" });
  const all = nodes(initial.tree);
  assert.ok(all.some((node) => node.type === "ScrollView" && node.props.horizontal === true));
  assert.ok(all.some((node) => node.type === "SmartImage" && node.props.uri === "https://media.test/private.jpg"));
  assert.equal(initial.request.enabled, false, "rendering a memory rail must not fetch an archive");
  all.find((node) => node.props.accessibilityLabel === "Open memory for Private artist").props.onPress();
  assert.equal(f.render({ id: "a" }).request.enabled, true);
  for (const account of [null, { id: "b" }]) {
    const next = f.render(account);
    assert.equal(next.request.enabled, false);
    assert.equal(next.request.showKey, null);
    assert.ok(!nodes(next.tree).some((node) => node.type === "SmartImage"));
    for (const modal of nodes(next.tree).filter((node) => node.type === "ConcertMemoryModal")) assert.equal(modal.props.memory, null);
  }
});


test("a native sheet never turns a stale mute/block selection into its opposite", () => {
  for (const key of ["mute", "block"]) {
    const f = menuFixture(), opened = [];
    const props = { scope: "a:profile:b", label: "Actions", actions: [{ key, label: key, onPress: () => opened.push(key) }] };
    f.render(props).props.onPress();
    f.render({ ...props, actions: [{ key: `un${key}`, label: `un${key}`, onPress: () => opened.push(`un${key}`) }] });
    f.sheets[0].choose(0);
    assert.deepEqual(opened, []);
  }
});


test("iOS no-banner profiles use a shorter accent treatment without shrinking uploaded banners", () => {
  const { styles } = stylesFor(profile, "ios");
  assert.equal(styles.nativeBannerArtwork.height, 128);
  assert.equal(styles.nativeIdentityWrap.paddingTop, 16);
  assert.equal(styles.nativeBannerCompact.height, 48);
  assert.equal(styles.nativeIdentityCompact.paddingTop, 12);
  assert.match(profile, /IS_IOS && user\.banner \? <ProfileBannerCover/);
  assert.match(profile, /user\.banner \? <SmartImage uri=\{user\.banner\} style=\{StyleSheet\.absoluteFill\}/);
  assert.match(profile, /IS_IOS && !user\.banner && styles\.nativeIdentityCompact/);
  assert.match(profile, /styles\.bannerShade, IS_IOS && !user\.banner && styles\.nativeBannerCompact/);
  assert.match(profile, /fallbackTextColor=\{IS_IOS \? colors\.text : undefined\}/);
});

function renderAvatar(props, platform = "web") {
  const source = readFileSync(new URL("../components/Avatar.jsx", import.meta.url), "utf8");
  const code = transformSync(source, { babelrc: false, configFile: false, plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")] }).code;
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react: { useMemo: (compute) => compute() },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "react-native": { Platform: { OS: platform }, View: "View", Text: "Text", Pressable: "Pressable", PixelRatio: { get: () => 3 }, StyleSheet: { create: (s) => s, absoluteFill: {} } },
    "expo-image": { Image: "ExpoImage" },
    "../theme": { colors: { surfaceAlt: "#1C1C22", amber: "#F2A65A", line: "#2A2A32", text: "#F4EFE7" }, mono: "mono" },
    "../lib/img": { previewSrc: (uri) => uri, displaySrc: (uri) => uri },
    "../domain/imageLoadPolicy.mjs": { imageLoadPolicy: () => ({}), versionedImageCacheKey: () => "avatar-key" },
    "../hooks/useImageAttempt": (_, sources) => ({ uri: sources[0], index: 0 }),
    "../hooks/feedImageRetry": { useFeedImageRetryPulse: () => null },
  };
  const module = { exports: {} };
  new vm.Script(code).runInNewContext({ module, exports: module.exports, require(name) { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
  return module.exports.default(props);
}

test("profile initials opt into readable text without changing custom avatar colors or photos", () => {
  const user = { id: "a", name: "Alex", initials: "AR", avatarColor: "#755552", avatarUri: "https://media.test/avatar.jpg" };
  const original = nodes(renderAvatar({ user }));
  const readable = nodes(renderAvatar({ user, fallbackTextColor: "#F4EFE7" }));
  const initialColor = (list) => list.find((node) => node.type === "Text").props.style[1].color;
  assert.equal(initialColor(original), user.avatarColor, "all existing callers retain their original text color");
  assert.equal(initialColor(readable), "#F4EFE7");
  const fallback = (list) => list.find((node) => node.type === "View" && Array.isArray(node.props.style)).props.style[1];
  assert.equal(fallback(readable).backgroundColor, `${user.avatarColor}33`);
  assert.equal(fallback(readable).borderColor, user.avatarColor);
  assert.deepEqual(JSON.parse(JSON.stringify(fallback(readable))), JSON.parse(JSON.stringify(fallback(original))));
  const photo = (list) => list.find((node) => node.type === "ExpoImage").props;
  assert.deepEqual(JSON.parse(JSON.stringify(photo(readable))), JSON.parse(JSON.stringify(photo(original))));
  assert.equal(photo(readable).source.uri, user.avatarUri);
});

const flattenStyle = (value) => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flattenStyle)) : value || {};

test("live iOS text-size changes resize memories without clearing the selected memory", () => {
  const f = iosYouFixture(), account = { id: "a" };
  const first = f.render(account);
  const findCard = (tree) => nodes(tree).find((node) => node.type === "View" && flattenStyle(node.props.style).width === 280);
  assert.ok(findCard(first.tree));
  nodes(first.tree).find((node) => node.props.accessibilityLabel === "Open memory for Private artist").props.onPress();
  const before = nodes(f.render(account).tree).find((node) => node.type === "ConcertMemoryModal").props.memory;
  for (const [width, fontScale, expectedWidth] of [[393, 2, 345], [320, 3.1, 272], [393, 1, 280]]) {
    Object.assign(f.dimensions, { width, fontScale });
    const current = f.render(account);
    const all = nodes(current.tree);
    assert.ok(all.some((node) => node.type === "View" && flattenStyle(node.props.style).width === expectedWidth));
    assert.equal(all.find((node) => node.type === "ConcertMemoryModal").props.memory, before);
    assert.equal(current.request.showKey, "show-a");
    const open = all.find((node) => node.props.accessibilityLabel === "Open memory for Private artist");
    const actionRow = all.find((node) => Array.isArray(node.props.children) && node.props.children.includes(open));
    assert.equal(flattenStyle(actionRow.props.style).flexDirection, fontScale > 1.25 ? "column" : "row");
  }
  assert.doesNotMatch(you, /key=\{[^}]*fontScale|setMemorySelection\([^)]*fontScale/);
});

test("large-text favorite shows retain routes and gain a full-width, wrapping text column", () => {
  const declaration = profileAST.program.body.find((node) => node.type === "FunctionDeclaration" && node.id.name === "FavoriteShows");
  const code = transformSync(profile.slice(declaration.start, declaration.end) + "\nmodule.exports = FavoriteShows;", {
    babelrc: false, configFile: false,
    plugins: [[require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }], require("@babel/plugin-transform-modules-commonjs")],
  }).code;
  const jsx = (type, props, key) => ({ type, props, key });
  const module = { exports: {} };
  new vm.Script(code).runInNewContext({ module, exports: module.exports,
    require: () => ({ jsx, jsxs: jsx }), IS_IOS: true, styles: stylesFor(profile, "ios").styles, colors: {},
    View: "View", Text: "Text", Pressable: "Pressable", SmartImage: "SmartImage", Icon: "Icon", formatDate: dates.formatDate,
  });
  const opened = [], props = { shows: [{ id: "show-a", artist: "A very long artist name", venue: "Venue", date: "2020-01-01", photo: "https://media.test/art.jpg" }], onOpen: (id) => opened.push(id) };
  for (const largeText of [false, true, false]) {
    const all = nodes(module.exports({ ...props, largeText }));
    const button = all.find((node) => node.type === "Pressable");
    assert.equal(button.key, "show-a");
    assert.equal(flattenStyle(button.props.style).flexBasis, largeText ? "100%" : "44%");
    const image = all.find((node) => node.type === "SmartImage");
    assert.equal(flattenStyle(image.props.style).width, largeText ? 80 : "100%");
    assert.ok(all.filter((node) => node.type === "Text").every((node) => node.props.numberOfLines == null));
    button.props.onPress();
  }
  assert.deepEqual(opened, ["show-a", "show-a", "show-a"]);
});

test("iOS profile actions and taste chips constrain large labels without disabling scaling", () => {
  const { styles } = stylesFor(profile, "ios");
  assert.equal(styles.nativeActionsLarge.flexDirection, "column");
  assert.equal(styles.nativeStatsLarge.flexDirection, "column");
  assert.equal(styles.nativeStatLarge.flex, 0, "stacked stats must measure intrinsic scaled text height");
  assert.equal(styles.nativeShowLarge.flexDirection, "column");
  assert.equal(styles.editBtn.maxWidth, "100%");
  for (const name of ["editTxt", "followTxt", "msgTxt", "tasteMatchArtistText", "tasteMatchGenreText"]) assert.equal(styles[name].flexShrink, 1, name);
  for (const name of ["tasteMatchArtistChip", "tasteMatchGenreChip"]) assert.equal(styles[name].maxWidth, "100%", name);
  assert.match(profile, /fontScale \} = useWindowDimensions\(\)/);
  assert.match(profile, /const largeText = IS_IOS && fontScale > 1\.25/);
  assert.doesNotMatch(profile, /key=\{[^}]*fontScale|allowFontScaling=\{false\}/);
});


test("iOS avatar initials stay readable while Android/web keep the chosen foreground", () => {
  const user = { id: "a", name: "Jamie", initials: "JC", avatarColor: "#755552", avatarUri: "https://media.test/avatar.jpg" };
  const color = tree => nodes(tree).find(node => node.type === "Text").props.style[1].color;
  assert.equal(color(renderAvatar({ user }, "ios")), "#F4EFE7");
  for (const platform of ["android", "web"]) assert.equal(color(renderAvatar({ user }, platform)), user.avatarColor);
  assert.equal(color(renderAvatar({ user, fallbackTextColor: "#EEDDCC" }, "ios")), "#EEDDCC");
  const ios = nodes(renderAvatar({ user }, "ios"));
  const web = nodes(renderAvatar({ user }, "web"));
  const fallback = list => list.find(node => node.type === "View" && Array.isArray(node.props.style)).props.style[1];
  assert.equal(fallback(ios).backgroundColor, `${user.avatarColor}33`);
  assert.equal(fallback(ios).borderColor, user.avatarColor);
  const photo = list => list.find(node => node.type === "ExpoImage").props;
  assert.deepEqual(JSON.parse(JSON.stringify(photo(ios))), JSON.parse(JSON.stringify(photo(web))));
});
