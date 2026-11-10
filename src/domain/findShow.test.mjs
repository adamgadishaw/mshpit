import test from "node:test";
import assert from "node:assert/strict";
import { findShowFrame } from "../cityIdentity.js";

test("Find a Show uses saved home without changing it", () => {
  const home = Object.freeze({ city: "New York", country: "United States", region: "New York" });
  const frame = findShowFrame(home);
  assert.equal(frame.cityGuide.city, "New York");
  assert.equal(frame.cityGuide.countryCode, "US");
  assert.equal(frame.cityGuide.homeShowPrompt, true);
  assert.deepEqual(home, { city: "New York", country: "United States", region: "New York" });
});
test("Find a Show sends missing and ambiguous home to city selection", () => {
  assert.deepEqual(findShowFrame(null), { cityGuide: { directory: true } });
  assert.deepEqual(findShowFrame({ city: "London" }), { cityGuide: { directory: true } });
});
import { readFileSync } from "node:fs";
test("home city prompt renders below the scroll boundary with choose and dismiss actions", () => {
  const source = readFileSync(new URL("../screens/CityScreen.jsx", import.meta.url), "utf8");
  assert.match(source, /<\/VinylRefreshBoundary>\s*\{city\?\.homeShowPrompt && !promptDismissed/);
  assert.match(source, /title="Choose another city"[^>]*onPress=\{onChooseCity\}/);
  assert.match(source, /accessibilityLabel="Dismiss city prompt" onPress=\{\(\) => setPromptDismissed\(true\)\}/);
});
