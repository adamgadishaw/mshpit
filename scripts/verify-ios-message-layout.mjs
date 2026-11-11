// Offline layout regression gate using the installed React Native Yoga engine.
// Text measurements are synthetic: this does not validate native typography,
// keyboard animations, interactive dismissal, VoiceOver, or a simulator build.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { parse } from "@babel/parser";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/screens/ThreadScreen.jsx", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
const walk = (node, visit) => {
  if (!node || typeof node !== "object") return;
  if (node.type) visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value === "object") walk(value, visit);
  }
};
const declarations = new Map();
walk(ast, node => { if (node.type === "VariableDeclarator" && node.id.type === "Identifier") declarations.set(node.id.name, node); });
const styleObject = declarations.get("styles").init.arguments[0];
const styles = new Function("colors", "radius", "mono", "Platform", `return (${source.slice(styleObject.start, styleObject.end)});`)({}, {}, "mono", { OS: "ios" });
const minExpression = declarations.get("composerMinHeight").init;
const capExpression = declarations.get("composerMaxHeight").init;
let composerStyle;
walk(ast, node => {
  if (node.type !== "JSXOpeningElement" || node.name.name !== "TextInput") return;
  const style = node.attributes.find(value => value.name?.name === "style")?.value?.expression;
  walk(style, child => {
    if (child.type === "ObjectExpression" && child.properties.some(property => property.key?.name === "maxHeight" && property.value?.name === "composerMaxHeight")) composerStyle = child;
  });
});
assert.ok(composerStyle, "the rendered TextInput must provide its computed bounds");
const composerBounds = new Function("composerViewportHeight", "fontScale", `
  const composerMinHeight = ${source.slice(minExpression.start, minExpression.end)};
  const composerMaxHeight = ${source.slice(capExpression.start, capExpression.end)};
  return (${source.slice(composerStyle.start, composerStyle.end)});
`);
const merge = (...names) => Object.assign({}, ...names.map(name => styles[name]));
const row = merge("row", "rowIOS"), column = styles.messageColumn;
const bubble = merge("bubble", "bubbleIOS"), footer = merge("msgFoot", "msgFootIOS");
const bar = merge("inputBar", "inputBarIOS"), input = merge("input", "inputIOS");
const actions = merge("deliveryActions", "deliveryActionsIOS"), action = merge("deliveryButton", "deliveryButtonIOS");
const report = merge("reportBtn", "reportBtnIOS");
assert.equal(row.flexDirection, "row"); assert.equal(row.alignSelf, "stretch");
assert.equal(column.alignItems, "flex-start"); assert.equal(styles.messageColumnMine.alignItems, "flex-end");
assert.equal(styles.rowMineIOS.justifyContent, "flex-end"); assert.equal(column.flexShrink, 1);
assert.equal(footer.flexDirection, "row"); assert.equal(footer.flexWrap, "wrap");
assert.equal(actions.flexDirection, "row"); assert.equal(actions.flexWrap, "wrap");
assert.equal(actions.flexShrink, 1); assert.equal(bar.flexDirection, "row");
assert.equal(bar.alignItems, "flex-end"); assert.equal(bar.flexShrink, 0);
assert.equal(input.flex, 1); assert.equal(styles.history.flex, 1); assert.equal(styles.history.minHeight, 0);
assert.equal(action.marginVertical, 0); assert.equal(report.marginVertical, 0); assert.equal(report.marginRight, 0);
let avatarSize;
walk(ast, node => {
  if (node.type !== "JSXElement" || node.openingElement.name.name !== "View") return;
  const style = node.openingElement.attributes.find(value => value.name?.name === "style")?.value?.expression;
  if (style?.object?.name !== "styles" || style?.property?.name !== "messageAvatar") return;
  const avatar = node.children.find(child => child.type === "JSXElement" && child.openingElement.name.name === "Avatar");
  avatarSize = avatar?.openingElement.attributes.find(value => value.name?.name === "size")?.value?.expression?.value;
});
const percent = value => { assert.match(value, /^\d+(\.\d+)?%$/); return Number.parseFloat(value); };
const config = {
  chatPadding: styles.chat.padding, rowGap: row.gap, columnMax: percent(column.maxWidth),
  avatarSize, avatarTop: styles.messageAvatar.paddingTop,
  bubblePadX: bubble.paddingHorizontal, bubblePadY: bubble.paddingVertical, bubbleBorder: bubble.borderWidth,
  failedBorder: styles.bubbleFailed.borderWidth, bubbleMax: percent(bubble.maxWidth), textFont: styles.msgText.fontSize, textLine: styles.msgText.lineHeight,
  footerMin: footer.minHeight, footerGap: footer.gap, footerTop: footer.marginTop, footerMax: percent(footer.maxWidth),
  timestampFont: styles.ts.fontSize, actionGap: actions.gap, actionFont: styles.deliveryAction.fontSize,
  failureFont: styles.deliveryFailed.fontSize, actionMinW: action.minWidth, actionMinH: action.minHeight,
  reportMinW: report.minWidth, reportMinH: report.minHeight,
  barPadX: bar.paddingHorizontal, barPadTop: bar.paddingTop, barPadBottom: bar.paddingBottom,
  barBorderTop: bar.borderTopWidth, barGap: bar.gap,
  inputPadX: input.paddingHorizontal, inputPadY: input.paddingVertical, inputBorder: input.borderWidth,
  inputFont: input.fontSize, inputLine: input.lineHeight,
  sendW: styles.sendBtn.width, sendH: styles.sendBtn.height,
};
assert.ok(Object.values(config).every(Number.isFinite), "all geometry must come from finite production styles");
const cases = [];
for (const width of [320, 375, 390, 430, 768]) for (const scale of [1, 1.3, 2, 3]) {
  for (const length of [1, 7, 80, 1000]) for (const kind of [0, 1, 2, 3]) cases.push("bubble", width, scale, length, kind, 0, 0);
  for (const height of [61, 80, 104, 105, 120, 140, 180, 280, 480, 700]) for (const length of [1, 80, 1000]) {
    const bounds = { ...input, ...composerBounds(height, scale) };
    assert.ok(Number.isFinite(bounds.maxHeight) && bounds.maxHeight >= 44 && bounds.maxHeight < height);
    assert.ok(Number.isFinite(bounds.minHeight) && bounds.minHeight >= 44 && bounds.minHeight <= bounds.maxHeight);
    cases.push("composer", width, scale, length, height, bounds.maxHeight, bounds.minHeight);
  }
}
assert.deepEqual(composerBounds(140, 3), { minHeight: 88, maxHeight: 88 }, "3× text in a 140-point body must expose one full line including padding");
const yoga = join(dirname(require.resolve("react-native/package.json")), "ReactCommon/yoga");
const cpp = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
  ? cpp(join(directory, entry.name)) : entry.name.endsWith(".cpp") ? [join(directory, entry.name)] : []);
const temporary = mkdtempSync(join(tmpdir(), "mshpit-message-yoga-"));
const binary = join(temporary, "message-layout");
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: "inherit", env: { ...process.env, TMPDIR: temporary } });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "iOS message geometry gate failed");
};
try {
  writeFileSync(join(temporary, "message-layout-style.h"), Object.entries(config).map(([key, value]) => `constexpr float ${key} = ${value};`).join("\n"));
  run("c++", ["-std=c++20", "-I", yoga, "-I", temporary, fileURLToPath(new URL("./fixtures/ios-message-layout.cpp", import.meta.url)), ...cpp(join(yoga, "yoga")), "-o", binary]);
  run(binary, cases.map(String));
} finally { rmSync(temporary, { recursive: true, force: true }); }
