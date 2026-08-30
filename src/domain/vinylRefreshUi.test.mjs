import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const nativeSource = readFileSync(new URL("../components/VinylRefreshBoundary.jsx", import.meta.url), "utf8");
const webSource = readFileSync(new URL("../components/VinylRefreshBoundary.web.jsx", import.meta.url), "utf8");
const touchMoveSource = webSource.slice(
  webSource.indexOf("const handleTouchMove"),
  webSource.indexOf("const handleTouchEnd"),
);

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

test("web returns the exact child for incapable devices and only marks phone scroll owners", () => {
  assert.match(webSource, /Children\.only\(children\)/);
  assert.match(webSource, /if \(!touchPhoneCapable\) return child;/);
  assert.match(webSource, /cloneElement\(child, \{/);
  assert.match(webSource, /dataSet:\s*\{ \.\.\.child\.props\.dataSet, pitRefreshScrollOwner: "true" \}/);
  assert.match(webSource, /style:\s*\[child\.props\.style, styles\.scrollOwner\]/);
  assert.match(webSource, /overscrollBehaviorY: "contain"/);
  assert.ok(
    webSource.indexOf("if (!touchPhoneCapable) return child;") < webSource.indexOf("const scrollChild = cloneElement"),
    "the incapable return must occur before cloning or merging child props",
  );
  assert.match(webSource, /boundaryRef\.current\?\.firstElementChild/);
  assert.match(webSource, /getAttribute\?\.\("data-pit-refresh-scroll-owner"\) !== "true"/);
  assert.doesNotMatch(webSource, /\bonTouchStart=|\bonTouchMove=|\bonTouchEnd=/);
});

test("web uses passive lifecycle touches and a single active move listener behind the phone gate", () => {
  assert.match(webSource, /if \(!touchPhoneCapable \|\| !canRefresh\) return undefined;[\s\S]*firstElementChild/);
  assert.match(webSource, /passiveCaptureOptions = \{ capture: true, passive: true \}/);
  assert.match(webSource, /activeMoveOptions = \{ capture: true, passive: false \}/);
  assert.match(webSource, /addEventListener\("touchstart", handleTouchStart, passiveCaptureOptions\)/);
  assert.match(webSource, /addEventListener\("touchmove", handleTouchMove, activeMoveOptions\)/);
  assert.match(webSource, /addEventListener\("touchend", handleTouchEnd, passiveCaptureOptions\)/);
  assert.match(webSource, /addEventListener\("touchcancel", cancelGesture, passiveCaptureOptions\)/);
  assert.match(webSource, /removeEventListener\("touchstart", handleTouchStart, passiveCaptureOptions\)/);
  assert.match(webSource, /removeEventListener\("touchmove", handleTouchMove, activeMoveOptions\)/);
  assert.match(touchMoveSource, /if \(!event\.cancelable && !wasClaimed\)/);
  assert.match(touchMoveSource, /if \(event\.cancelable && !event\.defaultPrevented\) event\.preventDefault\(\)/);
  assert.doesNotMatch(webSource, /stopPropagation\(/);
  assert.match(webSource, /visibilitychange/);
  assert.match(webSource, /pagehide/);
  assert.doesNotMatch(webSource, /userAgent|navigator\.platform|\biPad\b|\biPhone\b/);
});

test("web refresh uses one immediate latch and consumes sync and async callback failures", () => {
  assert.match(webSource, /if \(latch\.active \|\| refreshingRef\.current/);
  assert.match(webSource, /latch\.active = true;[\s\S]*latch\.promiseSettled = false;[\s\S]*refresh\(\)/);
  assert.match(webSource, /Promise\.resolve\(refreshResult\)\.then/);
  assert.match(webSource, /canReleaseWebRefreshLatch\(\{[\s\S]*promiseSettled:[\s\S]*refreshing:/);
  assert.match(webSource, /catch \{[\s\S]*latch\.promiseSettled = true;[\s\S]*releaseRefreshLatch\(\);[\s\S]*return true;/);
  assert.doesNotMatch(webSource, /catch \(error\)[\s\S]{0,160}throw error/);
  assert.match(webSource, /if \(refreshing\) showRefreshingIndicator\(\)/);
});

test("web pull frames update DOM refs without React renders and reduced motion stays fixed", () => {
  assert.doesNotMatch(touchMoveSource, /\bset[A-Z][A-Za-z]+\(/);
  assert.match(touchMoveSource, /showPullIndicator\(next\)/);
  assert.match(webSource, /indicator\.style\.opacity/);
  assert.match(webSource, /indicator\.setAttribute\("aria-valuenow"/);
  assert.match(webSource, /statusText\.textContent = value/);
  assert.match(webSource, /indicator\.style\.transform = reduceMotion \? "none"/);
  assert.match(webSource, /record\.style\.transform = reduceMotion[\s\S]*\? "rotate\(0deg\)"/);
  assert.match(webSource, /pointerEvents="none"/);
  assert.match(webSource, /useReducedMotion\(\)/);
  assert.match(webSource, /if \(!active \|\| reduceMotion \|\| typeof recordRef\.current\?\.animate !== "function"\)/);
  assert.match(webSource, /recordRef\.current\.animate\(/);
  assert.match(webSource, /return \(\) => animation\.cancel\(\)/);
  assert.match(webSource, /accessibilityLiveRegion="polite"/);
  assert.match(webSource, /accessibilityValue=\{refreshing \? \{ text: "Refreshing" \} : undefined\}/);
  assert.doesNotMatch(webSource, /now:\s*refreshing\s*\?\s*100/);
  assert.match(webSource, /removeProgressValue\(indicator\)/);
  assert.doesNotMatch(webSource, /\bPressable\b|<RefreshControl|accessibilityRole="button"/);
  assert.doesNotMatch(webSource, /react-native-reanimated|\bAnimated\b|\bEasing\b/);
  assert.doesNotMatch(webSource, /fetch\(|api\(|setInterval|setTimeout|requestAnimationFrame/);
  assert.doesNotMatch(nativeSource, /process\.env\.EXPO_OS|webButton/);
});
