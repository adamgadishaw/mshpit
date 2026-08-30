import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const nativeSource = readFileSync(new URL("../components/VinylRefreshBoundary.jsx", import.meta.url), "utf8");
const webSource = readFileSync(new URL("../components/VinylRefreshBoundary.web.jsx", import.meta.url), "utf8");

test("vinyl refresh keeps React Native's controlled pull mechanism", () => {
  assert.match(nativeSource, /<RefreshControl/);
  assert.match(nativeSource, /refreshing=\{!!refreshing\}/);
  assert.match(nativeSource, /onRefresh=\{requestRefresh\}/);
  assert.match(nativeSource, /if \(!canRefresh \|\| refreshing\) return/);
  assert.match(nativeSource, /progressViewOffset=\{progressViewOffset\}/);
  assert.match(nativeSource, /enabled=\{canRefresh\}/);
  assert.match(nativeSource, /Children\.only\(children\)/);
  assert.match(nativeSource, /cloneElement\(child, \{ refreshControl \}\)/);
  assert.doesNotMatch(nativeSource, /PanResponder|GestureDetector|onScroll\s*=|setNativeProps/);
});

test("vinyl rotation runs on Reanimated and stops outside controlled refresh", () => {
  assert.match(nativeSource, /from "react-native-reanimated"/);
  assert.match(nativeSource, /useSharedValue\(0\)/);
  assert.match(nativeSource, /useAnimatedStyle/);
  assert.match(nativeSource, /withRepeat\([\s\S]*withTiming\(360/);
  assert.match(nativeSource, /Easing\.linear/);
  assert.match(nativeSource, /cancelAnimation\(rotation\)/);
  assert.match(nativeSource, /if \(active && !reduceMotion\)/);
  assert.match(nativeSource, /if \(!refreshing\) return null/);
  assert.doesNotMatch(nativeSource, /requestAnimationFrame|setInterval|setTimeout|Animated\.timing|useState/);
});

test("reduced motion, theming, and refresh status are first-class", () => {
  assert.match(nativeSource, /useReducedMotion\(\)/);
  assert.match(nativeSource, /active && !reduceMotion/);
  assert.match(nativeSource, /colors\.(?:bgElev|surface|amberStrong|textDim)/);
  assert.match(nativeSource, /themeIsDark/);
  assert.match(nativeSource, /accessibilityRole="progressbar"/);
  assert.match(nativeSource, /accessibilityLiveRegion="polite"/);
  assert.match(nativeSource, /accessibilityValue=\{\{ text: "Refreshing" \}\}/);
});

test("web has a compact keyboard-accessible refresh fallback", () => {
  assert.match(webSource, /accessibilityRole="button"/);
  assert.match(webSource, /Press Enter or Space to refresh/);
  assert.match(webSource, /accessibilityState=\{\{ disabled: !canRefresh \|\| refreshing, busy: !!refreshing \}\}/);
  assert.match(webSource, /focused && focusRing/);
  assert.match(webSource, /minHeight: 44/);
  assert.match(webSource, /Children\.only\(children\)/);
  assert.match(webSource, /Animated\.loop\([\s\S]*Animated\.timing/);
  assert.match(webSource, /useReducedMotion\(\)/);
  assert.match(webSource, /accessibilityRole="progressbar"/);
});

test("the web boundary avoids native animation runtime and network work", () => {
  assert.doesNotMatch(webSource, /react-native-reanimated|<RefreshControl/);
  assert.doesNotMatch(webSource, /fetch\(|api\(|setInterval|setTimeout/);
  assert.doesNotMatch(nativeSource, /process\.env\.EXPO_OS|webButton/);
});
