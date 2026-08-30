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

test("web keeps the shared boundary transparent and owns no refresh control", () => {
  assert.match(webSource, /function VinylRefreshBoundary\(\{ children, style, testID \}\)/);
  assert.match(webSource, /Children\.only\(children\)/);
  assert.match(webSource, /\{child\}/);
  assert.doesNotMatch(webSource, /\bPressable\b|<RefreshControl|accessibilityRole="button"/);
  assert.doesNotMatch(webSource, /\bonRefresh\b|\brequestRefresh\b|\bcanRefresh\b|\brefreshing\b/);
});

test("the web boundary cannot animate or initiate network work", () => {
  assert.doesNotMatch(webSource, /react-native-reanimated|\bAnimated\b|\bEasing\b|useReducedMotion/);
  assert.doesNotMatch(webSource, /fetch\(|api\(|setInterval|setTimeout/);
  assert.doesNotMatch(nativeSource, /process\.env\.EXPO_OS|webButton/);
});
