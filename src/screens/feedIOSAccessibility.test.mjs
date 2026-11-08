import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { parse } from "@babel/parser";

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
