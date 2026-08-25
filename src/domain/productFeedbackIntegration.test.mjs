import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [app, landing, menu, admin] = await Promise.all([
  readFile(new URL("../../App.js", import.meta.url), "utf8"),
  readFile(new URL("../screens/LandingScreen.jsx", import.meta.url), "utf8"),
  readFile(new URL("../screens/MenuScreen.jsx", import.meta.url), "utf8"),
  readFile(new URL("../screens/AdminScreen.jsx", import.meta.url), "utf8"),
]);

test("one suggestion screen is reachable from both pre-signup and universal menu entry points", () => {
  assert.match(app, /SuggestionBoxScreen/);
  assert.match(app, /nav\.suggestion/);
  assert.match(app, /surface: "landing"/);
  assert.match(app, /surface: "menu"/);
  assert.match(landing, /What would make you come back\?/);
  assert.match(menu, /suggestion: onSuggestion/);
});

test("moderation distinguishes aggregate guest demand from identifiable retention", () => {
  assert.match(admin, /ANONYMOUS SEARCH DEMAND/);
  assert.match(admin, /search actions, not unique people or return visits/);
  assert.match(admin, /guest searches 30d/);
  assert.match(admin, /zero-result rate 7d/);
  assert.match(admin, /SuggestionsPanel/);
  assert.match(admin, /label: "Suggestions"/);
});
