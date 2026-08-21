import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (name) => readFileSync(new URL(`../components/${name}.jsx`, import.meta.url), "utf8");

test("shared buttons expose loading, busy, disabled, and 44 point compact states", () => {
  const button = source("Button");
  const sheet = source("SheetHeader");
  assert.match(button, /const blocked = !!disabled \|\| loading/);
  assert.match(button, /accessibilityState=\{\{ disabled: blocked, busy: loading \}\}/);
  assert.match(button, /ActivityIndicator/);
  assert.match(button, /small: \{[^}]*minHeight: 44/);
  assert.match(sheet, /actionBlocked = !!action\?\.disabled \|\| !!action\?\.loading/);
  assert.match(sheet, /accessibilityState=\{\{ disabled: actionBlocked, busy: !!action\.loading \}\}/);
  assert.match(sheet, /lead: \{ width: 44, height: 44/);
});

test("shared headers identify page headings and configurable navigation labels", () => {
  const screen = source("ScreenHeader");
  const sheet = source("SheetHeader");
  assert.match(screen, /backLabel = "Go back"/);
  assert.match(screen, /accessibilityHint=\{backHint\}/);
  assert.match(screen, /accessibilityRole="header"/);
  assert.match(sheet, /accessibilityRole="header"/);
  assert.match(sheet, /accessibilityHint=\{leadHint\}/);
});

test("crash recovery announces the error and requires reset confirmation", () => {
  const boundary = source("ErrorBoundary");
  assert.match(boundary, /accessibilityLiveRegion="assertive"/);
  assert.match(boundary, /resetArmed/);
  assert.match(boundary, /Tap again to confirm reset/);
  assert.match(boundary, /setTimeout\(\(\) => this\.setState\(\{ resetArmed: false \}\), 8000\)/);
  assert.match(boundary, /componentWillUnmount\(\)/);
  assert.match(boundary, /focused && focusRing/);
  assert.match(boundary, /pressed && styles\.buttonPressed/);
});

test("feedback controls are large and use severity-aware announcements", () => {
  const feedback = source("FeedbackHost");
  assert.match(feedback, /entry\.severity === "info" \? "polite" : "assertive"/);
  assert.match(feedback, /detailsButton: \{ minHeight: 44/);
  assert.match(feedback, /close: \{ width: 44, height: 44/);
  assert.match(feedback, /focused && focusRing/);
});

test("avatars and ratings have one concise accessible identity", () => {
  const avatar = source("Avatar");
  const stars = source("Stars");
  assert.match(avatar, /accessible=\{false\}/);
  assert.match(avatar, /accessibilityLabel=\{`Open \$\{profileName\}'s profile`\}/);
  assert.match(avatar, /accessibilityRole="image"/);
  assert.match(avatar, /focused && focusRing/);
  assert.match(stars, /accessibilityLabel=\{`\$\{rating\.toFixed\(1\)\} out of 5 stars`\}/);
  assert.match(stars, /Math\.max\(0, Math\.min\(5/);
});

test("account menu is a modal menu with stable, disabled-aware actions", () => {
  const menu = source("AccountMenu");
  assert.match(menu, /accessibilityRole="menu"/);
  assert.match(menu, /accessible=\{false\}/);
  assert.match(menu, /accessibilityViewIsModal/);
  assert.match(menu, /onAccessibilityEscape=\{onClose\}/);
  assert.match(menu, /key=\{it\.key \|\| it\.label\}/);
  assert.match(menu, /accessibilityRole="menuitem"/);
  assert.match(menu, /accessibilityState=\{\{ disabled: !!it\.disabled \}\}/);
  assert.match(menu, /item: \{ minHeight: 44/);
  assert.match(menu, /focused && focusRing/);
});

test("location picker virtualizes named navigation choices", () => {
  const picker = source("LocationPicker");
  assert.match(picker, /FlatList/);
  assert.match(picker, /accessibilityLabel=\{depth \? `Back to/);
  assert.match(picker, /accessibilityLiveRegion="polite"/);
  assert.match(picker, /keyboardShouldPersistTaps="handled"/);
  assert.match(picker, /accessibilityHint=\{depth === 3/);
  assert.match(picker, /row: \{ minHeight: 48/);
  assert.match(picker, /focused && focusRing/);
});

test("theme and rating controls expose checked, focus, and bounded values", () => {
  const theme = source("ThemeSwatch");
  const rating = source("TapStars");
  assert.match(theme, /focused && focusRing/);
  assert.match(theme, /checked: !!active/);
  assert.doesNotMatch(theme, /disabled=\{active\}/);
  assert.match(rating, /const rating = Math\.max\(0, Math\.min\(5/);
  assert.match(rating, /accessibilityHint="Swipe up or down to change the rating by half a star"/);
  assert.match(rating, /now: rating/);
  assert.match(rating, /key === "Home"/);
  assert.match(rating, /key === "End"/);
  assert.match(rating, /focused && focusRing/);
});
