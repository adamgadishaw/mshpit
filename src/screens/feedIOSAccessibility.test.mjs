import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { parse } from "@babel/parser";
import { transformSync } from "@babel/core";
import transformJSX from "@babel/plugin-transform-react-jsx";
import { unreadBadgeCount, unreadBadgeText } from "../domain/unreadBadge.mjs";

const source = readFileSync(new URL("./FeedScreen.jsx", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
const declaration = ast.program.body.find((node) => node.type === "VariableDeclaration" && node.declarations.some((item) => item.id.name === "styles"));
function stylesFor(os) {
  return new vm.Script(source.slice(declaration.start, declaration.end) + "\nstyles;").runInNewContext({
    Platform: { OS: os, select: (options) => options[os] || options.default },
    StyleSheet: { create: (styles) => styles, hairlineWidth: 0.5 },
    colors: {}, radius: {}, shadow: {}, space: (value) => value * 4, mono: "mono", CONTENT_COLUMN_MAX_WIDTH: 900,
  });
}
test("iOS onboarding action labels wrap within their buttons instead of overflowing", () => {
  const styles = stylesFor("ios");
  assert.equal(styles.homeAction.maxWidth, "100%");
  assert.equal(styles.homeAction.flexShrink, 1);
  assert.equal(styles.homeActionText.flexShrink, 1);
  assert.ok(styles.homeAction.minHeight >= 44);
  assert.equal(styles.homeAction.height, undefined);
});
test("Feed wrapping does not change Android/web home-action styles", () => {
  for (const platform of ["android", "web"]) {
    const styles = stylesFor(platform);
    assert.equal(styles.homeAction.maxWidth, undefined);
    assert.equal(styles.homeAction.flexShrink, undefined);
    assert.equal(styles.homeActionText.flexShrink, undefined);
    assert.equal(styles.homeAction.minHeight, 42);
  }
});

// Execute the actual Undo Pressable JSX with the screen's evaluated stylesheet.
// This catches a disconnected style as well as a target-size regression, without
// mounting the feed or allowing any recommendation/network mutation.
function findUndoControl(node) {
  if (!node || typeof node !== "object") return null;
  if (node.type === "JSXElement" && node.openingElement.name.name === "Pressable"
    && node.openingElement.attributes.some(attribute => attribute.name?.name === "onPress"
      && attribute.value?.expression?.name === "undoRecommendation")) return node;
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      const found = findUndoControl(child);
      if (found) return found;
    }
  }
  return null;
}
const undoControl = findUndoControl(ast.program);
assert.ok(undoControl, "Feed must retain its actual Undo/Retry control");
const undoCode = transformSync(source.slice(undoControl.start, undoControl.end), {
  babelrc: false, configFile: false, plugins: [[transformJSX, { runtime: "classic" }]],
}).code;
function undoFor(platform, busy, error) {
  const callback = () => {};
  const control = new vm.Script(undoCode).runInNewContext({
    React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    Pressable: "Pressable", Text: "Text", styles: stylesFor(platform),
    undoBusy: busy, undoError: error, undoItem: { id: "hidden-post" }, undoRecommendation: callback,
  });
  assert.equal(control.props.onPress, callback);
  return control;
}
for (const platform of ["ios", "android", "web"]) {
  test(`${platform} actual Undo/Retry target preserves states and platform dimensions`, () => {
    for (const [busy, error, label] of [
      [false, null, "Undo"],
      [true, null, "Restoring..."],
      [false, { postId: "hidden-post", message: "Try again" }, "Try again"],
      [false, { postId: "another-post", message: "Try again" }, "Undo"],
    ]) {
      const control = undoFor(platform, busy, error);
      const style = Object.assign({}, ...control.props.style.filter(Boolean));
      assert.equal(style.minHeight, platform === "ios" ? 44 : 36);
      assert.equal(style.height, undefined, "Allow larger text to grow the target");
      assert.equal(style.paddingHorizontal, 14);
      assert.equal(style.justifyContent, "center");
      assert.equal(control.props.disabled, busy);
      assert.equal(control.props.accessibilityState.disabled, busy);
      assert.equal(control.props.accessibilityState.busy, busy);
      assert.equal(control.props.accessibilityRole, "button");
      assert.equal(control.props.accessibilityLabel, error?.postId === "hidden-post"
        ? "Retry restoring hidden recommendation" : "Undo hidden recommendation");
      assert.equal(control.children[0].children[0], label);
    }
  });
}

// Activity now belongs to the compact app header, outside the Feed list.
// Execute its actual exported controls, including large-type badge behavior.
const nativeSource = readFileSync(new URL("../components/NativeAppHeader.ios.jsx", import.meta.url), "utf8");
const nativeAst = parse(nativeSource, { sourceType: "module", plugins: ["jsx"] });
const nativeStylesNode = nativeAst.program.body.find(node => node.type === "VariableDeclaration" && node.declarations.some(item => item.id.name === "styles"));
const nativeStyles = new vm.Script(nativeSource.slice(nativeStylesNode.start, nativeStylesNode.end) + "\nstyles;").runInNewContext({ StyleSheet: { create: value => value }, colors: {}, font: "System" });
const activityNode = nativeAst.program.body.find(node => node.type === "ExportNamedDeclaration" && node.declaration?.id?.name === "NativeActivityIcons").declaration;
const activityCode = transformSync(nativeSource.slice(activityNode.start, activityNode.end), { babelrc: false, configFile: false, plugins: [[transformJSX, { runtime: "classic" }]] }).code;
const activityTree = (fontScale, overrides = {}) => new vm.Script(activityCode + "\nNativeActivityIcons(props);").runInNewContext({
  React: { createElement: (type, props, ...children) => ({ type, props, children }) },
  Pressable: "Pressable", Text: "Text", View: "View", Icon: "Icon", colors: {}, styles: nativeStyles, unreadBadgeCount, unreadBadgeText,
  useWindowDimensions: () => ({ fontScale }), props: { enabled: true, onOpenInbox: () => {}, onOpenNotifications: () => {}, unread: 124, notifications: 7, ...overrides },
});
const activityNodes = node => !node ? [] : Array.isArray(node) ? node.flatMap(activityNodes) : typeof node !== "object" ? [] : [node, ...activityNodes(node.children)];
for (const scale of [1, 1.25, 1.5, 2, 3]) test(`Top activity symbols retain readable targets at text scale ${scale}`, () => {
  const tree = activityTree(scale);
  const buttons = activityNodes(tree).filter(node => node.type === "Pressable");
  assert.equal(buttons.length, 2);
  for (const button of buttons) {
    const style = Object.assign({}, ...button.props.style({ pressed: false }));
    assert.ok(style.minHeight >= 44);
    assert.ok((style.minWidth || style.width) >= 44);
    assert.equal(style.height, undefined);
    assert.equal(button.props.accessibilityState.disabled, false);
  }
  assert.deepEqual(buttons.map(node => node.props.accessibilityLabel), ["Messages, 124 unread", "Notifications, 7 unread"]);
  const badgeLabels = activityNodes(tree).filter(node => node.type === "Text").flatMap(node => node.children);
  assert.deepEqual(badgeLabels, scale <= 1.5 ? ["99+", "7"] : [], "large type uses compact dots; exact counts remain announced by the controls");
  const badges = activityNodes(tree).filter(node => node.type === "View" && node.props.importantForAccessibility === "no-hide-descendants");
  assert.equal(badges.length, 2);
  assert.ok(badges.every(node => node.props.accessible === false), "badge text must not duplicate the button's spoken count");
  assert.doesNotMatch(nativeSource, /allowFontScaling=\{false\}|maxFontSizeMultiplier|adjustsFontSizeToFit/);
});
test("Top activity announces actual unread values, caps only visible badges and rejects invalid counts", () => {
  for (const value of [-4, NaN, Infinity, undefined, "malformed"]) {
    const buttons = activityNodes(activityTree(1, { unread: value, notifications: value })).filter(node => node.type === "Pressable");
    assert.deepEqual(buttons.map(node => node.props.accessibilityLabel), ["Messages", "Notifications"]);
  }
  const buttons = activityNodes(activityTree(1, { unread: 123.9, notifications: 7, enabled: false })).filter(node => node.type === "Pressable");
  assert.deepEqual(buttons.map(node => node.props.accessibilityLabel), ["Messages, 123 unread", "Notifications, 7 unread"]);
  assert.ok(buttons.every(node => node.props.disabled && node.props.accessibilityState.disabled));
});
test("Top activity preserves separate actions and omits unavailable destinations", () => {
  const opened = [];
  const buttons = activityNodes(activityTree(1, { onOpenInbox: () => opened.push("messages"), onOpenNotifications: () => opened.push("notifications") })).filter(node => node.type === "Pressable");
  buttons.forEach(node => node.props.onPress());
  assert.deepEqual(opened, ["messages", "notifications"]);
  assert.equal(activityNodes(activityTree(1, { onOpenInbox: undefined, onOpenNotifications: undefined })).filter(node => node.type === "Pressable").length, 0);
});
