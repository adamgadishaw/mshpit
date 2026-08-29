import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const rails = readFileSync(new URL("../components/Rails.jsx", import.meta.url), "utf8");

test("the post composer warms from user intent instead of competing with startup", () => {
  assert.doesNotMatch(app, /setTimeout\(\(\) => \{ LogScreen\.preload/u);
  assert.doesNotMatch(app, /\[session\?\.id\][\s\S]{0,200}LogScreen\.preload/u);
  assert.match(app, /const preloadComposer = \(\) => \{[\s\S]*LogScreen\.preload/u);
  assert.match(app, /onLogIntent=\{preloadComposer\}/u);
  assert.match(app, /onPressIn=\{preloadComposer\}/u);
  assert.match(app, /onHoverIn=\{preloadComposer\}/u);
  assert.match(app, /onFocus=\{preloadComposer\}/u);
  assert.match(rails, /onLogIntent/u);
  assert.match(rails, /onPressIn=\{onLogIntent\}/u);
  assert.match(rails, /onHoverIn=\{onLogIntent\}/u);
  assert.match(rails, /onFocus=\{onLogIntent\}/u);
});
