import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";

const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const feed = readFileSync(new URL("../screens/FeedScreen.jsx", import.meta.url), "utf8");
const rails = readFileSync(new URL("../components/Rails.jsx", import.meta.url), "utf8");
const countdown = readFileSync(new URL("../components/OptionalHomeShowCountdown.jsx", import.meta.url), "utf8");

test("the isolated countdown keeps its implementation in an on-demand chunk", () => {
  assert.doesNotThrow(() => parse(countdown, { sourceType: "module", plugins: ["jsx"] }));
  assert.match(countdown, /Countdown = lazyWithRetry\(\(\) => import\("\.\/HomeShowCountdown"\), "HomeShowCountdown"\)/);
  assert.doesNotMatch(countdown, /import HomeShowCountdown from/);
  for (const source of [feed, rails]) {
    assert.doesNotMatch(source, /import HomeShowCountdown from|<HomeShowCountdown\b/);
    assert.equal((source.match(/<OptionalHomeShowCountdown\b/g) || []).length, 2);
    assert.match(source, /<OptionalHomeShowCountdown fallback=\{<Text[^>]*>Loading your next show…<\/Text>\}/);
    assert.match(source, /<OptionalHomeShowCountdown fallback=\{<Text[^>]*>Loading show suggestions…<\/Text>\}/);
  }
});

test("desktop rail does not pull optional feed panels back into the startup bundle", () => {
  assert.doesNotThrow(() => parse(rails, { sourceType: "module", plugins: ["jsx"] }));
  for (const name of ["NewsRailPanel"]) {
    assert.ok(rails.includes(`const ${name} = lazyWithRetry(() => import(`));
    assert.ok(!rails.includes(`import ${name} from`));
  }
  assert.match(rails, /<Suspense fallback=\{<Text[^>]*>Loading music news…<\/Text>\}><NewsRailPanel/);
});

test("optional feed panels keep local loading boundaries without delaying the core feed", () => {
  assert.doesNotThrow(() => parse(feed, { sourceType: "module", plugins: ["jsx"] }));
  for (const name of ["LiveCoverageCard"]) {
    assert.ok(feed.includes(`const ${name} = lazyWithRetry(() => import(`));
    assert.ok(!feed.includes(`import ${name} from`));
  }
  assert.match(feed, /<Suspense fallback=\{<Text[^>]*>Loading live coverage…<\/Text>\}><LiveCoverageCard/);
});

test("secondary primary tabs stay out of the first bundle and warm inside the selecting gesture", () => {
  assert.doesNotThrow(() => parse(app, { sourceType: "module", plugins: ["jsx"] }));
  assert.match(app, /import FeedScreen from "\.\/src\/screens\/FeedScreen"/);
  assert.match(app, /const SearchScreen = lazyWithRetry\(\(\) => import\("\.\/src\/screens\/SearchScreen"\), "SearchScreen"\)/);
  assert.match(app, /const YouScreen = lazyWithRetry\(\(\) => import\("\.\/src\/screens\/YouScreen"\), "YouScreen"\)/);
  assert.doesNotMatch(app, /import SearchScreen from "\.\/src\/screens\/SearchScreen"/);
  assert.doesNotMatch(app, /import YouScreen from "\.\/src\/screens\/YouScreen"/);
  assert.match(app, /if \(key === "search"\) SearchScreen\.preload\?\.\(\)/);
  assert.match(app, /if \(key === "you"\) YouScreen\.preload\?\.\(\)/);
  // The page transition may wrap the tabs, but only inside the boundary.
  assert.match(app, /<Suspense fallback=\{<ScreenLoading \/>\}>(?:<ScreenTransition [^>]*>)?\{tabScreens\}(?:<\/ScreenTransition>)?<\/Suspense>/);
});
