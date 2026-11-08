import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { parse } from "@babel/parser";

const source = readFileSync(new URL("./SearchScreen.jsx", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
const declaration = (name) => ast.program.body.find((node) => node.declarations?.[0]?.id?.name === name);
const screen = ast.program.body.find((node) => node.type === "ExportDefaultDeclaration").declaration;
const callback = (name) => screen.body.body.find((node) => node.declarations?.[0]?.id?.name === name).declarations[0].init;
function stylesFor(platform) {
  const names = ["IS_IOS", "legacyStyles", "iosStyles", "styles"];
  const code = names.map((name) => { const node = declaration(name); return source.slice(node.start, node.end); }).join("\n");
  const palette = new Proxy({}, { get: (_, key) => key });
  return new vm.Script(`${code}\n({ styles, legacyStyles });`).runInNewContext({
    Platform: { OS: platform }, StyleSheet: { create: (value) => value, hairlineWidth: 0.5 },
    colors: palette, radius: palette, mono: "mono",
  });
}

test("Search retains the entire pre-redesign Android/web style object", () => {
  const node = declaration("legacyStyles").declarations[0].init.arguments[0];
  const hash = createHash("sha256").update(source.slice(node.start, node.end)).digest("hex");
  assert.equal(hash, "6e6ac332250efc45f69645ecb86da8440563705b937770f5bbc6d4bb2cf879d7");
  for (const platform of ["android", "web"]) {
    const { styles, legacyStyles } = stylesFor(platform);
    assert.equal(styles, legacyStyles);
    assert.equal(styles.rowName.fontSize, 14.5);
  }
  assert.match(source, /const resultTextLines = IS_IOS \? undefined : 1/);
  assert.match(source, /const SearchControls = IS_IOS \? View : Fragment/);
});

test("iOS Search uses readable, growing rows and separately reachable 44pt actions", () => {
  const { styles } = stylesFor("ios");
  assert.equal(styles.rowName.fontSize, 17);
  assert.equal(styles.rowSub.fontSize, 15);
  assert.equal(styles.row.height, undefined);
  assert.equal(styles.rowReflow.flexWrap, "wrap");
  assert.equal(styles.rowMainReflow.flexBasis, "100%");
  assert.equal(styles.sectionHeadReflow.flexDirection, "column");
  for (const key of ["fieldAction", "secondaryAction", "cancelSearch", "clearAction", "followBtn", "sectionReveal", "recoveryAction", "categoryChip"]) {
    assert.ok((styles[key].minHeight || styles[key].height) >= 44, key);
  }
  assert.equal(styles.recoveryAction.maxWidth, "100%");
  assert.equal(styles.recoveryActionText.flexShrink, 1);
  assert.doesNotMatch(source, /allowFontScaling=\{false\}|maxFontSizeMultiplier/);
});

test("large-text layout follows live window font scale without resetting search state", () => {
  const node = screen.body.body.find((item) => item.declarations?.[0]?.id?.name === "largeText");
  const expression = source.slice(node.declarations[0].init.start, node.declarations[0].init.end);
  for (const platform of ["ios", "android", "web"]) {
    const result = [1, 2, 3.1, 1].map((fontScale) => new vm.Script(expression).runInNewContext({ IS_IOS: platform === "ios", fontScale }));
    assert.deepEqual(result, platform === "ios" ? [false, true, true, false] : [false, false, false, false]);
  }
  assert.match(source, /const \{ fontScale \} = useWindowDimensions\(\)/);
  assert.match(source, /styles\.fieldReflow/);
  const { styles } = stylesFor("ios");
  assert.equal(styles.fieldReflow.flex, 0);
  assert.equal(styles.fieldReflow.width, "100%");
});

test("Clear retains editing; Cancel clears through the guarded query owner then dismisses", () => {
  for (const name of ["clearSearch", "cancelSearch"]) {
    const calls = [];
    const node = callback(name);
    const run = new vm.Script(`(${source.slice(node.start, node.end)})`).runInNewContext({
      IS_IOS: true, searchAnnouncements: { isCurrent: () => true },
      changeQuery: (value) => calls.push(["query", value]),
      setSearchError: (value) => calls.push(["error", value]),
      setActiveCategory: (value) => calls.push(["category", value]),
      setFocused: (value) => calls.push(["focusState", value]),
      searchInputRef: { current: { focus: () => calls.push(["focus"]), blur: () => calls.push(["blur"]) } },
      resultScrollRef: { current: { scrollTo: (options) => calls.push(["scroll", options.y, options.animated]) } },
    });
    run();
    assert.deepEqual(calls, name === "clearSearch" ? [["query", ""], ["error", ""], ["focus"]]
      : [["query", ""], ["error", ""], ["category", "all"], ["blur"], ["focusState", false], ["scroll", 0, false]]);
  }
  assert.match(source, /IS_IOS && \(focused \|\| !!q\).*onPress=\{cancelSearch\}/);
  // Cancelling never clears persisted recents or changes the deletion confirmation owner.
  assert.match(source, /onPress=\{clearRecentSearches\}/);
  assert.match(source, /onPress=\{\(\) => removeRecentSearch\(e.label, e.type\)\}/);
});

test("iOS header scrolls with oversized content and keyboard behavior remains platform gated", () => {
  assert.match(source, /!IS_IOS && searchHeader/);
  assert.match(source, /IS_IOS && searchHeader/);
  assert.match(source, /IS_IOS \? \{ keyboardDismissMode: "interactive", automaticallyAdjustKeyboardInsets: true \} : \{\}/);
  assert.match(source, /IS_IOS \? \{ onSubmitEditing: \(\) => searchInputRef.current\?\.blur\?\.\(\), clearButtonMode: "never" \} : \{\}/);
  assert.match(source, /key=\{artistSearchRowIdentity\(a\)\}/);
  assert.match(source, /onPress=\{\(\) => openArtist\(a\)\}/);
  assert.match(source, /ENABLE_MUSIC_PLAYER && <Section/);
});
