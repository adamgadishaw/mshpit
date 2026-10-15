import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";

const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");
const feed = readFileSync(new URL("../screens/FeedScreen.jsx", import.meta.url), "utf8");
const rails = readFileSync(new URL("../components/Rails.jsx", import.meta.url), "utf8");

test("desktop rail does not pull optional feed panels back into the startup bundle", () => {
  assert.doesNotThrow(() => parse(rails, { sourceType: "module", plugins: ["jsx"] }));
  for (const name of ["HomeShowCountdown", "NewsRailPanel"]) {
    assert.ok(rails.includes(`const ${name} = lazyWithRetry(() => import(`));
    assert.ok(!rails.includes(`import ${name} from`));
  }
  assert.match(rails, /<Suspense fallback=\{<Text[^>]*>Loading music news…<\/Text>\}><NewsRailPanel/);
  assert.match(rails, /<Suspense fallback=\{<Text[^>]*>Loading your next show…<\/Text>\}><HomeShowCountdown/);
  assert.match(rails, /<Suspense fallback=\{<Text[^>]*>Loading show suggestions…<\/Text>\}><HomeShowCountdown/);
});

test("optional feed panels keep local loading boundaries without delaying the core feed", () => {
  assert.doesNotThrow(() => parse(feed, { sourceType: "module", plugins: ["jsx"] }));
  for (const name of ["HomeShowCountdown", "LiveCoverageCard"]) {
    assert.ok(feed.includes(`const ${name} = lazyWithRetry(() => import(`));
    assert.ok(!feed.includes(`import ${name} from`));
  }
  assert.match(feed, /<Suspense fallback=\{<Text[^>]*>Loading your next show…<\/Text>\}><HomeShowCountdown/);
  assert.match(feed, /<Suspense fallback=\{<Text[^>]*>Loading show suggestions…<\/Text>\}><HomeShowCountdown/);
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
