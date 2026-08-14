import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./PlayerBar.jsx", import.meta.url), "utf8");

test("mobile close rail owns touch-down before React Native resets gesture distance", () => {
  assert.match(source, /onStartShouldSetPanResponder:\s*shouldStart/);
  assert.match(source, /onStartShouldSetPanResponderCapture:\s*shouldStart/);
  assert.match(source, /onMoveShouldSetPanResponder:\s*\(\)\s*=>\s*false/);
  assert.doesNotMatch(source, /onStartShouldSetPanResponder:\s*\(\)\s*=>\s*false/);
});

test("mobile close rail is a dedicated full-size native touch target", () => {
  assert.match(source, /pointerEvents="box-only"/);
  assert.match(source, /collapsable=\{false\}/);
  assert.match(source, /minHeight:\s*PLAYER_CLOSE_RAIL_MIN_HEIGHT/);
  assert.match(source, /touchAction:\s*"none"/);
});
