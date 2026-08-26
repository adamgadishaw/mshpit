import assert from "node:assert/strict";
import test from "node:test";

import { PRIMARY_THEME_KEYS, visibleThemeChoices } from "./themeChoices.mjs";

const themes = [
  { key: "stage" },
  { key: "neon" },
  { key: "daylight" },
  { key: "forest" },
];

test("collapsed theme choices expose the primary dark and light pair", () => {
  assert.deepEqual(visibleThemeChoices(themes).map(({ key }) => key), PRIMARY_THEME_KEYS);
});

test("a saved enthusiast theme stays visible while choices are collapsed", () => {
  assert.deepEqual(
    visibleThemeChoices(themes, { selectedKey: "neon" }).map(({ key }) => key),
    ["stage", "neon", "daylight"],
  );
});

test("expanding returns every valid theme in its configured order", () => {
  assert.deepEqual(
    visibleThemeChoices(themes, { expanded: true, selectedKey: "neon" }),
    themes,
  );
});

test("malformed theme collections fail closed", () => {
  assert.deepEqual(visibleThemeChoices(null), []);
  assert.deepEqual(visibleThemeChoices([null, {}, { key: 3 }]), []);
});
