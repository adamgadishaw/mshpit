import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";

const app = readFileSync(new URL("../../App.js", import.meta.url), "utf8");

test("secondary primary tabs stay out of the first bundle and warm inside the selecting gesture", () => {
  assert.doesNotThrow(() => parse(app, { sourceType: "module", plugins: ["jsx"] }));
  assert.match(app, /import FeedScreen from "\.\/src\/screens\/FeedScreen"/);
  assert.match(app, /const SearchScreen = lazyWithRetry\(\(\) => import\("\.\/src\/screens\/SearchScreen"\), "SearchScreen"\)/);
  assert.match(app, /const YouScreen = lazyWithRetry\(\(\) => import\("\.\/src\/screens\/YouScreen"\), "YouScreen"\)/);
  assert.doesNotMatch(app, /import SearchScreen from "\.\/src\/screens\/SearchScreen"/);
  assert.doesNotMatch(app, /import YouScreen from "\.\/src\/screens\/YouScreen"/);
  assert.match(app, /if \(key === "search"\) SearchScreen\.preload\?\.\(\)/);
  assert.match(app, /if \(key === "you"\) YouScreen\.preload\?\.\(\)/);
  assert.match(app, /<Suspense fallback=\{<ScreenLoading \/>\}>\{tabScreens\}<\/Suspense>/);
});
